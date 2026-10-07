'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { Host, Guest } = require('../assets/classroom');
const { createTransport } = require('../assets/live-relay');
function relayServer() {
  const cache = new Map(), listeners = new Map(), requests = [];
  class EventSource {
    constructor(url) {
      this.topic = new URL(url).pathname.split('/')[1];
      if (!listeners.has(this.topic)) listeners.set(this.topic, new Set());
      listeners.get(this.topic).add(this);
      queueMicrotask(() => { this.onopen?.(); for (const body of cache.get(this.topic) || []) this.deliver(body); });
    }
    deliver(body) { queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ event: 'message', message: body }) })); }
    close() { listeners.get(this.topic)?.delete(this); }
  }
  const fetch = async (url, options) => {
    const topic = new URL(url).pathname.slice(1);
    requests.push(options.body);
    assert.ok(Buffer.byteLength(options.body) <= 4096);
    if (!cache.has(topic)) cache.set(topic, []);
    cache.get(topic).push(options.body);
    for (const listener of listeners.get(topic) || []) listener.deliver(options.body);
    return { ok: true, status: 200 };
  };
  return { fetch, EventSource, requests, listeners };
}
test('encrypted HTTPS relay shares all 50 questions with two students and keeps names out of server messages', async () => {
  const server = relayServer(), Peer = createTransport({ ...server, crypto: webcrypto });
  const host = new Host(Peer), first = new Guest(Peer), second = new Guest(Peer);
  const quiz = { topic: 'Test', questions: Array.from({ length: 50 }, (_, i) => ({ q: 'Gemeinsame Frage ' + i + ' mit längerer Erklärung', options: ['eins', 'zwei', 'drei', 'vier'], correct: 0, explanation: 'Ein ausführlicher Erklärungstext. '.repeat(20) })) };
  const room = 'room-1234567890123456', key = 'key-1234567890123456';
  try {
    await host.open(quiz, { time: '0', shuffle: 'yes' }, key, room);
    const results = await Promise.all([first.join({ room, key, name: 'Mia-Geheimname', id: 'student-1234567890123456' }), second.join({ room, key, name: 'Ali-Geheimname', id: 'student-2234567890123456' })]);
    assert.equal(host.roster().length, 2);
    assert.deepEqual(results.map(r => r.quiz.questions), [quiz.questions, quiz.questions]);
    assert.ok(server.requests.every(body => !body.includes('Geheimname') && !body.includes('Gemeinsame Frage')));
    assert.equal([...server.listeners.values()][0].size, 1, 'Only the teacher keeps a stream open after joining');
    const before = server.requests.length;
    first.progress(1); first.progress(2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(server.requests.length, before, 'Individual answers do not use the daily message allowance');
    first.finish(50, 50, 7300);
    for (let i = 0; i < 10 && !host.roster()[0].finished; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(host.roster()[0].finished, true);
    assert.equal(host.roster()[0].right, 50);
    assert.equal(host.roster()[0].score, 7300);
  } finally { first.close(); second.close(); host.close(); }
});
