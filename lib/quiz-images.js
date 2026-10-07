'use strict';
const Images = require('../assets/quiz-images');
const USER_AGENT = 'Herr-Raza-Quiz/1.0 (https://herr-raza-k11j-ras-projects-f153c026.vercel.app/)';
function plain(value) {
  return String(value || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => {
    const n = parseInt(hex || dec, hex ? 16 : 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }[entity])).replace(/\s+/g, ' ').trim();
}
function candidate(page, term) {
  const info = page.imageinfo?.[0], meta = info?.extmetadata;
  if (page.ns !== 6 || !info || !meta) return null;
  const licenseName = plain(meta.LicenseShortName?.value);
  let license = '', licenseUrl = plain(meta.LicenseUrl?.value);
  if (/^CC BY(?:-SA)? \d\.\d$/i.test(licenseName)) license = licenseName.toUpperCase();
  else if (/^(?:CC0(?: 1\.0)?|CC Zero)$/i.test(licenseName)) { license = 'CC0 1.0'; licenseUrl = 'https://creativecommons.org/publicdomain/zero/1.0/'; }
  else if (/^Public domain$/i.test(licenseName)) { license = 'Public domain'; licenseUrl = 'https://creativecommons.org/publicdomain/mark/1.0/'; }
  if (!license) return null;
  if (licenseUrl.startsWith('//')) licenseUrl = 'https:' + licenseUrl;
  licenseUrl = licenseUrl.replace(/^http:/, 'https:').replace(/\/$/, '') + '/';
  const author = plain(meta.Artist?.value || meta.Attribution?.value || meta.Credit?.value) || (license === 'Public domain' || license === 'CC0 1.0' ? 'Urheber nicht angegeben' : '');
  const url = info.thumburl || info.url, mime = info.thumbmime || info.mime;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !info.thumburl && info.size > Images.MAX_BYTES) return null;
  return Images.normalizeImage({ url, alt: term, author, license, sourceUrl: info.descriptionurl, licenseUrl });
}
async function searchImages(queries, fetcher = fetch) {
  const results = [], statuses = {}, failures = {}, signal = AbortSignal.timeout(9500);
  let cursor = 0, limited = false;
  async function worker() {
    while (cursor < queries.length && !limited && !signal.aborted) {
      const term = queries[cursor++];
      try {
        const url = new URL('https://commons.wikimedia.org/w/api.php');
        url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: term + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '4', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime|thumbmime', iiurlwidth: '480', iiextmetadatafilter: 'Artist|Attribution|Credit|LicenseShortName|LicenseUrl', maxlag: '5' });
        const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        if (response.status === 429) { limited = true; continue; }
        if (!response.ok) continue;
        const data = await response.json();
        const pages = Array.isArray(data.query?.pages) ? data.query.pages : [];
        if (data.error?.code) failures[data.error.code] = (failures[data.error.code] || 0) + 1;
        pages.sort((a,b) => (a.index || 0) - (b.index || 0));
        const image = pages.map(page => candidate(page, term)).find(Boolean);
        if (image) results.push({ query: term, image });
      } catch (error) { const kind = error?.name || 'Error'; failures[kind] = (failures[kind] || 0) + 1; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queries.length) }, worker));
  console.info('quiz-picture-search', JSON.stringify({ requested: queries.length, found: results.length, statuses, failures }));
  return results;
}
module.exports = { plain, candidate, searchImages, USER_AGENT };
