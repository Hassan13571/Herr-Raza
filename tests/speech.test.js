'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReader } = require('../assets/speech');
test('stopping speech cancels pending answer segments and ignores late completion events', () => {
  const said = [], pending = new Map(); let serial = 0;
  const reader = createReader({ synthesis: { getVoices: () => [], cancel() {}, speak: u => said.push(u) }, Utterance: class { constructor(text) { this.text = text; } }, setTimer: fn => { pending.set(++serial, fn); return serial; }, clearTimer: id => pending.delete(id) });
  reader.read('Erste Frage', ['Erste Antwort']); const stale = said[0]; stale.onend(); reader.stop();
  assert.equal(pending.size, 0); stale.onend(); assert.equal(pending.size, 0);
  reader.read('Zweite Frage', ['Neue Antwort']); stale.onend(); assert.equal(pending.size, 0);
  assert.deepEqual(said.map(u => u.text), ['Erste Frage', 'Zweite Frage']);
});
