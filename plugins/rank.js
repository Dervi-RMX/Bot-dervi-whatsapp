const { createDataStore } = require('../lib/data-store');

const dataStore = createDataStore();

function loadXPData() {
  try {
    return dataStore.read('xp.json', {});
  } catch (error) {
    console.error('Error loading XP data:', error);
    return {};
  }
}

function calculateLevel(xp) {
  return Math.floor(Math.sqrt(xp / 10));
}

module.exports = {
  name: 'rank',
  aliases: ['ranking', 'top'],
  description: 'Ranking de usuarios por XP: .rank (top 10 global)',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const xpData = loadXPData();
    const users = Object.entries(xpData).map(([jid, data]) => ({
      jid,
      xp: data.xp || 0,
      level: data.level || 0
    }));

    // Sort by XP descending
    users.sort((a, b) => b.xp - a.xp);

    // Take top 10
    const topUsers = users.slice(0, 10);

    if (topUsers.length === 0) {
      await context.reply(`📊 No hay datos de XP para mostrar.`);
      return;
    }

    let replyText = `🏆 *RANKING DE XP*\n\n`;
    topUsers.forEach((user, index) => {
      let medal = '';
      if (index === 0) medal = '🥇 ';
      else if (index === 1) medal = '🥈 ';
      else if (index === 2) medal = '🥉 ';
      else medal = `${index + 1}. `;

      // Try to get pushname
      let pushname = user.jid;
      try {
        if (context.handler.client && context.handler.client.contacts) {
          const contact = context.handler.client.contacts[user.jid];
          if (contact) {
            pushname = contact.pushname || contact.formattedName || contact.name || user.jid;
          }
        }
      } catch (e) {
        // ignore
      }

      const username = pushname.split('@')[0];
      replyText += `${medal}@${username} — Nivel ${user.level} — ${user.xp} XP\n`;
    });

    await context.reply(replyText);
  }
};