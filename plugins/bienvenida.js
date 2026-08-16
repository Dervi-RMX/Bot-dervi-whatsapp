const { DEFAULT_WELCOME_MESSAGE } = require('../lib/moderation');

function usage(prefix) {
  return [
    `Uso: ${prefix}bienvenida`,
    `${prefix}bienvenida on|off|status`,
    `${prefix}bienvenida mensaje <texto>`,
    '',
    'Usa {user} para mencionar automáticamente a quien entre.'
  ].join('\n');
}

module.exports = {
  name: 'bienvenida',
  aliases: ['welcome'],
  groupOnly: true,
  adminOnly: true,
  description: 'Activa mensajes automáticos cuando alguien entra al grupo',
  async execute(context) {
    const args = context.args || [];
    const action = String(args[0] || '').toLowerCase();
    const moderation = context.handler.moderation;

    if (!action || action === 'on' || action === 'activar') {
      const settings = moderation.setWelcome(context.chatId, { enabled: true });
      await context.reply(`✅ Bienvenida activada.\nMensaje: ${settings.message}`);
      return;
    }

    if (action === 'off' || action === 'desactivar') {
      moderation.setWelcome(context.chatId, { enabled: false });
      await context.reply('✅ Bienvenida desactivada para este grupo.');
      return;
    }

    if (action === 'status' || action === 'estado') {
      const settings = moderation.getWelcome(context.chatId);
      await context.reply([
        `📣 Bienvenida: ${settings.enabled ? 'ACTIVADA' : 'DESACTIVADA'}`,
        `Mensaje: ${settings.message}`,
        '',
        `Para personalizar: ${context.prefix}bienvenida mensaje <texto>`
      ].join('\n'));
      return;
    }

    if (action === 'mensaje' || action === 'message' || action === 'texto') {
      const message = args.slice(1).join(' ').trim();
      if (!message) {
        await context.reply(`⚠️ Escribe el mensaje después de ${context.prefix}bienvenida mensaje.`);
        return;
      }
      const settings = moderation.setWelcome(context.chatId, {
        enabled: true,
        message
      });
      await context.reply(`✅ Mensaje guardado y bienvenida activada.\nMensaje: ${settings.message}`);
      return;
    }

    await context.reply(usage(context.prefix));
  },
  defaultMessage: DEFAULT_WELCOME_MESSAGE
};
