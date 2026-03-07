/* ══════════════════════════════════════════════════════════════════════════════
   Herr-Raza Lernapp — Frontend Script
   APIs: Open-Meteo, HackerNews, Open Trivia, Wikipedia, RestCountries,
         Frankfurter, JokeAPI, Quotable — alle kostenlos, kein Key nötig
   ══════════════════════════════════════════════════════════════════════════════ */

// ── Utils ─────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $(id).style.display = '';
const hide = id => $(id).style.display = 'none';

function showLoader(txt = 'Lädt…') {
  $('loader-txt').textContent = txt;
  show('loader');
}
function hideLoader() { hide('loader'); }

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  return r.json();
}

function fmtNum(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + ' Mrd.' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' Mio.' : n.toLocaleString('de-DE'); }
function fmtDate(ts) { return ts ? new Date(ts * 1000).toLocaleDateString('de-DE') : ''; }

// ── Navigation ────────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:'Dashboard', weather:'Wetter', news:'Nachrichten',
  quiz:'Quiz', wiki:'Wikipedia', countries:'Länder',
  currency:'Währungen', jokes:'Witze', progress:'Fortschritt'
};

function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  $(`page-${name}`).classList.add('active');
  document.querySelector(`[data-page="${name}"]`).classList.add('active');
  $('page-title').textContent = PAGE_TITLES[name] || name;
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('mobile-open');
  if (name === 'progress') loadProgress();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => goPage(btn.dataset.page));
});

// Sidebar toggle
$('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.querySelector('.main-wrapper').classList.toggle('collapsed');
});
$('menuBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('mobile-open');
});

// Date
$('topbar-date').textContent = new Date().toLocaleDateString('de-DE',
  {weekday:'long',year:'numeric',month:'long',day:'numeric'});

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD INIT
// ══════════════════════════════════════════════════════════════════════════════
async function initDashboard() {
  // Quote
  try {
    const q = await get('/api/quote');
    $('dash-quote').innerHTML = `„${q.quote}"<br><strong>— ${q.author}</strong>`;
  } catch { $('dash-quote').innerHTML = '„Wissen ist Macht."<br><strong>— Francis Bacon</strong>'; }

  // Mini-Wetter
  try {
    const w = await get('/api/weather?city=Berlin');
    $('dash-weather-mini').textContent = `${w.city}: ${w.temp}°C ${w.icon}`;
  } catch { $('dash-weather-mini').textContent = 'Nicht verfügbar'; }

  // Score
  const p = getProgress();
  $('dash-score').textContent = `Punkte: ${p.points || 0}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// WETTER
// ══════════════════════════════════════════════════════════════════════════════
$('weather-city').addEventListener('keydown', e => { if (e.key === 'Enter') loadWeather(); });

async function loadWeather() {
  const city = $('weather-city').value.trim() || 'Berlin';
  showLoader('Wetterdaten laden…');
  try {
    const w = await get(`/api/weather?city=${encodeURIComponent(city)}`);
    renderWeather(w);
  } catch (e) {
    $('weather-result').innerHTML = `<div class="error-box">❌ ${e.message}</div>`;
  } finally { hideLoader(); }
}

function renderWeather(w) {
  const forecastHTML = w.forecast.map(d => `
    <div class="forecast-day">
      <div class="fd-date">${new Date(d.date).toLocaleDateString('de-DE',{weekday:'short',day:'numeric',month:'numeric'})}</div>
      <div class="fd-icon">${d.icon}</div>
      <div class="fd-temps">${d.max}° / ${d.min}°</div>
      <div class="fd-rain">🌧️ ${d.rain} mm</div>
    </div>`).join('');

  $('weather-result').innerHTML = `
    <div class="card">
      <div class="weather-main">
        <div class="weather-big-icon">${w.icon}</div>
        <div class="weather-info">
          <h2>${w.city}, ${w.country}</h2>
          <div class="weather-desc">${w.description}</div>
          <div class="temp-main">${w.temp}°C</div>
          <div class="temp-feels">Gefühlt: ${w.feels_like}°C</div>
          <div class="weather-pills">
            <span class="pill">💧 ${w.humidity}%</span>
            <span class="pill">💨 ${w.wind} km/h</span>
          </div>
        </div>
      </div>
      <hr/>
      <h3 style="margin-bottom:.75rem">5-Tage-Vorschau</h3>
      <div class="forecast-row">${forecastHTML}</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// NACHRICHTEN
// ══════════════════════════════════════════════════════════════════════════════
async function loadNews(category = 'tech', btn = null) {
  if (btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  $('news-list').innerHTML = '<div class="loading-box"><div class="spinner"></div><p>Nachrichten laden…</p></div>';
  try {
    const data = await get(`/api/news?category=${category}`);
    if (!data.articles.length) {
      $('news-list').innerHTML = '<div class="error-box">Keine Artikel gefunden.</div>';
      return;
    }
    $('news-list').innerHTML = data.articles.map(a => `
      <div class="news-item">
        <a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>
        <div class="news-meta">
          <span>📡 ${a.source}</span>
          <span>⬆️ ${a.score}</span>
          <span>💬 ${a.comments}</span>
          ${a.time ? `<span>📅 ${fmtDate(a.time)}</span>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    $('news-list').innerHTML = `<div class="error-box">❌ ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// QUIZ
// ══════════════════════════════════════════════════════════════════════════════
let qState = {};

async function startQuiz() {
  const cat   = $('q-cat').value;
  const diff  = $('q-diff').value;
  const amt   = parseInt($('q-amount').value);
  showLoader('Fragen laden…');
  try {
    const params = `category=${cat}&difficulty=${diff}&amount=${amt}`;
    const data   = await get(`/api/quiz?${params}`);
    qState = { questions: data.questions, idx: 0, score: 0, correct: 0 };
    hide('quiz-setup-panel');
    show('quiz-game');
    hide('quiz-result-area');
    renderQ();
  } catch (e) {
    alert(`Fehler: ${e.message}`);
  } finally { hideLoader(); }
}

function renderQ() {
  const q = qState.questions[qState.idx];
  $('q-progress').textContent = `Frage ${qState.idx + 1} / ${qState.questions.length}`;
  $('q-score-badge').textContent = `${qState.score} Punkte`;
  $('quiz-question-area').innerHTML = `
    <div class="quiz-q-text">${q.question}</div>
    <div class="quiz-answers">
      ${q.answers.map(a => `<button class="ans-btn" onclick="checkAns(this,'${esc(a)}','${esc(q.correct)}')">${a}</button>`).join('')}
    </div>
    <div class="quiz-feedback" id="q-fb"></div>
    <button class="btn btn-primary" id="q-next-btn" style="display:none;margin-top:1rem" onclick="qNext()">
      ${qState.idx + 1 < qState.questions.length ? 'Weiter ▶' : '🏆 Ergebnis'}
    </button>`;
}

function esc(s) { return String(s).replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

function checkAns(btn, sel, cor) {
  const isOK = sel === cor;
  btn.closest('.quiz-answers').querySelectorAll('.ans-btn').forEach(b => b.disabled = true);
  if (isOK) {
    btn.classList.add('correct');
    qState.score += 10; qState.correct++;
    $('q-fb').innerHTML = '<span class="fb-ok">✅ Richtig! +10</span>';
  } else {
    btn.classList.add('wrong');
    btn.closest('.quiz-answers').querySelectorAll('.ans-btn').forEach(b => {
      if (b.textContent.trim() === cor) b.classList.add('correct');
    });
    $('q-fb').innerHTML = `<span class="fb-no">❌ Falsch! Richtig: <em>${cor}</em></span>`;
  }
  $('q-score-badge').textContent = `${qState.score} Punkte`;
  show('q-next-btn');
}

function qNext() {
  qState.idx++;
  if (qState.idx >= qState.questions.length) showQResult();
  else renderQ();
}

function showQResult() {
  hide('quiz-question-area');
  const pct = Math.round(qState.correct / qState.questions.length * 100);
  const emoji = pct >= 80 ? '🌟' : pct >= 60 ? '👍' : pct >= 40 ? '📚' : '💪';
  $('quiz-result-area').innerHTML = `
    <div class="q-result-emoji">${emoji}</div>
    <div class="q-result-text">
      <strong>${qState.correct}/${qState.questions.length}</strong> richtig — ${pct}%<br>
      Gesamt: <strong>${qState.score} Punkte</strong>
    </div>
    <div style="text-align:center">
      <button class="btn btn-primary" onclick="resetQuiz()">🔄 Nochmal</button>
    </div>`;
  show('quiz-result-area');
  const p = getProgress();
  p.quizzes++; p.correct += qState.correct; p.total += qState.questions.length;
  p.points = (p.points || 0) + qState.score;
  saveProgress(p);
}

function resetQuiz() {
  show('quiz-setup-panel');
  hide('quiz-game');
}

// ══════════════════════════════════════════════════════════════════════════════
// WIKIPEDIA
// ══════════════════════════════════════════════════════════════════════════════
const WIKI_SUGGESTIONS = [
  'Photosynthese','Demokratie','Pythagoras','Schwarzes Loch','Klimawandel',
  'Quantenmechanik','Albert Einstein','Renaissance','DNA','Erster Weltkrieg',
  'Mathematik','Internet','Künstliche Intelligenz','Beethoven','Relativitätstheorie'
];

$('wiki-topic').addEventListener('keydown', e => { if (e.key === 'Enter') loadWiki(); });

function initWikiSuggestions() {
  $('wiki-chips').innerHTML = WIKI_SUGGESTIONS.slice(0,10).map(t =>
    `<button class="chip clickable" onclick="quickWiki('${t}')">${t}</button>`
  ).join('');
}

function quickWiki(topic) {
  $('wiki-topic').value = topic;
  loadWiki();
}

async function loadWiki() {
  const topic = $('wiki-topic').value.trim();
  const lang  = $('wiki-lang').value;
  if (!topic) { alert('Bitte einen Begriff eingeben.'); return; }
  showLoader('Wikipedia durchsuchen…');
  try {
    const data = await get(`/api/wiki?topic=${encodeURIComponent(topic)}&lang=${lang}`);
    $('wiki-result').innerHTML = `
      <div class="card">
        <div class="wiki-result-header">
          ${data.thumbnail ? `<img src="${data.thumbnail}" alt="${data.title}" class="wiki-thumb"/>` : ''}
          <div>
            <div class="wiki-title">${data.title}</div>
            ${data.description ? `<div class="wiki-desc">${data.description}</div>` : ''}
            <a href="${data.url}" target="_blank" class="wiki-link">Wikipedia öffnen ↗</a>
          </div>
        </div>
        <hr/>
        <div class="wiki-extract">${data.extract}</div>
      </div>`;
    const p = getProgress();
    p.lookups++;
    if (!p.topics.includes(topic)) p.topics.unshift(topic);
    p.topics = p.topics.slice(0, 20);
    saveProgress(p);
  } catch (e) {
    $('wiki-result').innerHTML = `<div class="error-box">❌ Nicht gefunden: ${e.message}</div>`;
  } finally { hideLoader(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// LÄNDER
// ══════════════════════════════════════════════════════════════════════════════
$('country-name').addEventListener('keydown', e => { if (e.key === 'Enter') loadCountry(); });

function quickCountry(name) {
  $('country-name').value = name;
  loadCountry();
}

async function loadCountry() {
  const name = $('country-name').value.trim() || 'Germany';
  showLoader('Länderdaten laden…');
  try {
    const c = await get(`/api/country?name=${encodeURIComponent(name)}`);
    $('country-result').innerHTML = `
      <div class="country-card">
        <div class="country-header">
          ${c.flag_png ? `<img src="${c.flag_png}" alt="Flagge" class="country-flag-img"/>` : `<span class="country-flag-emoji">${c.flag}</span>`}
          <div>
            <div class="country-name">${c.flag} ${c.name}</div>
            <div class="country-official">${c.official}</div>
          </div>
        </div>
        <div class="country-grid">
          <div class="country-row"><div class="cr-label">Hauptstadt</div><div class="cr-value">🏛️ ${c.capital}</div></div>
          <div class="country-row"><div class="cr-label">Region</div><div class="cr-value">🌐 ${c.region} / ${c.subregion}</div></div>
          <div class="country-row"><div class="cr-label">Bevölkerung</div><div class="cr-value">👥 ${fmtNum(c.population)}</div></div>
          <div class="country-row"><div class="cr-label">Fläche</div><div class="cr-value">📐 ${fmtNum(c.area)} km²</div></div>
          <div class="country-row"><div class="cr-label">Sprachen</div><div class="cr-value">🗣️ ${c.languages.join(', ')}</div></div>
          <div class="country-row"><div class="cr-label">Währung</div><div class="cr-value">💰 ${c.currencies.join(', ')}</div></div>
          <div class="country-row"><div class="cr-label">Zeitzone</div><div class="cr-value">🕐 ${c.timezone}</div></div>
          <div class="country-row"><div class="cr-label">Vorwahl</div><div class="cr-value">📞 ${c.calling || '–'}</div></div>
        </div>
        ${c.maps ? `<div style="margin-top:1rem"><a href="${c.maps}" target="_blank" class="btn btn-outline">🗺️ Google Maps öffnen</a></div>` : ''}
      </div>`;
    const p = getProgress();
    p.countries = (p.countries || 0) + 1;
    if (!p.topics.includes(c.name)) p.topics.unshift(c.name);
    p.topics = p.topics.slice(0, 20);
    saveProgress(p);
  } catch (e) {
    $('country-result').innerHTML = `<div class="error-box">❌ ${e.message}</div>`;
  } finally { hideLoader(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// WÄHRUNGEN
// ══════════════════════════════════════════════════════════════════════════════
async function convertCurrency() {
  const amount = parseFloat($('cur-amount').value) || 1;
  const from   = $('cur-from').value;
  const to     = $('cur-to').value;
  if (from === to) { $('cur-result').textContent = `${amount} ${from} = ${amount} ${to}`; show('cur-result'); return; }
  showLoader('Umrechnen…');
  try {
    const d = await get(`/api/currency/convert?amount=${amount}&from=${from}&to=${to}`);
    $('cur-result').innerHTML = `${amount.toLocaleString('de-DE')} ${from} = <span style="color:var(--accent)">${d.result.toLocaleString('de-DE',{maximumFractionDigits:4})} ${to}</span><br><small style="color:var(--muted);font-size:.8rem">Stand: ${d.date}</small>`;
    show('cur-result');
  } catch (e) { alert(e.message); }
  finally { hideLoader(); }
}

async function loadRates() {
  $('cur-rates-grid').innerHTML = '<div class="spinner"></div>';
  try {
    const d = await get('/api/currency?base=EUR');
    const ICONS = {USD:'🇺🇸',GBP:'🇬🇧',JPY:'🇯🇵',CHF:'🇨🇭',CAD:'🇨🇦',AUD:'🇦🇺',CNY:'🇨🇳',INR:'🇮🇳',TRY:'🇹🇷',SEK:'🇸🇪',NOK:'🇳🇴',DKK:'🇩🇰',PLN:'🇵🇱',CZK:'🇨🇿',HUF:'🇭🇺',BRL:'🇧🇷',MXN:'🇲🇽',SGD:'🇸🇬',HKD:'🇭🇰',KRW:'🇰🇷'};
    const top = ['USD','GBP','JPY','CHF','CAD','AUD','CNY','INR','TRY','SEK','NOK','PLN','BRL','MXN','HKD'];
    $('cur-rates-grid').innerHTML = top.filter(k => d.rates[k]).map(k => `
      <div class="rate-card">
        <div class="rate-code">${ICONS[k] || ''} ${k}</div>
        <div class="rate-val">${Number(d.rates[k]).toLocaleString('de-DE',{maximumFractionDigits:4})}</div>
      </div>`).join('') + `<div class="rate-card" style="grid-column:1/-1;color:var(--muted);font-size:.8rem;text-align:center">Stand: ${d.date}</div>`;
  } catch { $('cur-rates-grid').innerHTML = '<div class="error-box">Nicht verfügbar</div>'; }
}

// ══════════════════════════════════════════════════════════════════════════════
// WITZE
// ══════════════════════════════════════════════════════════════════════════════
let currentJokeCat = 'Any';

async function loadJoke(cat = 'Any', btn = null) {
  currentJokeCat = cat;
  if (btn) {
    document.querySelectorAll('#page-jokes .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  $('joke-card').innerHTML = '<div class="spinner-sm"></div>';
  try {
    const j = await get(`/api/joke?category=${cat}`);
    if (j.type === 'twopart') {
      $('joke-card').innerHTML = `<div>${j.joke}</div><div class="joke-punchline">😄 ${j.punchline}</div>`;
    } else {
      $('joke-card').innerHTML = `<div>${j.joke}</div>`;
    }
    const p = getProgress();
    p.jokes = (p.jokes || 0) + 1;
    saveProgress(p);
  } catch {
    $('joke-card').innerHTML = `<div>Warum können Informatiker nicht kochen? Weil sie immer nur Stack Overflow haben! 😄</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FORTSCHRITT
// ══════════════════════════════════════════════════════════════════════════════
function getProgress() {
  try { return JSON.parse(localStorage.getItem('lernapp_v2') || '{}'); } catch { return {}; }
}
function saveProgress(p) { localStorage.setItem('lernapp_v2', JSON.stringify(p)); }

function loadProgress() {
  const p = getProgress();
  $('s-quizzes').textContent  = p.quizzes   || 0;
  $('s-correct').textContent  = p.correct   || 0;
  $('s-pct').textContent      = p.total ? Math.round((p.correct || 0) / p.total * 100) + '%' : '0%';
  $('s-lookups').textContent  = p.lookups   || 0;
  $('s-countries').textContent= p.countries || 0;
  $('s-jokes').textContent    = p.jokes     || 0;
  $('dash-score').textContent = `Punkte: ${p.points || 0}`;
  const list = $('recent-topics');
  list.innerHTML = (p.topics || []).length
    ? (p.topics || []).map(t => `<li>📌 ${t}</li>`).join('')
    : '<li style="color:var(--muted)">Noch nichts nachgeschlagen</li>';
}

function resetProgress() {
  if (confirm('Fortschritt wirklich zurücksetzen?')) {
    localStorage.removeItem('lernapp_v2');
    loadProgress();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════
(async function init() {
  loadProgress();
  initDashboard();
  loadNews('tech');
  loadRates();
  loadJoke('Any');
  initWikiSuggestions();

  // Enter-Taste für Währungsrechner
  $('cur-amount').addEventListener('keydown', e => { if (e.key === 'Enter') convertCurrency(); });

  // Wetter beim ersten Besuch laden
  loadWeather();
})();
