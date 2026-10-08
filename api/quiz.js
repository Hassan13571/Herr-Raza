const {generateFreeText,publicAIError,FreeAIError}=require('../lib/free-ai');
const {matchesTopic,reviewQuestions}=require('../lib/quiz-quality');
const MAX_SOURCE_TEXT=60000;
const MAX_QUESTIONS=50;
const {textGrounding,parseQuizText,makePrompt,QUIZ_INSTRUCTIONS}=require('../assets/quiz-core');

function restrictedTopic(t){
  return /\b(?:waffen?|pistolen?|gewehre?|munition|messer|sprengstoff|bomben?|drogen|cannabis|thc|kokain|heroin|meth|vapes?|zigaretten?|nikotin|alkohol|porno|pornografie|glücksspiel|casino|wetten|betting)\b/iu.test(t);
}
function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
function safeText(s,n=6000){return clean(s).slice(0,n);}
function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;}

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
  let remaining=9000;
  const list=[];
  for(const item of (items||[]).filter(x=>x&&x.source&&x.text).slice(0,10)){
    const text=safeText(item.text,Math.max(0,remaining-item.source.title.length-20));
    if(!text)break;
    list.push({...item,text});remaining-=text.length+item.source.title.length+20;
  }
  const sources=list.map(x=>x.source);
  const normalized=list.map((x,i)=>({sourceIndex:i,text:x.text,kind:x.kind||'background'}));
  const context=normalized.map(x=>'['+x.sourceIndex+'] '+sources[x.sourceIndex].title+': '+x.text).join('\n\n').slice(0,9000);
  return {sources,items:normalized,context};
}

async function buildGrounding(topic,mode){
  let background={items:[]};
  try{background=await wikiContext(topic);}catch(e){console.warn('wiki',e.message);}
  background.items=background.items.filter(item=>matchesTopic(item.source.title+' '+item.text,topic));
  if(!background.items.length){
    try{background=await duckContext(topic);}catch(e){console.warn('duck',e.message);}
    background.items=background.items.filter(item=>matchesTopic(item.source.title+' '+item.text,topic));
  }
  if(mode!=='live')return normalizeGrounding(background.items);
  let live={items:[]};
  try{live=await gdeltContext(topic);}catch(e){console.warn('gdelt',e.message);}
  if(!live.items.length){try{live=await googleNewsContext(topic);}catch(e){console.warn('news-rss',e.message);}}
  return normalizeGrounding([...background.items.slice(0,3),...live.items.filter(item=>matchesTopic(item.text,topic)).slice(0,7)]);
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
function addQuestion(out,seen,q,options,correctAnswer,explanation,src,count,quote){
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
    sourceUrl:src?src.url:'',sourceQuote:quote
  });
}
function numericInfo(sentence){
  const numbers=[...sentence.matchAll(/\b(\d{1,4}(?:[.,]\d+)?)(\s*(?:%|°C|km|m|Mio\.?|Millionen?|Milliarden?))?\b/g)];
  if(numbers.length!==1)return null;
  const m=numbers[0];
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
function liveQuestions(topic,count,grounding,out,seen){
  const live=(grounding.items||[]).filter(x=>x.kind==='live'&&matchesTopic(x.text,topic));
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
    addQuestion(out,seen,'Welche aktuelle Meldung zu „'+topic+'“ stammt aus der Quelle „'+src.title+'“?',[answer,...wrong],answer,'Diese Nachricht steht in den neuen Meldungen dieser Seite.',src,count,answer);
  }
}
function deterministicQuestions(topic,count,difficulty,grounding,exclude){
  const facts=sourceFacts(grounding).filter(f=>matchesTopic(f.text,topic));
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
    addQuestion(out,seen,'Welche Zahl steht im Text zu „'+cue+'“?',[ni.answer,...ni.wrong],ni.answer,'Die Quelle nennt die Angabe '+ni.answer+'. Textstelle: „'+f.text+'“',src,count,f.text);
  }

  // An unavailable model cannot establish that unrelated definition
  // fragments are false alternatives. Keep only directly extractable facts.
  return out;
}
async function createQuiz(topic,count,difficulty,mode,sourceText='',includeImages=false){
  const grounding=sourceText?textGrounding(sourceText):await buildGrounding(topic,mode);
  const parse=text=>parseQuizText(text,count,grounding,includeImages);
  const validateDraft=text=>{const reasons={},accepted=parseQuizText(text,count,grounding,includeImages,reasons).length;if(!accepted)console.warn('quiz-validation',JSON.stringify({stage:'draft',accepted,reasons}));return accepted>0;};
  const deadline=AbortSignal.timeout(count>15?250000:62000);
  let questions=[];
  let fallbackUsed=false,ai=null,aiError=null,reviewStarted=false,quality={reviewed:false,checked:0,rejected:0};
  try{
    ai=await generateFreeText(makePrompt(topic,count,difficulty,mode,grounding,includeImages),{instructions:QUIZ_INSTRUCTIONS,maxOutputTokens:Math.max(3000,count*(sourceText?650:500)),signal:AbortSignal.any([deadline,AbortSignal.timeout(count>15?225000:39000)]),attemptTimeoutMs:count>15?220000:29000,validateText:validateDraft});
    questions=parse(ai.text);
    if(!questions.length)throw new FreeAIError('invalid_response','Die KI konnte keine passenden Fragen erstellen. Bitte versuche es noch einmal.');
    reviewStarted=true;
    const reviewed=await reviewQuestions({topic,mode,grounding,questions,generate:generateFreeText,signal:AbortSignal.any([deadline,AbortSignal.timeout(count>15?45000:22000)]),attemptTimeoutMs:count>15?35000:18000});
    questions=reviewed.questions;quality=reviewed.quality;
    if(!questions.length)throw new FreeAIError('quality_rejected','Keine Frage konnte sicher geprüft werden. Bitte versuche es noch einmal. Oder füge mehr Text hinzu.');
  }catch(e){questions=[];aiError=publicAIError(e);console.warn('ai-primary',JSON.stringify({code:aiError.code}));}
  const aiQuestionCount=questions.length;
  // Never mix accepted AI questions with automatic filler. A failed semantic
  // review must not be bypassed by sending an unreviewed replacement quiz.
  if(!questions.length&&grounding.items.length&&!reviewStarted){
    const fallback=deterministicQuestions(topic,count,difficulty,grounding);
    if(fallback.length)fallbackUsed=true;
    questions.push(...fallback);
  }
  if(!questions.length||fallbackUsed&&questions.length<Math.min(3,count)){
    if(aiError)throw new FreeAIError(aiError.code,aiError.code==='invalid_response'?'Die KI konnte die Fragen und Antworten nicht sicher prüfen. Bitte versuche es noch einmal.':aiError.message,aiError.retryAfter);
    throw new Error(sourceText?'In deinem Text stehen zu wenige passende Informationen. Bitte füge mehr Text hinzu.':'Die App konnte zu wenige sichere Fragen finden. Bitte versuche es noch einmal.');
  }
  return {questions:questions.slice(0,count),requestedCount:count,fallbackUsed,aiQuestionCount,quality,
    ai:{connected:aiQuestionCount>0,model:aiQuestionCount>0?ai.model:null,modelName:aiQuestionCount>0?ai.modelName:null,pricing:aiQuestionCount>0?'free':null,unlimited:false},
    warning:aiError?aiError.message:null};
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST, OPTIONS');return res.status(405).json({error:'Bitte GET oder POST verwenden.'});}
  let input=req.query||{};
  if(req.method==='POST'){
    try{input=typeof req.body==='string'||Buffer.isBuffer(req.body)?JSON.parse(String(req.body)):req.body;if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();}
    catch{return res.status(400).json({error:'Bitte gültige Quiz-Eingaben senden.'});}
  }
  if(input.sourceText!=null&&typeof input.sourceText!=='string')return res.status(400).json({error:'Der Lerntext muss ein Text sein.'});
  const rawText=input.sourceText||'';
  if(rawText.length>MAX_SOURCE_TEXT)return res.status(413).json({error:'Dein Text ist zu lang. Bitte auf höchstens 60.000 Zeichen kürzen.'});
  if(req.method==='GET'&&rawText.trim())return res.status(400).json({error:'Bitte eigene Texte mit POST senden.'});
  const sourceText=rawText.replace(/\r\n?/g,'\n').replace(/\0/g,'').trim();
  if(sourceText&&sourceText.length<80)return res.status(400).json({error:'Bitte mindestens 80 Zeichen Lerntext eingeben.'});
  if(input.topic!=null&&typeof input.topic!=='string')return res.status(400).json({error:'Bitte ein gültiges Thema angeben.'});
  const topic=clean(input.topic).slice(0,100)||(sourceText?'Quiz aus deinem Text':'');
  const count=Math.min(MAX_QUESTIONS,Math.max(3,Math.trunc(Number(input.count)||10)));
  const difficulty=['easy','medium','hard','expert'].includes(input.difficulty)?input.difficulty:'medium';
  const mode=!sourceText&&input.mode==='live'?'live':'school';
  if(!topic)return res.status(400).json({error:'Bitte ein Thema oder einen eigenen Text angeben.'});
  if(!sourceText&&restrictedTopic(topic))return res.status(400).json({error:'Dieses Thema ist für die Quiz-Suche nicht verfügbar.'});
  try{
    const result=await createQuiz(topic,count,difficulty,mode,sourceText,input.images===true||input.images==='yes');
    const engine=result.aiQuestionCount?'free-ai':'source-fallback';
    if(req.method==='GET'&&!sourceText&&result.ai.connected&&!result.fallbackUsed)res.setHeader('Cache-Control',mode==='live'?'s-maxage=120, stale-while-revalidate=300':'s-maxage=1800, stale-while-revalidate=7200');
    console.info('quiz-result',JSON.stringify({engine,model:result.ai.model,aiQuestionCount:result.aiQuestionCount,count:result.questions.length,quality:result.quality}));
    return res.status(200).json({topic,count:result.questions.length,difficulty,mode,inputType:sourceText?'text':'topic',...result,engine});
  }catch(err){
    const failure=publicAIError(err);
    console.error('quiz-error',JSON.stringify({code:failure.code}));
    if(failure.code==='quota')res.setHeader('Retry-After',String(failure.retryAfter));
    return res.status(failure.code==='quota'?429:502).json({error:'Das Quiz konnte gerade nicht erstellt werden.',details:err instanceof FreeAIError?failure.message:String(err&&err.message||err),code:failure.code,...(failure.retryAfter?{retryAfter:failure.retryAfter}:{})});
  }
};

module.exports.buildGrounding=buildGrounding;
module.exports.restrictedTopic=restrictedTopic;
