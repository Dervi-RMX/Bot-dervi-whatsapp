const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'menu',
  aliases: ['helpmenu'],
  description: 'Menú principal con banner estilizado',
  async execute(context) {
    const lines = [
      '╔════════════════════════════════╗',
      '║   *BOT SANDBOX* — Herramientas  ║',
      '╚════════════════════════════════╝',
      '',
      '*🤖 GENERAL*',
      '  • .help — Lista de comandos',
      '  • .menu — Este menú',
      '  • .ping — Latencia del bot',
      '  • .info — Información del mensaje citado',
      '  • .forense — Indicadores forenses (URL/archivo)',
      '  • .vt — Detector de amenazas (URL/archivo)',
      '',
      '*📷 MULTIMEDIA*',
      '  • .ver — Reenviar/mostrar contenido citado',
      '  • .descargar — Descargar contenido o URL',
      '',
      '*🎬 VIDEO*',
      '  • .tiktok — Descargar vídeo público de TikTok',
      '  • .clip <tema> — Buscar y enviar un clip por tema',
      '  • .yt — Descargar/obtener metadatos de YouTube',
      '',
      '*🎵 AUDIO*',
      '  • .spotify — Buscar/obtener enlaces de Spotify',
      '',
      '──────────────────────────────────',
      '_Responde a un mensaje (quote) y usa el comando correspondiente._',
      '',
      '_by demon_'
    ];

    const caption = lines.join('\n');

    // Prefer a local banner image if present (assets/menu-banner.webp)
    const assetPath = path.resolve(__dirname, '..', 'assets', 'menu-banner.webp');

    try {
      if (fs.existsSync(assetPath)) {
        const buffer = fs.readFileSync(assetPath);
        await context.client.sendMessage(context.chatId, { image: buffer, caption }, { quoted: context.quoted });
        return;
      }
    } catch (e) {
      // ignore and fallback to SVG
    }

    // SVG fallback with nicer gradient and title
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360">` +
      `<defs>` +
      `<linearGradient id="g" x1="0" x2="1">` +
      `<stop offset="0" stop-color="#0f172a"/>` +
      `<stop offset="1" stop-color="#0ea5a3"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="100%" height="100%" fill="url(#g)" />` +
      `<g transform="translate(40,60)">` +
      `<text x="0" y="40" font-family="Segoe UI, Arial" font-size="48" fill="#fff">BOT SANDBOX</text>` +
      `<text x="0" y="90" font-family="Segoe UI, Arial" font-size="20" fill="#cffafe">Herramientas directas desde WhatsApp</text>` +
      `</g>` +
      `</svg>`;

    const buffer = Buffer.from(svg, 'utf8');

    try {
      await context.client.sendMessage(context.chatId, { image: buffer, caption }, { quoted: context.quoted });
    } catch (e) {
      // Fall back to plain text reply if image fails
      await context.reply(caption);
    }
  }
};
