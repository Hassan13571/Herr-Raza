(function (root) {
  'use strict';
  const PDF_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.mjs';
  const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.mjs';
  const OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  let pdfModule, ocrScript;
  function cancelled() { const error = new Error('Abgebrochen. Dein alter Text bleibt erhalten.'); error.name = 'AbortError'; return error; }
  function check(signal) { if (signal?.aborted) throw cancelled(); }
  function deadline(promise, signal, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = root.setTimeout(() => { cleanup(); reject(new Error(label + ' dauert zu lange. Bitte versuche es noch einmal.')); }, ms);
      const abort = () => { cleanup(); reject(cancelled()); };
      const cleanup = () => { root.clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      Promise.resolve(promise).then(v => { cleanup(); resolve(v); }, e => { cleanup(); reject(e); });
    });
  }
  function validateFiles(files) {
    if (!files.length || files.length > 10) throw new Error('Wähle 1 bis 10 PDFs oder Bilder aus.');
    return files.map(file => {
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error(file.name + ': Die Datei darf höchstens 20 MB groß sein.');
      const pdf = /\.pdf$/i.test(file.name) && (!file.type || file.type === 'application/pdf');
      const image = /\.(png|jpe?g|webp)$/i.test(file.name) && (!file.type || ['image/png', 'image/jpeg', 'image/webp'].includes(file.type));
      if (!pdf && !image) throw new Error(file.name + ': Bitte wähle PDF, JPG, PNG oder WebP.');
      return { file, pdf };
    });
  }
  function pageText(items) {
    return items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function combine(current, extracted, append = false) {
    const text = append && current.trim() ? current.trimEnd() + '\n\n' + extracted.trim() : extracted.trim();
    if (!text) throw new Error('Es wurde kein Text gefunden. Bitte wähle ein schärferes Bild oder eine andere PDF.');
    if (text.length > 60000) throw new Error('Der Text ist zu lang. Er darf höchstens 60.000 Zeichen haben. Kürze ihn oder wähle weniger Seiten.');
    return text;
  }
  async function loadPDF() {
    if (!pdfModule) pdfModule = import(PDF_URL).then(pdf => { pdf.GlobalWorkerOptions.workerSrc = PDF_WORKER; return pdf; }).catch(e => { pdfModule = null; throw e; });
    return pdfModule;
  }
  async function loadOCR() {
    if (root.Tesseract) return root.Tesseract;
    if (!ocrScript) ocrScript = new Promise((resolve, reject) => {
      const script = root.document.createElement('script'); script.src = OCR_URL; script.crossOrigin = 'anonymous';
      script.onload = () => root.Tesseract ? resolve(root.Tesseract) : reject(new Error('Der Text konnte nicht gelesen werden. Bitte versuche es noch einmal.'));
      script.onerror = () => { ocrScript = null; script.remove(); reject(new Error('Die App kann den Text gerade nicht lesen. Prüfe deine Internetverbindung.')); };
      root.document.head.appendChild(script);
    });
    return ocrScript;
  }
  async function imageCanvas(file, signal) {
    const bitmap = await deadline(root.createImageBitmap(file), signal, 30000, 'Bild laden');
    try {
      check(signal); if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80000000) throw new Error('Das Bild ist zu groß. Bitte nutze ein kleineres Bild.');
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = root.document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); return canvas;
    } finally { bitmap.close(); }
  }
  async function extract(files, { signal, firstPage = 1, lastPage = 0, onProgress = () => {}, loadPDF: getPDF = loadPDF, createWorker, imageCanvas: getCanvas = imageCanvas } = {}) {
    const checked = validateFiles(Array.from(files));
    if (!Number.isInteger(firstPage) || firstPage < 1 || !Number.isInteger(lastPage) || lastPage < 0 || lastPage && lastPage < firstPage) throw new Error('Prüfe die erste und die letzte PDF-Seite. Die erste Seite muss vor der letzten liegen.');
    let worker = null, pendingWorker = null, task = null, renderTask = null, pageCount = 0, ocrCount = 0, lowConfidence = 0;
    const chunks = [], abort = () => { try { renderTask?.cancel(); } catch {} Promise.resolve(task?.destroy()).catch(() => {}); Promise.resolve(worker?.terminate()).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    async function recognize(canvas, label) {
      check(signal); onProgress(label + ' · Text wird vorbereitet …');
      if (!worker) {
        const factory = createWorker || (await deadline(loadOCR(), signal, 45000, 'Text-Leser laden')).createWorker;
        pendingWorker = factory('deu+eng', 1, { logger: info => {
          if (info.status === 'recognizing text') onProgress(label + ' · Text erkennen: ' + Math.round((info.progress || 0) * 100) + '%');
        } });
        try { worker = await deadline(pendingWorker, signal, 120000, 'Text-Leser starten'); }
        catch (error) { Promise.resolve(pendingWorker).then(w => w.terminate()).catch(() => {}); throw error; }
      }
      const result = await deadline(worker.recognize(canvas), signal, 120000, 'Text erkennen');
      ocrCount++; if (Number.isFinite(result.data.confidence) && result.data.confidence < 75) lowConfidence++;
      return String(result.data.text || '').trim();
    }
    try {
      for (const { file, pdf } of checked) {
        check(signal); onProgress(file.name + ' wird gelesen …');
        if (!pdf) { if (++pageCount > 50) throw new Error('Wähle zusammen höchstens 50 Seiten oder Bilder aus.'); const canvas = await getCanvas(file, signal); chunks.push(await recognize(canvas, file.name)); canvas.width = canvas.height = 0; continue; }
        const data = new Uint8Array(await file.arrayBuffer());
        if (String.fromCharCode(...data.slice(0, 5)) !== '%PDF-') throw new Error(file.name + ': Diese Datei ist keine PDF.');
        const pdfjs = await deadline(getPDF(), signal, 45000, 'PDF-Leser laden');
        task = pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false, useSystemFonts: true });
        const pdfDoc = await deadline(task.promise, signal, 45000, 'PDF öffnen');
        const end = lastPage ? Math.min(lastPage, pdfDoc.numPages) : pdfDoc.numPages;
        if (firstPage > end) throw new Error(file.name + ': Diese Seiten gibt es in der PDF nicht.');
        if (pageCount + end - firstPage + 1 > 50) throw new Error('Du hast mehr als 50 Seiten ausgewählt. Wähle oben weniger PDF-Seiten.');
        for (let n = firstPage; n <= end; n++) {
          check(signal); const label = file.name + ' · Seite ' + n + ' von ' + pdfDoc.numPages; onProgress(label);
          const page = await deadline(pdfDoc.getPage(n), signal, 30000, 'PDF-Seite laden');
          const content = await deadline(page.getTextContent(), signal, 30000, 'PDF-Text lesen');
          let text = pageText(content.items);
          if (text.replace(/\s/g, '').length < 20) {
            const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) });
            const canvas = root.document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'rgb(255,255,255)' });
            await deadline(renderTask.promise, signal, 45000, 'PDF-Seite anzeigen'); renderTask = null;
            text = await recognize(canvas, label); canvas.width = canvas.height = 0;
          }
          chunks.push(text); pageCount++; page.cleanup();
        }
        await task.destroy(); task = null;
      }
      check(signal); const text = chunks.filter(Boolean).join('\n\n').trim();
      if (!text) throw new Error('Kein Text gefunden. Bitte nutze ein scharfes, helles Foto.');
      return { text, pages: pageCount, ocrPages: ocrCount, lowConfidence };
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (error.name === 'PasswordException') throw new Error('Die PDF braucht ein Passwort. Bitte nutze eine PDF ohne Passwort.');
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      try { await task?.destroy(); } catch {}
      try { await worker?.terminate(); } catch {}
    }
  }
  function create({ document: doc = root.document, onApply, isLocked = () => false }) {
    const $ = id => doc.getElementById(id); let controller = null;
    const count = () => { $('importCount').textContent = $('importText').value.length.toLocaleString('de-DE') + ' / 60.000 Zeichen'; $('importCount').classList.toggle('text-limit', $('importText').value.length > 60000); };
    $('chooseMaterial').onclick = () => { if (!isLocked()) $('materialFiles').click(); };
    $('materialFiles').onchange = async () => {
      if (isLocked()) return; const files = Array.from($('materialFiles').files || []); if (!files.length) return;
      controller?.abort(); controller = new AbortController(); const active = controller;
      $('chooseMaterial').disabled = true; $('cancelImport').classList.remove('hide'); ['replaceText', 'appendText'].forEach(id => $(id).disabled = true);
      try {
        const result = await extract(files, { signal: active.signal, firstPage: Number($('pdfFirst').value || 1), lastPage: Number($('pdfLast').value || 0), onProgress: message => { $('importStatus').textContent = message; } });
        $('importText').value = result.text; $('importReview').classList.remove('hide'); count();
        $('importStatus').textContent = result.pages + ' Seiten oder Bilder gelesen.' + (result.ocrPages ? ' Bitte prüfe den Text auf Fehler.' : ' Bitte prüfe den Text.') + (result.lowConfidence ? ' Einige Wörter waren schwer zu lesen.' : '');
      } catch (error) { $('importStatus').textContent = error.message; }
      finally { if (controller === active) { controller = null; $('chooseMaterial').disabled = false; $('cancelImport').classList.add('hide'); ['replaceText', 'appendText'].forEach(id => $(id).disabled = false); $('materialFiles').value = ''; } }
    };
    $('cancelImport').onclick = () => controller?.abort();
    $('importText').addEventListener('input', count);
    for (const [id, append] of [['replaceText', false], ['appendText', true]]) $(id).onclick = () => {
      if (isLocked()) { $('importStatus').textContent = 'Bitte warte, bis das Quiz fertig ist. Oder beende das Quiz für die Klasse.'; return; }
      try { const text = combine($('sourceText').value, $('importText').value, append); onApply(text); $('importStatus').textContent = 'Der Text ist bereit. Du kannst jetzt ein Quiz erstellen.'; } catch (error) { $('importStatus').textContent = error.message; }
    };
    return { cancel: () => controller?.abort(), get running() { return !!controller; } };
  }
  const api = { extract, validateFiles, pageText, combine, create, PDF_URL, OCR_URL };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RazaMaterial = api;
})(typeof globalThis === 'object' ? globalThis : this);
