const { normalizeJid } = require('../lib/moderation');

function extractTargetJid(context) {
  const getMessageEntry = (context) => {
    const content = context.getMessageContent ? context.getMessageContent() : {};
    const type = Object.keys(content || {})[0];
    return type ? content[type] : null;
  };

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
  name: 'group',
  aliases: [],
  description: 'Comandos de administración de grupos: admins, link, setname, setdesc, kick, add, promote, demote, tagall, hidetag',
  groupOnly: true,
  adminOnly: true,
  async execute(context) {
    const subcmd = String(context.args?.[0] || '').toLowerCase();
    const args = context.args.slice(1);

    switch (subcmd) {
      case 'admins':
        return await this._admins(context, args);
      case 'link':
      case 'invite':
        return await this._link(context, args);
      case 'setname':
        return await this._setname(context, args);
      case 'setdesc':
        return await this._setdesc(context, args);
      case 'kick':
        return await this._kick(context, args);
      case 'add':
        return await this._add(context, args);
      case 'promote':
        return await this._promote(context, args);
      case 'demote':
        return await this._demote(context, args);
      case 'tagall':
      case 'mencionartodo':
        return await this._tagall(context, args);
      case 'hidetag':
      case 'etiquetada':
        return await this._hidetag(context, args);
      default:
        await context.reply(`⚠️ Subcomando desconocido: ${subcmd}\nUso:\n${context.prefix}group admins\n${context.prefix}group link\n${context.prefix}group setname <nuevo nombre>\n${context.prefix}group setdesc <nueva descripción>\n${context.prefix}group kick @usuario\n${context.prefix}group add @usuario\n${context.prefix}group promote @usuario\n${context.prefix}group demote @usuario\n${context.prefix}group tagall\n${context.prefix}group hidetag`);
    }
  },

  async _admins(context, args) {
    try {
      const info = await context.handler.getGroupInfo(context.chatId);
      const admins = Array.from(info.admins)
        .map(jid => `@${jid.split('@')[0]}`)
        .join(', ');
      await context.reply(`👑 *Administradores del grupo:*\n${admins || 'Ninguno'}`);
    } catch (error) {
      await context.reply('⚠️ No se pudo obtener la lista de administradores.');
    }
  },

  async _link(context, args) {
    try {
      const code = await context.client.groupInviteCode(context.chatId);
      if (!code) {
        await context.reply('⚠️ No se pudo obtener el enlace de invitación.');
        return;
      }
      const link = `https://chat.whatsapp.com/${code}`;
      await context.reply(`🔗 *Enlace de invitación del grupo:*\n${link}`);
    } catch (error) {
      await context.reply('⚠️ No se pudo obtener el enlace de invitación.');
    }
  },

  async _setname(context, args) {
    const newName = args.join(' ').trim();
    if (!newName) {
      await context.reply(`⚠️ Especifique el nuevo nombre: ${context.prefix}group setname <nombre>`);
      return;
    }
    try {
      await context.client.groupUpdateSubject(context.chatId, newName);
      await context.reply(`✅ Nombre del grupo cambiado a: *${newName}*`);
    } catch (error) {
      await context.reply('⚠️ No se pudo cambiar el nombre del grupo.');
    }
  },

  async _setdesc(context, args) {
    const newDesc = args.join(' ').trim();
    if (!newDesc) {
      await context.reply(`⚠️ Especifique la nueva descripción: ${context.prefix}group setdesc <descripción>`);
      return;
    }
    try {
      await context.client.groupUpdateDescription(context.chatId, newDesc);
      await context.reply(`✅ Descripción del grupo actualizada.`);
    } catch (error) {
      await context.reply('⚠️ No se pudo actualizar la descripción del grupo.');
    }
  },

  async _kick(context, args) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}group kick @usuario`);
      return;
    }
    // Prevent kicking owner or bots?
    if (context.handler.isOwner(target) || await context.handler.isAdminInGroup(context.chatId, target)) {
      await context.reply('⚠️ No se puede expulsar a un admin/owner.');
      return;
    }
    try {
      await context.client.groupParticipantsUpdate(context.chatId, [target], 'remove');
      await context.reply(`✅ Usuario @${target.split('@')[0]} expulsado del grupo.`);
    } catch (error) {
      await context.reply('⚠️ No se pudo expulsar al usuario.');
    }
  },

  async _add(context, args) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}group add @usuario`);
      return;
    }
    try {
      await context.client.groupParticipantsUpdate(context.chatId, [target], 'add');
      await context.reply(`✅ Usuario @${target.split('@')[0]} agregado al grupo.`);
    } catch (error) {
      await context.reply('⚠️ No se pudo agregar al usuario.');
    }
  },

  async _promote(context, args) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}group promote @usuario`);
      return;
    }
    if (context.handler.isOwner(target)) {
      await context.reply('⚠️ El propietario ya es admin.');
      return;
    }
    try {
      await context.client.groupParticipantsUpdate(context.chatId, [target], 'promote');
      await context.reply(`✅ Usuario @${target.split('@')[0]} promovido a administrador.`);
    } catch (error) {
      await context.reply('⚠️ No se pudo promover al usuario.');
    }
  },

  async _demote(context, args) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}group demote @usuario`);
      return;
    }
    const isBotAdmin = await context.handler.isAdminInGroup(context.chatId, context.client?.user?.id || '');
    if (!isBotAdmin) {
      await context.reply('⚠️ Necesito ser administrador para demotear.');
      return;
    }
    try {
      await context.client.groupParticipantsUpdate(context.chatId, [target], 'demote');
      await context.reply(`✅ Usuario @${target.split('@')[0]} ya no es administrador.`);
    } catch (error) {
      await context.reply('⚠️ No se pudo demotar al usuario.');
    }
  },

  async _tagall(context, args) {
    try {
      const info = await context.handler.getGroupInfo(context.chatId);
      const members = (info.metadata?.participants || [])
        .map(participant => ({
          jid: participant?.id || participant?.jid || participant?.phoneNumber,
          displayJid: normalizeJid(participant?.phoneNumber || participant?.id || participant?.jid)
        }))
        .filter(member => member.jid && member.displayJid && !member.displayJid.endsWith('@g.us'))
        .filter((member, index, list) => list.findIndex(item => item.displayJid === member.displayJid) === index);

      if (!members.length) {
        await context.reply('⚠️ No se encontraron miembros para etiquetar.');
        return;
      }

      const mentions = members.map(member => member.jid);
      const tags = members.map(member => `@${member.displayJid.split('@')[0]}`).join(' ');
      const text = [
        '📢 *ATENCIÓN A TODOS*',
        '',
        tags,
        '',
        `👥 Total de miembros: *${members.length}*`
      ].join('\n');

      await context.client.sendMessage(context.chatId, { text, mentions }, {
        quoted: context.quoted || context.message
      });
    } catch (error) {
      context.handler.logger?.warning?.('No se pudo ejecutar group tagall', {
        error: error?.message || String(error)
      });
      await context.reply('⚠️ No se pudo etiquetar a todos los miembros.');
    }
  },

  async _hidetag(context, args) {
    try {
      const info = await context.handler.getGroupInfo(context.chatId);
      const members = (info.metadata?.participants || [])
        .map(participant => participant?.id || participant?.jid || participant?.phoneNumber)
        .filter(Boolean);
      const text = args.join(' ').trim() || '📢 Atención a todos los miembros del grupo.';
      await context.client.sendMessage(context.chatId, { text, mentions: members }, {
        quoted: context.quoted || context.message
      });
    } catch (error) {
      context.handler.logger?.warning?.('No se pudo ejecutar group hidetag', {
        error: error?.message || String(error)
      });
      await context.reply('⚠️ No se pudo notificar a todos los miembros.');
    }
  }
};