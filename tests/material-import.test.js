'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extract, validateFiles, pageText, combine, create } = require('../assets/material-import');
const { fixture } = require('./browser-fixture');
const { pdfFixture } = require('./pdf-fixture');
test('actual PDF.js extracts a local PDF without OCR or transmitting its bytes', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const file = new File([pdfFixture()], 'pflanzen.pdf', { type: 'application/pdf' });
  const result = await extract([file], { loadPDF: async () => pdfjs, createWorker() { throw new Error('Text PDFs do not need OCR'); } });
  assert.match(result.text, /Pflanzen brauchen Licht/); assert.match(result.text, /Zellwand und Chloroplasten/); assert.equal(result.pages, 1); assert.equal(result.ocrPages, 0);
});
test('photo OCR worker is reused and terminated, and low confidence is disclosed', async () => {
  let creates = 0, recognizes = 0, terminated = 0;
  const files = ['eins.png', 'zwei.jpg'].map(name => new File(['synthetic bitmap fixture'], name));
  const result = await extract(files, { imageCanvas: async () => ({ width: 1, height: 1 }), createWorker: async langs => { assert.equal(langs, 'deu+eng'); creates++; return { recognize: async () => ({ data: { text: 'Erkannter Text ' + ++recognizes, confidence: 60 } }), terminate: async () => { terminated++; } }; } });
  assert.equal(creates, 1); assert.equal(terminated, 1); assert.equal(result.ocrPages, 2); assert.equal(result.lowConfidence, 2); assert.match(result.text, /Text 1\n\nErkannter Text 2/);
});
test('cancellation terminates OCR and cannot return a partial replacement; bad files and oversized text fail clearly', async () => {
  const controller = new AbortController(); let terminated = 0;
  await assert.rejects(extract([new File(['photo'], 'foto.png')], { signal: controller.signal, imageCanvas: async () => ({}), createWorker: async () => ({ recognize: async () => { controller.abort(); return { data: { text: 'partial' } }; }, terminate: async () => { terminated++; } }) }), /Abgebrochen/);
  assert.ok(terminated > 0); assert.throws(() => validateFiles([new File(['x'], 'x.svg')]), /Bitte wähle/);
  assert.throws(() => combine('x'.repeat(60000), 'new', true), /60.000/);
  assert.equal(combine('Mein Text', 'Mehr Text', true), 'Mein Text\n\nMehr Text'); assert.equal(combine('Alt', 'Neu'), 'Neu');
  assert.equal(pageText([{ str: 'Zeile 1', hasEOL: true }, { str: 'Zeile 2', hasEOL: false }]), 'Zeile 1\nZeile 2');
});
test('more than 50 PDF pages require an explicit range rather than silent truncation', async () => {
  let destroyed = 0;
  const file = new File([pdfFixture()], 'lang.pdf');
  const pdf = { getDocument: () => ({ promise: Promise.resolve({ numPages: 51 }), destroy: async () => { destroyed++; } }) };
  await assert.rejects(extract([file], { loadPDF: async () => pdf }), /mehr als 50/); assert.equal(destroyed, 1);
});
test('OCR failures during cancellation are handled and image memory is released', async () => {
  const controller = new AbortController(), canvas = { width: 1200, height: 800 };
  await assert.rejects(extract([new File(['photo'], 'foto.png')], {
    signal: controller.signal, imageCanvas: async () => canvas,
    createWorker: async () => ({ recognize: () => { controller.abort(); return Promise.reject(new Error('worker terminated')); }, terminate: async () => {} })
  }), /Abgebrochen/);
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  await new Promise(setImmediate);
});
test('unreadable pages are counted rather than silently presented as a complete import', async () => {
  let page = 0;
  const result = await extract(['eins.png', 'zwei.png'].map(name => new File(['photo'], name)), {
    imageCanvas: async () => ({ width: 1, height: 1 }),
    createWorker: async () => ({ recognize: async () => ({ data: { text: ++page === 1 ? 'Lesbarer Text.' : '', confidence: 80 } }), terminate: async () => {} })
  });
  assert.equal(result.pages, 2); assert.equal(result.emptyPages, 1); assert.equal(result.text, 'Lesbarer Text.');
});
test('file selection starts in the background and a failed second import cannot apply stale text', async () => {
  const app = fixture(), $ = app.element; let requests = 0;
  $('sourceText').value = 'Mein ursprünglicher Text';
  const material = create({ document: app.document, onApply: text => { $('sourceText').value = text; }, extractFiles: async () => {
    if (++requests === 1) return { text: 'Erster gelesener Text', pages: 1, ocrPages: 0 };
    throw new Error('Die neue Datei kann nicht gelesen werden.');
  } });
  $('materialFiles').files = [new File(['photo'], 'eins.png')];
  assert.equal($('materialFiles').onchange(), undefined); assert.equal(material.running, true);
  await new Promise(setImmediate); assert.equal($('importReview').classList.contains('hide'), false);
  $('materialFiles').files = [new File(['photo'], 'zwei.png')]; $('materialFiles').onchange();
  assert.equal($('importReview').classList.contains('hide'), true); await new Promise(setImmediate);
  assert.equal(material.running, false); assert.equal($('replaceText').disabled, true); assert.equal($('appendText').disabled, true);
  $('replaceText').onclick(); assert.equal($('sourceText').value, 'Mein ursprünglicher Text');
  assert.match($('importStatus').textContent, /neue Datei/); assert.equal($('importText').value, '');
});
test('cancelled and superseded imports cannot replace the latest successful text or status', async () => {
  const app = fixture(), $ = app.element, pending = [];
  const material = create({ document: app.document, onApply: text => { $('sourceText').value = text; }, extractFiles: (files, options) => new Promise(resolve => pending.push({ resolve, options })) });
  $('materialFiles').files = [new File(['photo'], 'eins.png')]; $('materialFiles').onchange();
  $('cancelImport').onclick();
  $('materialFiles').files = [new File(['photo'], 'zwei.png')]; $('materialFiles').onchange();
  pending[1].resolve({ text: 'Neuer Text', pages: 1, ocrPages: 1, emptyPages: 0 }); await new Promise(setImmediate);
  const status = $('importStatus').textContent;
  pending[0].options.onProgress('Alter Fortschritt'); pending[0].resolve({ text: 'Alter Text', pages: 1 }); await new Promise(setImmediate);
  assert.equal($('importText').value, 'Neuer Text'); assert.equal($('importStatus').textContent, status);
  assert.equal(material.running, false); $('replaceText').onclick(); assert.equal($('sourceText').value, 'Neuer Text');
});
