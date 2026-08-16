module.exports = {
  name: 'vincular',
  aliases: ['link', 'unir'],
  publicAccess: true,
  description: 'Vincula este número usando un código de invitación',
  async execute(context) {
    if (context.isOwner) {
      await context.reply('✅ El propietario ya tiene acceso completo al bot.');
      return;
    }

    if (context.handler.isLinked(context.sender)) {
      await context.reply('✅ Este número ya está vinculado al bot.');
      return;
    }

    const code = (context.args || []).join('').trim();
    if (!code) {
      await context.reply(`⚠️ Uso: ${context.prefix}vincular <codigo>`);
      return;
    }

    const result = context.handler.access.consumeInvite(
      code,
      context.sender,
      Date.now(),
      context.senderAliases || []
    );
    if (result.reason === 'expired') {
      await context.reply('⚠️ Ese código ya expiró. Solicita uno nuevo al propietario.');
      return;
    }

    if (result.reason === 'unavailable') {
      await context.reply('⚠️ El sistema de vinculación no está disponible. Contacta al propietario.');
      return;
    }

    if (!result.ok) {
      await context.reply('⚠️ Código inválido. Solicita un código nuevo al propietario.');
      return;
    }

    const expires = result.expiresAt ? new Date(result.expiresAt).toLocaleString('es-ES') : 'la fecha configurada';
    await context.reply(`✅ Número vinculado correctamente. Ya puedes usar las funciones del bot hasta ${expires}.`);
  }
};
