'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ai = require('../lib/free-ai');
const { reviewing } = require('./review-fixture');
const { validQuiz } = require('../assets/classroom');
const { fixture } = require('./browser-fixture');

const facts = Array.from({ length: 50 }, (_, n) => 'Im Lernabschnitt ' + (n + 1) + ' untersucht das Team einen anderen Vorgang.');
const rawQuestion = n => ({ q: 'Was untersucht das Team in Lernabschnitt ' + (n + 1) + '?', options: ['Einen Vorgang', 'Ein Rezept', 'Einen Einkauf', 'Eine Sportart'], correct: 0, explanation: 'Es untersucht einen Vorgang.', sourceIndex: 0, quote: facts[n] });
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } }; }

test('large text quizzes request complete output, keep evidence and remain bounded to 50', async t => {
  const originalGenerate = ai.generateFreeText, originalFetch = global.fetch;
  let generate;
  ai.generateFreeText = (...args) => reviewing(generate)(...args);
  delete require.cache[require.resolve('../api/quiz')];
  const handler = require('../api/quiz');
  global.fetch = async () => { throw new Error('Own text must not search the web'); };
  try {
    await t.test('one generation produces 50 distinct questions and the complete set receives a review', async () => {
      let calls = 0;
      generate = async (prompt, options) => {
        calls++;
        assert.match(prompt, /^ANZAHL: 50$/m);
        assert.ok(prompt.includes(JSON.stringify(facts.join('\n\n'))));
        assert.equal(options.maxOutputTokens, 32500);
        assert.equal(options.attemptTimeoutMs, 220000);
        assert.ok(options.signal instanceof AbortSignal);
        const text = JSON.stringify({ questions: Array.from({ length: 50 }, (_, n) => rawQuestion(n)) });
        assert.ok(options.validateText(text));
        return { text, model: 'verified/free', modelName: 'Free' };
      };
      const res = response();
      await handler({ method: 'POST', body: { sourceText: facts.join('\n\n'), count: 50, difficulty: 'hard' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(calls, 1);
      assert.equal(res.body.count, 50);
      assert.equal(res.body.requestedCount, 50);
      assert.equal(res.body.aiQuestionCount, 50);
      assert.equal(res.body.engine, 'free-ai');
      assert.equal(new Set(res.body.questions.map(q => q.q)).size, 50);
      assert.equal(res.body.questions[49].sourceQuote, facts[49]);
      assert.equal(res.body.ai.pricing, 'free');
      assert.ok(validQuiz(res.body));
      assert.equal(validQuiz({ ...res.body, questions: [...res.body.questions, res.body.questions[0]] }), false);
    });
    await t.test('API inputs above the maximum never request more than 50 questions', async () => {
      generate = async (prompt, options) => {
        assert.match(prompt, /^ANZAHL: 50$/m);
        assert.ok(options.maxOutputTokens <= 32768);
        return { text: JSON.stringify({ questions: Array.from({ length: 50 }, (_, n) => rawQuestion(n)) }), model: 'verified/free' };
      };
      const res = response();
      await handler({ method: 'POST', body: { sourceText: facts.join('\n\n'), count: 1000 } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.requestedCount, 50);
      assert.equal(res.body.count, 50);
    });
    await t.test('repeated model questions cannot be counted as 50 AI questions', async () => {
      let calls = 0;
      generate = async () => {
        calls++;
        return { text: JSON.stringify({ questions: Array.from({ length: 50 }, (_, n) => rawQuestion(n % 25)) }), model: 'verified/free' };
      };
      const res = response();
      await handler({ method: 'POST', body: { sourceText: facts.join('\n\n'), count: 50 } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(calls, 1);
      assert.equal(res.body.aiQuestionCount, 25);
      assert.equal(res.body.requestedCount, 50);
      assert.equal(new Set(res.body.questions.map(q => q.q.toLowerCase())).size, res.body.questions.length);
    });
  } finally {
    ai.generateFreeText = originalGenerate; global.fetch = originalFetch;
    delete require.cache[require.resolve('../api/quiz')];
  }
});

test('50-question quiz downloads completely, reaches the last answer and replays offline', async () => {
  const questions = Array.from({ length: 50 }, (_, n) => ({ q: 'Frage ' + (n + 1), options: ['eins', 'zwei', 'drei', 'vier'], correct: n % 4, explanation: 'Erklärung ' + (n + 1) }));
  const app = fixture({ quiz: { topic: 'Großes Quiz', questions } });
  app.element('count').value = '50';
  let requested;
  app.context.fetch = async (url, options) => { requested = JSON.parse(options.body); return { ok: true, json: async () => ({ topic: 'Großes Quiz', questions }) }; };
  await app.element('downloadSetup').onclick();
  await app.element('previewDownload').onclick();
  assert.equal(requested.count, '50');
  assert.equal(app.element('previewCount').textContent, '50 / 50 Fragen');
  const output = await app.blobs.get(app.downloads[0].href).text();
  const script = output.match(/<script>([\s\S]*?)<\/script>/)[1];
  const offline = { document: app.document, setTimeout() {}, clearTimeout() {} };
  vm.createContext(offline); vm.runInContext(script, offline);
  for (let n = 0; n < 50; n++) {
    assert.equal(app.element('q').textContent, questions[n].q);
    app.element('a').children[questions[n].correct].onclick();
    app.element('next').onclick();
  }
  assert.match(app.element('done').textContent, /5000 von 5000/);
  app.element('restart').onclick();
  assert.equal(app.element('q').textContent, 'Frage 1');
  assert.match(app.element('n').textContent, /Frage 1 von 50.*Punkte: 0/);
});

test('large legacy links preserve the requested count and partial results show their actual size', async () => {
  const questions = Array.from({ length: 5 }, (_, n) => ({ q: 'Frage ' + n, options: ['eins', 'zwei', 'drei', 'vier'], correct: 0, explanation: 'Erklärung' }));
  const app = fixture({ url: 'https://quiz.test/?join=1&topic=Test&count=50', quiz: { topic: 'Test', requestedCount: 50, questions, ai: { connected: true, modelName: 'Free' }, warning: 'Kostenloses Limit erreicht.' } });
  assert.equal(app.element('count').value, '50');
  await app.element('start').onclick();
  if (!app.element('preview').classList.contains('hide')) await app.element('previewPlay').onclick();
  assert.match(app.element('generation').textContent, /5 von 50 gewünschten Fragen/);
  assert.match(app.element('generation').textContent, /Kostenloses Limit erreicht/);
});
