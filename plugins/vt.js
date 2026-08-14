const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadQuotedMedia } = require('../lib/downloader');
const { extractUrls, validateSafeUrl, formatBytes } = require('../lib/utils');

function b64UrlNoPad(input) {
  return Buffer.from(String(input), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function vtRequest(endpoint, options = {}) {
  const response = await fetch(`https://www.virustotal.com/api/v3${endpoint}`, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { ok: response.ok, status: response.status, data, text };
}

function normalizeStats(stats = {}) {
  const malicious = Number(stats.malicious || 0);
  const suspicious = Number(stats.suspicious || 0);
  const harmless = Number(stats.harmless || 0);
  const undetected = Number(stats.undetected || 0);
  const timeout = Number(stats.timeout || 0);
  const failure = Number(stats.failure || 0);
  return { malicious, suspicious, harmless, undetected, timeout, failure };
}

function verdictFromStats(stats = {}) {
  const s = normalizeStats(stats);
  if (s.malicious > 0) return { icon: '🔴', label: 'Peligroso' };
  if (s.suspicious > 0) return { icon: '🟠', label: 'Sospechoso' };
  if (s.harmless > 0 && s.malicious === 0 && s.suspicious === 0) return { icon: '🟢', label: 'Sin detecciones' };
  return { icon: '🟡', label: 'Sin veredicto suficiente' };
}

function renderStats(stats = {}) {
  const s = normalizeStats(stats);
  return [
    `🔴 Malicious: ${s.malicious}`,
    `🟠 Suspicious: ${s.suspicious}`,
    `🟢 Harmless: ${s.harmless}`,
    `⚪ Undetected: ${s.undetected}`,
    `⏱️ Timeout: ${s.timeout}`,
    `❌ Failure: ${s.failure}`
  ];
}

function buildReportCard(title, fields = [], stats = null, reportUrl = null) {
  const lines = [
    '╔════ 🛡️ DETECTOR DE AMENAZAS ════╗',
    `║ ${title}`,
    '╚════════════════════════════════╝',
    ''
  ];

  for (const field of fields) {
    if (!field) continue;
    lines.push(field);
  }

  if (stats) {
    const verdict = verdictFromStats(stats);
    lines.push('', `Veredicto: ${verdict.icon} ${verdict.label}`, ...renderStats(stats));
  }

  if (reportUrl) {
    lines.push('', `🔗 Reporte: ${reportUrl}`);
  }

  return lines.join('\n');
}

async function pollAnalysis(apiKey, analysisId) {
  const maxPoll = 8;
  for (let i = 0; i < maxPoll; i += 1) {
    const res = await vtRequest(`/analyses/${analysisId}`, {
      method: 'GET',
      headers: { 'x-apikey': apiKey }
    });
    if (!res.ok) return res;
    const status = res.data?.data?.attributes?.status;
    if (status === 'completed') return res;
    await new Promise(r => setTimeout(r, 1400));
  }
  return vtRequest(`/analyses/${analysisId}`, {
    method: 'GET',
    headers: { 'x-apikey': apiKey }
  });
}

async function analyzeUrl(apiKey, url) {
  const body = new URLSearchParams({ url });
  const submit = await vtRequest('/urls', {
    method: 'POST',
    headers: {
      'x-apikey': apiKey,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  if (!submit.ok) return { error: `VT URL submit failed (${submit.status})` };

  const analysisId = submit.data?.data?.id;
  const analysis = analysisId ? await pollAnalysis(apiKey, analysisId) : null;
  const stats = analysis?.data?.data?.attributes?.stats || {};
  const permalink = `https://www.virustotal.com/gui/url/${b64UrlNoPad(url)}`;

  return { stats, permalink };
}

async function findFileByHash(apiKey, sha256) {
  const res = await vtRequest(`/files/${sha256}`, {
    method: 'GET',
    headers: { 'x-apikey': apiKey }
  });
  if (res.ok) {
    return {
      found: true,
      stats: res.data?.data?.attributes?.last_analysis_stats || {},
      permalink: `https://www.virustotal.com/gui/file/${sha256}`
    };
  }
  if (res.status === 404) return { found: false };
  return { error: `VT file lookup failed (${res.status})` };
}

async function uploadFileToVt(apiKey, filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), path.basename(filePath));
  const submit = await vtRequest('/files', {
    method: 'POST',
    headers: { 'x-apikey': apiKey },
    body: form
  });
  if (!submit.ok) return { error: `VT file upload failed (${submit.status})` };
  const analysisId = submit.data?.data?.id;
  if (!analysisId) return { error: 'VT no devolvió analysis id' };
  const analysis = await pollAnalysis(apiKey, analysisId);
  if (!analysis.ok) return { error: `VT analysis failed (${analysis.status})` };
  return { stats: analysis.data?.data?.attributes?.stats || {} };
}

module.exports = {
  name: 'vt',
  aliases: ['virustotal'],
  description: 'Analiza URL o archivo citado con detector de amenazas',
  async execute(context) {
    const apiKey = process.env.VT_API_KEY || '';
    const allowUpload = String(process.env.VT_ALLOW_UPLOAD || 'false').toLowerCase() === 'true';

    if (!apiKey) {
      await context.reply('⚠️ Falta VT_API_KEY en .env para usar Detector de Amenazas.');
      return;
    }

    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const maybeUrl = urls[0] || null;

    if (maybeUrl) {
      const safe = await validateSafeUrl(maybeUrl);
      if (!safe.valid) {
        await context.reply('⚠️ URL no segura o bloqueada.');
        return;
      }
      const result = await analyzeUrl(apiKey, safe.url);
      if (result.error) {
        await context.reply('⚠️ No fue posible consultar el Detector de Amenazas.');
        return;
      }
      await context.reply(
        buildReportCard(
          'Análisis de URL',
          [`🌐 URL: ${safe.url}`],
          result.stats,
          result.permalink
        )
      );
      return;
    }

    if (!['image', 'video', 'audio', 'document', 'sticker'].includes(detection.type)) {
      await context.reply('⚠️ Responde a una URL o a un archivo (PDF, imagen, video, audio, etc.) y usa .vt');
      return;
    }

    const sourceMessage = detection.source === 'quoted-message' ? detection.message : context.message;
    const filePath = await downloadQuotedMedia(sourceMessage, context.handler.config.tempDirectory);
    try {
      const stat = await fs.promises.stat(filePath).catch(() => null);
      const sha256 = await sha256File(filePath);
      const lookup = await findFileByHash(apiKey, sha256);

      if (lookup.error) {
        await context.reply('⚠️ No fue posible consultar el Detector de Amenazas.');
        return;
      }

      if (lookup.found) {
        await context.reply(
          buildReportCard(
            'Archivo (existente en VT)',
            [
              `📌 SHA256: ${sha256}`,
              stat ? `📦 Tamaño: ${formatBytes(stat.size)}` : null
            ],
            lookup.stats,
            lookup.permalink
          )
        );
        return;
      }

      if (!allowUpload) {
        await context.reply(
          [
            '🛡️ DETECTOR DE AMENAZAS (ARCHIVO)',
            '',
            `SHA256: ${sha256}`,
            'No existe análisis previo.',
            'Para subir y escanear automáticamente habilita VT_ALLOW_UPLOAD=true en .env'
          ].join('\n')
        );
        return;
      }

      if (stat && stat.size > 32 * 1024 * 1024) {
        await context.reply('⚠️ Archivo >32MB. VT API simple no permite subirlo por este flujo.');
        return;
      }

      const upload = await uploadFileToVt(apiKey, filePath);
      if (upload.error) {
        await context.reply('⚠️ No fue posible subir el archivo al Detector de Amenazas.');
        return;
      }

      await context.reply(
        buildReportCard(
          'Archivo subido y escaneado',
          [
            `📌 SHA256: ${sha256}`,
            stat ? `📦 Tamaño: ${formatBytes(stat.size)}` : null
          ],
          upload.stats,
          `https://www.virustotal.com/gui/file/${sha256}`
        )
      );
    } finally {
      await fs.promises.unlink(filePath).catch(() => null);
    }
  }
};
