const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'help',
  aliases: [],
  description: 'Muestra ayuda del bot con categorías organizadas',
  async execute(context) {
    const config = context.handler?.config || {};
    const prefix = config.prefix || '.';

    // Load banner image from Downloads folder
    const bannerPath = path.resolve('C:\\Users\\deivi\\Downloads\\9984643a-f46c-4cc1-acbd-75eba5bde0c2.png');
    let bannerBuffer = null;

    try {
      const exists = fs.existsSync(bannerPath);
      if (exists) {
        const data = fs.readFileSync(bannerPath);
        bannerBuffer = Buffer.from(data);
      }
    } catch (e) {
      // ignore, fall back to text only
    }

    const helpText = `🤖 *bot-Dervi*\n\n` +
      `📋 Aquí tienes todos los comandos disponibles:\n\n` +
      `──────────────────────────────────\n` +
      `*🤖 GENERAL*\n` +
      `  • .ping — Latencia del bot\n` +
      `  • .status — Estado del bot\n` +
      `  • .reload — Recargar plugins\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*📷 MULTIMEDIA*\n` +
      `  • .ver — Mostrar información del contenido citado\n` +
      `  • .info — Información detallada de medios\n` +
      `  • .descargar — Descargar contenido o URL\n` +
      `  • .estado — Descargar estados de WhatsApp\n` +
      `  • .sticker — Crear stickers con emojis\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*🎬 VIDEO*\n` +
      `  • .tiktok — Descargar vídeo público de TikTok\n` +
      `  • .clip <tema> — Buscar y enviar un video público de TikTok\n` +
      `  • .yt — Descargar/obtener metadatos de YouTube\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*🎵 AUDIO*\n` +
      `  • .spotify — Metadata de Spotify\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*🔐 VINCULACIÓN*\n` +
      `  • .vincular <codigo> — Vincular este número\n` +
      `  • .codigo 1d — Acceso 1 día (propietario)\n` +
      `  • .codigo 1m — Acceso 1 mes (propietario)\n` +
      `  • .codigo 1a — Acceso 1 año (propietario)\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*🛡️ MODERACIÓN*\n` +
      `  • .antilinks / .antilink / .nolinks — Proteger enlaces en grupos\n` +
      `  • .bienvenida / .welcome — Mensajes automáticos de bienvenida\n` +
      `  • .reglas / .rules — Configurar reglas del grupo\n` +
      `  • .silenciar <usuario> [tiempo] — Silenciar usuario\n` +
      `  • .desilenciar / .unmute — Quitar silencio a un usuario\n` +
      `  • .ban <usuario> — Expulsar usuario (solo admin)\n` +
      `  • .warn <usuario> — Agregar alerta manual\n` +
      `  • .admin-tools — Herramientas administrativas\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*🔍 BÚSQUEDA Y ANÁLISIS*\n` +
      `  • .forense — Análisis forense de URLs/archivos\n` +
      `  • .vt — Consultar VirusTotal\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*💬 CHATS IA*\n` +
      `  • .chatgpt <pregunta> — Consultar ChatGPT\n` +
      `  • .gemini <pregunta> — Consultar Google Gemini\n\n` +
      `──────────────────────────────────\n` +
      `` +
      `*🧪 EXPERIMENTAL*\n` +
      `  • .canary — Funciones experimentales\n\n` +
      `💡 Escribe .<comando> para usar\n` +
      `Owner: dervi MRJUNIOR`;

    try {
      if (bannerBuffer) {
        await context.client.sendMessage(context.chatId, {
          image: bannerBuffer,
          caption: helpText,
          mentionUsername: false
        }, { quoted: context.quoted });
      } else {
        await context.reply(helpText);
      }
    } catch (e) {
      await context.reply(helpText);
    }
  }
};