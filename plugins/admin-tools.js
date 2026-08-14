const { normalizeJid } = require('../lib/moderation');

function getMessageEntry(context) {
  const content = context.getMessageContent ? context.getMessageContent() : {};
  const type = Object.keys(content || {})[0];
  return type ? content[type] : null;
}

function extractTargetJid(context) {
  const entry = getMessageEntry(context) || {};
  const mentioned = entry?.contextInfo?.mentionedJid || [];
  if (Array.isArray(mentioned) && mentioned.length) return normalizeJid(mentioned[0]);

  const quotedParticipant = entry?.contextInfo?.participant;
  if (quotedParticipant) return normalizeJid(quotedParticipant);

  const rawArg = String(context.args?.[0] || '').trim();
  if (!rawArg) return null;
  if (rawArg.includes('@')) return normalizeJid(rawArg);
  const digits = rawArg.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

module.exports = {
  extractTargetJid
};

