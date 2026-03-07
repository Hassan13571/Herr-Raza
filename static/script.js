/* ── Herr-Raza Lernapp — Frontend Script ──────────────────────────────────── */

// ── Navigation ───────────────────────────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelector(`[data-section="${id}"]`).classList.add('active');
  if (id === 'progress') loadProgress();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

// ── Quiz Mode Toggle ──────────────────────────────────────────────────────────
document.getElementById('quiz-mode').addEventListener('change', function () {
  const isAI = this.value === 'ai';
  document.getElementById('trivia-category-group').style.display = isAI ? 'none' : '';
  document.getElementById('ai-topic-group').style.display = isAI ? '' : 'none';
});

// ── Loader ────────────────────────────────────────────────────────────────────
function showLoader(text = 'Wird geladen…') {
  document.getElementById('loader-text').textContent = text;
  document.getElementById('loader').style.display = 'flex';
}
function hideLoader() { document.getElementById('loader').style.display = 'none'; }

// ── API helper ────────────────────────────────────────────────────────────────
async function api(endpoint, body) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'Unbekannter Fehler' }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// ══════════════════════════════════════════════════════════════════════════════
// QUIZ
// ══════════════════════════════════════════════════════════════════════════════
let quizState = { questions: [], current: 0, score: 0, correct: 0, total: 0 };

async function startQuiz() {
  const mode       = document.getElementById('quiz-mode').value;
  const topic      = document.getElementById('quiz-topic').value.trim();
  const categoryId = document.getElementById('trivia-category').value || null;
  const difficulty = document.getElementById('quiz-difficulty').value;
  const amount     = parseInt(document.getElementById('quiz-amount').value);

  if (mode === 'ai' && !topic) { alert('Bitte ein Thema eingeben.'); return; }

  showLoader('Quizfragen werden geladen…');
  try {
    const data = await api('/api/quiz', {
      mode, topic, category_id: categoryId ? parseInt(categoryId) : null,
      difficulty, amount,
    });

    if (!data.questions || data.questions.length === 0) {
      alert('Keine Fragen gefunden. Bitte andere Einstellungen versuchen.');
      hideLoader();
      return;
    }

    quizState = { questions: data.questions, current: 0, score: 0,
                  correct: 0, total: data.questions.length };

    document.getElementById('quiz-setup').style.display = 'none';
    document.getElementById('quiz-game').style.display = 'block';
    document.getElementById('quiz-result').style.display = 'none';
    renderQuestion();
    hideLoader();
  } catch (e) {
    hideLoader();
    alert(`Fehler: ${e.message}`);
  }
}

function renderQuestion() {
  const q   = quizState.questions[quizState.current];
  const idx = quizState.current;
  const tot = quizState.total;

  document.getElementById('quiz-progress').textContent = `Frage ${idx + 1}/${tot}`;
  document.getElementById('quiz-score').textContent = `Punkte: ${quizState.score}`;

  const card = document.getElementById('quiz-question-card');
  // Decode HTML entities from Open Trivia DB
  const decode = str => {
    const txt = document.createElement('textarea');
    txt.innerHTML = str; return txt.value;
  };

  card.innerHTML = `
    <div class="quiz-question">${decode(q.question)}</div>
    <div class="quiz-answers">
      ${q.answers.map(a => `
        <button class="answer-btn" onclick="checkAnswer(this, '${escapeAttr(a)}', '${escapeAttr(q.correct)}')">
          ${decode(a)}
        </button>`).join('')}
    </div>
    <div class="quiz-feedback" id="quiz-feedback"></div>
    <button class="btn btn-primary quiz-next-btn" id="quiz-next" style="display:none"
            onclick="nextQuestion()">
      ${idx + 1 < tot ? 'Nächste Frage ▶' : 'Ergebnis anzeigen 🏆'}
    </button>
  `;
}

function escapeAttr(s) { return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }

function checkAnswer(btn, selected, correct) {
  const decode = str => { const t = document.createElement('textarea'); t.innerHTML = str; return t.value; };
  const allBtns = btn.closest('.quiz-answers').querySelectorAll('.answer-btn');
  allBtns.forEach(b => b.disabled = true);

  const isCorrect = decode(selected) === decode(correct);
  const fb = document.getElementById('quiz-feedback');

  if (isCorrect) {
    btn.classList.add('correct');
    quizState.score += 10;
    quizState.correct++;
    fb.textContent = '✅ Richtig! +10 Punkte';
    fb.className = 'quiz-feedback feedback-correct';
  } else {
    btn.classList.add('wrong');
    allBtns.forEach(b => { if (decode(b.textContent.trim()) === decode(correct)) b.classList.add('correct'); });
    fb.innerHTML = `❌ Falsch! Richtige Antwort: <em>${decode(correct)}</em>`;
    fb.className = 'quiz-feedback feedback-wrong';
  }
  document.getElementById('quiz-next').style.display = 'inline-block';
  document.getElementById('quiz-score').textContent = `Punkte: ${quizState.score}`;
}

function nextQuestion() {
  quizState.current++;
  if (quizState.current >= quizState.total) {
    showQuizResult();
  } else {
    renderQuestion();
  }
}

function showQuizResult() {
  document.getElementById('quiz-question-card').innerHTML = '';
  const resultEl = document.getElementById('quiz-result');
  resultEl.style.display = 'block';
  const pct = Math.round(quizState.correct / quizState.total * 100);
  const emoji = pct >= 80 ? '🌟' : pct >= 60 ? '👍' : pct >= 40 ? '📚' : '💪';
  document.getElementById('result-text').innerHTML =
    `${emoji} Du hast <strong>${quizState.correct}/${quizState.total}</strong> Fragen richtig beantwortet (${pct}%).<br>
     Gesamtpunkte: <strong>${quizState.score}</strong>`;

  // Fortschritt speichern
  const p = getProgress();
  p.quizzes++;
  p.correct += quizState.correct;
  p.total   += quizState.total;
  saveProgress(p);
}

function resetQuiz() {
  document.getElementById('quiz-setup').style.display = 'block';
  document.getElementById('quiz-game').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════════════════
// KI-TUTOR
// ══════════════════════════════════════════════════════════════════════════════
let chatHistory = [];

async function sendTutorMessage() {
  const input   = document.getElementById('tutor-input');
  const subject = document.getElementById('tutor-subject').value;
  const question = input.value.trim();
  if (!question) return;

  appendMsg(question, 'user');
  chatHistory.push({ role: 'user', content: question });
  input.value = '';

  // Fortschritt
  const p = getProgress();
  p.sessions++;
  saveProgress(p);

  showLoader('KI-Tutor denkt nach…');
  try {
    const data = await api('/api/tutor', { question, subject, history: chatHistory });
    const answer = data.answer || data.error;
    appendMsg(answer, 'assistant');
    chatHistory.push({ role: 'assistant', content: answer });
  } catch (e) {
    appendMsg(`Fehler: ${e.message}`, 'assistant');
  } finally {
    hideLoader();
  }
}

function appendMsg(text, role) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function clearChat() {
  chatHistory = [];
  const box = document.getElementById('chat-messages');
  box.innerHTML = '<div class="chat-msg assistant">Hallo! Ich bin dein KI-Tutor. 👋 Welche Frage hast du?</div>';
}

// ══════════════════════════════════════════════════════════════════════════════
// NACHSCHLAGEN
// ══════════════════════════════════════════════════════════════════════════════
async function lookupTopic() {
  const topic = document.getElementById('explain-topic').value.trim();
  const lang  = document.getElementById('explain-lang').value;
  if (!topic) { alert('Bitte ein Thema eingeben.'); return; }

  showLoader('Wikipedia wird durchsucht…');
  try {
    const data = await api('/api/explain', { topic, lang });

    document.getElementById('explain-title').textContent = data.title;
    document.getElementById('explain-extract').textContent = data.extract;
    const link = document.getElementById('explain-link');
    link.href = data.url || '#';
    link.style.display = data.url ? '' : 'none';

    const thumb = document.getElementById('explain-thumb');
    if (data.thumbnail) { thumb.src = data.thumbnail; thumb.style.display = ''; }
    else thumb.style.display = 'none';

    const summaryBox = document.getElementById('ai-summary-box');
    if (data.ai_summary) {
      document.getElementById('ai-summary-text').textContent = data.ai_summary;
      summaryBox.style.display = '';
    } else {
      summaryBox.style.display = 'none';
    }

    document.getElementById('explain-result').style.display = '';

    // Fortschritt
    const p = getProgress();
    p.lookups++;
    if (!p.topics.includes(topic)) p.topics.unshift(topic);
    p.topics = p.topics.slice(0, 20);
    saveProgress(p);
  } catch (e) {
    alert(`Fehler: ${e.message}`);
  } finally {
    hideLoader();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LERNKARTEN
// ══════════════════════════════════════════════════════════════════════════════
let fcState = { cards: [], current: 0, correct: 0, wrong: 0 };

async function generateFlashcards() {
  const topic  = document.getElementById('fc-topic').value.trim();
  const amount = parseInt(document.getElementById('fc-amount').value);
  if (!topic) { alert('Bitte ein Thema eingeben.'); return; }

  showLoader('Lernkarten werden generiert…');
  try {
    const data = await api('/api/flashcards', { topic, amount });
    if (!data.cards || !data.cards.length) { alert('Keine Karten generiert.'); hideLoader(); return; }

    fcState = { cards: data.cards, current: 0, correct: 0, wrong: 0 };
    document.getElementById('fc-setup').style.display = 'none';
    document.getElementById('fc-area').style.display = '';
    document.getElementById('fc-summary').style.display = 'none';
    showCard();
    hideLoader();

    // Thema in Fortschritt speichern
    const p = getProgress();
    if (!p.topics.includes(topic)) p.topics.unshift(topic);
    p.topics = p.topics.slice(0, 20);
    saveProgress(p);
  } catch (e) {
    hideLoader();
    alert(`Fehler: ${e.message}`);
  }
}

function showCard() {
  const card = fcState.cards[fcState.current];
  document.getElementById('fc-counter').textContent =
    `${fcState.current + 1} / ${fcState.cards.length}`;
  document.getElementById('fc-front').textContent = card.front;
  document.getElementById('fc-back').textContent  = card.back;
  document.getElementById('fc-card').classList.remove('flipped');
}

function flipCard()  { document.getElementById('fc-card').classList.toggle('flipped'); }
function prevCard()  { if (fcState.current > 0) { fcState.current--; showCard(); } }
function nextCard()  { if (fcState.current < fcState.cards.length - 1) { fcState.current++; showCard(); } }

function markCard(result) {
  if (result === 'correct') fcState.correct++;
  else fcState.wrong++;

  const p = getProgress();
  p.cards++;
  saveProgress(p);

  if (fcState.current < fcState.cards.length - 1) {
    fcState.current++;
    showCard();
  } else {
    showFCSummary();
  }
}

function showFCSummary() {
  const total = fcState.correct + fcState.wrong;
  const pct   = total ? Math.round(fcState.correct / total * 100) : 0;
  document.getElementById('fc-summary-text').innerHTML =
    `✅ Richtig: <strong>${fcState.correct}</strong> &nbsp; ❌ Falsch: <strong>${fcState.wrong}</strong><br>
     Trefferquote: <strong>${pct}%</strong>`;
  document.getElementById('fc-summary').style.display = '';
}

function restartFlashcards() {
  fcState.current = 0; fcState.correct = 0; fcState.wrong = 0;
  document.getElementById('fc-summary').style.display = 'none';
  showCard();
}

// ══════════════════════════════════════════════════════════════════════════════
// FORTSCHRITT (localStorage)
// ══════════════════════════════════════════════════════════════════════════════
function getProgress() {
  const raw = localStorage.getItem('lernapp_progress');
  return raw ? JSON.parse(raw) : { quizzes:0, correct:0, total:0, lookups:0, cards:0, sessions:0, topics:[] };
}
function saveProgress(p) { localStorage.setItem('lernapp_progress', JSON.stringify(p)); }

function loadProgress() {
  const p = getProgress();
  document.getElementById('stat-quizzes').textContent  = p.quizzes;
  document.getElementById('stat-correct').textContent  = p.correct;
  document.getElementById('stat-accuracy').textContent = p.total ? Math.round(p.correct / p.total * 100) + '%' : '0%';
  document.getElementById('stat-lookups').textContent  = p.lookups;
  document.getElementById('stat-cards').textContent    = p.cards;
  document.getElementById('stat-sessions').textContent = p.sessions;

  const list = document.getElementById('recent-topics');
  list.innerHTML = p.topics.length
    ? p.topics.map(t => `<li>📌 ${t}</li>`).join('')
    : '<li>Noch keine Themen gelernt.</li>';
}

function resetProgress() {
  if (confirm('Möchtest du deinen gesamten Fortschritt zurücksetzen?')) {
    localStorage.removeItem('lernapp_progress');
    loadProgress();
  }
}
