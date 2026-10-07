'use strict';
const Images = require('../assets/quiz-images');
const { USER_AGENT } = require('../lib/quiz-images');
module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end(); }
  const url = typeof req.query?.url === 'string' && req.query.url.length <= 1600 && Images.commonsUrl(req.query.url);
  if (!url) return res.status(400).end();
  try {
    const signal = AbortSignal.timeout(7000);
    let current = url, response;
    for (let hop=0;hop<3;hop++) {
      response = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT }, signal });
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get('location');
      current = location && Images.commonsUrl(new URL(location, current).href);
      await response.body?.cancel();
      if (!current || hop===2) return res.status(502).end();
    }
    if (!response.ok) return res.status(response.status === 429 ? 429 : 502).end();
    const length = Number(response.headers.get('content-length'));
    if (length > Images.MAX_BYTES) return res.status(413).end();
    if (!['image/jpeg','image/png','image/webp'].includes((response.headers.get('content-type') || '').split(';')[0])) return res.status(415).end();
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > Images.MAX_BYTES) { await reader.cancel(); return res.status(413).end(); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks), mime = Images.imageMime(bytes);
    if (!mime) return res.status(415).end();
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800');
    return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(bytes);
  } catch { return res.status(502).end(); }
};
