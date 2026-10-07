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
    await assert.rejects(guest.join({ room, key: 'wrong-1234567890123456', name: 'Mia', id: 'student-1234567890123456' }), /nicht beitreten/);
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
  assert.match(csv([{ name: '  =SUM(1;2)' }]), /"'  =SUM\(1;2\)"/);
});
test('invalid finish messages leave progress and results unchanged, allowing normal progress afterwards', async () => {
  const Peer = fakePeers(), host = new Host(Peer), guest = new Guest(Peer);
  const questions = Array.from({ length: 3 }, () => quiz.questions[0]);
  try {
    await host.open({ ...quiz, questions }, {}, key, room);
    await guest.join({ room, key, name: 'Test', id: 'student-1234567890123456' });
    const before = host.roster();
    for (const invalid of [{ progress: 3, right: 3, score: 330, answers: [1, 1, 1] }, { progress: 3, right: 3, score: 10000 }, { progress: 2, right: 2, score: 220 }]) {
      guest.send({ type: 'finished', ...invalid }); await flush();
      assert.deepEqual(host.roster(), before);
    }
    guest.progress(1); await flush(); assert.equal(host.roster()[0].progress, 1);
    guest.finish(3, 2, 230, [0, 1, 0]); await flush();
    assert.equal(host.roster()[0].finished, true); assert.equal(host.roster()[0].right, 2);
  } finally { guest.close(); host.close(); }
});
test('late events from a replaced connection cannot disconnect or close the new classroom connection', async () => {
  const Peer = fakePeers(), host = new Host(Peer), statuses = [], guest = new Guest(Peer, { onStatus: message => statuses.push(message) });
  const join = { room, key, name: 'Test', id: 'student-1234567890123456' };
  try {
    await host.open(quiz, {}, key, room); await guest.join(join);
    const oldConnection = guest.connection, oldPeer = guest.peer;
    await guest.join(join); const count = statuses.length;
    oldConnection.emit('close'); oldConnection.emit('error', { type: 'peer-unavailable' });
    oldPeer.emit('error', { type: 'peer-unavailable' }); oldConnection.emit('data', { v: 1, type: 'closed' });
    assert.equal(guest.connected, true); assert.equal(guest.closed, false); assert.equal(statuses.length, count);
    guest.finish(1, 1, 110, [0]); await flush(); assert.equal(host.roster()[0].finished, true);
  } finally { guest.close(); host.close(); }
});
