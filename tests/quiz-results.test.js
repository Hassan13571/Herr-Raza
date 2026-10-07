'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stats, csv } = require('../assets/quiz-results');
const { Host, Guest } = require('../assets/classroom');
const { fakePeers } = require('./peer-fixture');
const questions = [0, 1].map((correct, i) => ({ q: 'Frage ' + i, options: ['eins', 'zwei', 'drei', 'vier'], correct, explanation: 'Darum.' }));
test('question analysis uses only completed validated answers, counts timeouts and excludes older or inconsistent scores', () => {
  const report = stats(questions, [{ finished: true, right: 1, answers: [0, -1] }, { finished: true, right: 2, answers: [0, 1] }, { finished: true, right: 2 }, { finished: false, right: 1, answers: [0, -1] }, { finished: true, right: 2, answers: [3, 3] }]);
  assert.equal(report.included, 2); assert.equal(report.missing, 2); assert.equal(report.rows[0].index, 1); assert.equal(report.rows[0].percent, 50); assert.equal(report.rows[0].timedOut, 1);
  assert.deepEqual(report.rows[1].counts, [2, 0, 0, 0]); assert.equal(stats(questions, []).rows[0].percent, null);
  assert.match(csv([{ ...questions[0], q: ' =SUM(1;2)' }], [{ finished: true, right: 1, answers: [0] }]), /"' =SUM/);
});
test('guest sends original answer indices once; host rejects malformed results, supports legacy guests and reconnects without double counting', async () => {
  const Peer = fakePeers(), host = new Host(Peer), guest = new Guest(Peer), legacy = new Guest(Peer);
  const room = 'room-1234567890123456', key = 'key-1234567890123456', id = 'student-1234567890123456';
  try {
    await host.open({ topic: 'Test', questions }, {}, key, room); await guest.join({ room, key, name: 'Mia', id });
    guest.send({ type: 'finished', progress: 2, right: 2, score: 220, answers: [3, 3] }); await new Promise(setImmediate); assert.equal(host.roster()[0].finished, false);
    guest.finish(2, 1, 110, [0, -1]); await new Promise(setImmediate); assert.deepEqual(host.roster()[0].answers, [0, -1]);
    guest.finish(2, 2, 220, [0, 1]); await new Promise(setImmediate); assert.equal(host.roster()[0].right, 1);
    const copy = host.roster(); copy[0].answers[0] = 3; assert.equal(host.roster()[0].answers[0], 0);
    await guest.join({ room, key, name: 'Mia', id }); await new Promise(setImmediate); assert.equal(host.roster().length, 1);
    await legacy.join({ room, key, name: 'Alt', id: 'student-2234567890123456' }); legacy.finish(2, 2, 220); await new Promise(setImmediate);
    const report = stats(questions, host.roster()); assert.equal(report.included, 1); assert.equal(report.missing, 1);
  } finally { guest.close(); legacy.close(); host.close(); }
});
