const fs = require('fs');
const path = require('path');
const { normalizeJid } = require('../lib/moderation');
const { createDataStore } = require('../lib/data-store');

const dataStore = createDataStore();
const xpFilePath = dataStore.path('xp.json');

// Activity XP settings
const ACTIVITY_XP_REWARD = 5;
const ACTIVITY_XP_COOLDOWN_MS = 30 * 1000; // 30 seconds

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure XP file exists
if (!fs.existsSync(xpFilePath)) {
  dataStore.write('xp.json', {});
}

function loadXPData() {
  try {
    return dataStore.read('xp.json', {});
  } catch (error) {
    console.error('Error loading XP data:', error);
    return {};
  }
}

function saveXPData(data) {
  try {
    dataStore.write('xp.json', data);
  } catch (error) {
    console.error('Error saving XP data:', error);
  }
}

function awardActivityXP(jid) {
  // Prevent awarding to empty JID
  if (!jid) return 0;

  const xpData = loadXPData();
  if (!xpData[jid]) {
    xpData[jid] = { xp: 0, level: 0, lastDaily: 0, lastActivityXP: 0 };
  }
  const userData = xpData[jid];
  const now = Date.now();
  if (now - userData.lastActivityXP < ACTIVITY_XP_COOLDOWN_MS) {
    return 0; // still on cooldown
  }
  // Award XP
  userData.xp += ACTIVITY_XP_REWARD;
  userData.lastActivityXP = now;
  // Recalculate level
  userData.level = Math.floor(Math.sqrt(userData.xp / 10));
  saveXPData(xpData);
  return ACTIVITY_XP_REWARD;
}

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

function calculateLevel(xp) {
  // Simple level formula: level = floor(sqrt(xp / 10))
  // Adjust as needed
  return Math.floor(Math.sqrt(xp / 10));
}

function xpForNextLevel(level) {
  // XP needed for next level: (level+1)^2 * 10
  return (level + 1) ** 2 * 10;
}

module.exports = {
  name: 'xp',
  aliases: ['level', 'daily'],
  description: 'Sistema de XP y niveles: .xp (ver XP), .daily (recompensa diaria)',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const subcmd = (args[0] || '').toLowerCase();

    // Load XP data
    let xpData = loadXPData();

    // Get user JID (from args if mentioning someone, else from sender)
    let targetJid;
    if (subcmd === 'daily') {
      // For daily, we always affect the sender
      targetJid = context.sender;
    } else {
      // For xp/level, we can check args for a target
      const targetContext = { ...context, args };
      targetJid = extractTargetJid(targetContext) || context.sender;
    }

    // Ensure user exists in data
    if (!xpData[targetJid]) {
      xpData[targetJid] = { xp: 0, level: 0, lastDaily: 0, lastActivityXP: 0 };
    }

    const userData = xpData[targetJid];

    if (subcmd === 'daily') {
      const now = Date.now();
      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (now - userData.lastDaily < ONE_DAY) {
        const hoursLeft = Math.ceil((ONE_DAY - (now - userData.lastDaily)) / (60 * 60 * 1000));
        await context.reply(`⏰ Ya reclamaste tu recompensa diaria. Vuelve en ${hoursLeft} horas.`);
        return;
      }

      // Give XP reward (e.g., 50 XP)
      const xpReward = 50;
      userData.xp += xpReward;
      userData.lastDaily = now;
      // Recalculate level
      const newLevel = calculateLevel(userData.xp);
      const levelUp = newLevel > userData.level;
      userData.level = newLevel;

      saveXPData(xpData);

      let replyText = `🎁 ¡Has reclamado tu recompensa diaria!\n`;
      replyText += `✨ +${xpReward} XP\n`;
      replyText += `📊 Total XP: ${userData.xp}\n`;
      if (levelUp) {
        replyText += `🎉 ¡Subiste de nivel! Ahora eres nivel ${userData.level}\n`;
      } else {
        replyText += `📈 Nivel actual: ${userData.level}\n`;
      }
      replyText += `⏭️ XP para siguiente nivel: ${xpForNextLevel(userData.level) - userData.xp}`;

      await context.reply(replyText);
    } else {
      // Show XP and level for the target user
      const level = calculateLevel(userData.xp);
      const xpForNext = xpForNextLevel(level);
      const xpNeeded = xpForNext - userData.xp;

      // Get pushname if possible
      let pushname = targetJid;
      try {
        if (context.handler.client && context.handler.client.contacts) {
          const contact = context.handler.client.contacts[targetJid];
          if (contact) {
            pushname = contact.pushname || contact.formattedName || contact.name || targetJid;
          }
        }
      } catch (e) {
        // ignore
      }

      await context.reply(`👤 *PERFIL DE ${pushname.split('@')[0].toUpperCase()}*\n\n` +
        `🆔 JID: @${targetJid.split('@')[0]}\n` +
        `💎 XP: ${userData.xp}\n` +
        `📈 Nivel: ${level}\n` +
        `⏭️ XP para siguiente nivel: ${xpNeeded}\n` +
        `💡 Usa .daily para obtener recompensa diaria`);
    }
  }
};