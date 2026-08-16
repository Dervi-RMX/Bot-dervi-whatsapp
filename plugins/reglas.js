module.exports = {
  name: 'reglas',
  aliases: ['rules', 'regla'],
  description: 'Muestra y configura las reglas del grupo',
  groupOnly: true,
  async execute(context) {
    const args = context.args || [];
    const action = String(args[0] || 'show').toLowerCase();
    const moderation = context.handler.moderation;
    const canManage = Boolean(context.isOwner || context.isAdmin);

    if (['set', 'establecer', 'mensaje', 'editar', 'on', 'activar', 'off', 'desactivar'].includes(action) && !canManage) {
      await context.reply('⛔ Solo administradores pueden modificar las reglas del grupo.');
      return;
    }

    if (action === 'set' || action === 'establecer' || action === 'mensaje' || action === 'editar') {
      const message = args.slice(1).join(' ').trim();
      if (!message) {
        await context.reply(`⚠️ Uso: ${context.prefix}reglas set <texto de las reglas>`);
        return;
      }
      const settings = moderation.setRules(context.chatId, { enabled: true, message });
      await context.reply(`✅ Reglas guardadas y activadas.\n\n${settings.message}`);
      return;
    }

    if (action === 'on' || action === 'activar') {
      const settings = moderation.setRules(context.chatId, { enabled: true });
      await context.reply(`✅ Reglas activadas.\n\n${settings.message}`);
      return;
    }

    if (action === 'off' || action === 'desactivar') {
      moderation.setRules(context.chatId, { enabled: false });
      await context.reply('✅ Reglas desactivadas. El texto se conservará para volver a activarlo.');
      return;
    }

    const settings = moderation.getRules(context.chatId);
    if (!settings.enabled) {
      await context.reply(`📜 Las reglas no están configuradas.\nUn administrador puede usar: ${context.prefix}reglas set <texto>`);
      return;
    }
    await context.reply(`📜 REGLAS DEL GRUPO\n\n${settings.message}`);
  }
};
