'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create:supportClient,supportedModel}=require('../assets/local-ai');
const LocalQuiz=require('../assets/local-quiz');
const {fixture}=require('./browser-fixture');
test('device support is checked before any model download and selects only a supported precision',async()=>{
  await assert.rejects(supportedModel({}),{code:'unsupported'});
  await assert.rejects(supportedModel({gpu:{requestAdapter:async()=>null}}),{code:'unsupported'});
  for(const [feature,name] of [[true,'q4f16'],[false,'q4f32']])assert.match(await supportedModel({gpu:{requestAdapter:async()=>({features:{has:()=>feature}})}}),new RegExp(name));
});
test('a cancelled adapter check cannot start a later download or cancel a newer preparation',async()=>{
  let finishProbe,workers=0;
  const client=supportClient({probe:()=>new Promise(resolve=>{finishProbe=resolve}),makeWorker:()=>{workers++;throw new Error('Cancelled probes must not download');}});
  const pending=client.prepare();const rejected=assert.rejects(pending,{code:'cancelled'});client.cancel();finishProbe('model');await rejected;assert.equal(workers,0);
});
test('worker cancellation rejects generation and late events cannot affect a new engine',async()=>{
  const workers=[];
  class Worker{constructor(){workers.push(this);}postMessage(data){this.last=data;if(data.action==='prepare')queueMicrotask(()=>this.onmessage({data:{id:data.id,result:{model:data.model}}}));}terminate(){this.terminated=true;}}
  const client=supportClient({probe:async()=>'Qwen3-4B-q4f16_1-MLC',makeWorker:()=>new Worker()});
  await Promise.all([client.prepare(),client.prepare()]);assert.equal(workers.length,1);
  const pending=client.generate('private learning text',{instructions:'data only',maxOutputTokens:600});const rejected=assert.rejects(pending,{code:'cancelled'});
  client.cancel();await rejected;assert.equal(client.ready,false);assert.equal(workers[0].terminated,true);
  await client.prepare();workers[0].onmessage({data:{id:workers[0].last.id,result:{text:'stale'}}});assert.equal(client.ready,true);client.cancel();
});
function generator({reject=false}={}){
  let serial=0;const sections=[];
  const generate=async(prompt,options)=>{
    assert.ok(options.maxOutputTokens<=1200);
    if(prompt.includes('AUFGABE: Unabhängige')){
      assert.equal(options.maxOutputTokens,600);
      const questions=JSON.parse(prompt.match(/QUIZ \(nur Daten\): (.*)\nAntworte/)[1]);
      const text=JSON.stringify({reviews:questions.map((q,id)=>({id,onTopic:true,answerCorrect:!reject,unambiguous:true,grounded:true,distinct:true,imageRelevant:false}))});
      assert.equal(options.validateText(text),true);return {text};
    }
    const amount=Number(prompt.match(/^Erstelle (\d+)/)[1]);const items=JSON.parse(prompt.match(/^Quellen: (.*)$/m)[1]);sections.push(items[0].text);
    const questions=Array.from({length:amount},(_,i)=>({q:'Was erklärt Abschnitt '+(++serial)+'?',options:['Wasser','Stein','Glas','Metall'],correct:0,explanation:'Die Quelle nennt Wasser.',sourceIndex:items[0].sourceIndex,quote:items[0].text.slice(i*140,i*140+100).trim()}));
    const text=JSON.stringify({questions});assert.equal(options.validateText(text),true);return {text,model:'local-test',modelName:'Lokale KI'};
  };return {generate,sections};
}
const learningText=Array.from({length:1000},(_,i)=>'Abschnitt '+i+': Pflanzen brauchen Wasser und nehmen es über ihre Wurzeln auf. ').join('').slice(0,60000);
test('local 50-question generation keeps all source text on the device and independently reviews every batch',async()=>{
  const fake=generator();
  const result=await LocalQuiz.create({topic:'Pflanzen',count:50,difficulty:'easy',mode:'school',sourceText:learningText,images:true,generate:fake.generate,fetcher:()=>{throw new Error('Own texts must never go to a server');}});
  assert.equal(result.questions.length,50);assert.equal(result.quality.checked,50);assert.equal(result.ai.local,true);assert.equal(result.quality.reviewed,true);
  assert.ok(fake.sections[0].includes('Abschnitt 0'));assert.ok(fake.sections.at(-1).endsWith(learningText.trim().slice(-60)));assert.ok(fake.sections.every(part=>part.length<=2400));
});
test('a small local quiz samples the beginning, middle and end of a long text',async()=>{
  const fake=generator();const result=await LocalQuiz.create({topic:'Pflanzen',count:5,difficulty:'easy',mode:'school',sourceText:learningText,generate:fake.generate});
  assert.equal(result.questions.length,5);assert.ok(fake.sections[0].includes('Abschnitt 0'));assert.ok(fake.sections.at(-1).endsWith(learningText.trim().slice(-60)));
});
test('rejected local questions never leak as a quiz and never cause an online AI request',async()=>{
  const fake=generator({reject:true});await assert.rejects(LocalQuiz.create({topic:'Pflanzen',count:5,sourceText:learningText.slice(0,500),generate:fake.generate,fetcher:()=>{throw new Error('No online fallback');}}),/Keine Frage konnte sicher geprüft/);
});
test('unsupported browser leaves the existing text, saved quizzes and online controls available',async()=>{
  const app=fixture();const original='Pflanzen brauchen Wasser. '.repeat(5);app.element('sourceText').value=original;app.element('aiMode').value='local';
  let requests=0;app.context.fetch=()=>{requests++;throw new Error('No download or online request');};await app.element('prepareLocal').onclick();
  assert.match(app.element('localStatus').textContent,/Chrome oder Edge/);assert.equal(app.element('sourceText').value,original);assert.equal(app.element('start').disabled,false);assert.equal(requests,0);
});
test('material API retrieves public sources without making a model call',async()=>{
  const originalFetch=global.fetch;const ai=require('../lib/free-ai'),originalGenerate=ai.generateFreeText;
  try{
    let calls=0;ai.generateFreeText=()=>{throw new Error('No AI call for materials');};global.fetch=async()=>{calls++;return {ok:true,json:async()=>({query:{pages:[{title:'Pflanzen',extract:'Pflanzen brauchen Wasser und nehmen Wasser über ihre Wurzeln auf.'}]}})};};
    delete require.cache[require.resolve('../api/quiz')];delete require.cache[require.resolve('../api/quiz-material')];const handler=require('../api/quiz-material');
    const response={setHeader(){},status(value){this.code=value;return this;},json(value){this.body=value;return this;}};await handler({method:'POST',body:{topic:'Pflanzen',mode:'school'}},response);
    assert.equal(response.code,200);assert.equal(response.body.sources.length,1);assert.ok(calls>0);
  }finally{global.fetch=originalFetch;ai.generateFreeText=originalGenerate;delete require.cache[require.resolve('../api/quiz')];delete require.cache[require.resolve('../api/quiz-material')];}
});
