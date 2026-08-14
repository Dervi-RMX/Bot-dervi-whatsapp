const { normalizeJid } = require('../lib/moderation');

module.exports = {
  name: 'antispam',
  aliases: [],
  description: 'Activa/desactiva antispam del grupo',
  groupOnly: true,
  adminOnly: true,
  async execute(context) {
    const [action, a2, a3] = (context.args || []).map(x => String(x || '').toLowerCase());
    const chatId = context.chatId;
    const mod = context.handler.moderation;

    if (!action || action === 'status') {
      const cfg = mod.getAntiSpam(chatId);
      await context.reply(
        [
          '🛡️ ANTI-SPAM',
          '',
          `Estado: ${cfg.enabled ? 'ON' : 'OFF'}`,
          `Ventana: ${cfg.windowSec}s`,
          `Máx mensajes: ${cfg.maxMessages}`,
          `Máx alertas: ${cfg.maxWarnings}`,
          '',
          `Uso: ${context.prefix}antispam on|off`,
          `Extra: ${context.prefix}antispam config <maxMsgs> <ventanaSeg> [maxAlertas]`
        ].join('\n')
      );
      return;
    }

    if (action === 'on') {
      const cfg = mod.setAntiSpam(chatId, { enabled: true });
      await context.reply(`✅ Anti-spam activado (${cfg.maxMessages} msgs/${cfg.windowSec}s, ${cfg.maxWarnings} alertas).`);
      return;
    }

    if (action === 'off') {
      mod.setAntiSpam(chatId, { enabled: false });
      await context.reply('✅ Anti-spam desactivado.');
      return;
    }

    if (action === 'config') {
      const maxMessages = Number.parseInt(a2, 10);
      const windowSec = Number.parseInt(a3, 10);
      const maxWarnings = Number.parseInt(context.args?.[3], 10);
      if (!Number.isFinite(maxMessages) || !Number.isFinite(windowSec)) {
        await context.reply(`⚠️ Uso: ${context.prefix}antispam config <maxMsgs> <ventanaSeg> [maxAlertas]`);
        return;
      }
      const patch = { maxMessages, windowSec };
      if (Number.isFinite(maxWarnings)) patch.maxWarnings = maxWarnings;
      const cfg = mod.setAntiSpam(chatId, patch);
      await context.reply(`✅ Config anti-spam actualizada: ${cfg.maxMessages} msgs/${cfg.windowSec}s, alertas ${cfg.maxWarnings}.`);
      return;
    }

    if (action === 'reset' && context.args?.[1]) {
      const target = normalizeJid(context.args[1].includes('@') ? context.args[1] : `${context.args[1].replace(/\D/g, '')}@s.whatsapp.net`);
      if (!target) {
        await context.reply('⚠️ Usuario inválido.');
        return;
      }
      mod.clearWarnings(chatId, target);
      await context.reply(`✅ Alertas reiniciadas para @${target.split('@')[0]}.`);
      return;
    }

    await context.reply(`⚠️ Opción inválida. Usa: ${context.prefix}antispam status|on|off|config`);
  }
};

