'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { fixture } = require('./browser-fixture');

test('start-screen download creates a complete offline quiz with replay', async () => {
  const question = { q: 'Frage mit "Anführungszeichen" und </script>', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: 'Erklärung' };
  const app = fixture({ quiz: { topic: 'Test', questions: [question] } });
  await app.element('downloadSetup').onclick();
  assert.equal(app.downloads.length, 1);
  const { href, name } = app.downloads[0];
  assert.equal(name, 'Test.html');
  assert.ok(!app.element('downloadPanel').classList.contains('hide'));
  assert.equal(app.element('offlineFile').href, href);
  assert.equal(app.element('openOffline').href, href);
  const output = await app.blobs.get(href).text();
  const script = output.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.ok(!/<script\s+src=/i.test(output));
  const offline = { document: app.document, setTimeout() {}, clearTimeout() {} };
  vm.createContext(offline);
  vm.runInContext(script, offline);
  assert.equal(app.element('a').children.length, 4);
  assert.equal(app.element('q').textContent, question.q);
  app.element('a').children[0].onclick();
  app.element('next').onclick();
  assert.match(app.element('done').textContent, /100 von 100/);
  app.element('restart').onclick();
  assert.equal(app.element('a').children.length, 4);
  assert.match(app.element('n').textContent, /Punkte: 0/);
  assert.equal(typeof app.element('read').onclick, 'function');
});

test('speech follows shuffled visible answers and pauses the timer', async () => {
  const app = fixture({ quiz: { topic: 'Test', questions: [{ q: 'Eine Frage', options: ['Apfel', 'Birne', 'Citrone', 'Dattel'], correct: 0, explanation: 'Erklärung' }] } });
  app.element('timeLimit').value = '30';
  await app.element('start').onclick();
  const visible = app.element('answers').children.map(button => button.textContent.split(' · ')[1]);
  app.element('speak').onclick();
  for (const tick of app.intervals.values()) tick();
  assert.equal(app.element('timer').textContent, 30);
  for (let k = 0; k < 8; k++) app.speechStep();
  assert.deepEqual(app.spoken.map(u => u.text), ['Eine Frage', 'Antwort Ah.', visible[0], 'Antwort Be.', visible[1], 'Antwort Zeh.', visible[2], 'Antwort De.', visible[3]]);
  assert.ok(app.spoken.every(u => u.lang === 'de-DE' && u.voice.lang === 'de-DE'));
  app.element('speak').onclick();
  for (const tick of app.intervals.values()) tick();
  assert.equal(app.element('timer').textContent, 29);
});

test('class join requires a name before connecting', async () => {
  const app = fixture({ url: 'https://quiz.test/?join=1&room=room-1234567890123456#key=key-1234567890123456', Peer: class { constructor() { throw new Error('Must not connect without a name'); } } });
  app.element('nickname').value = '';
  await app.element('start').onclick();
  assert.match(app.element('status').textContent, /Namen oder Spitznamen/);
  assert.ok(app.element('quizSettings').classList.contains('hide'));
  assert.equal(app.element('nickname').required, true);
});
