'use strict';
const Images = require('../assets/quiz-images');
const { searchImages } = require('../lib/quiz-images');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Bitte GET oder POST verwenden.' }); }
  let input = req.query || {};
  if (req.method === 'POST') {
    try { input = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? JSON.parse(String(req.body)) : req.body; }
    catch { return res.status(400).json({ error: 'Ungültige Bildersuche.' }); }
  }
  const queries = req.method === 'GET' ? [input?.q] : input?.queries;
  if (!Array.isArray(queries) || !queries.length || queries.length > Images.MAX_QUERIES || queries.some(q => !Images.query(q))) return res.status(400).json({ error: 'Bitte höchstens sechs kurze Bildbegriffe angeben.' });
  const images = await searchImages([...new Set(queries.map(Images.query))]);
  if (req.method === 'GET' && images.length) res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ images });
};
