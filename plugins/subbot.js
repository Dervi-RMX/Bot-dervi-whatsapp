module.exports = {
  name: 'subbot',
  aliases: [],
  ownerOnly: true,
  description: 'Administra bots secundarios con sesiones independientes',
  async execute(context) {
    const action = String(context.args?.[0] || 'ayuda').toLowerCase();
    const manager = context.handler.subbots;
    if (!manager) {
      await context.reply('⚠️ El sistema de subbots no está disponible.');
      return;
    }

    if (action === 'crear') {
      const record = manager.create();
      await manager.start(record.id, { targetChatId: context.chatId });
      await context.reply(`✅ ${record.id} creado y en proceso de conexión.\nEl QR llegará a tu chat privado.`);
      return;
    }
    if (action === 'lista') {
      const records = manager.list();
      if (!records.length) {
        await context.reply('🤖 No hay subbots creados.');
        return;
      }
      await context.reply([
        '🤖 *SISTEMA DE SUBBOTS*',
        '',
        ...records.map((record, index) =>
          `${index + 1}. ${record.id}\n   📱 Número: ${record.jid || 'No conectado'}\n   ${statusIcon(record.status)} Estado: ${record.status}`
        )
      ].join('\n\n'));
      return;
    }
    if (action === 'conectar' || action === 'encender') {
      const id = context.args?.[1] || '';
      if (!manager.get(id)) {
        await context.reply('⚠️ Ese subbot no existe.');
        return;
      }
      const phone = context.args?.slice(2).join('') || '';
      if (phone) {
        try {
          await manager.requestPairingCode(id, phone, context.chatId);
          await context.reply(`🟡 ${String(id).toUpperCase()} está esperando la vinculación por número.`);
        } catch (error) {
          await context.reply(`⚠️ No se pudo generar el código de vinculación:\n${error.message}`);
        }
      } else {
        await manager.start(id, { targetChatId: context.chatId });
        await context.reply(`🟡 ${String(id).toUpperCase()} está iniciando. El QR llegará a este chat.`);
      }
      return;
    }
    if (action === 'apagar') {
      const id = context.args?.[1] || '';
      await manager.stop(id);
      await context.reply(`🔴 ${String(id).toUpperCase()} apagado.`);
      return;
    }
    if (action === 'info') {
      const record = manager.get(context.args?.[1]);
      if (!record) {
        await context.reply('⚠️ Ese subbot no existe.');
        return;
      }
      await context.reply([
        `🤖 *${record.id}*`,
        `📱 JID: ${record.jid || 'No conectado'}`,
        `${statusIcon(record.status)} Estado: ${record.status}`,
        `📅 Creado: ${new Date(record.createdAt).toLocaleString('es-ES')}`,
        `📁 Sesión: sessions\\${record.id}`
      ].join('\n'));
      return;
    }
    if (action === 'eliminar') {
      const id = String(context.args?.[1] || '').toUpperCase();
      if (!manager.get(id)) {
        await context.reply('⚠️ Ese subbot no existe.');
        return;
      }
      manager.requestDelete(context.sender, id);
      await context.reply(`⚠️ ¿Seguro que quieres eliminar ${id}?\n\nEscribe:\n.confirmar`);
      return;
    }

    await context.reply([
      '🤖 *AYUDA DE SUBBOTS*',
      '.subbot crear',
      '.subbot lista',
      '.subbot conectar SUB-001',
      '.subbot conectar SUB-001 521XXXXXXXXXX',
      '.subbot info SUB-001',
      '.subbot apagar SUB-001',
      '.subbot encender SUB-001',
      '.subbot eliminar SUB-001',
      '.confirmar'
    ].join('\n'));
  }
};

function statusIcon(status) {
  return status === 'ONLINE' ? '🟢' : status === 'CONECTANDO' ? '🟡' : '🔴';
}
