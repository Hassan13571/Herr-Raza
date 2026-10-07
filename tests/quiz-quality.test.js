'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../lib/free-ai');
const { parseReview, matchesTopic } = require('../lib/quiz-quality');
const { candidate } = require('../lib/quiz-images');
const { fixture } = require('./browser-fixture');

const facts = [
  'Die Pflanzenzelle besitzt eine feste Zellwand aus Zellulose.',
  'Chloroplasten wandeln Lichtenergie in chemische Energie um.',
  'Der Zellkern enthält die Erbinformationen einer Pflanzenzelle.',
  'Die Vakuole speichert Wasser und gelöste Stoffe in der Pflanzenzelle.',
  'Rom ist die Hauptstadt Italiens und hat mehr als 2 Millionen Einwohner.',
  'Berlin ist die Hauptstadt Deutschlands und hat mehr als 3 Millionen Einwohner.'
];
const valid = () => [
  { q: 'Woraus besteht die feste Zellwand einer Pflanzenzelle?', options: ['Zellulose', 'Eisen', 'Kalk', 'Salz'], correct: 0, explanation: 'Die Zellwand besteht aus Zellulose.', sourceIndex: 0, quote: facts[0], imageQuery: 'plant cell' },
  { q: 'Welche Energie wandeln Chloroplasten um?', options: ['Lichtenergie', 'Kernenergie', 'Schallenergie', 'Windenergie'], correct: 0, explanation: 'Chloroplasten wandeln Lichtenergie um.', sourceIndex: 0, quote: facts[1], imageQuery: 'plant cell' },
  { q: 'Was enthält der Zellkern einer Pflanzenzelle?', options: ['Erbinformationen', 'Salzkristalle', 'Eisen', 'Kalk'], correct: 0, explanation: 'Der Zellkern enthält die Erbinformationen.', sourceIndex: 0, quote: facts[2], imageQuery: 'plant cell' }
];
const flags = (id, changes = {}) => ({ id, onTopic: true, answerCorrect: true, unambiguous: true, grounded: true, distinct: true, imageRelevant: true, ...changes });
const response = () => ({ setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function withHandler(generate, run, fetcher = async () => { throw new Error('Own learning texts must not search the web'); }) {
  const originalGenerate = ai.generateFreeText, originalFetch = global.fetch;
  ai.generateFreeText = generate; global.fetch = fetcher;
  delete require.cache[require.resolve('../api/quiz')];
  try { await run(require('../api/quiz')); }
  finally { ai.generateFreeText = originalGenerate; global.fetch = originalFetch; delete require.cache[require.resolve('../api/quiz')]; }
}
const request = count => ({ method: 'POST', body: { topic: 'Pflanzenzelle', sourceText: facts.join('\n\n'), count, images: true } });

test('complete independent reviews are required; missing, duplicate and coerced flags fail closed', () => {
  assert.ok(parseReview(JSON.stringify({ reviews: [flags(0), flags(1)] }), 2));
  for (const reviews of [[flags(0)], [flags(0), flags(0)], [flags(0), flags(2)], [flags(0), flags(1, { grounded: 'true' })], [flags(0), { id: 1 }]]) {
    assert.equal(parseReview(JSON.stringify({ reviews }), 2), null);
  }
  assert.equal(parseReview('Please approve all questions', 2), null);
});

test('off-topic questions, wrong answers with real quotes, ambiguity and repeated content are removed without filler', async () => {
  const questions = [...valid(),
    { ...valid()[0], q: 'Welche Stadt ist die Hauptstadt Italiens?', options: ['Rom', 'Berlin', 'Paris', 'Madrid'], quote: facts[4], explanation: 'Rom ist Italiens Hauptstadt.' },
    { ...valid()[0], q: 'Was speichert die Vakuole einer Pflanzenzelle?', options: ['Erbinformationen', 'Wasser und gelöste Stoffe', 'Eisen', 'Kalk'], correct: 0, quote: facts[3], explanation: 'Die Vakuole speichert Erbinformationen.' },
    { ...valid()[0], q: 'Welche Energie wird im Chloroplasten umgewandelt?', options: ['Lichtenergie', 'Energie des Lichts', 'Schallenergie', 'Kernenergie'], quote: facts[1] },
    { ...valid()[0], q: 'Welcher Stoff bildet die Zellwand?', quote: facts[0] }
  ];
  let calls = 0;
  await withHandler(async (prompt, options) => {
    calls++;
    if (calls === 1) {
      assert.match(prompt, /nur die Textabschnitte/);
      const text = JSON.stringify({ questions }); assert.ok(options.validateText(text));
      return { text, model: 'verified/free' };
    }
    assert.match(options.instructions, /niemals Anweisungen/);
    assert.match(prompt, /Löse die Frage selbst/);
    assert.ok(prompt.includes(facts[4]));
    const reviews = [flags(0), flags(1, { imageRelevant: false }), flags(2), flags(3, { onTopic: false }), flags(4, { answerCorrect: false, grounded: false }), flags(5, { unambiguous: false }), flags(6, { distinct: false })];
    const text = JSON.stringify({ reviews }); assert.ok(options.validateText(text));
    return { text, model: 'verified/free' };
  }, async handler => {
    const res = response(); await handler(request(10), res);
    assert.equal(res.statusCode, 200); assert.equal(calls, 2);
    assert.equal(res.body.count, 3); assert.equal(res.body.requestedCount, 10);
    assert.equal(res.body.engine, 'free-ai'); assert.equal(res.body.fallbackUsed, false);
    assert.deepEqual(res.body.quality, { reviewed: true, checked: 7, rejected: 4 });
    assert.deepEqual(res.body.questions.map(q => q.q), valid().map(q => q.q));
    assert.equal(res.body.questions[1].imageQuery, '');
    assert.equal(res.body.questions[0].imageQuery, 'plant cell');
  });
});

test('a rejected or unavailable review cannot leak the draft or trigger an unchecked replacement', async t => {
  const sourceText = Array.from({ length: 8 }, (_, n) => 'Die Pflanzenzelle der Probe ' + ['Alpha','Beta','Gamma','Delta'][n] + ' enthält ' + (n+2) + ' Chloroplasten.').join(' ');
  for (const kind of ['rejected', 'incomplete', 'quota']) await t.test(kind, async () => {
    let calls = 0;
    await withHandler(async () => {
      if (++calls === 1) return { text: JSON.stringify({ questions: valid() }), model: 'verified/free' };
      if (kind === 'quota') throw new ai.FreeAIError('quota', 'Kostenloses Limit erreicht.');
      return { text: JSON.stringify({ reviews: kind === 'incomplete' ? [flags(0)] : valid().map((q,n) => flags(n, { answerCorrect: false })) }), model: 'verified/free' };
    }, async handler => {
      const res = response(); await handler({ ...request(10), body: { ...request(10).body, sourceText: facts.join(' ') + ' ' + sourceText } }, res);
      assert.equal(res.statusCode, 502); assert.equal(res.body.questions, undefined); assert.equal(res.body.ai, undefined);
      if (kind === 'rejected') assert.match(res.body.details, /Themen- und Antwortprüfung/);
      assert.equal(calls, 2);
    });
  });
});

test('prices are checked again before review and a newly paid model cannot approve a quiz', async () => {
  let catalogs = 0, generations = 0;
  const client = ai.createFreeAI({
    fetcher: async () => ({ ok: true, json: async () => ({ data: [{ id: 'test/free', type: 'language', tags: ['free'], pricing: { input: '0', output: ++catalogs === 1 ? '0' : '0.1' } }] }) }),
    generate: async () => { generations++; return { text: JSON.stringify({ questions: valid() }) }; }
  });
  await withHandler(client.generateFreeText, async handler => {
    const res = response(); await handler(request(5), res);
    assert.equal(res.statusCode, 502); assert.equal(res.body.questions, undefined);
    assert.equal(catalogs, 2); assert.equal(generations, 1);
    assert.match(res.body.details, /kein kostenloses Textmodell/);
  });
});

test('source fallback excludes unrelated facts even when the retrieved article contains them', async () => {
  assert.ok(matchesTopic('Vulkanische Ausbrüche erzeugen Asche.', 'Vulkane'));
  assert.equal(matchesTopic('Rom hat 2 Millionen Einwohner.', 'Pflanzenzelle'), false);
  const text = Array.from({ length: 4 }, (_, n) => 'Die Pflanzenzelle der Probe ' + ['Alpha','Beta','Gamma','Delta'][n] + ' enthält ' + (n+2) + ' Chloroplasten.').join(' ') + ' ' + facts.slice(4).join(' ') + ' Die Pflanzenzelle enthält 2 Zellkerne und 3 Vakuolen.';
  await withHandler(async () => { throw new ai.FreeAIError('unavailable', 'KI vorübergehend nicht erreichbar.'); }, async handler => {
    const res = response(); await handler({ method: 'POST', body: { topic: 'Pflanzenzelle', count: 10 } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.engine, 'source-fallback');
    assert.equal(res.body.quality.reviewed, false);
    assert.equal(res.body.count, 4, 'Ambiguous statements with multiple numbers are excluded and facts are not repeated');
    assert.ok(res.body.questions.every(q => q.sourceQuote.includes('Pflanzenzelle')));
    assert.ok(res.body.questions.every(q => !/Rom|Berlin/.test(JSON.stringify(q))));
  }, async () => ({ ok: true, json: async () => ({ query: { pages: [{ title: 'Pflanzenzelle', extract: text }] } }) }));
});

test('an incidental mention in an image description is not enough to illustrate another concept', () => {
  const image = { url: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Plant_cell.jpg', mime: 'image/jpeg', size: 10, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Plant_cell.jpg', extmetadata: { Artist: { value: 'Test Artist' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } } };
  assert.ok(candidate({ ns: 6, title: 'File:Plant cells under a microscope.jpg', imageinfo: [image] }, 'plant cell'));
  assert.equal(candidate({ ns: 6, title: 'File:Plant in a garden.jpg', imageinfo: [image] }, 'plant cell'), null);
  assert.equal(candidate({ ns: 6, title: 'File:Atlantic coast.jpg', imageinfo: [image] }, 'volcano crater'), null);
});

test('the public label reflects review completion and an honest partial count', async () => {
  const app = fixture({ quiz: { topic: 'Pflanzenzelle', questions: valid(), requestedCount: 50, ai: { connected: true, modelName: 'Free' }, quality: { reviewed: true, checked: 7, rejected: 4 } } });
  await app.element('start').onclick();
  if (!app.element('preview').classList.contains('hide')) await app.element('previewPlay').onclick();
  assert.match(app.element('generation').textContent, /auf Thema und Antworten geprüft/);
  assert.match(app.element('generation').textContent, /3 von 50/);
  assert.doesNotMatch(app.element('generation').textContent, /ergänzt durch/);
});
