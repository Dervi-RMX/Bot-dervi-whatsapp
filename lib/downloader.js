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
const { getStatsManager } = require('./stats');
const stats = getStatsManager();
const MAX_ACTIVE_DOWNLOADS = 3;
let activeDownloads = 0;
const waitingDownloads = [];

async function acquireDownloadSlot() {
  if (activeDownloads < MAX_ACTIVE_DOWNLOADS) {
    activeDownloads += 1;
    return;
  }
  await new Promise(resolve => waitingDownloads.push(resolve));
  activeDownloads += 1;
}

function releaseDownloadSlot() {
  activeDownloads = Math.max(0, activeDownloads - 1);
  const next = waitingDownloads.shift();
  if (next) next();
}
let bundledFfmpeg = null;
try {
  bundledFfmpeg = require('ffmpeg-static');
} catch {
  bundledFfmpeg = null;
}
const localFfmpeg = path.join(
  __dirname,
  '..',
  'bin',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);
if (fs.existsSync(localFfmpeg)) bundledFfmpeg = localFfmpeg;

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
  try {
    const content = message?.message || message || {};
  const type = Object.keys(content)[0];
  if (!type) throw new Error('Contenido no soportado');

  const media = content[type];
  const mediaType = type.replace('Message', '').toLowerCase();
  const stream = await downloadContentFromMessage(media, mediaType);
  const buffer = await streamToBuffer(stream);
    const result = await writeBufferToTemp(buffer, tempDir, media?.mimetype, media?.fileName);
    stats.recordDownload(true);
    return result;
  } catch (error) {
    stats.recordDownload(false);
    stats.recordError();
    throw error;
  }
}

async function downloadUrlToTempFile(url, tempDir, options = {}) {
  try {
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
  const result = {
    filePath: fileName,
    mimeType: contentType.split(';')[0].trim(),
    kind: inferKindFromMime(contentType),
    sourceUrl: currentUrl
  };
    stats.recordDownload(true);
    return result;
  } catch (error) {
    stats.recordDownload(false);
    stats.recordError();
    throw error;
  }
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
  await acquireDownloadSlot();
  try {
  ensureDir(tempDir);
  const base = randomId(8);
  const template = `${base}.%(ext)s`;
  const outPath = path.join(tempDir, template);
  const timeoutMs = options.timeout || 180000; // default 3 min

  // Resolve a bundled or automatically prepared yt-dlp binary.
  let ytdlpCmd = 'yt-dlp';
  try {
    const candidates = process.platform === 'win32'
      ? [
          path.join(__dirname, '..', 'bin', 'yt-dlp.exe'),
          path.join(process.cwd(), 'yt-dlp.exe'),
          path.join(__dirname, '..', 'yt-dlp.exe')
        ]
      : [
          path.join(__dirname, '..', 'bin', process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'),
          'yt-dlp'
        ];
    const local = candidates.find(candidate => candidate === 'yt-dlp' || fs.existsSync(candidate));
    if (local) ytdlpCmd = local;
    if (ytdlpCmd !== 'yt-dlp') {
      const runtimeTemp = path.resolve(tempDir);
      ensureDir(runtimeTemp);
      process.env.TMPDIR = runtimeTemp;
      process.env.TMP = runtimeTemp;
      process.env.TEMP = runtimeTemp;
    }
  } catch (error) {
    throw new Error(`No se pudo localizar yt-dlp: ${error.message}`);
  }

  // Add JavaScript runtime support for YouTube (required since yt-dlp deprecated JS runtime-less extraction)
  // Use JSEngine if no explicit runtime specified in options
  const jsRuntime = options.jsRuntimes ? options.jsRuntimes : [];
  const jsRuntimeArgs = jsRuntime.flatMap(runtime => ['--js-runtimes', runtime]);

  // preferred args: let yt-dlp choose formats and include headers that mimic a browser
  const baseArgs = ['--no-playlist', '--restrict-filenames', '--no-warnings'];
  const audioArgs = options.audioOnly && options.convertAudio !== false
    ? [
      '-x',
      '--audio-format',
      options.audioFormat || 'mp3',
      '--audio-quality',
      options.audioQuality || '0'
    ]
    : [];
  const speedArgs = options.concurrentFragments
    ? ['--concurrent-fragments', String(Math.max(1, Number(options.concurrentFragments) || 1))]
    : [];
  const metadataArgs = options.printMetadata ? ['--print-json'] : [];
  const reliabilityArgs = [
    '--retries', String(Math.max(1, Number(options.retries) || 1)),
    '--fragment-retries', String(Math.max(1, Number(options.fragmentRetries) || 1)),
    '--socket-timeout', String(Math.max(5, Number(options.socketTimeout) || 20)),
    '--no-part',
    '--no-continue',
    '--force-overwrites'
  ];
  const commonArgs = [...baseArgs, ...speedArgs, ...reliabilityArgs, ...audioArgs, ...metadataArgs, '-o', outPath, url];
  const headerUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const headerArgs = ['--add-header', `User-Agent: ${headerUA}`];
  const ffmpegPath = options.ffmpegLocation || bundledFfmpeg;
  const ffmpegArgs = ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : [];
  const audioExtractorArgs = options.audioOnly
    ? ['--extractor-args', 'youtube:player_client=android']
    : [];

  // Merge output format if specified (e.g., mp4)
  const mergeFormat = options.mergeOutputFormat;
  if (mergeFormat) {
    commonArgs.push('--merge-output-format', mergeFormat);
  }

  // try list of arg sets until one succeeds
  // build attempts; include cookies if provided in options
  const cookieArgs = options.cookies ? ['--cookies', options.cookies] : [];
  const attemptTemplates = [
    // attempt 1: with browser-like headers + JS runtime
    [...headerArgs, ...ffmpegArgs, ...audioExtractorArgs, ...jsRuntimeArgs, ...commonArgs],
    // attempt 2: without headers but with JS runtime
    [...ffmpegArgs, ...audioExtractorArgs, ...jsRuntimeArgs, ...commonArgs],
    // attempt 3: direct format fallback when extraction/conversion is unavailable
    options.audioOnly
      ? ['-f', 'bestaudio/best', ...ffmpegArgs, ...audioExtractorArgs, ...jsRuntimeArgs, ...commonArgs]
      : ['-f', 'b', ...ffmpegArgs, ...jsRuntimeArgs, ...baseArgs, '-o', outPath, url]
  ];
  if (options.audioOnly) {
    // If ffmpeg is unavailable, send the source audio instead of failing completely.
    attemptTemplates.push([
      '-f',
      'bestaudio/best',
      ...ffmpegArgs,
      ...audioExtractorArgs,
      ...jsRuntimeArgs,
      ...baseArgs,
      '-o',
      outPath,
      url
    ]);
  }

  // probe available formats to pick a faster/smaller one (prefer mp4 <=480p)
  let preferredFormat = null;
  try {
    if (options.audioOnly) throw new Error('skip video format probe');
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
    // If user provided a format option, use it; otherwise use preferredFormat if available
    const formatArg = options.format;
    if (formatArg) {
      baseArgs.push('-f', formatArg);
    } else if (preferredFormat && !options.audioOnly) {
      // pick explicit format to accelerate download
      baseArgs.push('-f', preferredFormat);
    }
    baseArgs.push(...t);
    return baseArgs;
  }).slice(0, Math.max(1, Number(options.maxAttempts) || attemptTemplates.length));

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
      const extension = path.extname(filePath).toLowerCase();
      const mimeType = extension === '.mp3'
        ? 'audio/mpeg'
        : extension === '.m4a'
          ? 'audio/mp4'
          : extension === '.opus'
            ? 'audio/ogg; codecs=opus'
            : extension === '.webm'
              ? (options.audioOnly ? 'audio/webm' : 'video/webm')
              : extension === '.mp4'
                ? 'video/mp4'
                : undefined;
      stats.recordDownload(true);
      let metadata = null;
      if (options.printMetadata) {
        const jsonLines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        for (let index = jsonLines.length - 1; index >= 0; index -= 1) {
          try {
            const parsed = JSON.parse(jsonLines[index]);
            if (parsed && typeof parsed === 'object') {
              metadata = parsed;
              break;
            }
          } catch {
            // yt-dlp may print progress lines before the final JSON object.
          }
        }
      }
      return { filePath, size: bestSize, mimeType, metadata };
    } catch (err) {
      lastErr = err;
      // Remove partial files before retrying or reporting the failure.
      const partialFiles = await fs.promises.readdir(tempDir).catch(() => []);
      await Promise.all(
        partialFiles
          .filter(file => file.startsWith(base))
          .map(file => fs.promises.unlink(path.join(tempDir, file)).catch(() => null))
      );
    }
  }

    throw lastErr || new Error('yt-dlp failed');
  } catch (error) {
    stats.recordDownload(false);
    stats.recordError();
    throw error;
  } finally {
    releaseDownloadSlot();
  }
}

module.exports = {
  writeBufferToTemp,
  downloadQuotedMedia,
  downloadUrlToTempFile,
  cleanupTempFiles,
  downloadWithYtDlp
};
