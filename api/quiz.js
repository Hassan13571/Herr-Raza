const BANKS = {
  photosynthese: [
    ['Welches Gas nehmen Pflanzen bei der Photosynthese auf?', ['Kohlenstoffdioxid','Sauerstoff','Stickstoff','Wasserstoff'], 0, 'Pflanzen nehmen Kohlenstoffdioxid auf und bilden unter anderem Sauerstoff.'],
    ['In welchem Zellbestandteil findet Photosynthese hauptsächlich statt?', ['Chloroplasten','Zellkern','Ribosomen','Mitochondrien'], 0, 'Die Photosynthese läuft vor allem in den Chloroplasten ab.'],
    ['Welcher grüne Farbstoff ist für die Lichtaufnahme wichtig?', ['Chlorophyll','Hämoglobin','Keratin','Melanin'], 0, 'Chlorophyll absorbiert Lichtenergie.']
  ],
  dna: [
    ['Wofür steht DNA?', ['Desoxyribonukleinsäure','Dynamische Nuklearachse','Doppelte Natriumart','Digitale Nukleinsäure'], 0, 'DNA ist die Abkürzung für Desoxyribonukleinsäure.'],
    ['Welche Form wird oft zur Beschreibung der DNA verwendet?', ['Doppelhelix','Würfel','Einzelring','Pyramide'], 0, 'Die DNA besteht typischerweise aus zwei Strängen in Form einer Doppelhelix.'],
    ['Welche Base paart sich in der DNA mit Adenin?', ['Thymin','Guanin','Cytosin','Uracil'], 0, 'In DNA paart sich Adenin mit Thymin.']
  ],
  bruchrechnen: [
    ['Was zeigt der Nenner eines Bruchs?', ['In wie viele gleich große Teile das Ganze geteilt ist','Wie viele Teile genommen werden','Nur das Vorzeichen','Die Anzahl der Dezimalstellen'], 0, 'Der Nenner gibt an, in wie viele gleich große Teile ein Ganzes geteilt ist.'],
    ['Welcher Bruch ist gleichwertig zu 1/2?', ['2/4','1/3','3/4','2/3'], 0, '1/2 erweitert mit 2 ergibt 2/4.'],
    ['Was ist 1/3 + 1/3?', ['2/3','2/6','1/6','1/3'], 0, 'Bei gleichem Nenner werden die Zähler addiert.']
  ]
};

function clean(s){ return String(s || '').replace(/\s+/g,' ').trim(); }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function keyFor(topic){ const t=clean(topic).toLowerCase(); if(/photo|foto/.test(t)) return 'photosynthese'; if(/\bdna\b|\bdns\b|desox/.test(t)) return 'dna'; if(/bruch|brüche|brueche/.test(t)) return 'bruchrechnen'; return null; }
function localQuestions(topic,count){
  const key=keyFor(topic); if(!key) return [];
  const bank=BANKS[key]; const out=[];
  while(out.length<count){
    for(const row of shuffle(bank)){
      const answer=row[1][row[2]]; const opts=shuffle(row[1]);
      out.push({q:row[0],options:opts,correct:opts.indexOf(answer),explanation:row[3],source:'Offline-Fallback'});
      if(out.length>=count) break;
    }
  }
  return out;
}
function sentences(text){
  return clean(text).split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/).map(clean).filter(s=>s.length>=70 && s.length<=360 && !/^(Siehe|Weblinks|Literatur|Einzelnachweise|Kategorie)/i.test(s));
}
function terms(sentence){
  const stop=new Set(['Diese','Dieser','Dieses','Dabei','Daher','Damit','Durch','Eine','Einer','Eines','Einen','Erste','Heute','Jedoch','Neben','Nach','Unter','Über','Viele','Während','Weiter','Welche','Das','Der','Die','Den','Dem','Ein','Im','Am','Auf','Aus','Bei','Bis','Für','Mit','Ohne','Seit','Von','Vor','Zum','Zur','Als','Auch','Ist','Sind','War','Wird','Werden']);
  const words=sentence.match(/\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüßéèêáàóòúùíìç-]{3,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüßéèêáàóòúùíìç-]{2,})?/g)||[];
  return [...new Set(words.map(clean))].filter(w=>!stop.has(w)&&w.length<55);
}
async function wikiJSON(params){
  const url='https://de.wikipedia.org/w/api.php?'+new URLSearchParams({...params,format:'json',origin:'*'}).toString();
  const r=await fetch(url,{headers:{'User-Agent':'Herr-Raza-Quiz/1.0 (educational quiz app)','Accept':'application/json'}});
  if(!r.ok) throw new Error('Wikipedia HTTP '+r.status);
  return r.json();
}
async function wikipediaQuestions(topic,count,difficulty){
  const limit=Math.min(20,Math.max(8,count+5));
  const search=await wikiJSON({action:'query',list:'search',srsearch:topic,srlimit:String(limit)});
  const hits=(search.query&&search.query.search)||[];
  if(!hits.length) throw new Error('Kein passender Wikipedia-Artikel gefunden.');
  const titles=hits.map(x=>x.title).slice(0,limit);
  const pagesData=await wikiJSON({action:'query',prop:'extracts',exintro:'1',explaintext:'1',redirects:'1',titles:titles.join('|'),formatversion:'2'});
  const pages=((pagesData.query&&pagesData.query.pages)||[]).filter(p=>p.extract&&p.extract.length>80);
  const byTitle=new Map(pages.map(p=>[p.title,p]));
  const ordered=titles.map(t=>byTitle.get(t)).filter(Boolean);
  const questions=[];

  for(const page of ordered){
    if(questions.length>=count) break;
    const desc=sentences(page.extract)[0] || clean(page.extract).slice(0,300);
    if(desc.length<70) continue;
    const distractors=shuffle(titles.filter(t=>t!==page.title)).slice(0,3);
    if(distractors.length<3) continue;
    const opts=shuffle([page.title,...distractors]);
    questions.push({q:'Welcher Begriff passt am besten zu dieser Beschreibung?\n„'+desc+'“',options:opts,correct:opts.indexOf(page.title),explanation:desc,source:'Wikipedia: '+page.title});
  }

  const main=ordered[0];
  if(main && questions.length<count){
    const ss=sentences(main.extract).slice(0,difficulty==='hard'?35:22);
    const pool=[...new Set(ss.flatMap(terms))];
    for(const sen of shuffle(ss)){
      if(questions.length>=count) break;
      const ts=terms(sen); if(!ts.length||pool.length<4) continue;
      const answer=ts[0];
      const wrong=shuffle(pool.filter(x=>x!==answer&&!x.includes(answer)&&!answer.includes(x))).slice(0,3);
      if(wrong.length<3) continue;
      const blank=sen.replace(answer,'_____'); if(blank===sen) continue;
      const opts=shuffle([answer,...wrong]);
      questions.push({q:'Welche Ergänzung passt in den Satz?\n„'+blank+'“',options:opts,correct:opts.indexOf(answer),explanation:sen,source:'Wikipedia: '+main.title});
    }
  }

  if(!questions.length) throw new Error('Aus den Wikipedia-Inhalten konnten keine Quizfragen erstellt werden.');
  while(questions.length<count) questions.push({...questions[questions.length % Math.max(1,questions.length)]});
  return questions.slice(0,count);
}

module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='GET') return res.status(405).json({error:'Nur GET ist erlaubt.'});
  const topic=clean(req.query.topic).slice(0,100);
  const count=Math.min(15,Math.max(3,Number(req.query.count)||10));
  const difficulty=['easy','medium','hard'].includes(req.query.difficulty)?req.query.difficulty:'medium';
  if(!topic) return res.status(400).json({error:'Bitte ein Thema angeben.'});
  try{
    let questions;
    try{ questions=await wikipediaQuestions(topic,count,difficulty); }
    catch(err){ questions=localQuestions(topic,count); if(!questions.length) throw err; }
    return res.status(200).json({topic,count:questions.length,questions,provider:'Wikipedia / Wikimedia Action API',cost:'kein API-Key erforderlich'});
  }catch(err){
    return res.status(502).json({error:'Für dieses Thema konnten gerade keine Fragen geladen werden.',details:String(err&&err.message||err)});
  }
};