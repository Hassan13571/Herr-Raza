function restrictedTopic(t){
  return /(?:waffe|pistole|gewehr|munition|messer|sprengstoff|bombe|drogen|cannabis|thc|kokain|heroin|meth|vape|zigarette|nikotin|alkohol|porno|pornografie|glücksspiel|casino|wetten|betting)/i.test(t);
}
function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
function safeText(s,n=6000){return clean(s).slice(0,n);}
function difficultyText(d){
  return {
    easy:'Einfach: Grundwissen, klare Begriffe, direkte Zusammenhänge.',
    medium:'Mittel: Verständnis, typische Anwendungen und Ursachen/Folgen.',
    hard:'Schwer: Transfer, präzise Fachbegriffe und anspruchsvolle Zusammenhänge.',
    expert:'Sehr schwer: mehrere Denkschritte, feine Unterschiede und anspruchsvoller Transfer; trotzdem fair und eindeutig.'
  }[d]||'Mittel';
}

async function wikiJSON(params){
  const url='https://de.wikipedia.org/w/api.php?'+new URLSearchParams({...params,format:'json',origin:'*'}).toString();
  const r=await fetch(url,{headers:{
    'User-Agent':'Herr-Raza-Quiz/4.0 (https://herr-raza-k11j-ras-projects-f153c026.vercel.app/) educational quiz',
    'Api-User-Agent':'Herr-Raza-Quiz/4.0 (https://herr-raza-k11j-ras-projects-f153c026.vercel.app/)',
    'Accept':'application/json'
  }});
  if(!r.ok){
    const e=new Error('Wikipedia HTTP '+r.status);
    e.status=r.status;
    e.retryAfter=r.headers.get('retry-after');
    throw e;
  }
  return r.json();
}

async function wikiContext(topic){
  let pages=[];
  try{
    const direct=await wikiJSON({action:'query',prop:'extracts',explaintext:'1',exintro:'1',redirects:'1',titles:topic,formatversion:'2'});
    pages=((direct.query&&direct.query.pages)||[]).filter(x=>x.extract&&!x.missing);
  }catch(e){
    if(e.status===429)throw e;
  }
  if(!pages.length){
    const found=await wikiJSON({action:'query',generator:'search',gsrsearch:topic,gsrlimit:'3',prop:'extracts',explaintext:'1',exintro:'1',redirects:'1',formatversion:'2'});
    pages=((found.query&&found.query.pages)||[]).filter(x=>x.extract);
  }
  if(!pages.length)return {context:'',sources:[]};
  return {
    context:pages.map((x,i)=>'['+i+'] '+x.title+': '+safeText(x.extract,1800)).join('\n\n').slice(0,6500),
    sources:pages.map(x=>({title:'Wikipedia: '+x.title,url:'https://de.wikipedia.org/wiki/'+encodeURIComponent(x.title.replace(/ /g,'_'))}))
  };
}

async function gdeltContext(topic){
  const url='https://api.gdeltproject.org/api/v2/doc/doc?'+new URLSearchParams({
    query:topic,
    mode:'artlist',
    maxrecords:'10',
    format:'json',
    sort:'datedesc'
  }).toString();
  const r=await fetch(url,{headers:{'User-Agent':'Herr-Raza-Quiz/4.0 educational quiz','Accept':'application/json'}});
  if(!r.ok)throw new Error('Live-Suche HTTP '+r.status);
  const d=await r.json();
  const articles=(d.articles||[]).filter(a=>a&&a.title&&/^https?:\/\//.test(String(a.url||''))).slice(0,8);
  return {
    context:articles.map((a,i)=>'['+i+'] '+safeText(a.title,300)+' | '+safeText(a.domain||'Web',80)+' | '+safeText(a.seendate||'',40)).join('\n'),
    sources:articles.map(a=>({title:safeText(a.domain||a.title,100),url:String(a.url)}))
  };
}

async function buildGrounding(topic,mode){
  let wiki={context:'',sources:[]};
  try{wiki=await wikiContext(topic);}catch(e){if(e.status!==429)console.warn('wiki',e.message);}
  if(mode!=='live')return wiki;
  let live={context:'',sources:[]};
  try{live=await gdeltContext(topic);}catch(e){console.warn('gdelt',e.message);}
  const sources=[...wiki.sources.slice(0,3),...live.sources.slice(0,7)];
  const chunks=[];
  if(wiki.context)chunks.push('HINTERGRUNDWISSEN:\n'+wiki.context);
  if(live.context){
    const offset=wiki.sources.slice(0,3).length;
    const shifted=live.context.replace(/^\[(\d+)\]/gm,(_,n)=>'['+(Number(n)+offset)+']');
    chunks.push('AKTUELLE WEB-MELDUNGEN:\n'+shifted);
  }
  return {context:chunks.join('\n\n').slice(0,8000),sources};
}

async function gatewayText(prompt){
  const {generateText}=await import('ai');
  const result=await generateText({
    model:'inclusionai/ling-3.1-flash-free',
    prompt,
    temperature:0.2,
    maxOutputTokens:2800
  });
  if(!result||!result.text)throw new Error('Vercel AI hat keine Antwort geliefert.');
  return result.text;
}

function parseJSON(raw){
  const s=String(raw||'').replace(/\uFEFF/g,'').trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  try{return JSON.parse(s);}catch{}
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a>=0&&b>a)return JSON.parse(s.slice(a,b+1));
  throw new Error('KI-Antwort war nicht gültiges JSON.');
}

function validateQuestions(data,count,sources){
  const arr=Array.isArray(data)?data:Array.isArray(data&&data.questions)?data.questions:[];
  const seen=new Set(),out=[];
  for(const x of arr){
    if(!x||!x.q||!Array.isArray(x.options)||x.options.length!==4)continue;
    const options=x.options.map(v=>clean(v));
    if(options.some(v=>!v)||new Set(options.map(v=>v.toLowerCase())).size!==4)continue;
    const correct=Number(x.correct);
    if(!Number.isInteger(correct)||correct<0||correct>3)continue;
    const q=clean(x.q);
    if(q.length<8||seen.has(q.toLowerCase()))continue;
    seen.add(q.toLowerCase());
    const idx=Number(x.sourceIndex);
    const src=Number.isInteger(idx)&&idx>=0&&idx<sources.length?sources[idx]:null;
    out.push({
      q,
      options,
      correct,
      explanation:clean(x.explanation||('Richtig ist: '+options[correct])),
      source:src?src.title:'KI-Wissensmodell',
      sourceUrl:src?src.url:''
    });
    if(out.length>=count)break;
  }
  return out;
}

function makePrompt(topic,count,difficulty,mode,grounding){
  const hasSources=grounding.sources.length>0&&grounding.context;
  const sourceList=grounding.sources.map((s,i)=>i+': '+s.title).join('\n');
  return [
    'Du bist ein sehr guter deutscher Lehrer und Quizautor.',
    'Erstelle ein sicheres, altersgerechtes Multiple-Choice-Quiz.',
    'THEMA: '+topic,
    'SCHWIERIGKEIT: '+difficultyText(difficulty),
    'ANZAHL: '+count,
    'MODUS: '+(mode==='live'?'Aktuelle Internetinformationen':'Schulwissen'),
    '',
    'REGELN:',
    '- Normale Fragen, KEINE Lückensätze und KEINE Frage nach dem Namen eines Artikels.',
    '- Genau vier Antwortmöglichkeiten und genau eine eindeutig richtige Antwort.',
    '- Falsche Antworten sollen plausibel, aber klar falsch sein.',
    '- Keine Trickfragen, keine doppelten Fragen, kein "Alle Antworten".',
    '- Bei gefährlichen oder altersbeschränkten Themen niemals praktische Anleitungen, Beschaffung, Dosierungen oder Umgehung von Regeln.',
    hasSources?'- Nutze für überprüfbare Fakten bevorzugt den Quellenkontext. sourceIndex muss auf eine passende Quelle zeigen.':'- Es sind gerade keine externen Quellen verfügbar. Nutze nur stabiles, allgemein anerkanntes Wissen und setze sourceIndex auf -1.',
    mode==='live'?'- Frage aktuelle Fakten NUR ab, wenn sie ausdrücklich in den aktuellen Web-Meldungen stehen.':'',
    '',
    hasSources?'QUELLEN:\n'+sourceList+'\n\nKONTEXT:\n'+grounding.context:'',
    '',
    'Antworte NUR als gültiges JSON in diesem Format:',
    '{"questions":[{"q":"Frage","options":["A","B","C","D"],"correct":0,"explanation":"kurze Begründung","sourceIndex":0}]}',
    'Erzeuge genau '+count+' unterschiedliche Fragen.'
  ].filter(Boolean).join('\n');
}

async function aiQuiz(topic,count,difficulty,mode){
  const grounding=await buildGrounding(topic,mode);
  const raw=await gatewayText(makePrompt(topic,count,difficulty,mode,grounding));
  const parsed=parseJSON(raw);
  const qs=validateQuestions(parsed,count,grounding.sources);
  if(qs.length<Math.min(3,count))throw new Error('KI konnte nicht genug gültige Fragen erzeugen.');
  return qs;
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=7200');
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'Nur GET ist erlaubt.'});
  const topic=clean(req.query.topic).slice(0,100);
  const count=Math.min(15,Math.max(3,Number(req.query.count)||10));
  const difficulty=['easy','medium','hard','expert'].includes(req.query.difficulty)?req.query.difficulty:'medium';
  const mode=req.query.mode==='live'?'live':'school';
  if(!topic)return res.status(400).json({error:'Bitte ein Thema angeben.'});
  if(restrictedTopic(topic))return res.status(400).json({error:'Dieses Thema ist für die Quiz-Suche nicht verfügbar.'});
  try{
    const questions=await aiQuiz(topic,count,difficulty,mode);
    return res.status(200).json({topic,count:questions.length,difficulty,mode,questions,engine:'vercel-ai-gateway-free'});
  }catch(err){
    console.error('quiz-error',err);
    return res.status(502).json({error:'Das Quiz konnte gerade nicht erstellt werden.',details:String(err&&err.message||err)});
  }
};