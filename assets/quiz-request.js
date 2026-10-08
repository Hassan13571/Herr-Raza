(function (root) {
  'use strict';
  const CACHE = 'herr-raza-ready-quizzes-v1', LIMIT = 'herr-raza-ai-wait-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  function create({ storage, fetcher, crypto = root.crypto, normalize, now = () => Date.now() }) {
    const memory = new Map(), pending = new Map();
    let waitUntil = 0;
    try { waitUntil = Number(storage?.getItem(LIMIT)) || 0; } catch {}
    if (!Number.isFinite(waitUntil)) waitUntil = 0;
    function quota(seconds) {
      const error = new Error('Die kostenlose KI hat ihr Anfragelimit erreicht. Bitte warte noch ' + Math.ceil(seconds) + ' Sekunden. Du kannst ein gespeichertes Quiz öffnen oder eigene Fragen schreiben.');
      error.code = 'quota'; return error;
    }
    async function keyFor(input) {
      const raw = JSON.stringify([input.topic, input.sourceText, String(input.count), input.difficulty, input.mode, !!input.images]);
      // Store only a fingerprint of the source text, never the complete text.
      try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
      catch { return null; }
    }
    function read(key) {
      if (!key) return null;
      let entry = memory.get(key);
      if (!entry) try { entry = JSON.parse(storage?.getItem(CACHE) || '[]').find(e => e.key === key); } catch {}
      if (!entry || !Number.isFinite(entry.expires) || entry.expires <= now()) return null;
      try { const quiz = normalize(entry.quiz); if (quiz.edited || !quiz.ai?.connected || !quiz.quality?.reviewed) return null; return quiz; } catch { return null; }
    }
    function save(key, data, mode) {
      if (!key || !data.ai?.connected || !data.quality?.reviewed || data.edited) return;
      let quiz; try { quiz = normalize(data); } catch { return; }
      const entry = { key, expires: now() + (mode === 'live' ? 120000 : 86400000), quiz };
      memory.delete(key); memory.set(key, entry);
      while (memory.size > 3) memory.delete(memory.keys().next().value);
      try {
        const old = JSON.parse(storage?.getItem(CACHE) || '[]');
        const entries = [entry, ...(Array.isArray(old) ? old.filter(e => e.key !== key && e.expires > now()) : [])].slice(0, 3);
        const raw = JSON.stringify(entries); if (raw.length <= 500000) storage?.setItem(CACHE, raw);
      } catch {}
    }
    async function load(input) {
      const key = await keyFor(input), cached = read(key);
      if (cached) return clone(cached);
      if (waitUntil > now()) throw quota((waitUntil - now()) / 1000);
      const requestKey = key || JSON.stringify(input);
      if (pending.has(requestKey)) return clone(await pending.get(requestKey));
      const task = (async () => {
        const response = await fetcher('/api/quiz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(Number(input.count) > 15 ? 268000 : 78000) });
        let data; try { data = await response.json(); } catch { throw new Error('Die Antwort konnte nicht gelesen werden. Bitte versuche es später noch einmal.'); }
        if (!response.ok) {
          if (response.status === 429 || data.code === 'quota') {
            const delay = Number(data.retryAfter), seconds = Number.isFinite(delay) && delay > 0 ? Math.ceil(delay) : 60;
            waitUntil = Math.max(waitUntil, now() + seconds * 1000);
            try { storage?.setItem(LIMIT, String(waitUntil)); } catch {}
            throw quota(seconds);
          }
          throw new Error(data.details || data.error || 'Das Quiz konnte gerade nicht erstellt werden.');
        }
        // Validate before caching or displaying a server response.
        normalize(data); save(key, data, input.mode); return data;
      })();
      pending.set(requestKey, task);
      try { return clone(await task); } finally { pending.delete(requestKey); }
    }
    return { load };
  }
  const api = { create, CACHE, LIMIT };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RazaQuizRequest = api;
})(typeof globalThis === 'object' ? globalThis : this);
