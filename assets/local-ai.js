(function(root){
  'use strict';
  function failure(code,message){const error=new Error(message);error.code=code;return error;}
  async function supportedModel(navigator=root.navigator){
    if(!navigator?.gpu)throw failure('unsupported','Diese KI läuft hier nicht. Öffne die App in einer aktuellen Version von Chrome oder Edge auf einem Computer.');
    const adapter=await navigator.gpu.requestAdapter();
    if(!adapter)throw failure('unsupported','Dein Browser kann die Grafikkarte nicht nutzen. Die Online-KI und gespeicherte Quizze bleiben verfügbar.');
    return adapter.features.has('shader-f16')?'Qwen3-4B-q4f16_1-MLC':'Qwen3-4B-q4f32_1-MLC';
  }
  function create({makeWorker=()=>new root.Worker('/assets/local-ai-runtime.mjs',{type:'module'}),probe=supportedModel,onStatus=()=>{},setTimer=root.setTimeout,clearTimer=root.clearTimeout}={}){
    let worker=null,model=null,preparing=null,serial=0,epoch=0;const tasks=new Map();
    function cancel(){epoch++;const old=worker;worker=null;model=null;preparing=null;old?.terminate();for(const task of tasks.values()){clearTimer(task.timer);task.reject(failure('cancelled','Die KI wurde gestoppt. Dein Text bleibt erhalten.'));}tasks.clear();}
    function call(action,values,timeout){
      const id=++serial;
      return new Promise((resolve,reject)=>{const timer=setTimer(()=>cancel(),timeout);tasks.set(id,{resolve,reject,timer});worker.postMessage({id,action,...values});});
    }
    async function prepare(){
      if(model)return {model};if(preparing)return preparing;
      const ticket=++epoch;
      preparing=(async()=>{
        const selected=await probe();
        if(epoch!==ticket)throw failure('cancelled','Die KI wurde gestoppt. Dein Text bleibt erhalten.');
        const current=makeWorker();worker=current;
        current.onmessage=({data})=>{
          if(worker!==current)return;const task=tasks.get(data.id);if(!task)return;
          if(data.progress){const percent=Math.max(0,Math.min(100,Math.round(Number(data.progress.progress||0)*100)));onStatus('Die KI wird auf deinen Computer geladen: '+percent+' %. Bitte lass die Seite offen.');return;}
          clearTimer(task.timer);tasks.delete(data.id);
          if(data.error)task.reject(failure('local_failed','Die KI konnte auf diesem Computer nicht arbeiten. Prüfe deine Verbindung und freien Speicher. Du kannst die Online-KI oder ein gespeichertes Quiz nutzen.'));
          else task.resolve(data.result);
        };
        current.onerror=()=>{if(worker===current)cancel();};
        onStatus('Die KI wird auf deinen Computer geladen. Beim ersten Start dauert das länger.');
        await call('prepare',{model:selected},600000);model=selected;
        onStatus('Die KI auf deinem Computer ist bereit. Du kannst jetzt ein Quiz erstellen.');return {model};
      })();
      try{return await preparing;}catch(error){if(epoch===ticket)cancel();throw error;}finally{if(epoch===ticket)preparing=null;}
    }
    async function generate(prompt,{instructions,maxOutputTokens,signal,validateText}={}){
      if(!model)throw failure('not_ready','Bitte lade zuerst die KI auf deinen Computer.');
      if(signal?.aborted)throw failure('cancelled','Die KI wurde gestoppt.');
      const abort=()=>cancel();signal?.addEventListener('abort',abort,{once:true});
      try{
        const result=await call('generate',{prompt,instructions,maxOutputTokens},180000);
        if(!result.text||validateText&&!validateText(result.text))throw failure('invalid_response','Die KI konnte diese Fragen nicht sicher prüfen. Bitte nutze mehr Text oder ein gespeichertes Quiz.');
        return {...result,model,modelName:'Qwen3 · auf deinem Computer',pricing:'free'};
      }finally{signal?.removeEventListener('abort',abort);}
    }
    return {prepare,generate,cancel,get ready(){return !!model;}};
  }
  const api={create,supportedModel};if(typeof module==='object'&&module.exports)module.exports=api;else root.RazaLocalAI=api;
})(typeof globalThis==='object'?globalThis:this);
