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
  const r=await fetch(url,{headers:{
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
    text:safeText(x.extract,2200),
    kind:'background'
  }));
  return {items};
}

async function duckContext(topic){
  const url='https://api.duckduckgo.com/?'+new URLSearchParams({
    q:topic,format:'json',no_html:'1',no_redirect:'1',skip_disambig:'1'
  }).toString();
  const r=await fetch(url,{headers:{'User-Agent':'Herr-Raza-Quiz/5.0 educational quiz','Accept':'application/json'}});
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
  const r=await fetch(url,{headers:{'User-Agent':'Herr-Raza-Quiz/5.0 educational quiz','Accept':'application/json'}});
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
  const r=await fetch(url,{headers:{'User-Agent':'Herr-Raza-Quiz/5.1 educational quiz','Accept':'application/rss+xml, application/xml, text/xml'}});
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

async function gatewayText(prompt){
  const {generateText}=await import('ai');
  const models=['stealth/pixel-canary','inclusionai/ling-3.1-flash-free','inclusionai/ling-3.1-flash'];
  let lastError=null;
  for(const model of models){
    try{
      const result=await generateText(model==='stealth/pixel-canary'?{model,prompt,maxOutputTokens:3200,reasoning:'none'}:{model,prompt,maxOutputTokens:2400});
      const text=String(result&&result.text||'').trim();
      if(text)return text;
      lastError=new Error('Leere KI-Antwort von '+model);
    }catch(e){lastError=e;}
  }
  throw lastError||new Error('Vercel AI hat keine Antwort geliefert.');
}

function parseQuizText(raw,count,sources){
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
    const idx=Number(clean(b.SOURCE));
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
    const sentences=String(item.text||'').split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/u);
    for(const s of sentences){
      const t=clean(s);
      if(t.length>=45&&t.length<=260)facts.push({text:t,sourceIndex:item.sourceIndex,kind:'background'});
    }
  }
  return facts;
}

function termPool(facts){
  const stop=new Set(['Diese','Dieser','Dieses','Dabei','Daher','Damit','Durch','Eine','Einer','Eines','Einen','Heute','Jedoch','Neben','Nach','Unter','Viele','Während','Weiter','Welche','Das','Der','Die','Den','Dem','Ein','Im','Am','Auf','Aus','Bei','Bis','Für','Mit','Ohne','Seit','Von','Vor','Zum','Zur','Als','Auch']);
  const terms=[];
  for(const f of facts){
    const ms=f.text.match(/\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{3,}\b/g)||[];
    for(const m of ms)if(!stop.has(m)&&!terms.includes(m))terms.push(m);
  }
  return terms;
}

function mutations(sentence,pool){
  const out=new Set();
  const number=sentence.match(/\b(?:1\d{3}|20\d{2}|\d{1,3}(?:[.,]\d+)?)\b/);
  if(number){
    const raw=number[0],n=Number(raw.replace(',','.'));
    if(Number.isFinite(n)){
      const vals=n>=1000&&n<=2100?[n-1,n+1,n+10]:[Math.max(0,n-1),n+1,n===0?2:n*2];
      for(const v of vals){
        const rep=Number.isInteger(v)?String(v):String(Math.round(v*10)/10).replace('.',',');
        if(rep!==raw)out.add(sentence.replace(raw,rep));
      }
    }
  }
  const own=(sentence.match(/\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{3,}\b/g)||[]).filter(x=>pool.includes(x));
  const target=own.sort((a,b)=>b.length-a.length)[0];
  if(target){
    for(const repl of shuffle(pool.filter(x=>x!==target&&!sentence.includes(x))).slice(0,6)){
      out.add(sentence.replace(target,repl));
      if(out.size>=3)break;
    }
  }
  const swaps=[
    [/\bsteigt\b/i,'sinkt'],[/\bsinkt\b/i,'steigt'],[/\bmehr\b/i,'weniger'],[/\bweniger\b/i,'mehr'],
    [/\bhöher\b/i,'niedriger'],[/\bniedriger\b/i,'höher'],[/\bgrößer\b/i,'kleiner'],[/\bkleiner\b/i,'größer'],
    [/\bvor\b/i,'nach'],[/\bnach\b/i,'vor'],[/\bist\b/i,'ist nicht'],[/\bsind\b/i,'sind nicht'],[/\bwar\b/i,'war nicht']
  ];
  for(const [re,to] of swaps)if(re.test(sentence)){out.add(sentence.replace(re,to));if(out.size>=3)break;}
  return [...out].filter(x=>x!==sentence).slice(0,3);
}

function subjectCue(sentence,topic){
  const m=sentence.match(/^(.{3,70}?)\s+(?:ist|sind|war|waren|wurde|wurden|hat|haben|liegt|liegen|entsteht|entstehen|bezeichnet|besteht|führt|führte)\b/i);
  if(m)return clean(m[1]).slice(0,70);
  return clean(sentence.split(/[,;:]/)[0]).split(' ').slice(0,6).join(' ')||topic;
}

function deterministicQuestions(topic,count,difficulty,grounding,exclude){
  let facts=sourceFacts(grounding);
  const pool=termPool(facts);
  const score=f=>{
    let s=0;
    if(/\b\d/.test(f.text))s+=difficulty==='hard'||difficulty==='expert'?5:2;
    if(/\b(?:weil|dadurch|deshalb|während|führt|Folge|Ursache|durch)\b/i.test(f.text))s+=difficulty==='hard'||difficulty==='expert'?5:1;
    if(f.text.length<150)s+=difficulty==='easy'?4:1;
    if(f.kind==='live')s+=2;
    return s;
  };
  facts=facts.sort((a,b)=>score(b)-score(a));
  const out=[],seen=new Set(exclude||[]);
  for(const f of facts){
    if(out.length>=count)break;
    const wrong=mutations(f.text,pool);
    if(wrong.length<3)continue;
    const answer=f.text;
    const options=shuffle([answer,...wrong.slice(0,3)]);
    const qBase={
      easy:'Welche Aussage zu „'+subjectCue(answer,topic)+'“ stimmt laut Quelle?',
      medium:'Welche Aussage über „'+subjectCue(answer,topic)+'“ wird von der Quelle gestützt?',
      hard:'Welche präzise Aussage zu „'+subjectCue(answer,topic)+'“ ist anhand der Quelle korrekt?',
      expert:'Welche Aussage zu „'+subjectCue(answer,topic)+'“ ist anhand der Quelle fachlich am besten belegt?'
    }[difficulty]||'Welche Aussage ist laut Quelle korrekt?';
    if(seen.has(qBase.toLowerCase()))continue;
    seen.add(qBase.toLowerCase());
    const src=grounding.sources[f.sourceIndex]||null;
    out.push({
      q:qBase,
      options,
      correct:options.indexOf(answer),
      explanation:'Die Quelle nennt: '+answer,
      source:src?src.title:'Quellenmaterial',
      sourceUrl:src?src.url:''
    });
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
    hasSources?'- Nutze für überprüfbare Fakten bevorzugt den Quellenkontext. SOURCE muss auf eine passende Quellen-Nummer zeigen.':'- Nutze nur stabiles, allgemein anerkanntes Wissen und setze SOURCE auf -1.',
    mode==='live'?'- Frage aktuelle Fakten NUR ab, wenn sie ausdrücklich in den aktuellen Web-Meldungen stehen.':'',
    '',
    hasSources?'QUELLEN:\n'+sourceList+'\n\nKONTEXT:\n'+grounding.context:'',
    '',
    'Antworte NUR im folgenden Zeilenformat, ohne Markdown:',
    'QUESTION|Fragetext','A|Antwort A','B|Antwort B','C|Antwort C','D|Antwort D',
    'CORRECT|A','WHY|kurze Begründung','SOURCE|0','END',
    'Erzeuge genau '+count+' unterschiedliche Fragen.'
  ].filter(Boolean).join('\n');
}

async function createQuiz(topic,count,difficulty,mode){
  const grounding=await buildGrounding(topic,mode);
  let questions=[];
  let fallbackUsed=false;
  try{
    const raw=await gatewayText(makePrompt(topic,count,difficulty,mode,grounding));
    questions=parseQuizText(raw,count,grounding.sources);
  }catch(e){console.warn('ai-primary',e.message);}
  const seen=new Set(questions.map(q=>q.q.toLowerCase()));
  if(questions.length<count&&grounding.items.length){
    const fallback=deterministicQuestions(topic,count-questions.length,difficulty,grounding,seen);
    if(fallback.length)fallbackUsed=true;
    questions.push(...fallback);
  }
  if(questions.length<Math.min(3,count))throw new Error('Es konnten nicht genug zuverlässige Fragen aus den verfügbaren Quellen erstellt werden.');
  return {questions:questions.slice(0,count),fallbackUsed};
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
    const result=await createQuiz(topic,count,difficulty,mode);
    return res.status(200).json({topic,count:result.questions.length,difficulty,mode,questions:result.questions,engine:'free-ai-with-source-fallback'});
  }catch(err){
    console.error('quiz-error',err);
    return res.status(502).json({error:'Das Quiz konnte gerade nicht erstellt werden.',details:String(err&&err.message||err)});
  }
};