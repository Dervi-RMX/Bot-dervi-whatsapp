const fs = require('fs');
const path = require('path');
const { downloadWithYtDlp } = require('../lib/downloader');
const { validateSafeUrl } = require('../lib/utils');

function decodeDuckHref(href) {
  if (!href) return null;
  const raw = String(href).replace(/&amp;/g, '&');
  try {
    if (raw.startsWith('/l/?') || raw.startsWith('https://duckduckgo.com/l/?') || raw.startsWith('//duckduckgo.com/l/?')) {
      const absolute = raw.startsWith('http') ? raw : `https://duckduckgo.com${raw.startsWith('/') ? '' : '/'}${raw}`;
      const u = new URL(absolute);
      const target = u.searchParams.get('uddg');
      if (target) return decodeURIComponent(target);
    }
  } catch {}
  if (/^https?:\/\//i.test(raw)) return raw;
  return null;
}

function extractTikTokUrlsFromHtml(html) {
  const urls = new Set();
  const hrefRegex = /href="([^"]+)"/gi;
  let m = null;
  while ((m = hrefRegex.exec(html))) {
    const url = decodeDuckHref(m[1]);
    if (!url) continue;
    if (!/tiktok\.com/i.test(url)) continue;
    if (!/\/video\/\d+/i.test(url) && !/vt\.tiktok\.com/i.test(url) && !/vm\.tiktok\.com/i.test(url)) continue;
    urls.add(url);
    if (urls.size >= 25) break;
  }
  return Array.from(urls);
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function searchTikTokVideos(query) {
  const q = encodeURIComponent(`site:tiktok.com ${query}`);
  const url = `https://duckduckgo.com/html/?q=${q}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`search failed (${response.status})`);
  const html = await response.text();
  return extractTikTokUrlsFromHtml(html);
}

module.exports = {
  name: 'clip',
  aliases: ['video', 'goku'],
  description: 'Busca clips por tema y envía un video directamente',
  async execute(context) {
    const query = (context.args || []).join(' ').trim();
    if (!query) {
      await context.reply('⚠️ Usa: .clip <tema>\nEjemplo: .clip goku');
      return;
    }

    let candidates = [];
    try {
      candidates = await searchTikTokVideos(query);
    } catch (error) {
      context.handler.logger?.warning?.('clip search failed', { error: String(error?.message || error) });
    }

    if (!candidates.length) {
      await context.reply('⚠️ No encontré clips para ese tema. Prueba con otra palabra.');
      return;
    }

    const cookiesPath = path.join(context.handler.config.tempDirectory || 'tmp', 'cookies.txt');
    const cookiesExist = fs.existsSync(cookiesPath);
    const ordered = shuffle(candidates).slice(0, 8);

    let lastError = null;
    for (const candidate of ordered) {
      try {
        const safe = await validateSafeUrl(candidate);
        if (!safe.valid) continue;
        const opts = { timeout: 180000 };
        if (cookiesExist) opts.cookies = cookiesPath;
        const dl = await downloadWithYtDlp(safe.url, context.handler.config.tempDirectory, opts);
        if (!dl?.filePath) throw new Error('sin archivo');

        await context.sendTempFile(dl.filePath, {
          fileName: path.basename(dl.filePath),
          mimeType: 'video/mp4',
          kind: 'video'
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    context.handler.logger?.warning?.('clip download failed', { error: String(lastError?.message || lastError || 'unknown') });
    await context.reply('⚠️ No fue posible enviar un clip ahora. Intenta de nuevo en unos segundos.');
  }
};

