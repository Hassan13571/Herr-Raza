(function resultsModule(root) {
  'use strict';
  function validAnswers(questions, answers) {
    return Array.isArray(answers) && answers.length === questions.length
      && answers.every(n => Number.isInteger(n) && n >= -1 && n <= 3);
  }
  function stats(questions, roster) {
    const finished = roster.filter(m => m.finished);
    const included = finished.filter(m => validAnswers(questions, m.answers)
      && m.right === m.answers.filter((n, i) => n === questions[i].correct).length);
    return { completed: finished.length, included: included.length, missing: finished.length - included.length,
      rows: questions.map((q, index) => {
        const counts = [0, 0, 0, 0]; let timedOut = 0;
        for (const member of included) { const n = member.answers[index]; if (n < 0) timedOut++; else counts[n]++; }
        const right = counts[q.correct], total = included.length;
        return { index, question: q, counts, timedOut, right, total, percent: total ? Math.round(right / total * 100) : null };
      }).sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.index - b.index) };
  }
  function el(doc, tag, text, cls) {
    const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node;
  }
  function renderIndividual(container, questions, answers) {
    container.replaceChildren(); const doc = container.ownerDocument || root.document;
    container.appendChild(el(doc, 'h3', 'Deine Antworten je Frage'));
    questions.forEach((q, i) => {
      const n = answers[i], ok = n === q.correct;
      const detail = el(doc, 'details', undefined, 'result-detail');
      detail.appendChild(el(doc, 'summary', (ok ? '✅ ' : '❌ ') + (i + 1) + '. ' + q.q));
      detail.appendChild(el(doc, 'p', 'Deine Antwort: ' + (n === -1 ? 'Zeit abgelaufen' : Number.isInteger(n) ? q.options[n] : 'Keine Antwort')));
      detail.appendChild(el(doc, 'p', 'Richtig: ' + q.options[q.correct], 'result-correct'));
      detail.appendChild(el(doc, 'p', q.explanation)); container.appendChild(detail);
    });
  }
  function renderClass(container, questions, roster) {
    const report = stats(questions, roster), doc = container.ownerDocument || root.document;
    container.replaceChildren(); container.appendChild(el(doc, 'h3', 'Auswertung je Frage'));
    container.appendChild(el(doc, 'p', report.included + ' fertige Quizze mit Antwortdaten.' + (report.missing ? ' ' + report.missing + ' ältere Ergebnisse ohne Antwortdaten.' : '') + ' Fragen mit den meisten Fehlern stehen zuerst.', 'hint'));
    if (!report.included) { container.appendChild(el(doc, 'p', 'Die Auswertung erscheint, sobald jemand sein Quiz beendet hat.', 'small')); return report; }
    report.rows.forEach(row => {
      const detail = el(doc, 'details', undefined, 'result-detail');
      detail.appendChild(el(doc, 'summary', 'Frage ' + (row.index + 1) + ' · ' + row.percent + '% richtig · ' + row.question.q));
      row.question.options.forEach((option, n) => detail.appendChild(el(doc, 'p', (n === row.question.correct ? '✅ ' : '') + option + ': ' + row.counts[n] + ' Antworten')));
      detail.appendChild(el(doc, 'p', 'Zeit abgelaufen: ' + row.timedOut));
      detail.appendChild(el(doc, 'p', row.question.explanation)); container.appendChild(detail);
    }); return report;
  }
  function csv(questions, roster) {
    const report = stats(questions, roster);
    const cell = value => '"' + String(value ?? '').replace(/^\s*[=+@-]/, "'$&").replace(/"/g, '""') + '"';
    return '\ufeff' + [['Frage', 'Text', 'Richtige Antwort', 'Ausgewertete Quizze', 'Richtig', 'Richtig %', 'Antwort 1', 'Antwort 2', 'Antwort 3', 'Antwort 4', 'Zeit abgelaufen'],
      ...report.rows.map(r => [r.index + 1, r.question.q, r.question.options[r.question.correct], r.total, r.right, r.percent, ...r.counts, r.timedOut])]
      .map(row => row.map(cell).join(';')).join('\r\n');
  }
  const api = { validAnswers, stats, renderIndividual, renderClass, csv, browserSource: () => '(' + resultsModule.toString() + ')(globalThis);' };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RazaResults = api;
})(typeof globalThis === 'object' ? globalThis : this);
