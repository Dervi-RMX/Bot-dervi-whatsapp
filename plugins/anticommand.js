module.exports = {
  name: 'anticommand',
  aliases: ['anticmd'],
  description: 'Bloquea los comandos para todos excepto el OWNER en este chat',
  category: 'moderation',
  ownerOnly: true,
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const action = String(context.args?.[0] || 'status').toLowerCase();
    const moderation = context.handler.moderation;

    if (action === 'on' || action === 'activar') {
      moderation.setAntiCommand(context.chatId, { enabled: true });
      await context.reply('🔒 Anti-comandos activado en este chat. Solo el OWNER puede ejecutar comandos.');
      return;
    }

    if (action === 'off' || action === 'desactivar') {
      moderation.setAntiCommand(context.chatId, { enabled: false });
      await context.reply('🔓 Anti-comandos desactivado en este chat.');
      return;
    }

    if (action === 'status' || action === 'estado') {
      const settings = moderation.getAntiCommand(context.chatId);
      await context.reply([
        '🔐 ANTI-COMANDOS',
        '',
        `Estado: ${settings.enabled ? 'ACTIVADO' : 'DESACTIVADO'}`,
        `Acceso: ${settings.enabled ? 'Solo OWNER' : 'Usuarios autorizados'}`,
        '',
        `Uso: ${context.prefix}anticommand on|off|status`
      ].join('\n'));
      return;
    }

    await context.reply(`⚠️ Uso: ${context.prefix}anticommand on|off|status`);
  }
};
