module.exports = {
  name: 'canary',
  aliases: [],
  description: 'Muestra indicadores de canarytokens y tipos de web bugs',
  async execute(context) {
    const { config } = context;
    const prefix = config.prefix || '.';

    await context.reply(
      [
        '╔═════════════════════════════════════════════════════════════════',
        '║          🛡️ CANARYTOKENS - INDICADORES                ║',
        '║   Herramienta de detección y monitoreo               ║',
        '╚════════════════════════════════════════════════════════════════════════',
        '',
        '📋 **Tipos de Web Bugs y Electrónica:**',
        '',
        '1️⃣ .web-bug   - Web beacon / tracking pixel',
        '2️⃣ .dns        - DNS lookup y monitoring',
        '3️⃣ .qr-code    - QR code generation y analysis',
        '4️⃣ .web-image  - Web image tracking',
        '5️⃣ .microsoft-word - Document tracking (Word)',
        '6️⃣ .microsoft-excel - Spreadsheet tracking (Excel)',
        '7️⃣ .pdf        - PDF document tracking',
        '8️⃣ .windows-folder - Windows folder monitoring',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '🛡️ **CANARYTOKENS ACTIVOS:**',
        ' cada tipo genera un token único al ser activado',
        '',
        '💡 **Comandos relacionados:**',
        '• `.canary status` - Ver estado de tokens activos',
        '• `.canary track <tipo>` - Rastrear un indicador específico',
        '• `.canary list` - Listar todos los tipos disponibles',
        '',
        '╔═════════════════════════════════════════════════════════════════',
        '║   🔍 Para implementar estas funcionalidades, busca APIs:  ║',
        '║   • Web Bug Detection APIs                    ║',
        '║   • DNS Monitoring & Tracking APIs            ║',
        '║   • QR Code Generation & Analysis APIs        ║',
        '║   • Image Recognition & Tracking APIs         ║',
        '║   • Document Tracking APIs (Office, PDF)      ║',
        '║   • File System & Folder Monitoring APIs      ║',
        '╚═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════',
        '',
        '💬 **USO:** `.canary` - Muestra este menú de indicadores',
        '',
        '╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════'
      ].join('\n')
    );
  }
};