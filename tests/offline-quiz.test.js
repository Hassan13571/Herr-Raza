'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('downloaded quiz executes without network, scores answers and supports replay', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', children: [], addEventListener() {},
      replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
      classList: { add() {}, remove() {}, toggle() {} }
    });
    return elements.get(id);
  };
  let downloaded;
  const document = {
    getElementById: element,
    createElement: () => ({ classList: { add() {}, remove() {} }, click() {}, remove() {} }),
    body: { appendChild() {} }
  };
  const context = {
    document, URL: { createObjectURL(blob) { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    URLSearchParams, location: { search: '' }, Blob, setTimeout: () => 0, clearInterval() {}, window: {}
  };
  vm.createContext(context);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const appScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(script => script.includes('function downloadCurrentQuiz'));
  vm.runInContext(appScript, context);
  const question = { q: 'Frage mit "Anführungszeichen" und </script>', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: 'Erklärung' };
  vm.runInContext('questions=' + JSON.stringify([question]) + ';currentTopic="Test";downloadCurrentQuiz();', context);
  const output = await downloaded.text();
  const script = output.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Export must contain a properly closed script');
  assert.ok(!/<script\s+src=/i.test(output), 'Export must work without external scripts');
  const offline = { document };
  vm.createContext(offline);
  vm.runInContext(script, offline);
  assert.equal(element('a').children.length, 4);
  assert.equal(element('q').textContent, question.q);
  element('a').children[0].onclick();
  element('next').onclick();
  assert.match(element('done').textContent, /100 von 100/);
  element('restart').onclick();
  assert.equal(element('a').children.length, 4);
  assert.match(element('n').textContent, /Punkte: 0/);
});
