module.exports = {
  name: 'antilinks',
  aliases: ['antilink', 'nolinks'],
  description: 'Activa o desactiva la protección contra enlaces',
  groupOnly: true,
  adminOnly: true,
  async execute(context) {
    const action = String(context.args?.[0] || 'status').toLowerCase();
    const moderation = context.handler.moderation;

    if (action === 'on' || action === 'activar') {
      const settings = moderation.setAntiLinks(context.chatId, { enabled: true });
      await context.reply(`🔗 Anti-enlaces activado: ${settings.enabled ? 'ON' : 'OFF'}.`);
      return;
    }

    if (action === 'off' || action === 'desactivar') {
      moderation.setAntiLinks(context.chatId, { enabled: false });
      await context.reply('✅ Anti-enlaces desactivado para este grupo.');
      return;
    }

    if (action === 'status' || action === 'estado') {
      const settings = moderation.getAntiLinks(context.chatId);
      await context.reply([
        '🔗 ANTI-ENLACES',
        '',
        `Estado: ${settings.enabled ? 'ON' : 'OFF'}`,
        '',
        `Uso: ${context.prefix}antilinks on|off|status`
      ].join('\n'));
      return;
    }

    await context.reply(`⚠️ Uso: ${context.prefix}antilinks on|off|status`);
  }
};
