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
  name: 'ppt',
  aliases: ['piedrapapeltijera'],
  description: 'Juego de piedra, papel o tijera: .ppt <piedra|papel|tijera> o .ppt para jugar aleatoriamente',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const choice = String(args[0] || '').toLowerCase();

    // Valid choices
    const validChoices = ['piedra', 'papel', 'tijera'];
    const choiceMap = {
      'piedra': '🪨 Piedra',
      'papel': '📄 Papel',
      'tijera': '✂️ Tijera'
    };

    // If no choice provided, show a random result
    if (!choice) {
      const randomChoice = validChoices[Math.floor(Math.random() * validChoices.length)];
      await context.reply(choiceMap[randomChoice]);
      return;
    }

    // Validate choice
    if (!validChoices.includes(choice)) {
      await context.reply(`⚠️ Opción inválida: ${choice}\n` +
        `Opciones válidas: piedra, papel, tijera`);
      return;
    }

    // Bot's random choice
    const botChoice = validChoices[Math.floor(Math.random() * validChoices.length)];

    // Determine winner
    let result;
    if (choice === botChoice) {
      result = '🤝 ¡Empate! Ambos elegimos ' + choiceMap[choice];
    } else if (
      (choice === 'piedra' && botChoice === 'tijera') ||
      (choice === 'papel' && botChoice === 'piedra') ||
      (choice === 'tijera' && botChoice === 'papel')
    ) {
      result = `🎉 ¡Ganaste! Tú elegiste ${choiceMap[choice]} y yo ${choiceMap[botChoice]}`;
    } else {
      result = `😢 ¡Perdí! Tú elegiste ${choiceMap[choice]} y yo ${choiceMap[botChoice]}`;
    }

    await context.reply(result);
  }
};