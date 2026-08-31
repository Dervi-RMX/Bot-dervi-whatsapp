const { normalizeJid } = require('../lib/moderation');

function extractTargetJid(context) {
  const getMessageEntry = (context) => {
    const content = context.getMessageContent ? context.getMessageContent() : {};
    const type = Object.keys(content || {})[0];
    return type ? content[type] : null;
  };

  const entry = getMessageEntry(context) || {};
  const mentioned = entry?.contextInfo?.mentionedJid || [];
  if (Array.isArray(mentioned) && mentioned.length) {
    const jid = normalizeJid(mentioned[0]);
    return jid || null;
  }

  const quotedParticipant = entry?.contextInfo?.participant;
  if (quotedParticipant) {
    const jid = normalizeJid(quotedParticipant);
    return jid || null;
  }

  const rawArg = String(context.args?.[0] || '').trim();
  if (!rawArg) return null;
  if (rawArg.includes('@')) {
    const jid = normalizeJid(rawArg);
    return jid || null;
  }
  const digits = rawArg.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

module.exports = {
  name: 'warn',
  aliases: [],
  description: 'Sistema de advertencias: warn, warnings, unwarn, resetwarn',
  groupOnly: true,
  adminOnly: true,
  async execute(context) {
    const args = context.args || [];
    const subcmd = String(args[0] || '').toLowerCase();
    const moderation = context.handler.moderation;

    // Determine if the first argument looks like a target (number or jid)
    const looksLikeTarget = (arg) => {
      if (!arg) return false;
      if (arg.includes('@')) return true;
      return /^\d+$/.test(arg);
    };

    // If no subcommand or subcmd looks like a target, treat as warn (add warning)
    if (!subcmd || looksLikeTarget(subcmd)) {
      return await this._addWarning(context, args, moderation);
    }

    // Subcommands
    switch (subcmd) {
      case 'warnings':
      case 'advertencias':
        return await this._checkWarnings(context, args.slice(1), moderation);
      case 'unwarn':
      case 'perdonar':
        return await this._removeWarning(context, args.slice(1), moderation);
      case 'resetwarn':
      case 'resetear':
        return await this._resetWarnings(context, args.slice(1), moderation);
      default:
        // If subcmd looks like a target, fallback to add warning
        if (looksLikeTarget(subcmd)) {
          return await this._addWarning(context, args, moderation);
        }
        await context.reply(`⚠️ Subcomando desconocido: ${subcmd}\nUso: ${context.prefix}warn [@usuario|numero]\n       ${context.prefix}warnings [@usuario]\n       ${context.prefix}unwarn [@usuario]\n       ${context.prefix}resetwarn [@usuario]`);
    }
  },

  async _addWarning(context, args, moderation) {
    // Reuse args (including first) to extract target
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}warn <numero>`);
      return;
    }
    if (context.handler.isOwner(target) || await context.handler.isAdminInGroup(context.chatId, target)) {
      await context.reply('⚠️ No se aplican alertas a owner/admin.');
      return;
    }
    const warnings = moderation.addWarning(context.chatId, target, 1);
    const cfg = moderation.getAntiSpam(context.chatId);
    await context.reply(`⚠️ Alerta para @${target.split('@')[0]}: ${warnings}/${cfg.maxWarnings}`);
  },

  async _checkWarnings(context, args, moderation) {
    let target;
    if (args.length === 0) {
      // Show warnings for the message sender
      const senderId = context.key?.participant || context.key?.sender;
      if (senderId) {
        const jid = normalizeJid(senderId);
        target = jid || null;
      }
    } else {
      target = extractTargetJid({ args: args });
    }
    if (!target) {
      await context.reply(`⚠️ Especifica un usuario: ${context.prefix}warnings @usuario`);
      return;
    }
    const warnings = moderation.getWarnings(context.chatId, target);
    await context.reply(`⚠️ Advertencias para @${target.split('@')[0]}: ${warnings}`);
  },

  async _removeWarning(context, args, moderation) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}unwarn <numero>`);
      return;
    }
    const before = moderation.getWarnings(context.chatId, target);
    // Remove all warnings for this user
    moderation.addWarning(context.chatId, target, -9999);
    const after = moderation.getWarnings(context.chatId, target);
    await context.reply(`✅ Advertencias para @${target.split('@')[0]} reducidas de ${before} a ${after}.`);
  },

  async _resetWarnings(context, args, moderation) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}resetwarn <numero>`);
      return;
    }
    moderation.addWarning(context.chatId, target, -9999);
    const after = moderation.getWarnings(context.chatId, target);
    await context.reply(`✅ Advertencias para @${target.split('@')[0]} reseteadas a ${after}.`);
  }
};