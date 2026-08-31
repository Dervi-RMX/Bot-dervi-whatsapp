const { DEFAULT_WELCOME_MESSAGE } = require('../lib/moderation');

function usage(prefix) {
  return [
    `Uso: ${prefix}despedida`,
    `${prefix}despedida on|off|status`,
    `${prefix}despedida mensaje <texto>`,
    '',
    'Despedida automática cuando alguien sale del grupo.'
  ].join('\n');
}

module.exports = {
  name: 'despedida',
  aliases: ['goodbye'],
  groupOnly: true,
  adminOnly: true,
  description: 'Activa mensajes automáticos cuando alguien sale del grupo',
  async execute(context) {
    const args = context.args || [];
    const action = String(args[0] || '').toLowerCase();
    const moderation = context.handler.moderation;

    if (!action || action === 'on' || action === 'activar') {
      // Initialize goodbye settings if they don't exist
      await this._ensureGoodbyeSettings(context.chatId, moderation);
      const settings = moderation.setGoodbye(context.chatId, { enabled: true });
      await context.reply(`✅ Despedida activada.\nMensaje: ${settings.message}`);
      return;
    }

    if (action === 'off' || action === 'desactivar') {
      await this._ensureGoodbyeSettings(context.chatId, moderation);
      moderation.setGoodbye(context.chatId, { enabled: false });
      await context.reply('✅ Despedida desactivada para este grupo.');
      return;
    }

    if (action === 'status' || action === 'estado') {
      await this._ensureGoodbyeSettings(context.chatId, moderation);
      const settings = moderation.getGoodbye(context.chatId);
      await context.reply([
        `👋 Despedida: ${settings.enabled ? 'ACTIVADA' : 'DESACTIVADA'}`,
        `Mensaje: ${settings.message}`,
        '',
        `Para personalizar: ${context.prefix}despedida mensaje <texto>`
      ].join('\n'));
      return;
    }

    if (action === 'mensaje' || action === 'message' || action === 'texto') {
      const message = args.slice(1).join(' ').trim();
      if (!message) {
        await context.reply(`⚠️ Escribe el mensaje después de ${context.prefix}despedida mensaje.`);
        return;
      }
      await this._ensureGoodbyeSettings(context.chatId, moderation);
      const settings = moderation.setGoodbye(context.chatId, {
        enabled: true,
        message
      });
      await context.reply(`✅ Mensaje guardado y despedida activada.\nMensaje: ${settings.message}`);
      return;
    }

    await context.reply(usage(context.prefix));
  },

  async _ensureGoodbyeSettings(chatId, moderation) {
    // Ensure the chat has a goodbye object initialized
    const chat = moderation.ensureChat(chatId);
    if (!chat.goodbye) {
      chat.goodbye = { enabled: false, message: DEFAULT_WELCOME_MESSAGE };
      moderation.save();
    }
  }
};
