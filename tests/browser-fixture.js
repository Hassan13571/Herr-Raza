'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
function fixture({ quiz, url = 'https://quiz.test/', Peer } = {}) {
  const elements = new Map(), blobs = new Map(), downloads = [], intervals = new Map(), timers = new Map(), spoken = [];
  let serial = 0;
  function node(id = '') {
    const classes = new Set();
    const result = { id, value: '', children: [], style: {}, dataset: {}, disabled: false, textContent: '',
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, force) { const add = force === undefined ? !classes.has(c) : force; if (add) classes.add(c); else classes.delete(c); } },
      addEventListener() {}, focus() {}, scrollIntoView() {}, replaceChildren(...children) { this.children = children; }, appendChild(child) { this.children.push(child); },
      remove() {}, removeAttribute(name) { delete this[name]; }, click() { if (this.href) downloads.push({ href: this.href, name: this.download }); return this.onclick?.(); },
      querySelectorAll() { return [...elements.values()].filter(e => ['topic', 'sourceText', 'count', 'difficulty', 'mode', 'timeLimit', 'shuffle', 'images'].includes(e.id)); } };
    Object.defineProperty(result, 'innerHTML', { get() { return this._html || ''; }, set(html) { this._html = html;
      if (id === 'answers') this.children = [...html.matchAll(/data-original="(\d+)">([\s\S]*?)<\/button>/g)].map(match => { const button = node(); button.dataset.original = match[1]; button.textContent = match[2]; return button; });
    } });
    return result;
  }
  const element = id => { if (!elements.has(id)) elements.set(id, node(id)); return elements.get(id); };
  for (const [id, value] of Object.entries({ topic: 'Test', count: '5', difficulty: 'medium', mode: 'school', timeLimit: '0', shuffle: 'yes' })) element(id).value = value;
  for (const id of ['quiz', 'done', 'downloadPanel', 'classDashboard', 'guestStatusBox', 'joinHint']) element(id).classList.add('hide');
  const document = { getElementById: element, createElement: () => node(), body: node(), addEventListener(name, callback) { if (name === 'DOMContentLoaded') callback(); }, querySelectorAll() { return element('answers').children; } };
  class FakeURL extends URL { static createObjectURL(blob) { const id = 'blob:test-' + ++serial; blobs.set(id, blob); return id; } static revokeObjectURL(id) { blobs.delete(id); } }
  const synthesis = { speak(utterance) { spoken.push(utterance); }, cancel() {}, resume() {}, getVoices: () => [{ name: 'Deutsch', lang: 'de-DE', localService: true }] };
  const storage = new Map();
  const context = { document, URL: FakeURL, URLSearchParams, location: new URL(url), Blob, File, crypto: webcrypto,
    navigator: { canShare: () => false }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout(callback) { const id = ++serial; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    setInterval(callback) { const id = ++serial; intervals.set(id, callback); return id; }, clearInterval: id => intervals.delete(id),
    speechSynthesis: synthesis, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    fetch: async () => ({ ok: true, json: async () => quiz }), AbortSignal, btoa: value => Buffer.from(value, 'binary').toString('base64'), scrollTo() {}, console, prompt() {} };
  context.window = { RazaRelay: { Peer } };
  vm.createContext(context);
  for (const file of ['speech.js', 'quiz-images.js', 'classroom.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets', file), 'utf8'), context);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function downloadCurrentQuiz'));
  vm.runInContext(script, context);
  return { element, document, context, blobs, downloads, intervals, timers, spoken,
    speechStep() { spoken.at(-1)?.onend(); for (const [id, callback] of [...timers.entries()]) { timers.delete(id); callback(); } } };
}
module.exports = { fixture };
