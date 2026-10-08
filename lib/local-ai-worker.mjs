import { CreateMLCEngine } from '@mlc-ai/web-llm';
let engine=null;
self.onmessage=async({data})=>{
  const {id,action}=data;
  try{
    if(action==='prepare'){
      engine=await CreateMLCEngine(data.model,{logLevel:'ERROR',initProgressCallback:progress=>self.postMessage({id,progress:{progress:progress.progress,text:progress.text}})});
      self.postMessage({id,result:{model:data.model}});
    }else if(action==='generate'&&engine){
      const response=await engine.chat.completions.create({messages:[{role:'system',content:data.instructions},{role:'user',content:data.prompt}],temperature:0.2,max_tokens:data.maxOutputTokens,response_format:{type:'json_object'},extra_body:{enable_thinking:false}});
      self.postMessage({id,result:{text:response.choices[0]?.message?.content||''}});
    }else throw new Error('not_ready');
  }catch(error){self.postMessage({id,error:String(error?.message||'local_failed').slice(0,1000)});}
};
