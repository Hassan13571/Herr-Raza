'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Host, Guest, csv } = require('../assets/classroom');
const { fakePeers } = require('./peer-fixture');
const quiz = { topic: 'Test', questions: [{ q: 'Eine Frage', options: ['eins', 'zwei', 'drei', 'vier'], correct: 0, explanation: 'Darum.' }] };
const room = 'room-1234567890123456', key = 'key-1234567890123456';
const flush = () => new Promise(resolve => setImmediate(resolve));
test('two participants join one quiz and reconnect without duplicate rows', async () => {
  const Peer = fakePeers(), host = new Host(Peer), first = new Guest(Peer), second = new Guest(Peer);
  try {
    await host.open(quiz, { time: '30', shuffle: 'yes' }, key, room);
    const joins = await Promise.all([first.join({ room, key, name: 'Mia', id: 'student-1234567890123456' }), second.join({ room, key, name: 'Ali', id: 'student-2234567890123456' })]);
    assert.deepEqual(joins.map(join => join.quiz.questions), [quiz.questions, quiz.questions]);
    assert.deepEqual(host.roster().map(member => member.name).sort(), ['Ali', 'Mia']);
    first.progress(1); first.finish(1, 1, 110); await flush();
    assert.equal(host.roster().find(member => member.name === 'Mia').finished, true);
    assert.equal(host.roster().find(member => member.name === 'Mia').score, 110);
    second.peer.destroy();
    assert.equal(host.roster().length, 2);
    assert.equal(host.roster().find(member => member.name === 'Ali').connected, false);
    await second.join({ room, key, name: 'Ali', id: 'student-2234567890123456' });
    assert.equal(host.roster().length, 2);
    assert.equal(host.roster().find(member => member.name === 'Ali').connected, true);
    host.close(); await flush();
    assert.equal(first.closed, true);
    assert.ok(host.roster().every(member => !member.connected));
  } finally { first.close(); second.close(); host.close(); }
});
test('wrong room keys and blank names cannot create participants', async () => {
  const Peer = fakePeers(), host = new Host(Peer), guest = new Guest(Peer);
  try {
    await host.open(quiz, {}, key, room);
    await assert.rejects(guest.join({ room, key: 'wrong-1234567890123456', name: 'Mia', id: 'student-1234567890123456' }), /Beitritt/);
    assert.equal(host.roster().length, 0);
    await assert.rejects(guest.join({ room, key, name: '   ', id: 'student-1234567890123456' }), /Namen/);
    assert.equal(host.roster().length, 0);
  } finally { guest.close(); host.close(); }
});
test('CSV export prevents spreadsheet formula execution', () => {
  const output = csv([{ name: '=SUM(1;2)', joinedAt: '2026-10-06T14:00:00Z', connected: true, finished: false }]);
  assert.ok(output.startsWith('\ufeff'));
  assert.match(output, /"'=SUM\(1;2\)"/);
  assert.match(output, /"Verbunden"/);
});
