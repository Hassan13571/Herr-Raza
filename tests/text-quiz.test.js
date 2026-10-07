'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../lib/free-ai');
const { reviewing } = require('./review-fixture');
const { fixture } = require('./browser-fixture');
const { fakePeers } = require('./peer-fixture');

const facts = [
  'Die Sternwarte Morgenrot verwendet wissenschaftliche Methoden und beobachtet das Licht entfernter Sterne.',
  'Ihr Spektrometer zerlegt das Licht in einzelne Wellenlängen.',
  'Zum Abschluss vergleicht das Team die Messwerte mit früheren Beobachtungen.'
];
const validQuestions = () => facts.map((quote, n) => ({ q: 'Was beschreibt Abschnitt ' + (n + 1) + '?', options: ['Eine Beobachtung', 'Einen Einkauf', 'Eine Sportart', 'Ein Rezept'], correct: 0, explanation: 'Der Text beschreibt eine Beobachtung.', sourceIndex: 0, quote }));
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } }; }

test('text API preserves the full source, verifies evidence and never fetches web grounding', async t => {
  const originalGenerate = ai.generateFreeText, originalFetch = global.fetch;
  let generate, calls = 0;
  ai.generateFreeText = (...args) => { calls++; return reviewing(generate)(...args); };
  delete require.cache[require.resolve('../api/quiz')];
  const handler = require('../api/quiz');
  global.fetch = async () => { throw new Error('Text quizzes must not search the web'); };
  try {
    await t.test('all 60,000 characters including the last paragraph reach the model', async () => {
      const padding = 'Hintergrund zum Beobachtungsprojekt. '.repeat(1800);
      const suffix = '\n\n' + facts[2];
      const prefix = facts[0] + '\n\n' + facts[1] + '\n\n';
      const sourceText = prefix + padding.slice(0, 60000 - prefix.length - suffix.length) + suffix;
      assert.equal(sourceText.length, 60000);
      generate = async (prompt, options) => {
        assert.ok(prompt.includes(JSON.stringify(sourceText)));
        assert.match(options.instructions, /keine Anweisungen/);
        assert.match(prompt, /Anfang, in der Mitte und am Ende/);
        assert.ok(options.validateText(JSON.stringify({ questions: validQuestions() })));
        return { text: JSON.stringify({ questions: validQuestions() }), model: 'verified/free', modelName: 'Free' };
      };
      const res = response();
      await handler({ method: 'POST', body: { sourceText, count: 3, mode: 'live', difficulty: 'hard' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.inputType, 'text');
      assert.equal(res.body.mode, 'school');
      assert.equal(res.body.engine, 'free-ai');
      assert.equal(res.body.questions[2].sourceQuote, facts[2]);
      assert.ok(res.body.questions.every(q => q.source === 'Dein Text' && q.sourceUrl === '' && q.explanation.includes(q.sourceQuote)));
      assert.equal(res.headers['Cache-Control'], 'no-store');
      assert.equal(res.body.sourceText, undefined);
      assert.equal(res.body.topic, 'Quiz aus deinem Text');
    });
    await t.test('fabricated quotes, wrong sources and unchecked legacy answers cannot count as AI questions', async () => {
      generate = async (prompt, options) => {
        const invalid = [
          { ...validQuestions()[0], quote: 'Eine völlig erfundene Textstelle ohne Bezug zum Lerntext.' },
          { ...validQuestions()[1], sourceIndex: -1 },
          { ...validQuestions()[2], quote: '' }
        ];
        assert.equal(options.validateText(JSON.stringify({ questions: invalid })), false);
        assert.equal(options.validateText('QUESTION|Test?\nA|eins\nB|zwei\nC|drei\nD|vier\nCORRECT|A\nEND'), false);
        return { text: JSON.stringify({ questions: invalid }), model: 'verified/free' };
      };
      const res = response();
      await handler({ method: 'POST', body: { sourceText: facts.join(' '), count: 3 } }, res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.body.ai, undefined);
      assert.match(res.body.details, /KI hat gerade kein ausreichend belegtes und geprüftes Quiz/);
      assert.doesNotMatch(res.body.details, /mehr Lerntext/);
    });
    await t.test('a provider outage does not blame a complete learning text', async () => {
      generate = async () => { throw new ai.FreeAIError('unavailable', 'Die kostenlose KI ist gerade nicht erreichbar. Bitte später erneut versuchen.'); };
      const res = response();
      await handler({ method: 'POST', body: { sourceText: facts.join(' '), count: 3 } }, res);
      assert.equal(res.statusCode, 502);
      assert.match(res.body.details, /KI ist gerade nicht erreichbar/);
      assert.doesNotMatch(res.body.details, /mehr Lerntext/);
    });
    await t.test('oversized, short and malformed text is rejected before calling AI', async () => {
      const before = calls;
      for (const [body, status] of [[{ sourceText: 'x'.repeat(60001) }, 413], [{ sourceText: 'Zu kurz' }, 400], [{ sourceText: {} }, 400], ['{invalid', 400]]) {
        const res = response();
        await handler({ method: 'POST', body }, res);
        assert.equal(res.statusCode, status);
      }
      const res = response();
      await handler({ method: 'GET', query: { sourceText: facts.join(' ') } }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(calls, before);
    });
    await t.test('safe topics containing the word Methoden are not mistaken for drugs', async () => {
      global.fetch = async () => ({ ok: true, json: async () => ({ query: { pages: [{ title: 'Wissenschaftliche Methoden', extract: facts.join(' ') }] } }) });
      generate = async () => ({ text: JSON.stringify({ questions: validQuestions() }), model: 'verified/free' });
      const res = response();
      await handler({ method: 'POST', body: { topic: 'Wissenschaftliche Methoden', count: 3 } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.inputType, 'topic');
    });
  } finally {
    ai.generateFreeText = originalGenerate; global.fetch = originalFetch;
    delete require.cache[require.resolve('../api/quiz')];
  }
});

test('long text uses a POST body, supports an empty title and can be downloaded without another AI call', async () => {
  const app = fixture();
  app.element('topic').value = '';
  const sourceText = facts.join('\n\n') + '\n' + 'Lernmaterial. '.repeat(1700);
  app.element('sourceText').value = sourceText;
  const calls = [];
  app.context.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ topic: 'Quiz aus deinem Text', questions: validQuestions().map(q => ({ ...q, source: 'Dein Text', sourceUrl: '' })) }) };
  };
  await app.element('downloadSetup').onclick();
  await app.element('previewDownload').onclick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/quiz');
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(JSON.parse(calls[0].options.body).sourceText === sourceText.trim());
  assert.equal(app.element('mode').disabled, true);
  assert.equal(app.downloads[0].name, 'Quiz-aus-deinem-Text.html');
  app.element('downloadQuiz').onclick();
  assert.equal(calls.length, 1);
});

test('a text class shares only its finished questions, with named guests making no AI requests', async () => {
  const Peer = fakePeers(), quiz = { topic: 'Quiz aus deinem Text', questions: validQuestions().map(q => ({ ...q, source: 'Dein Text', sourceUrl: '' })) };
  const teacher = fixture({ quiz, Peer });
  teacher.element('topic').value = '';
  teacher.element('sourceText').value = facts.join('\n\n');
  await teacher.element('classStart').onclick();
  await teacher.element('previewClass').onclick();
  assert.equal(teacher.element('sourceText').disabled, true);
  const guest = fixture({ url: teacher.element('classLink').href, Peer });
  guest.element('nickname').value = 'Text-Test';
  guest.context.fetch = () => { throw new Error('Students do not call AI'); };
  await guest.element('start').onclick();
  assert.equal(guest.element('question').textContent, quiz.questions[0].q);
  assert.equal(teacher.element('participantCount').textContent, '1 beigetreten · 1 verbunden');
  teacher.element('closeClass').onclick();
  assert.equal(teacher.element('sourceText').disabled, false);
});
