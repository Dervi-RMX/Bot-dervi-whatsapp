const { extractTargetJid } = require('./admin-tools');

module.exports = {
  name: 'warn',
  aliases: [],
  description: 'Agrega una alerta manual a un usuario',
  groupOnly: true,
  adminOnly: true,
  async execute(context) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}warn <numero>`);
      return;
    }
    if (context.handler.isOwner(target) || await context.handler.isAdminInGroup(context.chatId, target)) {
      await context.reply('⚠️ No se aplican alertas a owner/admin.');
      return;
    }
    const warnings = context.handler.moderation.addWarning(context.chatId, target, 1);
    const cfg = context.handler.moderation.getAntiSpam(context.chatId);
    await context.reply(`⚠️ Alerta para @${target.split('@')[0]}: ${warnings}/${cfg.maxWarnings}`);
  }
};

