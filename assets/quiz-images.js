(function install(root) {
  'use strict';
  const MAX_QUERIES = 6, MAX_BYTES = 320 * 1024;
  const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim() : '';
  function query(value) {
    const term = text(value).replace(/\s+/g, ' ');
    return term.length >= 2 && term.length <= 80 && /^[\p{L}\p{N} -]+$/u.test(term) && term.split(' ').length <= 8 ? term : '';
  }
  function commonsUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org' || url.port || url.username || url.password || url.search || url.hash) return '';
      if (!/^\/wikipedia\/commons\/(?:thumb\/)?[a-f0-9]\/[a-f0-9]{2}\/.+\.(?:jpe?g|png|webp)$/i.test(url.pathname) || /%2f|%5c|%0[0-9a-f]|%1[0-9a-f]/i.test(url.pathname)) return '';
      return url.href;
    } catch { return ''; }
  }
  function sourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'commons.wikimedia.org' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/wiki\/File(?::|%3A).+/i.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }
  function licenseUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && /^(?:www\.)?creativecommons\.org$/.test(url.hostname) && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/(?:licenses\/by(?:-sa)?\/\d\.\d|publicdomain\/(?:zero|mark)\/1\.0)\/(?:deed\.[a-z-]+)?$/.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }
  function normalizeImage(value) {
    if (!value || typeof value !== 'object') return null;
    const url = commonsUrl(value.url), source = sourceUrl(value.sourceUrl), license = text(value.license), author = text(value.author), alt = text(value.alt);
    const licenseLink = licenseUrl(value.licenseUrl);
    if (!url || url.length > 1600 || !source || source.length > 1600 || !licenseLink || !author || author.length > 400 || !alt || alt.length > 180 || !/^(?:CC BY(?:-SA)? \d\.\d|CC0 1\.0|Public domain)$/.test(license)) return null;
    return { url, alt, author, license, sourceUrl: source, licenseUrl: licenseLink };
  }
  function imageMime(bytes) {
    if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0,4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8,12)) === 'WEBP') return 'image/webp';
    return '';
  }
  const proxyUrl = image => '/api/quiz-image?url=' + encodeURIComponent(image.url);
  function questionQuery(question, topic) {
    // Only short generic concepts are sent to the picture search, never the learning text.
    if (Object.prototype.hasOwnProperty.call(question, 'imageQuery')) return query(question.imageQuery);
    const cue = query(question.q?.match(/„([^“]{2,60})“/)?.[1]);
    return (topic === 'Quiz aus deinem Text' ? '' : query(topic)) || (cue.split(' ').length <= 3 ? cue : '');
  }
  async function enrich(quiz, fetcher = root.fetch) {
    const terms = quiz.questions.map(q => questionQuery(q, quiz.topic));
    const queries = [...new Set(terms.filter(Boolean))].slice(0, MAX_QUERIES);
    if (!queries.length) return { ...quiz, imageCount: 0 };
    try {
      const response = await fetcher('/api/quiz-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries }), signal: AbortSignal.timeout(14000) });
      if (!response.ok) throw new Error('Bilder nicht verfügbar');
      const data = await response.json(), found = new Map();
      for (const item of Array.isArray(data.images) ? data.images : []) {
        const image = normalizeImage(item.image);
        if (queries.includes(item.query) && image) found.set(item.query, image);
      }
      const questions = quiz.questions.map((q, i) => found.has(terms[i]) ? { ...q, image: found.get(terms[i]) } : { ...q });
      return { ...quiz, questions, imageCount: questions.filter(q => q.image).length };
    } catch { return { ...quiz, imageCount: 0 }; }
  }
  const embeddedCache = new Map();
  async function embedOffline(questions, fetcher = root.fetch) {
    const images = new Map();
    for (const question of questions) {
      const image = normalizeImage(question.image);
      if (image && !images.has(image.url) && images.size < MAX_QUERIES) images.set(image.url, image);
    }
    const entries = [...images.values()], signal = AbortSignal.timeout(14000);
    let cursor = 0;
    async function worker() {
      while (cursor < entries.length && !signal.aborted) {
        const image = entries[cursor++];
        if (embeddedCache.has(image.url)) continue;
        try {
          const response = await fetcher(proxyUrl(image), { signal });
          if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) continue;
          const bytes = new Uint8Array(await response.arrayBuffer()), mime = imageMime(bytes);
          if (!mime || bytes.length > MAX_BYTES) continue;
          let binary = '';
          for (let i = 0; i < bytes.length; i += 1024) binary += String.fromCharCode(...bytes.subarray(i, i + 1024));
          embeddedCache.set(image.url, 'data:' + mime + ';base64,' + root.btoa(binary));
        } catch { /* A missing picture must never prevent saving the quiz. */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker));
    let embedded = 0, missing = 0;
    const result = questions.map(question => {
      const copy = { ...question }, image = normalizeImage(question.image);
      delete copy.image;
      if (image) {
        const data = images.has(image.url) && embeddedCache.get(image.url);
        if (data) { copy.image = { ...image, data }; embedded++; } else missing++;
      }
      return copy;
    });
    return { questions: result, embedded, missing };
  }
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function render(figure, img, credit, value, offline = false) {
    const image = normalizeImage(value);
    const data = offline && typeof value?.data === 'string' && value.data.length <= MAX_BYTES * 1.4 + 100 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.data) ? value.data : '';
    figure.classList.toggle('hide', !image || (offline && !data));
    if (!image || (offline && !data)) { img.removeAttribute('src'); return; }
    img.alt = 'Bild zum Thema: ' + image.alt;
    img.onerror = () => figure.classList.add('hide');
    img.src = offline ? data : proxyUrl(image);
    credit.innerHTML = esc(image.author) + ' · <a href="' + esc(image.sourceUrl) + '" target="_blank" rel="noopener">Bildquelle</a> · <a href="' + esc(image.licenseUrl) + '" target="_blank" rel="noopener">' + esc(image.license) + '</a>';
  }
  const api = { MAX_QUERIES, MAX_BYTES, query, commonsUrl, normalizeImage, imageMime, proxyUrl, questionQuery, enrich, embedOffline, render, browserSource: () => '(' + install.toString() + ')(globalThis);' };
  root.RazaQuizImages = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
