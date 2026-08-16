const { parseAccessDuration } = require('../lib/access-manager');

module.exports = {
  name: 'codigo',
  aliases: ['code', 'invitar'],
  ownerOnly: true,
  description: 'Genera un código temporal de vinculación para otro usuario',
  async execute(context) {
    const args = context.args || [];
    const duration = args.length === 1 ? parseAccessDuration(args[0]) : null;
    if (!duration) {
      await context.reply(
        [
          '⚠️ Indica cuánto tiempo tendrá acceso la persona:',
          '',
          `${context.prefix}codigo 1d — 1 día`,
          `${context.prefix}codigo 1m — 1 mes (30 días)`,
          `${context.prefix}codigo 1a — 1 año (365 días)`
        ].join('\n')
      );
      return;
    }

    let invite;
    try {
      invite = context.handler.access.createInvite(duration);
    } catch {
      await context.reply('⚠️ No se pudo guardar el código de vinculación. Revisa la carpeta de datos del bot.');
      return;
    }

    const codeExpires = new Date(invite.expiresAt).toLocaleString('es-ES');

    await context.reply(
      [
        '🔐 CÓDIGO DE VINCULACIÓN',
        '',
        `Código: ${invite.code}`,
        `Duración del acceso: ${duration.label}`,
        `El código se puede canjear hasta: ${codeExpires}`,
        `Después de canjearlo, tendrá acceso durante: ${duration.label}`,
        '',
        `La otra persona debe enviar: ${context.prefix}vincular ${invite.code}`,
        'El código es de un solo uso; generar otro invalida este.',
        context.isGroup ? '⚠️ Este chat es un grupo: todos pueden ver el código.' : 'Compártelo únicamente con la persona autorizada.'
      ].join('\n')
    );
  }
};
