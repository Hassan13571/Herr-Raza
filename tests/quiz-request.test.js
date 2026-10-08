'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { create, CACHE } = require('../assets/quiz-request');
const { normalizeQuiz } = require('../assets/studio');
const { fixture } = require('./browser-fixture');
const input = { topic: 'Pflanzen', sourceText: 'PRIVATE ORIGINAL SOURCE', count: '5', difficulty: 'easy', mode: 'school', images: false };
const quiz = { topic: 'Pflanzen', ai: { connected: true }, quality: { reviewed: true }, requestedCount: 5, questions: [{ q: 'Was brauchen Pflanzen?', options: ['Wasser', 'Plastik', 'Glas', 'Beton'], correct: 0, explanation: 'Pflanzen brauchen Wasser.' }] };
const storage = () => { const map = new Map(); return { map, getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) }; };
const options = (store, fetcher, now) => ({ storage: store, fetcher, normalize: normalizeQuiz, crypto: webcrypto, now });
test('identical requests share one AI call and a completed quiz survives reload without storing the source', async () => {
  const store = storage(); let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => quiz }; };
  const client = create(options(store, fetcher));
  const [a, b] = await Promise.all([client.load(input), client.load(input)]);
  assert.equal(calls, 1); a.questions[0].correct = 2; assert.equal(b.questions[0].correct, 0);
  const reloaded = create(options(store, () => { throw new Error('No AI needed'); }));
  assert.equal((await reloaded.load(input)).questions[0].correct, 0);
  assert.ok(!store.map.get(CACHE).includes(input.sourceText));
});
test('rate limit survives reload, blocks different fresh requests, but allows an already ready quiz', async () => {
  const store = storage(); let time = 1000, calls = 0;
  const fetcher = async () => { calls++; return calls === 1 || calls === 3 ? { ok: true, json: async () => quiz } : { ok: false, status: 429, json: async () => ({ code: 'quota', retryAfter: 120 }) }; };
  const client = create(options(store, fetcher, () => time));
  await client.load(input);
  const changed = { ...input, sourceText: 'A different source' };
  await assert.rejects(client.load(changed), /120 Sekunden/);
  const reloaded = create(options(store, fetcher, () => time));
  await assert.rejects(reloaded.load({ ...changed, topic: 'Zellen' }), /120 Sekunden/);
  assert.equal((await reloaded.load(input)).questions.length, 1); assert.equal(calls, 2);
  time += 120001; await reloaded.load(changed); assert.equal(calls, 3);
});
test('request parameters and live expiry prevent reuse of mismatched or stale quizzes', async () => {
  let time = 1000, calls = 0; const store = storage();
  const client = create(options(store, async () => { calls++; return { ok: true, json: async () => quiz }; }, () => time));
  await client.load(input);
  for (const change of [{ sourceText: 'Different' }, { count: '50' }, { difficulty: 'hard' }, { images: true }]) await client.load({ ...input, ...change });
  assert.equal(calls, 5);
  const live = { ...input, mode: 'live' }; await client.load(live); await client.load(live); assert.equal(calls, 6);
  time += 120001; await client.load(live); assert.equal(calls, 7);
});
test('failed reviews and blocked browser storage cannot create a fake cached success', async () => {
  let calls = 0;
  const client = create(options({ getItem() { throw new Error(); }, setItem() { throw new Error(); } }, async () => { calls++; return { ok: false, status: 502, json: async () => ({ code: 'quality_rejected', details: 'Keine Frage ist sicher.' }) }; }));
  await assert.rejects(client.load(input), /Keine Frage/); await assert.rejects(client.load(input), /Keine Frage/); assert.equal(calls, 2);
});
test('actual app reopens a ready quiz from the start screen without another server call', async () => {
  const app = fixture({ quiz }); let calls = 0;
  app.context.fetch = async () => { calls++; return { ok: true, json: async () => quiz }; };
  await app.element('start').onclick(); app.element('previewBack').onclick(); await app.element('start').onclick();
  assert.equal(calls, 1); assert.equal(app.element('preview').classList.contains('hide'), false);
});
