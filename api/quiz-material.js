'use strict';
const { buildGrounding, restrictedTopic } = require('./quiz');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Bitte POST verwenden.'});}
  let input;try{input=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{}
  if(!input||typeof input.topic!=='string'||!input.topic.trim()||input.topic.length>100)return res.status(400).json({error:'Bitte ein Thema mit höchstens 100 Zeichen angeben.'});
  const topic=input.topic.replace(/\s+/g,' ').trim();
  if(restrictedTopic(topic))return res.status(400).json({error:'Dieses Thema ist für die Quiz-Suche nicht verfügbar.'});
  try{return res.status(200).json(await buildGrounding(topic,input.mode==='live'?'live':'school'));}
  catch{return res.status(502).json({error:'Die Texte zum Thema konnten nicht geladen werden. Bitte füge einen eigenen Lerntext hinzu.'});}
};
