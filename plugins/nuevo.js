const { DEFAULT_WELCOME_MESSAGE } = require('../lib/moderation');
const path = require('path');

function usage(prefix) {
  return [
    `Uso: ${prefix}nuevo`,
    `${prefix}nuevo on|off|status`,
    `${prefix}nuevo foto <URL>`,
    `${prefix}nuevo mensaje <texto>`,
    '',
    'Usa {user} en el mensaje para mencionar automáticamente a quien entra.'
  ].join('\n');
}

module.exports = {
  name: 'nuevo',
  aliases: ['welcome', 'bienvenida'],
  groupOnly: true,
  adminOnly: true,
  description: 'Configura mensajes y fotos de bienvenida para nuevos miembros',
  async execute(context) {
    const args = context.args || [];
    const action = String(args[0] || '').toLowerCase();
    const moderation = context.handler.moderation;

    if (!action || action === 'on' || action === 'activar') {
      const settings = moderation.setWelcome(context.chatId, { enabled: true });
      await context.reply(`✅ Nuevo miembro activado.\nMensaje: ${settings.message}`);
      return;
    }

    if (action === 'off' || action === 'desactivar') {
      moderation.setWelcome(context.chatId, { enabled: false });
      await context.reply('✅ Nuevo miembro desactivado para este grupo.');
      return;
    }

    if (action === 'status' || action === 'estado') {
      const settings = moderation.getWelcome(context.chatId);
      await context.reply([
        `📣 Nuevo miembro: ${settings.enabled ? 'ACTIVADO' : 'DESACTIVADO'}`,
        `Mensaje: ${settings.message}`,
        '',
        `Para personalizar:`,
        `  ${context.prefix}nuevo foto <URL>`,
        `  ${context.prefix}nuevo mensaje <texto>`
      ].join('\n'));
      return;
    }

    if (action === 'foto') {
      const url = args.slice(1).join(' ').trim();
      if (!url) {
        await context.reply(`⚠️ Escribe la URL de la foto después de ${context.prefix}nuevo foto.`);
        return;
      }

      // Basic URL validation
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        await context.reply('⚠️ La URL debe comenzar con http:// o https://');
        return;
      }

      const settings = moderation.setWelcome(context.chatId, {
        enabled: true,
        photoUrl: url
      });
      await context.reply(`✅ Foto de bienvenida guardada y activada.\nURL: ${settings.photoUrl}`);
      return;
    }

    if (action === 'mensaje' || action === 'message' || action === 'texto') {
      const message = args.slice(1).join(' ').trim();
      if (!message) {
        await context.reply(`⚠️ Escribe el mensaje después de ${context.prefix}nuevo mensaje.`);
        return;
      }

      const settings = moderation.setWelcome(context.chatId, {
        enabled: true,
        message
      });
      await context.reply(`✅ Mensaje de bienvenida guardado y activado.\nMensaje: ${settings.message}`);
      return;
    }

    await context.reply(usage(context.prefix));
  }
};