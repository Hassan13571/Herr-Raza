const {generateFreeText,publicAIError,FreeAIError}=require('../lib/free-ai');

function restrictedTopic(t){
  return /(?:waffe|pistole|gewehr|munition|messer|sprengstoff|bombe|drogen|cannabis|thc|kokain|heroin|meth|vape|zigarette|nikotin|alkohol|porno|pornografie|glücksspiel|casino|wetten|betting)/i.test(t);
}
function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
function safeText(s,n=6000){return clean(s).slice(0,n);}
function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;}
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
  const r=await fetch(url,{signal:AbortSignal.timeout(3000),headers:{
    'User-Agent':'Herr-Raza-Quiz/5.0 (https://herr-raza-k11j-ras-projects-f153c026.vercel.app/) educational quiz',
    'Api-User-Agent':'Herr-Raza-Quiz/5.0 (https://herr-raza-k11j-ras-projects-f153c026.vercel.app/)',
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
    const direct=await wikiJSON({action:'query',prop:'extracts',explaintext:'1',redirects:'1',titles:topic,formatversion:'2'});
    pages=((direct.query&&direct.query.pages)||[]).filter(x=>x.extract&&!x.missing);
  }catch(e){if(e.status===429)throw e;}
  if(!pages.length){
    const found=await wikiJSON({action:'query',generator:'search',gsrsearch:topic,gsrlimit:'3',prop:'extracts',explaintext:'1',exintro:'1',redirects:'1',formatversion:'2'});
    pages=((found.query&&found.query.pages)||[]).filter(x=>x.extract);
  }
  const items=pages.slice(0,3).map(x=>({
    source:{title:'Wikipedia: '+x.title,url:'https://de.wikipedia.org/wiki/'+encodeURIComponent(x.title.replace(/ /g,'_'))},
    text:safeText(x.extract,6000),
    kind:'background'
  }));
  return {items};
}

async function duckContext(topic){
  const url='https://api.duckduckgo.com/?'+new URLSearchParams({
    q:topic,format:'json',no_html:'1',no_redirect:'1',skip_disambig:'1'
  }).toString();
  const r=await fetch(url,{signal:AbortSignal.timeout(3000),headers:{'User-Agent':'Herr-Raza-Quiz/5.0 educational quiz','Accept':'application/json'}});
  if(!r.ok)throw new Error('DuckDuckGo HTTP '+r.status);
  const d=await r.json();
  const text=clean(d.AbstractText||d.Definition||(typeof d.Answer==='string'?d.Answer:''));
  if(!text)return {items:[]};
  const underlying=clean(d.AbstractSource||d.DefinitionSource||'Instant Answer');
  return {items:[{
    source:{title:'DuckDuckGo / '+underlying,url:'https://duckduckgo.com/?q='+encodeURIComponent(topic)},
    text:safeText(text,2600),
    kind:'background'
  }]};
}

async function gdeltContext(topic){
  const url='https://api.gdeltproject.org/api/v2/doc/doc?'+new URLSearchParams({
    query:topic,mode:'artlist',maxrecords:'10',format:'json',sort:'datedesc'
  }).toString();
  const r=await fetch(url,{signal:AbortSignal.timeout(3000),headers:{'User-Agent':'Herr-Raza-Quiz/5.0 educational quiz','Accept':'application/json'}});
  if(!r.ok)throw new Error('Live-Suche HTTP '+r.status);
  const d=await r.json();
  const articles=(d.articles||[]).filter(a=>a&&a.title&&/^https?:\/\//.test(String(a.url||''))).slice(0,8);
  return {items:articles.map(a=>({
    source:{title:safeText(a.domain||'Webquelle',100),url:String(a.url)},
    text:safeText(a.title,300)+(a.seendate?' | Datum: '+safeText(a.seendate,40):''),
    kind:'live'
  }))};
}

function decodeXml(s){
  return String(s||'')
    .replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
}
async function googleNewsContext(topic){
  const url='https://news.google.com/rss/search?'+new URLSearchParams({
    q:topic,hl:'de',gl:'DE',ceid:'DE:de'
  }).toString();
  const r=await fetch(url,{signal:AbortSignal.timeout(3000),headers:{'User-Agent':'Herr-Raza-Quiz/5.1 educational quiz','Accept':'application/rss+xml, application/xml, text/xml'}});
  if(!r.ok)throw new Error('News-RSS HTTP '+r.status);
  const xml=await r.text();
  const blocks=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,8);
  const items=[];
  for(const m of blocks){
    const b=m[1];
    const pick=re=>{const x=b.match(re);return x?decodeXml(x[1]):'';};
    const title=pick(/<title>([\s\S]*?)<\/title>/i);
    const link=pick(/<link>([\s\S]*?)<\/link>/i);
    const date=pick(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const source=pick(/<source[^>]*>([\s\S]*?)<\/source>/i);
    if(!title||!/^https?:\/\//.test(link))continue;
    items.push({
      source:{title:'News: '+(source||'Google News'),url:link},
      text:safeText(title,300)+(date?' | Datum: '+safeText(date,60):''),
      kind:'live'
    });
  }
  return {items};
}

function normalizeGrounding(items){
  const list=(items||[]).filter(x=>x&&x.source&&x.text).slice(0,10);
  const sources=list.map(x=>x.source);
  const normalized=list.map((x,i)=>({sourceIndex:i,text:x.text,kind:x.kind||'background'}));
  const context=normalized.map(x=>'['+x.sourceIndex+'] '+sources[x.sourceIndex].title+': '+x.text).join('\n\n').slice(0,9000);
  return {sources,items:normalized,context};
}

async function buildGrounding(topic,mode){
  let background={items:[]};
  try{background=await wikiContext(topic);}catch(e){console.warn('wiki',e.message);}
  if(!background.items.length){
    try{background=await duckContext(topic);}catch(e){console.warn('duck',e.message);}
  }
  if(mode!=='live')return normalizeGrounding(background.items);
  let live={items:[]};
  try{live=await gdeltContext(topic);}catch(e){console.warn('gdelt',e.message);}
  if(!live.items.length){try{live=await googleNewsContext(topic);}catch(e){console.warn('news-rss',e.message);}}
  return normalizeGrounding([...background.items.slice(0,3),...live.items.slice(0,7)]);
}

function parseQuizText(raw,count,sources){
  const jsonText=String(raw||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();
  const candidates=[jsonText];
  for(const [open,close] of [['{','}'],['[',']']]){
    const start=jsonText.indexOf(open),end=jsonText.lastIndexOf(close);
    if(start>=0&&end>start)candidates.push(jsonText.slice(start,end+1));
  }
  for(const candidate of candidates){
    try{
      const data=JSON.parse(candidate),list=Array.isArray(data)?data:data.questions;
      if(!Array.isArray(list))continue;
      const out=[],seen=new Set();
      for(const item of list){
        if(!item||typeof item!=='object')continue;
        const q=clean(item.q||item.question),opts=item.options;
        if(!q||!Array.isArray(opts)||opts.length!==4||opts.some(x=>typeof x!=='string'||!clean(x)))continue;
        const options=opts.map(clean);
        if(new Set(options.map(x=>x.toLowerCase())).size!==4||seen.has(q.toLowerCase()))continue;
        const supplied=item.correct;
        const correct=typeof supplied==='string'&&/^[ABCD]$/i.test(supplied)?'ABCD'.indexOf(supplied.toUpperCase()):supplied;
        if(!Number.isInteger(correct)||correct<0||correct>3)continue;
        const idx=item.sourceIndex,src=Number.isInteger(idx)&&idx>=0&&idx<sources.length?sources[idx]:null;
        out.push({q,options,correct,explanation:clean(item.explanation||('Richtig ist: '+options[correct])),source:src?src.title:'KI-Wissensmodell',sourceUrl:src?src.url:''});
        seen.add(q.toLowerCase());
        if(out.length>=count)break;
      }
      if(out.length)return out;
    }catch{}
  }
  const lines=String(raw||'').replace(/\r/g,'').replace(/\x60\x60\x60(?:text)?/gi,'').split('\n');
  const blocks=[];let cur={};
  const push=()=>{if(Object.keys(cur).length){blocks.push(cur);cur={};}};
  for(let rawLine of lines){
    let line=rawLine.trim().replace(/^[-*]\s*/,'').replace(/\*\*/g,'');
    if(!line)continue;
    if(/^END\b/i.test(line)){push();continue;}
    const m=line.match(/^(QUESTION(?:\s+\d+)?|A|B|C|D|CORRECT|WHY|SOURCE)\s*(?:\||:|\)|\.)\s*(.*)$/i);
    if(!m)continue;
    let key=m[1].toUpperCase();
    if(key.startsWith('QUESTION'))key='QUESTION';
    if(key==='QUESTION'&&cur.QUESTION)push();
    cur[key]=m[2].trim();
  }
  push();
  const out=[],seen=new Set();
  for(const b of blocks){
    const q=b.QUESTION,options=[b.A,b.B,b.C,b.D].map(clean);
    const corr=clean(b.CORRECT).toUpperCase().replace(/[^ABCD]/g,'').slice(0,1);
    const correct='ABCD'.indexOf(corr);
    if(!q||options.some(x=>!x)||correct<0)continue;
    if(new Set(options.map(x=>x.toLowerCase())).size!==4)continue;
    const qn=clean(q);if(seen.has(qn.toLowerCase()))continue;seen.add(qn.toLowerCase());
    const idx=clean(b.SOURCE)?Number(clean(b.SOURCE)):-1;
    const src=Number.isInteger(idx)&&idx>=0&&idx<sources.length?sources[idx]:null;
    out.push({
      q:qn,options,correct,
      explanation:clean(b.WHY||('Richtig ist: '+options[correct])),
      source:src?src.title:'KI-Wissensmodell',
      sourceUrl:src?src.url:''
    });
    if(out.length>=count)break;
  }
  return out;
}

function sourceFacts(grounding){
  const facts=[];
  for(const item of grounding.items||[]){
    if(item.kind==='live'){
      const t=clean(item.text.replace(/\s*\|\s*Datum:.*$/,''));
      if(t.length>=25)facts.push({text:t,sourceIndex:item.sourceIndex,kind:'live'});
      continue;
    }
    const prepared=String(item.text||'').replace(/={2,}[^=]+={2,}/g,'. ');
    const sentences=prepared.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/u);
    for(const s of sentences){
      const t=clean(s);
      if(t.length>=35&&t.length<=280)facts.push({text:t,sourceIndex:item.sourceIndex,kind:'background'});
    }
  }
  return facts;
}
function addQuestion(out,seen,q,options,correctAnswer,explanation,src,count){
  if(out.length>=count)return;
  const opts=[...new Set(options.map(clean).filter(Boolean))];
  if(opts.length!==4)return;
  const shuffled=shuffle(opts);
  const correct=shuffled.indexOf(clean(correctAnswer));
  if(correct<0)return;
  const key=clean(q).toLowerCase();
  if(seen.has(key))return;
  seen.add(key);
  out.push({
    q:clean(q),options:shuffled,correct,
    explanation:clean(explanation),
    source:src?src.title:'Quellenmaterial',
    sourceUrl:src?src.url:''
  });
}
function numericInfo(sentence){
  const m=sentence.match(/\b(\d{1,4}(?:[.,]\d+)?)(\s*(?:%|°C|km|m|Mio\.?|Millionen?|Milliarden?))?\b/);
  if(!m)return null;
  const n=Number(m[1].replace(',','.')); if(!Number.isFinite(n))return null;
  const suffix=m[2]||'';
  const format=v=>(Number.isInteger(v)?String(v):String(Math.round(v*100)/100).replace('.',','))+suffix;
  let vals;
  if(n>=1000&&n<=2100)vals=[n-10,n-1,n+1,n+10];
  else if(n===0)vals=[1,2,5,10];
  else vals=[Math.max(0,n-1),n+1,Math.max(0,Math.round(n*0.5*100)/100),Math.round(n*2*100)/100];
  const wrong=[...new Set(vals.map(format).filter(x=>x!==m[0]))].slice(0,3);
  if(wrong.length<3)return null;
  return {answer:m[0],wrong};
}
function subjectCue(sentence,topic){
  const m=sentence.match(/^(.{3,85}?)\s+(?:ist|sind|war|waren|wurde|wurden|hat|haben|liegt|liegen|entsteht|entstehen|bezeichnet|besteht|führt|führte|umfasst|enthält)\b/i);
  if(m){const cue=clean(m[1]).slice(0,85);if(!/^(sie|er|es|dieser|diese|dieses|dabei|dort|hier)$/i.test(cue))return cue;}
  const first=clean(sentence.split(/[,;:]/)[0]).split(' ').slice(0,7).join(' ');
  return first||topic;
}
function definitionPairs(facts){
  const out=[];
  for(const f of facts){
    const m=f.text.match(/^(.{3,90}?)\s+(ist|sind|war|waren|wird|werden|bezeichnet|besteht aus|umfasst|enthält)\s+(.{12,190})$/i);
    if(!m)continue;
    const subject=clean(m[1]);if(/^(sie|er|es|dieser|diese|dieses|dabei|dort|hier)$/i.test(subject))continue;out.push({subject,verb:m[2].toLowerCase(),predicate:clean(m[3]),fact:f});
  }
  return out;
}
function liveQuestions(topic,count,grounding,out,seen){
  const live=(grounding.items||[]).filter(x=>x.kind==='live');
  const bySource=new Map();
  for(const x of live){
    const name=grounding.sources[x.sourceIndex]?.title||'';
    if(!name)continue;
    bySource.set(name,(bySource.get(name)||0)+1);
  }
  for(const item of live){
    if(out.length>=count)break;
    const src=grounding.sources[item.sourceIndex]; if(!src||bySource.get(src.title)!==1)continue;
    const answer=clean(item.text.replace(/\s*\|\s*Datum:.*$/,''));
    const alternatives=shuffle(live.filter(x=>x.sourceIndex!==item.sourceIndex).map(x=>clean(x.text.replace(/\s*\|\s*Datum:.*$/,''))).filter(Boolean));
    const wrong=[...new Set(alternatives.filter(x=>x!==answer))].slice(0,3);
    if(wrong.length<3)continue;
    addQuestion(out,seen,'Welche aktuelle Meldung stammt aus der Quelle „'+src.title+'“?',[answer,...wrong],answer,'Diese Meldung wurde im aktuellen Nachrichtenfeed dieser Quelle gefunden.',src,count);
  }
}
function deterministicQuestions(topic,count,difficulty,grounding,exclude){
  const facts=sourceFacts(grounding);
  const out=[],seen=new Set(exclude||[]);
  if((grounding.items||[]).some(x=>x.kind==='live'))liveQuestions(topic,count,grounding,out,seen);

  const background=facts.filter(x=>x.kind!=='live');
  const ordered=[...background].sort((a,b)=>{
    const score=x=>{
      let s=0;
      if(/\b\d/.test(x.text))s+=difficulty==='hard'||difficulty==='expert'?6:3;
      if(/\b(?:weil|dadurch|deshalb|während|führt|Folge|Ursache|durch|aufgrund)\b/i.test(x.text))s+=difficulty==='hard'||difficulty==='expert'?5:1;
      if(x.text.length>=70&&x.text.length<=190)s+=3;
      return s;
    };
    return score(b)-score(a);
  });

  for(const f of ordered){
    if(out.length>=count)break;
    const ni=numericInfo(f.text); if(!ni)continue;
    const cue=subjectCue(f.text,topic);
    const src=grounding.sources[f.sourceIndex]||null;
    addQuestion(out,seen,'Welche Zahlenangabe nennt die Quelle im Zusammenhang mit „'+cue+'“?',[ni.answer,...ni.wrong],ni.answer,'Die Quelle nennt die Angabe '+ni.answer+'.',src,count);
  }

  const defs=definitionPairs(background);
  const predicates=[...new Set(defs.map(x=>x.predicate))];
  for(const d of defs){
    if(out.length>=count)break;
    const wrong=shuffle(predicates.filter(x=>x!==d.predicate&&x.length<210)).slice(0,3);
    if(wrong.length<3)continue;
    const src=grounding.sources[d.fact.sourceIndex]||null;
    const verb=d.verb;
    let q;
    if(verb==='ist'||verb==='war'||verb==='wird')q='Welche Beschreibung trifft laut Quelle auf „'+d.subject+'“ zu?';
    else q='Welche Aussage über „'+d.subject+'“ entspricht der Quelle?';
    addQuestion(out,seen,q,[d.predicate,...wrong],d.predicate,'Die Quelle beschreibt „'+d.subject+'“ so: '+d.predicate,src,count);
  }

  // Last-resort statement questions, but only when we can create clean numerical/antonym variants.
  const swaps=[
    [/\bsteigt\b/i,'sinkt'],[/\bsinkt\b/i,'steigt'],[/\bmehr\b/i,'weniger'],[/\bweniger\b/i,'mehr'],
    [/\bhöher\b/i,'niedriger'],[/\bniedriger\b/i,'höher'],[/\bgrößer\b/i,'kleiner'],[/\bkleiner\b/i,'größer']
  ];
  for(const f of ordered){
    if(out.length>=count)break;
    const variants=[];
    const ni=numericInfo(f.text);
    if(ni)for(const x of ni.wrong)variants.push(f.text.replace(ni.answer,x));
    for(const [re,to] of swaps)if(re.test(f.text))variants.push(f.text.replace(re,to));
    const wrong=[...new Set(variants.filter(x=>x!==f.text))].slice(0,3);
    if(wrong.length<3)continue;
    const src=grounding.sources[f.sourceIndex]||null;
    addQuestion(out,seen,'Welche präzise Aussage zu „'+subjectCue(f.text,topic)+'“ ist laut Quelle korrekt?',[f.text,...wrong],f.text,'Die Quelle nennt: '+f.text,src,count);
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
    hasSources?'- Nutze für überprüfbare Fakten bevorzugt den Quellenkontext. sourceIndex muss auf eine passende Quellen-Nummer zeigen.':'- Nutze nur stabiles, allgemein anerkanntes Wissen und setze sourceIndex auf -1.',
    mode==='live'?'- Frage aktuelle Fakten NUR ab, wenn sie ausdrücklich in den aktuellen Web-Meldungen stehen.':'',
    '',
    hasSources?'QUELLEN:\n'+sourceList+'\n\nKONTEXT:\n'+grounding.context:'',
    '',
    'Antworte NUR mit einem gültigen JSON-Objekt, ohne Markdown und ohne zusätzlichen Text.',
    'Format: {"questions":[{"q":"Fragetext","options":["Antwort A","Antwort B","Antwort C","Antwort D"],"correct":0,"explanation":"Kurze Begründung","sourceIndex":-1}]}',
    'correct ist der Index der richtigen Antwort: 0=A, 1=B, 2=C, 3=D.',
    'sourceIndex ist die Nummer der verwendeten Quelle oder -1, wenn keine Quelle passt.',
    'Erzeuge genau '+count+' unterschiedliche Fragen.'
  ].filter(Boolean).join('\n');
}

async function createQuiz(topic,count,difficulty,mode){
  const grounding=await buildGrounding(topic,mode);
  let questions=[];
  let fallbackUsed=false,ai=null,aiError=null;
  try{
    ai=await generateFreeText(makePrompt(topic,count,difficulty,mode,grounding),{maxOutputTokens:Math.max(1800,count*350),validateText:text=>parseQuizText(text,count,grounding.sources).length>=Math.min(3,count)});
    questions=parseQuizText(ai.text,count,grounding.sources);
    if(!questions.length)throw new FreeAIError('invalid_response','Die KI-Antwort enthält keine gültigen Quizfragen.');
  }catch(e){aiError=publicAIError(e);console.warn('ai-primary',JSON.stringify({code:aiError.code}));}
  const aiQuestionCount=questions.length;
  const seen=new Set(questions.map(q=>q.q.toLowerCase()));
  if(questions.length<count&&grounding.items.length){
    const fallback=deterministicQuestions(topic,count-questions.length,difficulty,grounding,seen);
    if(fallback.length)fallbackUsed=true;
    questions.push(...fallback);
  }
  if(questions.length<Math.min(3,count))throw new Error('Es konnten nicht genug zuverlässige Fragen aus den verfügbaren Quellen erstellt werden.');
  return {questions:questions.slice(0,count),fallbackUsed,aiQuestionCount,
    ai:{connected:aiQuestionCount>0,model:aiQuestionCount>0?ai.model:null,modelName:aiQuestionCount>0?ai.modelName:null,pricing:aiQuestionCount>0?'free':null,unlimited:false},
    warning:aiError?aiError.message:null};
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'Nur GET ist erlaubt.'});
  const topic=clean(req.query.topic).slice(0,100);
  const count=Math.min(15,Math.max(3,Math.trunc(Number(req.query.count)||10)));
  const difficulty=['easy','medium','hard','expert'].includes(req.query.difficulty)?req.query.difficulty:'medium';
  const mode=req.query.mode==='live'?'live':'school';
  if(!topic)return res.status(400).json({error:'Bitte ein Thema angeben.'});
  if(restrictedTopic(topic))return res.status(400).json({error:'Dieses Thema ist für die Quiz-Suche nicht verfügbar.'});
  try{
    const result=await createQuiz(topic,count,difficulty,mode);
    const engine=result.aiQuestionCount?(result.fallbackUsed?'free-ai-with-source-fallback':'free-ai'):'source-fallback';
    if(result.ai.connected&&!result.fallbackUsed)res.setHeader('Cache-Control',mode==='live'?'s-maxage=120, stale-while-revalidate=300':'s-maxage=1800, stale-while-revalidate=7200');
    console.info('quiz-result',JSON.stringify({engine,model:result.ai.model,aiQuestionCount:result.aiQuestionCount,count:result.questions.length}));
    return res.status(200).json({topic,count:result.questions.length,difficulty,mode,...result,engine});
  }catch(err){
    console.error('quiz-error',err);
    return res.status(502).json({error:'Das Quiz konnte gerade nicht erstellt werden.',details:String(err&&err.message||err)});
  }
};
