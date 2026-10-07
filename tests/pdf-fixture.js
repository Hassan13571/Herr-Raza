'use strict';
// A small real PDF, parsed by the actual PDF.js release in the import test.
function pdfFixture(text = 'Pflanzen brauchen Licht und Wasser. Eine Pflanzenzelle besitzt eine Zellwand und Chloroplasten.') {
  const stream = 'BT /F1 10 Tf 40 750 Td (' + text.replace(/[()\\]/g, '\\$&') + ') Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream'];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const start = Buffer.byteLength(output); output += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF'; return Buffer.from(output);
}
module.exports = { pdfFixture };
