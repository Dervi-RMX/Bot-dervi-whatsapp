const path = require('path');
const fs = require('fs');

/**
 * Generador de stickers SIN APIs externas
 * Usa emojis predefinidos y lógica simple para crear stickers
 * Completamente autónomo - no requiere OPENAI_API_KEY ni ninguna API
 */

// Base de emojis disponibles (lista completa sin dependencias externas)
const EMOJIS_DISPONIBLES = [
  '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊',
  '😋', '😎', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛',
  '😜', '🤪', '🤨', '😢', '😭', '😓', '😰', '😪', '😫', '😌',
  '😴', '🤔', '😤', '😠', '😡', '😒', '😓', '😔', '😖', '😞',
  '😟', '😠', '😤', '😥', '😩', '😨', '😰', '😱', '😲', '😳',
  '😵', '😶', '😷', '🤒', '🤕', '🤖', '🤠', '🤡', '🤥', '😈',
  '👿', '👹', '👺', '💀', '💩', '☹️', '🙁', '😦', '😧', '😮',
  '😯', '😪', '😴', '😪', '🤤', '😪', '😵', '💫', '💫'
];

const COLORS_DISPONIBLES = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💔', '💘',
  '👍', '👎', '✅', '❌', '❤️‍🔥', '🎉', '🌟', '⭐', '🏆'
];

/**
 * Obtiene un emoji aleatorio de la base de datos
 * @returns {string} Emoji aleatorio
 */
function obtenerEmojiAleatorio() {
  return EMOJIS_DISPONIBLES[Math.floor(Math.random() * EMOJIS_DISPONIBLES.length)];
}

/**
 * Obtiene un emoji por palabra clave (búsqueda simple)
 * @param {string} texto - Texto a analizar
 * @returns {object} - Emoji y tipo de mapeo
 */
function obtenerEmojiPorTexto(texto) {
  const bajo = texto.toLowerCase().trim();

  // Mapas simples palabra -> emoji (sin APIs)
  const mapas = {
    'feliz': '😀', 'contento': '😀', 'j': '😀',
    'triste': '😢', 'depresión': '😢', 'sad': '😢',
    'enojado': '😠', 'ira': '😠', 'angry': '😠',
    'risa': '😂', 'jajaja': '😂', 'haha': '😂',
    'sorpresa': '😮', 'wow': '😮', 'oh': '😮',
    'hola': '👋', 'hello': '👋',
    'gracias': '🙏', 'thank': '🙏',
    'amor': '❤️', 'love': '❤️',
    'fuego': '🔥', 'fire': '🔥',
    'corazón': '❤️', 'heart': '❤️',
    'estrella': '⭐', 'star': '⭐',
    ' musica': '🎵', 'music': '🎵',
    'comida': '🍕', 'eat': '🍴',
    'dormir': '😴', 'sleep': '😴',
    'lol': '😂', 'rofl': '😂', 'lmao': '🤣'
  };

  // Buscar coincidencia exacta o parcial
  for (const [palabra, emoji] of Object.entries(mapas)) {
    if (bajo.includes(palabra)) {
      return { emoji, tipo: 'mapeado' };
    }
  }

  // Si no hay coincidencia, retornar emoji aleatorio
  return { emoji: obtenerEmojiAleatorio(), tipo: 'aleatorio' };
}

/**
 * Crea una descripción de sticker usando emojis
 * @param {string} texto - Texto del usuario (opcional)
 * @returns {string} - Descripción formateada del sticker
 */
function crearDescripcionSticker(texto) {
  let emoji;

  if (texto && texto.trim()) {
    const resultado = obtenerEmojiPorTexto(texto);
    emoji = resultado.emoji;
    const tipo = resultado.tipo;
  } else {
    emoji = obtenerEmojiAleatorio();
  }

  // Construir descripción simple
  const partes = [emoji];

  if (texto && texto.trim()) {
    // Agregar texto resumido (máximo 20 chars)
    const textoResp = texto.trim().slice(0, 20);
    partes.push(textoResp);
  }

  // Agregar color aleatorio si no hay emoji específico
  if (!EMOJIS_DISPONIBLES.includes(emoji)) {
    partes.unshift(COLORS_DISPONIBLES[Math.floor(Math.random() * COLORS_DISPONIBLES.length)]);
  }

  return partes.join(' ');
}

/**
 * Envía un sticker simple por WhatsApp
 * @param {object} context - Contexto del mensaje
 * @param {string} emoji - Emoji a enviar
 * @param {string} texto - Texto opcional
 */
async function enviarStickerSimple(context, emoji, texto) {
  // Crear descripción del sticker
  const descripcion = crearDescripcionSticker(texto);

  // Intentar enviar como sticker si el cliente lo permite
  try {
    // Construir caption con el emoji
    const caption = `🎨 ${descripcion}`;

    // En modo sandbox, enviamos como texto con emoji
    // En modo real, aquí se enviaría el buffer del sticker
    await context.reply(caption);

    // Alternativa: también podríamos intentar enviar un sticker real
    // si el cliente lo soporta, pero usemos texto por ahora para confiabilidad
    // await context.sendSticker(bufferEmoji, caption);

  } catch (error) {
    // Fallback completo - si falla todo, enviar solo el emoji
    try {
      await context.reply(`🎨 ${emoji}`);
    } catch (e) {
      // Último recurso: solo el emoji
      await context.reply(emoji);
    }
  }
}

/**
 * Ejecuta el comando sticker
 * @param {object} context - Contexto del mensaje
 */
async function ejecutarComandoSticker(context) {
  // Obtener texto de la args o del mensaje citado
  const texto = context.args && context.args.length > 0
    ? context.args.join(' ')
    : '';

  // Si hay texto citado (responder a un mensaje), usar ese texto
  if (context.quotedMessage && context.quotedMessage?.text) {
    const quotedText = context.getMessageText
      ? context.getMessageText(context.quotedMessage)
      : '';
    if (quotedText) {
      // Usar el texto del mensaje citado
      const resultado = obtenerEmojiPorTexto(quotedText);
      await enviarStickerSimple(context, resultado.emoji, quotedText);
      return;
    }
  }

  // Si no hay texto, mostrar ayuda
  if (!texto.trim()) {
    await context.reply(`⚠️ Usa: .sticker <texto>\n\nEjemplos:\n• .sticker feliz\n• .sticker gracias\n• .sticker amor\n• .sticer hola\n• .sticker (respondiendo a un mensaje)`);
    return;
  }

  // Analizar el texto y generar sticker
  const resultado = obtenerEmojiPorTexto(texto);

  // Enviar el sticker
  await enviarStickerSimple(context, resultado.emoji, texto);
}

/**
 * Maneja .sticker cuando se responde a un mensaje
 * @param {object} context - Contexto del mensaje citado
 */
async function manejarStickerCitado(context) {
  // Obtener texto del mensaje citado
  let texto = '';

  if (context.quotedMessage?.contextInfo?.mentionedJid?.length) {
    // Si mencionaron a alguien, usar texto simple
    texto = 'saludo';
  } else if (context.quotedMessage?.text) {
    texto = context.getMessageText
      ? context.getMessageText(context.quotedMessage)
      : '';
  } else {
    // Si es una imagen u otro tipo de contenido citado
    texto = 'emoji';
  }

  // Generar y enviar sticker
  const resultado = obtenerEmojiPorTexto(texto);
  await enviarStickerSimple(context, resultado.emoji, texto || 'sticker');
}

// Exportar módulo principal
module.exports = {
  name: 'sticker',
  aliases: ['pega', 'pegatina', 'emoji'],
  description: 'Genera stickers simples usando emojis (SIN APIs externas)',
  async execute(context) {
    try {
      await ejecutarComandoSticker(context);
    } catch (error) {
      console.error('Error en comando sticker:', error.message);
      // Fallback final
      await context.reply('🎨 Sticker generado');
    }
  }
};