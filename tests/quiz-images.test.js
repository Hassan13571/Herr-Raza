'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const Images = require('../assets/quiz-images');
const { candidate, searchImages } = require('../lib/quiz-images');
const { validQuiz } = require('../assets/classroom');
const { fixture } = require('./browser-fixture');
const { fakePeers } = require('./peer-fixture');
const image = { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/480px-Example.jpg', alt: 'plant cell', author: 'Example Artist', license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII=', 'base64');
const question = n => ({ q: 'Frage ' + (n+1), options: ['eins','zwei','drei','vier'], correct: n%4, explanation: 'Erklärung', imageQuery: 'plant cell' });
const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; }, send(body) { this.body=body; return this; }, end() { return this; } });
function page(license = 'CC BY-SA 4.0') { return { ns: 6, imageinfo: [{ thumburl: image.url, thumbmime: 'image/jpeg', descriptionurl: image.sourceUrl, extmetadata: { LicenseShortName: { value: license }, LicenseUrl: { value: image.licenseUrl }, Artist: { value: '<a href="https://example.test">Example Artist</a>' } } }] }; }

test('picture search keeps individual free licenses and plain creator attribution', async () => {
  assert.deepEqual(candidate(page(), 'plant cell'), image);
  assert.equal(candidate(page('CC BY-NC 4.0'), 'plant cell'), null);
  assert.equal(candidate(page('GFDL'), 'plant cell'), null);
  const missingAuthor = page(); delete missingAuthor.imageinfo[0].extmetadata.Artist;
  assert.equal(candidate(missingAuthor, 'plant cell'), null);
  const publicDomain = candidate(page('Public domain'), 'plant cell');
  assert.equal(publicDomain.license, 'Public domain');
  assert.match(publicDomain.licenseUrl, /publicdomain\/mark/);
  const current = page();
  current.imageinfo[0].thumburl = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/93/Stromboli_Eruption.jpg/500px-Stromboli_Eruption.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail';
  const normalized = candidate(current, 'volcanic eruption');
  assert.equal(normalized.url, current.imageinfo[0].thumburl.split('?')[0]);
  assert.equal(normalized.url.includes('utm_'), false);
  const calls = [];
  const result = await searchImages(['plant cell'], async url => { calls.push(url); return { ok: true, json: async () => ({ query: { pages: [page('CC BY-NC 4.0'), page()] } }) }; });
  assert.deepEqual(result, [{ query: 'plant cell', image }]);
  assert.equal(calls[0].hostname, 'commons.wikimedia.org');
  assert.equal(calls[0].searchParams.get('gsrnamespace'), '6');
});

test('untrusted URLs, active image formats and embedded classroom payloads are rejected', () => {
  for (const url of ['https://example.test/image.jpg', 'http://upload.wikimedia.org/wikipedia/commons/a/a9/x.jpg', image.url+'?redirect=1', image.url+'#x', image.url.replace('.jpg/480px-Example.jpg','.svg/480px-Example.svg'), image.url.replace('upload.wikimedia.org','user@upload.wikimedia.org')]) assert.equal(Images.normalizeImage({ ...image, url }), null);
  assert.equal(Images.normalizeImage({ ...image, sourceUrl: 'javascript:alert(1)' }), null);
  assert.equal(Images.normalizeImage({ ...image, licenseUrl: 'https://evil.test/license' }), null);
  const quiz = { topic: 'Test', questions: [{ ...question(0), image }] };
  assert.ok(validQuiz(quiz));
  assert.equal(validQuiz({ ...quiz, questions: [{ ...quiz.questions[0], image: { ...image, data: 'data:image/png;base64,ABC' } }] }), false);
});

test('search bounds and throttling do not cause unbounded calls or break quiz generation', async () => {
  const handler = require('../api/quiz-images');
  let res = response(); await handler({ method: 'POST', body: { queries: Array(7).fill('plant cell') } }, res); assert.equal(res.statusCode, 400);
  res = response(); await handler({ method: 'POST', body: '{' }, res); assert.equal(res.statusCode, 400);
  assert.equal(Images.query('https://private.test'), '');
  assert.equal(Images.questionQuery({ q: 'Was stimmt zu „Im Fall der Erde schmelzen Gesteine ab“?' }, 'Vulkane'), 'Vulkane');
  const quiz = { topic: 'Test', questions: [question(0)] };
  const result = await Images.enrich(quiz, async () => { throw new Error('Search unavailable'); });
  assert.deepEqual(result.questions, quiz.questions);
  let calls = 0;
  await searchImages(['one','two','three','four','five','six'], async () => { calls++; return { ok: false, status: 429 }; });
  assert.ok(calls <= 3);
});

test('image proxy allows bounded raster bytes and refuses redirects, SVG and oversized streams', async t => {
  const originalFetch = global.fetch, handler = require('../api/quiz-image');
  try {
    await t.test('only Commons image URLs can start an upstream request', async () => {
      global.fetch = () => { throw new Error('Must not request an arbitrary host'); };
      const res = response(); await handler({ method: 'GET', query: { url: 'https://localhost/secret.jpg' } }, res); assert.equal(res.statusCode, 400);
    });
    await t.test('valid bytes have a verified content type and cache headers', async () => {
      global.fetch = async (url, options) => { assert.equal(url, image.url); assert.equal(options.redirect, 'manual'); return new Response(png, { headers: { 'Content-Type': 'image/png' } }); };
      const res = response(); await handler({ method: 'GET', query: { url: image.url } }, res);
      assert.equal(res.statusCode, 200); assert.deepEqual(res.body, png); assert.equal(res.headers['Content-Type'], 'image/png'); assert.match(res.headers['Cache-Control'], /s-maxage/);
    });
    await t.test('HTML masquerading as an image and excessive bytes are rejected', async () => {
      global.fetch = async () => new Response('<svg onload="alert(1)"></svg>', { headers: { 'Content-Type': 'image/png' } });
      let res = response(); await handler({ method: 'GET', query: { url: image.url } }, res); assert.equal(res.statusCode, 415);
      global.fetch = async () => new Response(new Uint8Array(Images.MAX_BYTES+1), { headers: { 'Content-Type': 'image/png' } });
      res = response(); await handler({ method: 'GET', query: { url: image.url } }, res); assert.equal(res.statusCode, 413);
    });
    await t.test('only validated Commons redirects can be followed', async () => {
      let calls = 0;
      global.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://example.test/secret.jpg' } }); };
      let res = response(); await handler({ method: 'GET', query: { url: image.url } }, res); assert.equal(res.statusCode, 502); assert.equal(calls, 1);
      calls = 0; const thumbnail = image.url.replace('upload.', 'thumb.');
      global.fetch = async url => { calls++; return url === image.url ? new Response(null, { status: 302, headers: { Location: thumbnail } }) : new Response(png, { headers: { 'Content-Type': 'image/png' } }); };
      res = response(); await handler({ method: 'GET', query: { url: image.url } }, res); assert.equal(res.statusCode, 200); assert.equal(calls, 2);
    });
  } finally { global.fetch = originalFetch; }
});

test('optional picture queries keep text evidence and require no additional AI generation', async () => {
  const ai = require('../lib/free-ai'), originalGenerate = ai.generateFreeText, originalFetch = global.fetch;
  const quotes = ['Die Pflanzenzelle besitzt eine feste Zellwand aus Zellulose.', 'Chloroplasten wandeln Lichtenergie in chemische Energie um.', 'Der Zellkern enthält die Erbinformationen einer Pflanzenzelle.'];
  try {
    let promptText = '', calls = 0;
    ai.generateFreeText = async prompt => { promptText = prompt; calls++; return { text: JSON.stringify({ questions: quotes.map((quote,n) => ({ ...question(n), sourceIndex: 0, quote })) }), model: 'verified/free' }; };
    global.fetch = () => { throw new Error('Learning texts must not fetch source material or pictures in the quiz request'); };
    delete require.cache[require.resolve('../api/quiz')]; const handler = require('../api/quiz');
    let res = response(); await handler({ method: 'POST', body: { sourceText: quotes.join(' '), count: 3, images: true } }, res);
    assert.equal(res.statusCode, 200); assert.equal(calls, 1); assert.match(promptText, /höchstens sechs/); assert.ok(res.body.questions.every(q => q.imageQuery === 'plant cell' && q.sourceQuote));
    res = response(); await handler({ method: 'POST', body: { sourceText: quotes.join(' '), count: 3, images: false } }, res);
    assert.equal(res.statusCode, 200); assert.doesNotMatch(promptText, /imageQuery/); assert.ok(res.body.questions.every(q => !Object.hasOwn(q, 'imageQuery')));
  } finally { ai.generateFreeText = originalGenerate; global.fetch = originalFetch; delete require.cache[require.resolve('../api/quiz')]; }
});

test('50 questions retain shared pictures and the download works offline with one embedded copy per picture', async () => {
  const questions = Array.from({ length: 50 }, (_, n) => question(n)), quiz = { topic: 'Pflanzenzelle', questions }, Peer = fakePeers();
  const teacher = fixture({ quiz, Peer }); teacher.element('images').checked = true; teacher.element('count').value = '50';
  let aiCalls = 0, pictureCalls = 0, binaryCalls = 0;
  teacher.context.fetch = async (url, options) => {
    if (url === '/api/quiz') { aiCalls++; assert.equal(JSON.parse(options.body).images, true); return { ok: true, json: async () => quiz }; }
    if (url === '/api/quiz-images') { pictureCalls++; assert.deepEqual(JSON.parse(options.body), { queries: ['plant cell'] }); return { ok: true, json: async () => ({ images: [{ query: 'plant cell', image }] }) }; }
    if (url.startsWith('/api/quiz-image?')) { binaryCalls++; return new Response(png, { headers: { 'Content-Type': 'image/png' } }); }
    throw new Error('Unexpected request');
  };
  await teacher.element('classStart').onclick();
  const guest = fixture({ url: teacher.element('classLink').href, Peer }); guest.element('nickname').value = 'Mia';
  guest.context.fetch = () => { throw new Error('The student must use the shared quiz and its picture metadata'); };
  await guest.element('start').onclick();
  assert.equal(guest.element('counter').textContent, 'Frage 1 von 50'); assert.equal(guest.element('picture').src, Images.proxyUrl(image)); assert.match(guest.element('pictureCredit').innerHTML, /Example Artist.*CC BY-SA/);
  await teacher.element('downloadSetup').onclick();
  assert.equal(aiCalls, 1); assert.equal(pictureCalls, 1); assert.equal(binaryCalls, 1);
  const output = await teacher.blobs.get(teacher.downloads[0].href).text(), script = output.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.equal(output.split(png.toString('base64')).length-1, 1, 'Repeated pictures must only be embedded once in the HTML file');
  const offline = { document: teacher.document, URL, setTimeout() {}, clearTimeout() {}, fetch() { throw new Error('Offline play must not access the network'); } };
  vm.createContext(offline); vm.runInContext(script, offline);
  assert.match(teacher.element('picImg').src, /^data:image\/png;base64,/);
  assert.match(teacher.element('picCredit').innerHTML, /Example Artist.*creativecommons/);
  for (let n=0;n<50;n++) { assert.equal(teacher.element('q').textContent, questions[n].q); teacher.element('a').children[n%4].onclick(); teacher.element('next').onclick(); }
  assert.match(teacher.element('done').textContent, /5000 von 5000/); assert.ok(teacher.element('pic').classList.contains('hide'));
  teacher.element('restart').onclick(); assert.ok(!teacher.element('pic').classList.contains('hide'));
  assert.equal(quiz.questions[0].image, undefined, 'Picture enrichment must not mutate the original quiz');
  // The classroom copy retains small URLs; the exported image bytes never enter the relay.
  assert.equal(guest.element('picture').src.startsWith('data:'), false);
  teacher.element('closeClass').onclick();
});

test('failed offline pictures are omitted without remote image dependencies or losing questions', async () => {
  const result = await Images.embedOffline([{ ...question(0), image: { ...image, url: image.url.replace('a9/Example', 'a9/Other').replace('480px-Example', '480px-Other') } }], async () => ({ ok: false }));
  assert.equal(result.questions.length, 1); assert.equal(result.missing, 1); assert.equal(result.questions[0].image, undefined);
});
