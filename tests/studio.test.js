'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, backup, parseBackup, normalizeQuiz, KEY } = require('../assets/studio');
const { fixture } = require('./browser-fixture');
const quiz = { topic: 'Pflanzen', ai: { connected: true }, quality: { reviewed: true }, sourceText: 'PRIVATE ORIGINAL MATERIAL', questions: [{ q: 'Wie viele?', options: ['eins', 'zwei', 'drei', 'vier'], correct: 0, explanation: 'Eine Zelle. Textstelle: „Eine Zelle.“', sourceQuote: 'Eine Zelle.', source: 'Dein Text' }] };
function storageFixture() { const data = new Map(); return { data, getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }; }
test('collection survives a new instance, updates one entry and archives reversibly without storing the full source', () => {
  const storage = storageFixture(), first = new Collection(storage, () => 'entry-1');
  const saved = first.save(quiz, { time: '30', shuffle: 'no' });
  assert.ok(!storage.data.get(KEY).includes(quiz.sourceText));
  const second = new Collection(storage); assert.equal(second.read()[0].quiz.topic, 'Pflanzen');
  second.save({ ...quiz, topic: 'Zellen' }, {}, saved.id); assert.equal(second.read().length, 1);
  second.archive(saved.id, true); assert.equal(second.read()[0].archived, true);
  second.archive(saved.id, false); assert.equal(second.read()[0].archived, false);
});
test('corrupted and full storage report failure without overwriting existing quizzes', () => {
  const storage = storageFixture(); storage.data.set(KEY, '{broken');
  assert.throws(() => new Collection(storage).save(quiz, {}), /nicht überschrieben/); assert.equal(storage.data.get(KEY), '{broken');
  const denied = new Collection({ getItem: () => null, setItem() { throw new Error('quota'); } }, () => 'entry-1');
  assert.throws(() => denied.save(quiz, {}), /voll oder gesperrt/);
});
test('backup imports complete quizzes and rejects malformed answers, active links and unrelated data', () => {
  const roundtrip = parseBackup(backup(quiz, { time: '60', shuffle: 'no' }));
  assert.deepEqual(roundtrip.quiz.questions, quiz.questions); assert.equal(roundtrip.settings.time, '60');
  assert.equal(roundtrip.quiz.edited, true); assert.equal(roundtrip.quiz.quality.reviewed, false);
  assert.throws(() => parseBackup('{"questions":[]}'), /keine Herr-Raza/);
  assert.throws(() => normalizeQuiz({ ...quiz, questions: [{ ...quiz.questions[0], options: ['A', 'a', 'B', 'C'] }] }), /verschiedene Antworten/);
  assert.throws(() => normalizeQuiz({ ...quiz, questions: [{ ...quiz.questions[0], correct: 4 }] }), /Frage 1/);
  assert.equal(normalizeQuiz({ ...quiz, questions: [{ ...quiz.questions[0], sourceUrl: 'javascript:alert(1)' }] }).questions[0].sourceUrl, undefined);
});
test('preview precedes play and edited answers determine results, remove obsolete evidence and survive saving and reopening', async () => {
  const storage = new Map(), app = fixture({ quiz, storage }); let requests = 0;
  app.context.fetch = async () => { requests++; return { ok: true, json: async () => quiz }; };
  await app.element('start').onclick();
  assert.equal(app.element('quiz').classList.contains('hide'), true); assert.equal(app.element('preview').classList.contains('hide'), false);
  app.element('edit-option-0-1').value = 'zwei Zellen'; app.element('edit-correct-0-0').checked = false; app.element('edit-correct-0-1').checked = true;
  await app.element('previewSave').onclick(); assert.match(app.element('previewStatus').textContent, /gespeichert/);
  const stored = JSON.parse(storage.get(KEY)); assert.equal(stored.entries[0].quiz.questions[0].sourceQuote, undefined); assert.doesNotMatch(stored.entries[0].quiz.questions[0].explanation, /Textstelle/);
  await app.element('previewPlay').onclick(); app.element('answers').children.find(b => b.dataset.original === '1').onclick(); app.element('next').onclick();
  assert.equal(app.element('rightCount').textContent, 1); assert.match(app.element('individualResults').children[1].children[1].textContent, /zwei Zellen/); assert.equal(requests, 1);
  const reopened = fixture({ storage }); reopened.context.fetch = () => { throw new Error('A saved quiz needs no AI request'); };
  reopened.element('libraryList').children[0].children[2].children[0].onclick();
  assert.equal(reopened.element('edit-option-0-1').value, 'zwei Zellen'); await reopened.element('previewPlay').onclick(); assert.equal(reopened.element('question').textContent, quiz.questions[0].q);
});
test('invalid editor contents cannot start or save; add, reorder and remove preserve the other edits', async () => {
  const app = fixture({ quiz }); await app.element('start').onclick(); app.element('edit-option-0-0').value = '';
  await app.element('previewPlay').onclick(); assert.match(app.element('previewStatus').textContent, /vollständig/); assert.equal(app.element('quiz').classList.contains('hide'), true);
  app.element('edit-option-0-0').value = 'geändert'; app.element('addQuestion').onclick(); assert.equal(app.element('previewCount').textContent, '2 / 50 Fragen');
  app.element('editorQuestions').children[1].children.at(-1).children[0].onclick(); assert.equal(app.element('edit-option-1-0').value, 'geändert');
  app.element('editorQuestions').children[0].children.at(-1).children[2].onclick(); assert.equal(app.element('edit-option-0-0').value, 'geändert');
  await app.element('previewPlay').onclick(); assert.equal(app.element('quiz').classList.contains('hide'), false);
});
