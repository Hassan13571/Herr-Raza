'use strict';
const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
async function build(){
  fs.mkdirSync('public/assets',{recursive:true});
  fs.copyFileSync('index.html','public/index.html');
  for(const name of fs.readdirSync('assets')){
    if(name==='local-ai-runtime.mjs')continue;
    if(fs.statSync(path.join('assets',name)).isFile())fs.copyFileSync(path.join('assets',name),path.join('public/assets',name));
  }
  await esbuild.build({entryPoints:['lib/local-ai-worker.mjs'],bundle:true,format:'esm',minify:true,outfile:'public/assets/local-ai-runtime.mjs'});
}
build().catch(error=>{console.error(error.message);process.exitCode=1;});
