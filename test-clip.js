const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeClipQuery,
  isTikTokVideoUrl,
  extractTikTokResultsFromHtml
} = require('./plugins/clip');

test('normaliza búsquedas de clips y limita su longitud', () => {
  assert.equal(normalizeClipQuery('  goles   de   Messi  '), 'goles de Messi');
  assert.equal(normalizeClipQuery(''), '');
  assert.equal(normalizeClipQuery('x'.repeat(200)).length, 120);
});

test('acepta solo URLs de videos públicos de TikTok', () => {
  assert.equal(isTikTokVideoUrl('https://www.tiktok.com/@demo/video/123456'), true);
  assert.equal(isTikTokVideoUrl('https://vt.tiktok.com/ZTEST/'), true);
  assert.equal(isTikTokVideoUrl('https://www.tiktok.com/@demo'), false);
  assert.equal(isTikTokVideoUrl('https://example.com/video/123456'), false);
});

test('extrae, decodifica y deduplica resultados de búsqueda', () => {
  const redirect = encodeURIComponent('https://www.tiktok.com/@demo/video/123456');
  const html = [
    `<a href="https://duckduckgo.com/l/?uddg=${redirect}">Goles &amp; resumen</a>`,
    `<a href="https://www.tiktok.com/@demo/video/123456">Duplicado</a>`,
    `<a href="https://vt.tiktok.com/ZTEST/">Video corto</a>`,
    `<a href="https://youtube.com/watch?v=no">No es TikTok</a>`
  ].join('\n');

  assert.deepEqual(extractTikTokResultsFromHtml(html), [
    { url: 'https://www.tiktok.com/@demo/video/123456', title: 'Goles & resumen' },
    { url: 'https://vt.tiktok.com/ZTEST/', title: 'Video corto' }
  ]);
});
