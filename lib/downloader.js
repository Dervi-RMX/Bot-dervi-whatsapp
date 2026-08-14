const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const {
  ensureDir,
  randomId,
  sanitizeFileName,
  validateSafeUrl,
  getFileExtensionFromMime,
  safeJoin
} = require('./utils');
const { inferKindFromMime } = require('./media');

async function writeBufferToTemp(buffer, tempDir, mimetype, fileName) {
  ensureDir(tempDir);
  const ext = getFileExtensionFromMime(mimetype) || path.extname(fileName || '') || '';
  const finalName = `${randomId(8)}${ext}`;
  const filePath = safeJoin(tempDir, finalName);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadQuotedMedia(message, tempDir) {
  const content = message?.message || message || {};
  const type = Object.keys(content)[0];
  if (!type) throw new Error('Contenido no soportado');

  const media = content[type];
  const mediaType = type.replace('Message', '').toLowerCase();
  const stream = await downloadContentFromMessage(media, mediaType);
  const buffer = await streamToBuffer(stream);
  return writeBufferToTemp(buffer, tempDir, media?.mimetype, media?.fileName);
}

async function downloadUrlToTempFile(url, tempDir, options = {}) {
  const validation = await validateSafeUrl(url);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  ensureDir(tempDir);
  const maxBytes = Math.max(1, Number(options.maxBytes || 100) * 1024 * 1024);
  let currentUrl = validation.url;
  let response = null;

  for (let redirect = 0; redirect < 4; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'BOT-SANDBOX/1.0'
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirección inválida');
      const next = new URL(location, currentUrl).toString();
      const safe = await validateSafeUrl(next);
      if (!safe.valid) throw new Error(safe.reason);
      currentUrl = safe.url;
      continue;
    }

    break;
  }

  if (!response || !response.ok) {
    throw new Error(`No se pudo descargar el contenido (${response?.status || 'sin respuesta'})`);
  }

  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    throw new Error('El archivo supera el límite permitido');
  }

  const contentType = response.headers.get('content-type') || '';
  const ext = getFileExtensionFromMime(contentType.split(';')[0].trim()) || path.extname(new URL(currentUrl).pathname) || '';
  const fileName = safeJoin(tempDir, `${randomId(8)}${ext || '.bin'}`);

  let downloaded = 0;
  const stream = Readable.fromWeb(response.body);
  const counter = new (require('stream').Transform)({
    transform(chunk, encoding, callback) {
      downloaded += chunk.length;
      if (downloaded > maxBytes) {
        callback(new Error('El archivo supera el límite permitido'));
        return;
      }
      callback(null, chunk);
    }
  });

  await pipeline(stream, counter, fs.createWriteStream(fileName));
  return {
    filePath: fileName,
    mimeType: contentType.split(';')[0].trim(),
    kind: inferKindFromMime(contentType),
    sourceUrl: currentUrl
  };
}

async function cleanupTempFiles(tempDir, maxAgeMs = 30 * 60 * 1000) {
  ensureDir(tempDir);
  const files = await fs.promises.readdir(tempDir).catch(() => []);
  const now = Date.now();
  await Promise.all(files.map(async file => {
    const full = safeJoin(tempDir, file);
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) return;
    if (now - stat.mtimeMs > maxAgeMs) {
      await fs.promises.unlink(full).catch(() => null);
    }
  }));
}

const { spawn } = require('child_process');

async function downloadWithYtDlp(url, tempDir, options = {}) {
  ensureDir(tempDir);
  const base = randomId(8);
  const template = `${base}.%(ext)s`;
  const outPath = path.join(tempDir, template);
  const timeoutMs = options.timeout || 180000; // default 3 min

  // resolve yt-dlp binary: prefer bundled yt-dlp.exe in project root or repo, otherwise rely on PATH
  let ytdlpCmd = 'yt-dlp';
  try {
    const candidates = [
      path.join(process.cwd(), 'yt-dlp.exe'),
      path.join(__dirname, '..', 'yt-dlp.exe'),
      path.join(__dirname, '..', 'yt-dlp')
    ];
    for (const cand of candidates) {
      if (process.platform === 'win32' && fs.existsSync(cand)) { ytdlpCmd = cand; break; }
      if (process.platform !== 'win32' && fs.existsSync(cand)) { ytdlpCmd = cand; break; }
    }
  } catch (e) {}

  // preferred args: let yt-dlp choose formats and include headers that mimic a browser
  const commonArgs = ['--no-playlist', '--restrict-filenames', '--no-warnings', '-o', outPath, url];
  const headerUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const headerArgs = ['--add-header', `User-Agent: ${headerUA}`, '--add-header', 'Referer: https://www.tiktok.com/'];

  // try list of arg sets until one succeeds
  // build attempts; include cookies if provided in options
  const cookieArgs = options.cookies ? ['--cookies', options.cookies] : [];
  const attemptTemplates = [
    // attempt 1: with browser-like headers
    headerArgs.concat(commonArgs),
    // attempt 2: without headers
    commonArgs,
    // attempt 3: with explicit format fallback ('b' selects best pre-merged when appropriate)
    ['-f', 'b', '--no-playlist', '--restrict-filenames', '-o', outPath, url]
  ];

  // probe available formats to pick a faster/smaller one (prefer mp4 <=480p)
  let preferredFormat = null;
  try {
    const probeArgs = ['-J', '--no-warnings', '--no-playlist', url];
    const probeProc = spawn(ytdlpCmd, probeArgs, { windowsHide: true });
    let probeOut = '';
    let probeErr = '';
    const probePromise = new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        try { probeProc.kill(); } catch (e) {}
        resolve(null); // timeout probing — ignore
      }, 5000); // short probe timeout 5s
      probeProc.stdout?.on('data', d => { probeOut += d.toString(); });
      probeProc.stderr?.on('data', d => { probeErr += d.toString(); });
      probeProc.on('close', code => {
        clearTimeout(to);
        if (!probeOut) return resolve(null);
        try {
          const info = JSON.parse(probeOut);
          const fmts = info.formats || [];
          // prefer mp4 formats with height <=480, choose highest height under limit
          const candidates = fmts.filter(f => (f.ext === 'mp4' || (f.acodec && f.vcodec)) && f.height && f.height <= 480 && (f.protocol || '').startsWith('http'))
            .sort((a, b) => (b.height || 0) - (a.height || 0));
          if (candidates.length) preferredFormat = candidates[0].format_id;
          else {
            // fallback: choose smallest filesize_approx or filesize
            const withSize = fmts.filter(f => f.filesize_approx || f.filesize).sort((a, b) => ( (a.filesize_approx||a.filesize||Number.MAX_SAFE_INTEGER) - (b.filesize_approx||b.filesize||Number.MAX_SAFE_INTEGER) ));
            if (withSize.length) preferredFormat = withSize[0].format_id;
          }
        } catch (e) {
          // ignore parse errors
        }
        resolve(true);
      });
    });
    await probePromise;
  } catch (e) {
    // ignore probe errors
  }

  // incorporate preferred format into attempt templates if found
  const attempts = attemptTemplates.map(t => {
    const baseArgs = [];
    if (cookieArgs.length) baseArgs.push(...cookieArgs);
    if (preferredFormat) {
      // pick explicit format to accelerate download
      baseArgs.push('-f', preferredFormat);
    }
    baseArgs.push(...t);
    return baseArgs;
  });

  let lastErr = null;
  for (const args of attempts) {
    // spawn process and capture output
    const proc = spawn(ytdlpCmd, args, { windowsHide: true });
    let killed = false;
    let stderr = '';
    let stdout = '';

    const pidPromise = new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        killed = true;
        try { proc.kill(); } catch (e) {}
        reject(new Error('yt-dlp timeout'));
      }, timeoutMs);

      proc.on('error', err => {
        clearTimeout(to);
        reject(err);
      });
      proc.stdout?.on('data', d => { stdout += d.toString(); });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        clearTimeout(to);
        if (killed) return; // already rejected
        if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${stderr.split('\n').slice(-3).join(' | ')}`));
        resolve({ stdout, stderr });
      });
    });

    try {
      await pidPromise;
      // success — find produced file(s)
      const files = await fs.promises.readdir(tempDir).catch(() => []);
      const matched = files.filter(f => f.startsWith(base));
      if (!matched.length) throw new Error('yt-dlp no produjo archivo');
      // pick largest
      let best = matched[0];
      let bestSize = 0;
      for (const f of matched) {
        const stat = await fs.promises.stat(path.join(tempDir, f)).catch(() => null);
        if (stat && stat.size > bestSize) { best = f; bestSize = stat.size; }
      }
      const filePath = path.join(tempDir, best);
      return { filePath, size: bestSize };
    } catch (err) {
      lastErr = err;
      // try next attempt
    }
  }

  throw lastErr || new Error('yt-dlp failed');
}

module.exports = {
  writeBufferToTemp,
  downloadQuotedMedia,
  downloadUrlToTempFile,
  cleanupTempFiles,
  downloadWithYtDlp
};
