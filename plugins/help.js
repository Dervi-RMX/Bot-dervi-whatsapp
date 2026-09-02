const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'help',
  aliases: [],
  description: 'Muestra ayuda dinámica del bot con todos los comandos disponibles',
  async execute(context) {
    const config = context.handler?.config || {};
    const prefix = config.prefix || '.';
    const pluginsMap = context.handler?.plugins || new Map();

    // Convert Map to array and filter valid plugins
    const pluginArray = Array.from(pluginsMap.values())
      .filter(p => p.name && typeof p.execute === 'function');

    // Deduplicate by name (just in case)
    const seen = new Set();
    const plugins = [];
    for (const p of pluginArray) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        plugins.push(p);
      }
    }

    // Helper to get permission strings
    function getPermissions(plugin) {
      const perms = [];
      if (plugin.ownerOnly) perms.push('👑 Owner');
      if (plugin.adminOnly) perms.push('🛡️ Admin');
      if (plugin.groupOnly) perms.push('👥 Grupo');
      if (!plugin.ownerOnly && !plugin.adminOnly && !plugin.groupOnly) perms.push('🌎 Público');
      return perms;
    }

    // Subcommands map (hardcoded for known plugins)
    const subcommandsMap = {
      group: ['admins', 'link', 'setname', 'setdesc', 'kick', 'add', 'promote', 'demote', 'tagall', 'hidetag'],
      warn: ['warn', 'warnings', 'unwarn', 'resetwarn'],
    };

    // Determine category for each plugin
    const categorized = {};
    const categoryDefs = [
      { id: 'owner', label: '👑 OWNER' },
      { id: 'groups', label: '👥 GRUPOS' },
      { id: 'moderation', label: '🛡️ MODERACIÓN' },
      { id: 'ai', label: '🤖 IA' },
      { id: 'downloads', label: '🎵 DESCARGAS' },
      { id: 'multimedia', label: '🎨 MULTIMEDIA' },
      { id: 'utilities', label: '🛠️ UTILIDADES' },
      { id: 'games', label: '🎮 JUEGOS' },
      { id: 'profile', label: '⭐ PERFIL & XP' },
      { id: 'others', label: '🔹 OTROS' }
    ];
    categoryDefs.forEach(cat => { categorized[cat.id] = []; });

    for (const plugin of plugins) {
      let catId = 'others';
      // 1. explicit category property
      if (plugin.category && typeof plugin.category === 'string') {
        catId = plugin.category.toLowerCase();
        // normalize to known ids
        const known = categoryDefs.find(c => c.id === catId);
        if (known) catId = known.id;
      } else {
        // 2. pattern matching fallback
        const name = plugin.name.toLowerCase();
        if (['owner', 'vincular'].includes(name)) catId = 'owner';
        else if (['group', 'bienvenida', 'despedida', 'reglas'].some(k => name.includes(k))) catId = 'groups';
        else if (['antilinks', 'antispam', 'warn', 'silenciar', 'ban'].some(k => name.includes(k))) catId = 'moderation';
        else if (['chatgpt', 'gemini', 'ia', 'vision', 'ocr', 'resumen', 'imagine', 'translate'].some(k => name.includes(k))) catId = 'ai';
        else if (['play', 'ytdl', 'ytmp3', 'descargar', 'mediafire', 'facebook', 'instagram', 'tiktok', 'twitter', 'yt'].some(k => name.includes(k))) catId = 'downloads';
        else if (['sticker', 'take', 'toimg', 'blur', 'resize', 'crop', 'rotate', 'clip', 'codigo', 'spotify'].some(k => name.includes(k))) catId = 'multimedia';
        else if (['calc', 'qr', 'shorturl', 'weather', 'textutils', 'info', 'estado', 'ping', 'ver', 'status', 'forense'].some(k => name.includes(k))) catId = 'utilities';
        else if (['ppt', 'quiz', 'trivia', 'dados', 'adivinanza'].some(k => name.includes(k))) catId = 'games';
        else if (['perfil', 'xp', 'rank'].some(k => name.includes(k))) catId = 'profile';
      }

      // Ensure category exists
      if (!categorized[catId]) categorized[catId] = [];
      categorized[catId].push(plugin);
    }

    // Sort plugins within each category by name
    for (const catId in categorized) {
      categorized[catId].sort((a, b) => a.name.localeCompare(b.name));
    }

    // Count stats
    const totalPlugins = plugins.length;
    const totalCommands = totalPlugins; // each plugin is a command
    const totalAliases = plugins.reduce((sum, p) => sum + (p.aliases?.length || 0), 0);

    // Get owner info
    let ownerInfo = 'No definido';
    const ownerJid = context.handler?.ownerJid;
    if (ownerJid) {
      // Try to get pushname from contacts
      let pushname = null;
      try {
        if (context.handler.client && context.handler.client.contacts) {
          const contact = context.handler.client.contacts[ownerJid];
          if (contact) pushname = contact.pushname || contact.formattedName || contact.name;
        }
      } catch (_) {}
      ownerInfo = pushname ? `@${pushname.split('@')[0]}` : ownerJid;
    }

    // Build help text
    let help = `🤖 *DERVI BOT*\n`;
    help += `⚡ *Prefijo:* ${prefix}   👤 *Usuario:* ${ownerInfo}\n`;
    help += `🧩 *Plugins:* ${totalPlugins}   📋 *Comandos:* ${totalCommands}   🏷️ *Aliases:* ${totalAliases}\n\n`;

    // Process each category
    for (const catDef of categoryDefs) {
      const catId = catDef.id;
      const pluginList = categorized[catId];
      if (pluginList.length === 0) continue;

      help += `${catDef.label}\n`;

      for (const plugin of pluginList) {
        const name = plugin.name;
        const desc = plugin.description || 'Sin descripción';
        const aliases = plugin.aliases || [];
        const perms = getPermissions(plugin);
        const subcommands = subcommandsMap[name] || [];

        // Main command line
        let line = `• *.${name}*`;
        if (aliases.length > 0) {
          line += ` (${aliases.map(a => `.${a}`).join('/')})`;
        }
        if (perms.length > 0) {
          line += ` [${perms.join(' · ')}]`;
        }
        line += `  ${desc}`;
        help += line + '\n';

        // Subcommands
        if (subcommands.length > 0) {
          help += `    *Subcomandos:*\n`;
          for (const sub of subcommands) {
            help += `      • *.${sub}*\n`;
          }
        }

        help += '\n'; // blank line between plugins
      }

      help += '\n'; // blank line between categories
    }

    help += `💡 Escribe *.${{prefix}}<comando>* para usar\n`;

    // Try to load banner image
    const bannerPath = path.resolve(__dirname, '..', 'assets', '9984643a-f46c-4cc1-acbd-75eba5bde0c2.png');
    let bannerBuffer = null;
    try {
      if (fs.existsSync(bannerPath)) {
        const data = fs.readFileSync(bannerPath);
        bannerBuffer = Buffer.from(data);
      }
    } catch (e) {
      // ignore, fall back to text only
    }

    // Send as image with caption if available, else as text
    try {
      if (bannerBuffer) {
        const tempFilePath = path.join(context.handler.config.tempDirectory, `help_banner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.png`);
        await fs.promises.writeFile(tempFilePath, bannerBuffer);
        await context.sendTempFile(tempFilePath, {
          caption: help,
          mimeType: 'image/png',
          kind: 'image'
        });
        // Clean up
        await fs.promises.unlink(tempFilePath).catch(() => {});
      } else {
        await context.reply(help);
      }
    } catch (e) {
      await context.reply(help);
    }
  }
};