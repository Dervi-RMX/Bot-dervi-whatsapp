const fs = require('fs');
const path = require('path');
const { downloadWithYtDlp } = require('../lib/downloader');
const { validateSafeUrl } = require('../lib/utils');

const MAX_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 15_000;
const VIDEO_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com']);

function normalizeClipQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

function decodeHtml(value) {
  if (!value) return '';
  const result = String(value)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/')
    .replace(/\\\//g, '/');
  console.log('decodeHtml: input:', JSON.stringify(value), 'output:', JSON.stringify(result));
  return result;
}

function decodeDuckHref(href) {
  if (!href) return null;
  const raw = decodeHtml(String(href));
  try {
    const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(absolute.startsWith('/') ? `https://duckduckgo.com${absolute}` : absolute);
    if (/duckduckgo\.com$/i.test(url.hostname) && url.pathname === '/l/') {
      return url.searchParams.get('uddg') || null;
    }
    if (/google\./i.test(url.hostname) && url.pathname === '/url') {
      return url.searchParams.get('q') || null;
    }
    if (/^https?:\/\//i.test(raw)) return raw;
  } catch {
    return null;
  }
  return null;
}

function cleanTitle(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function isTikTokVideoUrl(value) {
  try {
    const url = new URL(String(value));
    const hostname = url.hostname.toLowerCase();
    if (!VIDEO_HOSTS.has(hostname)) return false;
    if (hostname === 'vt.tiktok.com' || hostname === 'vm.tiktok.com') {
      return url.pathname.length > 1;
    }
    return /\/video\/\d+/i.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizeTikTokUrl(value) {
  const decoded = decodeHtml(String(value || '')).replace(/[\\"'<>\s]+$/g, '');
  if (!isTikTokVideoUrl(decoded)) return null;
  try {
    const url = new URL(decoded);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function addResult(results, seen, rawUrl, title = '') {
  const decoded = decodeDuckHref(rawUrl) || decodeHtml(rawUrl);
  const url = normalizeTikTokUrl(decoded);
  if (!url || seen.has(url)) return;
  seen.add(url);
  console.log('addResult: title input:', JSON.stringify(title), 'cleanTitle output:', JSON.stringify(cleanTitle(title)));
  results.push({ url, title: cleanTitle(title) });
}

function extractTikTokResultsFromHtml(html) {
  const source = String(html || '');
  const results = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(source))) {
    addResult(results, seen, match[1] || match[2], match[3]);
    if (results.length >= 25) return results;
  }

  const urlRegex = /https?:\/\/(www\.)?(?:tiktok\.com\/[^"'<>\s]+|vt\.tiktok\.com\/[^"'<>\s]+|vm\.tiktok\.com\/[^"'<>\s]+)/gi;
  while ((match = urlRegex.exec(source))) {
    addResult(results, seen, match[0]);
    if (results.length >= 25) break;
  }

  console.log('extractTikTokResultsFromHtml results:', JSON.stringify(results, null, 2));
  return results;
}

async function fetchSearchHtml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: {
      'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`search failed (${response.status})`);
  return response.text();
}

async function searchTikTokVideos(query) {
  const encodedQuery = encodeURIComponent(query);
  const sources = [
    `https://www.tiktok.com/search?q=${encodedQuery}`,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:tiktok.com ${query}`)}`,
    `https://www.google.com/search?q=${encodeURIComponent(`site:tiktok.com/video ${query}`)}`
  ];

  const combined = [];
  const seen = new Set();
  for (const source of sources) {
    try {
      const html = await fetchSearchHtml(source);
      for (const result of extractTikTokResultsFromHtml(html)) {
        if (seen.has(result.url)) continue;
        seen.add(result.url);
        combined.push(result);
      }
      if (combined.length >= MAX_SEARCH_RESULTS) break;
    } catch {
      // Try the next public search source.
    }
  }
  return combined;
}

function buildCaption(result, query) {
  const title = cleanTitle(result?.title);
  return title ? `🎬 ${title}` : `🎬 Resultado para: ${query}`;
}

module.exports = {
  name: 'clip',
  aliases: ['video', 'goku'],
  description: 'Busca clips públicos de TikTok por tema y envía el resultado más relevante',
  async execute(context) {
    const query = normalizeClipQuery((context.args || []).join(' '));
    if (!query) {
      await context.reply('⚠️ Usa: .clip <tema>\nEjemplo: .clip goles de Messi');
      return;
    }

    let candidates = [];
    try {
      candidates = await searchTikTokVideos(query);
    } catch (error) {
      context.handler.logger?.warning?.('clip search failed', { error: String(error?.message || error) });
    }

    if (!candidates.length) {
      await context.reply(`⚠️ No encontramos videos públicos para: ${query}`);
      return;
    }

    let lastError = null;
    for (const candidate of candidates.slice(0, MAX_SEARCH_RESULTS)) {
      try {
        const safe = await validateSafeUrl(candidate.url);
        if (!safe.valid) continue;

        const options = { timeout: 180000 };
        // Try download without cookies first
        const download = await downloadWithYtDlp(safe.url, context.handler.config.tempDirectory, options);
        if (!download?.filePath) throw new Error('yt-dlp no produjo archivo');

        await context.sendTempFile(download.filePath, {
          fileName: path.basename(download.filePath),
          mimeType: 'video/mp4',
          kind: 'video',
          caption: buildCaption(candidate, query)
        });
        return;
      } catch (error) {
        lastError = error;
        // Optionally log and continue to next candidate
      }
    }

    context.handler.logger?.warning?.('clip download failed', {
      error: String(lastError?.message || lastError || 'unknown')
    });
    await context.reply('⚠️ Encontramos resultados, pero no pudimos descargar un video público. Prueba con otra búsqueda.');
  },
  normalizeClipQuery,
  isTikTokVideoUrl,
  extractTikTokResultsFromHtml
};