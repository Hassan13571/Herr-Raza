'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extract, validateFiles, pageText, combine } = require('../assets/material-import');
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
  await assert.rejects(extract([new File(['photo'], 'foto.png')], { signal: controller.signal, imageCanvas: async () => ({}), createWorker: async () => ({ recognize: async () => { controller.abort(); return { data: { text: 'partial' } }; }, terminate: async () => { terminated++; } }) }), /abgebrochen/);
  assert.ok(terminated > 0); assert.throws(() => validateFiles([new File(['x'], 'x.svg')]), /Unterstützt/);
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
