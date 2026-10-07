(function (root) {
  'use strict';
  const Images = root.RazaQuizImages || (typeof module === 'object' && module.exports ? require('./quiz-images') : null);
  const KEY = 'herr-raza-quiz-collection-v1', MAX_BYTES = 4 * 1024 * 1024;
  const clone = value => JSON.parse(JSON.stringify(value));
  const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
  function normalizeQuiz(input) {
    if (!input || !text(input.topic, 100) || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 50) throw new Error('Ein Quiz braucht einen Titel und 1 bis 50 Fragen.');
    const questions = input.questions.map((q, i) => {
      if (!q || !text(q.q, 4000) || !Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(o => text(o, 2000))
        || new Set(q.options.map(o => o.trim().toLocaleLowerCase('de-DE'))).size !== 4
        || !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3 || !text(q.explanation, 6000)) throw new Error('Frage ' + (i + 1) + ': Frage, vier verschiedene Antworten, richtige Antwort und Erklärung vollständig ausfüllen.');
      const out = { q: q.q.trim(), options: q.options.map(o => o.trim()), correct: q.correct, explanation: q.explanation.trim() };
      for (const [key, max] of Object.entries({ source: 300, sourceUrl: 2000, sourceQuote: 420, imageQuery: 200 })) if (typeof q[key] === 'string' && q[key].length <= max) {
        if (key !== 'sourceUrl' || /^https?:\/\//.test(q[key])) out[key] = q[key];
      }
      if (Number.isInteger(q.sourceIndex) && q.sourceIndex >= 0) out.sourceIndex = q.sourceIndex;
      const image = Images?.normalizeImage(q.image); if (image) out.image = image;
      return out;
    });
    const out = { topic: input.topic.trim(), questions };
    if (input.edited === true) out.edited = true;
    if (input.ai && typeof input.ai === 'object') out.ai = { connected: input.ai.connected === true, modelName: typeof input.ai.modelName === 'string' ? input.ai.modelName.slice(0, 120) : '' };
    if (input.quality) out.quality = { reviewed: input.quality.reviewed === true && !out.edited };
    if (typeof input.warning === 'string') out.warning = input.warning.slice(0, 1500);
    if (Number.isInteger(input.requestedCount)) out.requestedCount = Math.min(50, Math.max(1, input.requestedCount));
    return out;
  }
  function normalizeSettings(settings = {}) { return { time: ['0', '15', '30', '60'].includes(String(settings.time)) ? String(settings.time) : '0', shuffle: settings.shuffle === 'no' ? 'no' : 'yes' }; }
  function parseBackup(raw) {
    if (typeof raw !== 'string' || raw.length > 1500000) throw new Error('Die Quiz-Datei ist zu groß (höchstens 1,5 MB).');
    let input; try { input = JSON.parse(raw); } catch { throw new Error('Bitte eine gültige Quiz-JSON-Datei auswählen.'); }
    if (input?.format !== 'herr-raza-quiz' || input.version !== 1) throw new Error('Diese Datei ist keine Herr-Raza-Quiz-Sicherung.');
    return { quiz: normalizeQuiz({ ...input.quiz, edited: true }), settings: normalizeSettings(input.settings) };
  }
  function backup(quiz, settings) { return JSON.stringify({ format: 'herr-raza-quiz', version: 1, quiz: normalizeQuiz(quiz), settings: normalizeSettings(settings) }, null, 2); }
  class Collection {
    constructor(storage, idFactory = () => root.crypto.randomUUID()) { this.storage = storage; this.idFactory = idFactory; }
    read() {
      let raw; try { raw = this.storage.getItem(KEY); } catch { throw new Error('Der Browser erlaubt hier keinen Speicher. Nutze die JSON-Sicherung.'); }
      if (!raw) return [];
      try {
        const data = JSON.parse(raw); if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 200) throw new Error();
        return data.entries.map(entry => { if (!text(entry.id, 100) || !text(entry.updatedAt, 40)) throw new Error(); return { id: entry.id, updatedAt: entry.updatedAt, archived: entry.archived === true, quiz: normalizeQuiz(entry.quiz), settings: normalizeSettings(entry.settings) }; });
      } catch { throw new Error('Die gespeicherte Sammlung kann nicht gelesen werden. Deine Daten wurden nicht überschrieben.'); }
    }
    write(entries) {
      const raw = JSON.stringify({ version: 1, entries });
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('Der Gerätespeicher für Quizze ist voll. Sichere dein Quiz als JSON.');
      try { this.storage.setItem(KEY, raw); } catch { throw new Error('Speichern nicht möglich: Der Gerätespeicher ist voll oder gesperrt. Nutze die JSON-Sicherung.'); }
    }
    save(quiz, settings, id) {
      const entries = this.read(), entry = { id: id || this.idFactory(), quiz: normalizeQuiz(quiz), settings: normalizeSettings(settings), archived: false, updatedAt: new Date().toISOString() };
      const index = entries.findIndex(e => e.id === entry.id);
      if (index < 0) { if (entries.length >= 200) throw new Error('Die Sammlung enthält bereits 200 Quizze. Nutze die JSON-Sicherung.'); entries.push(entry); } else entries[index] = entry;
      this.write(entries); return clone(entry);
    }
    archive(id, value) { const entries = this.read(), entry = entries.find(e => e.id === id); if (!entry) throw new Error('Quiz nicht gefunden.'); entry.archived = value; this.write(entries); }
  }
  function create({ document: doc = root.document, storage, onOpen, onPlay, onClass, onDownload, onBack, getSettings, isClassActive }) {
    const $ = id => doc.getElementById(id), collection = new Collection(storage); let draft = null, entryId = null, intent = 'play', archived = false;
    const node = (tag, content, cls) => { const n = doc.createElement(tag); if (content !== undefined) n.textContent = content; if (cls) n.className = cls; return n; };
    const input = (tag, id, value, max) => { const n = node(tag); n.id = id; n.value = value; n.maxLength = max; if (tag === 'textarea') n.rows = 3; return n; };
    const button = (label, handler) => { const n = node('button', label, 'btn secondary compact'); n.type = 'button'; n.onclick = handler; return n; };
    function status(message) { $('previewStatus').textContent = message; }
    function guarded(action) { return async () => { try { status(''); await action(); } catch (e) { status(e.message); } }; }
    function values() {
      const questions = draft.questions.map((original, index) => {
        const q = { ...original, q: $('edit-q-' + index).value, options: [0, 1, 2, 3].map(n => $('edit-option-' + index + '-' + n).value), explanation: $('edit-explanation-' + index).value,
          correct: [0, 1, 2, 3].find(n => $('edit-correct-' + index + '-' + n).checked) };
        const changed = q.q !== original.q || q.explanation !== original.explanation || q.correct !== original.correct || q.options.some((o, n) => o !== original.options[n]);
        if (changed) { q.source = 'Manuell bearbeitet'; delete q.sourceUrl; delete q.sourceQuote; delete q.sourceIndex; delete q.imageQuery; q.explanation = q.explanation.replace(/\s*Textstelle:\s*[„"].*$/s, '').trim(); }
        if (original.image && !$('edit-image-' + index).checked) delete q.image;
        return { q, changed };
      });
      const changed = draft.edited || questions.some(x => x.changed) || $('previewTitle').value.trim() !== draft.topic;
      return { ...draft, topic: $('previewTitle').value.trim(), questions: questions.map(x => x.q), edited: !!changed, quality: { reviewed: draft.quality?.reviewed === true && !changed } };
    }
    function sync() { draft = values(); }
    function validated() { return normalizeQuiz(values()); }
    function renderEditor(openIndex = 0) {
      $('previewTitle').value = draft.topic; $('previewCount').textContent = draft.questions.length + ' / 50 Fragen'; $('editorQuestions').replaceChildren();
      draft.questions.forEach((q, index) => {
        const detail = node('details', undefined, 'editor-question'); detail.open = index === openIndex;
        detail.appendChild(node('summary', 'Frage ' + (index + 1) + ' · ' + (q.q || 'Neue Frage')));
        const field = (label, control) => { const wrap = node('div', undefined, 'field'), l = node('label', label); l.htmlFor = control.id; wrap.appendChild(l); wrap.appendChild(control); detail.appendChild(wrap); };
        field('Frage', input('textarea', 'edit-q-' + index, q.q, 4000));
        const options = node('div', undefined, 'editor-options');
        q.options.forEach((option, n) => {
          const row = node('div', undefined, 'editor-option'), radio = input('input', 'edit-correct-' + index + '-' + n, String(n));
          radio.type = 'radio'; radio.name = 'correct-' + index; radio.checked = n === q.correct;
          radio.setAttribute('aria-label', 'Antwort ' + String.fromCharCode(65 + n) + ' ist richtig');
          const label = node('label', 'Antwort ' + String.fromCharCode(65 + n)); label.htmlFor = 'edit-option-' + index + '-' + n;
          const wrap = node('div'); wrap.appendChild(label); wrap.appendChild(input('input', label.htmlFor, option, 2000)); row.appendChild(radio); row.appendChild(wrap); options.appendChild(row);
        }); detail.appendChild(options);
        field('Erklärung', input('textarea', 'edit-explanation-' + index, q.explanation, 6000));
        if (q.image) { const label = node('label', undefined, 'review-label'), check = input('input', 'edit-image-' + index, 'yes'); check.type = 'checkbox'; check.checked = true; label.appendChild(check); label.appendChild(node('span', 'Bild behalten'));
          detail.appendChild(label); const figure = node('figure', undefined, 'question-picture editor-figure'), img = node('img'), caption = node('figcaption'); figure.appendChild(img); figure.appendChild(caption); detail.appendChild(figure); Images.render(figure, img, caption, q.image); }
        const tools = node('div', undefined, 'tools');
        for (const [delta, label] of [[-1, '↑ Nach oben'], [1, '↓ Nach unten']]) { const b = button(label, () => { sync(); const j = index + delta; [draft.questions[index], draft.questions[j]] = [draft.questions[j], draft.questions[index]]; draft.edited = true; renderEditor(j); }); b.disabled = index + delta < 0 || index + delta >= draft.questions.length; tools.appendChild(b); }
        const remove = button('Frage entfernen', () => { sync(); draft.questions.splice(index, 1); draft.edited = true; renderEditor(Math.max(0, index - 1)); }); remove.disabled = draft.questions.length === 1; tools.appendChild(remove); detail.appendChild(tools); $('editorQuestions').appendChild(detail);
      });
      $('addQuestion').disabled = draft.questions.length >= 50;
      $('previewClass').disabled = !!isClassActive?.();
      $('previewPlay').className = 'btn ' + (intent === 'play' ? 'primary' : 'secondary');
      $('previewClass').className = 'btn ' + (intent === 'class' ? 'primary' : 'secondary');
      $('previewDownload').className = 'btn ' + (intent === 'download' ? 'primary' : 'secondary');
    }
    function open(quiz, { id = null, settings, purpose = 'play' } = {}) {
      if (isClassActive?.()) throw new Error('Beende zuerst die laufende Klasse, bevor du ein Quiz bearbeitest.');
      draft = clone(quiz); entryId = id; intent = purpose; if (settings) onOpen?.(normalizeSettings(settings)); else onOpen?.(); status(''); renderEditor();
    }
    function renderCollection() {
      $('libraryList').replaceChildren(); let entries;
      try { entries = collection.read(); $('libraryStatus').textContent = ''; } catch (e) { $('libraryStatus').textContent = e.message; return; }
      const query = $('librarySearch').value.trim().toLocaleLowerCase('de-DE');
      const shown = entries.filter(e => e.archived === archived && e.quiz.topic.toLocaleLowerCase('de-DE').includes(query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      $('libraryEmpty').textContent = shown.length ? '' : archived ? 'Keine archivierten Quizze.' : 'Noch keine passenden Quizze gespeichert.';
      shown.forEach(entry => {
        const li = node('li'); li.appendChild(node('strong', entry.quiz.topic)); li.appendChild(node('div', entry.quiz.questions.length + ' Fragen · ' + new Date(entry.updatedAt).toLocaleDateString('de-DE'), 'small'));
        const tools = node('div', undefined, 'tools'); tools.appendChild(button('Öffnen & bearbeiten', () => { try { open(entry.quiz, { id: entry.id, settings: entry.settings }); } catch (e) { $('libraryStatus').textContent = e.message; } }));
        tools.appendChild(button(archived ? 'Wiederherstellen' : 'Archivieren', () => { try { collection.archive(entry.id, !archived); renderCollection(); } catch (e) { $('libraryStatus').textContent = e.message; } })); li.appendChild(tools); $('libraryList').appendChild(li);
      });
    }
    function downloadJSON() { const quiz = validated(), blob = new root.Blob([backup(quiz, getSettings())], { type: 'application/json' }), url = root.URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = quiz.topic.replace(/[^a-z0-9äöüß_-]+/gi, '-').slice(0, 100) + '.quiz.json'; doc.body.appendChild(a); a.click(); a.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url), 60000); status('JSON-Sicherung erstellt. Du kannst sie über „Quiz importieren“ wieder öffnen.'); }
    $('previewPlay').onclick = guarded(() => onPlay(validated()));
    $('previewClass').onclick = guarded(() => onClass(validated()));
    $('previewDownload').onclick = guarded(() => onDownload(validated()));
    $('previewSave').onclick = guarded(() => { const entry = collection.save(validated(), getSettings(), entryId); entryId = entry.id; draft = clone(entry.quiz); renderCollection(); status('Auf diesem Gerät gespeichert.'); });
    $('previewBackup').onclick = guarded(downloadJSON);
    $('previewBack').onclick = () => { sync(); onBack(); renderCollection(); };
    $('addQuestion').onclick = () => { if (draft.questions.length >= 50) return; sync(); draft.questions.push({ q: '', options: ['', '', '', ''], correct: 0, explanation: '' }); draft.edited = true; renderEditor(draft.questions.length - 1); };
    $('librarySearch').addEventListener('input', renderCollection);
    $('libraryArchive').onclick = () => { archived = !archived; $('libraryArchive').textContent = archived ? 'Aktive Quizze zeigen' : 'Archiv zeigen'; renderCollection(); };
    $('importQuiz').onclick = () => $('quizFile').click();
    $('quizFile').onchange = async () => { try { const file = $('quizFile').files?.[0]; if (!file) return; if (file.size > 1500000) throw new Error('Die Quiz-Datei ist zu groß (höchstens 1,5 MB).'); const data = parseBackup(await file.text()); open(data.quiz, { settings: data.settings }); status('Quiz importiert. Prüfe die Fragen und speichere es bei Bedarf.'); } catch (e) { $('libraryStatus').textContent = e.message; } finally { $('quizFile').value = ''; } };
    renderCollection();
    return { open, reopen: () => { if (draft) open(values(), { id: entryId }); }, renderCollection, manual: () => open({ topic: 'Mein eigenes Quiz', edited: true, questions: [{ q: '', options: ['', '', '', ''], correct: 0, explanation: '' }] }), validated };
  }
  const api = { Collection, normalizeQuiz, normalizeSettings, parseBackup, backup, create, KEY };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RazaStudio = api;
})(typeof globalThis === 'object' ? globalThis : this);
