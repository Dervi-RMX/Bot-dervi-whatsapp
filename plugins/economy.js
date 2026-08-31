const fs = require('fs');
const path = require('path');
const { normalizeJid } = require('../lib/moderation');

const economyFilePath = path.join(__dirname, '..', 'data', 'economy.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure economy file exists
if (!fs.existsSync(economyFilePath)) {
  fs.writeFileSync(economyFilePath, JSON.stringify({}, null, 2));
}

function loadEconomyData() {
  try {
    const data = fs.readFileSync(economyFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading economy data:', error);
    return {};
  }
}

function saveEconomyData(data) {
  try {
    fs.writeFileSync(economyFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving economy data:', error);
  }
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

function formatMoney(amount) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD' }).format(amount);
}

const WORK_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const WORK_MIN_AMOUNT = 10;
const WORK_MAX_AMOUNT = 100;
const WORK_JOBS = [
  'programador',
  'diseñador',
  'escritor',
  'traductor',
  'consultor',
  'analista',
  'ingeniero',
  'arquitecto',
  'profesor',
  'periodista',
  'fotógrafo',
  'músico',
  'chef',
  'mecánico',
  'electricista',
  'fontanero',
  'carpintero',
  'peluquero',
  'masajista',
  'entrenador personal'
];

module.exports = {
  name: 'economy',
  aliases: [],
  description: 'Sistema de economía: .balance, .work, .pay',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const subcmd = (args[0] || '').toLowerCase();

    // Load economy data
    let economyData = loadEconomyData();

    // Get user JID (from args if mentioning someone, else from sender)
    let targetJid;
    if (subcmd === 'pay') {
      // For pay, the target is the first argument after the command
      const targetContext = { ...context, args: args.slice(1) };
      targetJid = extractTargetJid(targetContext);
    } else {
      // For balance/work, we use the sender (or target if specified in args for balance?)
      // But balance and work are for the sender only, unless we want to allow checking others?
      // We'll allow .balance @user to check another user's balance.
      const targetContext = { ...context, args };
      targetJid = extractTargetJid(targetContext) || context.sender;
    }

    // Ensure user exists in data
    if (!economyData[targetJid]) {
      economyData[targetJid] = { balance: 0, lastWork: 0 };
    }

    const userData = economyData[targetJid];

    if (subcmd === 'balance' || subcmd === 'bal') {
      // Show balance
      const pushname = await getPushname(context, targetJid);
      await context.reply(`💰 *Balance de @${pushname.split('@')[0]}*\n\n${formatMoney(userData.balance)}`);
    } else if (subcmd === 'work') {
      const now = Date.now();
      if (now - userData.lastWork < WORK_COOLDOWN_MS) {
        const hoursLeft = Math.ceil((WORK_COOLDOWN_MS - (now - userData.lastWork)) / (60 * 60 * 1000));
        await context.reply(`⏰ Ya trabajaste recientemente. Vuelve en ${hoursLeft} horas.`);
        return;
      }

      // Generate random job and amount
      const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
      const amount = Math.floor(Math.random() * (WORK_MAX_AMOUNT - WORK_MIN_AMOUNT + 1)) + WORK_MIN_AMOUNT;

      userData.balance += amount;
      userData.lastWork = now;
      saveEconomyData(economyData);

      await context.reply(`💼 Trabajaste como ${job}.\n💰 Ganaste ${formatMoney(amount)}.\n\n💰 Tu nuevo balance es ${formatMoney(userData.balance)}`);
    } else if (subcmd === 'pay') {
      const amountStr = String(args[1] || '').trim();
      const amount = parseFloat(amountStr);
      const senderJid = context.sender;

      // Validate amount
      if (isNaN(amount) || amount <= 0) {
        await context.reply(`⚠️ Cantidad inválida. Por favor, especifica un número positivo.`);
        return;
      }

      // Check if sender has enough balance
      const senderData = economyData[senderJid] || { balance: 0 };
      if (senderData.balance < amount) {
        await context.reply(`⚠️ Balance insuficiente. Tu balance actual es ${formatMoney(senderData.balance)}.`);
        return;
      }

      // Check if target is valid
      if (!targetJid) {
        await context.reply(`⚠️ Especifica un usuario para pagar: ${context.prefix}pay @usuario cantidad`);
        return;
      }

      // Prevent self-payment
      if (sameWhatsAppPhone(senderJid, targetJid)) {
        await context.reply(`⚠️ No puedes pagarte a ti mismo.`);
        return;
      }

      // Prevent paying bots (optional, but we can check if the target is the bot)
      const botId = normalizeJid(context.client?.user?.id || '');
      const botLid = normalizeJid(context.client?.user?.lid || '');
      const normalizedTarget = normalizeJid(targetJid);
      if (normalizedTarget === botId || normalizedTarget === botLid) {
        await context.reply(`⚠️ No puedes pagar al bot.`);
        return;
      }

      // Ensure target exists in data
      if (!economyData[targetJid]) {
        economyData[targetJid] = { balance: 0, lastWork: 0 };
      }

      // Perform transfer
      senderData.balance -= amount;
      economyData[targetJid].balance += amount;
      saveEconomyData(economyData);

      // Get pushnames for sender and target
      const senderPushname = await getPushname(context, senderJid);
      const targetPushname = await getPushname(context, targetJid);

      await context.reply(`💸 Transferencia realizada.\n\nDe:\n@${senderPushname.split('@')[0]}\nPara:\n@${targetPushname.split('@')[0]}\n\nCantidad:\n${formatMoney(amount)}`);
    } else {
      await context.reply(`⚠️ Subcomando desconocido. Uso:\n${context.prefix}balance\n${context.prefix}work\n${context.prefix}pay @usuario cantidad`);
    }
  }
};

// Helper function to get pushname (if possible)
async function getPushname(context, jid) {
  let pushname = jid; // fallback
  try {
    if (context.handler.client && context.handler.client.contacts) {
      const contact = context.handler.client.contacts[jid];
      if (contact) {
        pushname = contact.pushname || contact.formattedName || contact.name || jid;
      }
    }
  } catch (e) {
    // ignore
  }
  return pushname;
}