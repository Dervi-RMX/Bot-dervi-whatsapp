const { normalizeJid } = require('../lib/moderation');

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

// Simple trivia questions database
const triviaQuestions = {
  'general': [
    {
      question: '¿Cuál es el planeta más grande del sistema solar?',
      answer: 'Júpiter'
    },
    {
      question: '¿En qué año llegó el hombre a la Luna?',
      answer: '1969'
    },
    {
      question: '¿Cuál es el océano más grande del mundo?',
      answer: 'Océano Pacífico'
    },
    {
      question: '¿Quién escribió "Cien años de soledad"?',
      answer: 'Gabriel García Márquez'
    },
    {
      question: '¿Cuál es el país más poblado del mundo?',
      answer: 'China'
    }
  ],
  'ciencia': [
    {
      question: '¿Cuál es el símbolo químico del oro?',
      answer: 'Au'
    },
    {
      question: '¿Qué particula tiene carga eléctrica negativa?',
      answer: 'Electrón'
    },
    {
      question: '¿Cuál es el tejido más duro del cuerpo humano?',
      answer: 'Esmalte dental'
    },
    {
      question: '¿Qué planeta es conocido como el planeta rojo?',
      answer: 'Marte'
    },
    {
      question: '¿Cuál es el gas más abundante en la atmósfera terrestre?',
      answer: 'Nitrógeno'
    }
  ],
  'historia': [
    {
      question: '¿En qué año cayó el Imperio Romano de Occidente?',
      answer: '476 d.C.'
    },
    {
      question: '¿Quién fue el primer presidente de los Estados Unidos?',
      answer: 'George Washington'
    },
    {
      question: '¿En qué año comenzó la Segunda Guerra Mundial?',
      answer: '1939'
    },
    {
      question: '¿Quién descubrió América?',
      answer: 'Cristóbal Colón'
    },
    {
      question: '¿En qué año se firmó la Declaración de Independencia de los Estados Unidos?',
      answer: '1776'
    }
  ],
  'deporte': [
    {
      question: '¿Cuántos jugadores tiene un equipo de fútbol en el campo?',
      answer: '11'
    },
    {
      question: '¿Qué país ganó la Copa Mundial de Fútbol de 2018?',
      answer: 'Francia'
    },
    {
      question: '¿En qué deporte se utiliza una raqueta y una pelota amarilla?',
      answer: 'Tenis'
    },
    {
      question: '¿Cuál es el máximo anotador en la historia de la NBA?',
      answer: 'LeBron James (activo) o Kareem Abdul-Jabbar (histórico)'
    },
    {
      question: '¿Cuál es el deporte nacional de Japón?',
      answer: 'Sumo'
    }
  ]
};

// Helper function to get a random element from an array
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Helper function to get all categories
function getCategories() {
  return Object.keys(triviaQuestions);
}

module.exports = {
  name: 'trivia',
  aliases: [],
  description: 'Juego de trivia por categoría: .trivia [categoría]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const categoryArg = String(args[0] || '').toLowerCase();

    // Get available categories
    const availableCategories = getCategories();

    // Determine which category to use
    let selectedCategory = null;
    if (categoryArg) {
      // Check if the argument matches a category exactly
      if (availableCategories.includes(categoryArg)) {
        selectedCategory = categoryArg;
      } else {
        // Try to find a partial match
        const match = availableCategories.find(cat => cat.includes(categoryArg) || categoryArg.includes(cat));
        if (match) {
          selectedCategory = match;
        }
      }
    }

    // If no valid category specified, choose a random one
    if (!selectedCategory || !availableCategories.includes(selectedCategory)) {
      selectedCategory = getRandomElement(availableCategories);
    }

    // Get a random question from the selected category
    const questions = triviaQuestions[selectedCategory];
    if (!questions || questions.length === 0) {
      await context.reply(`⚠️ No hay preguntas disponibles para la categoría: ${selectedCategory}`);
      return;
    }

    const questionObj = getRandomElement(questions);

    // Format the category name for display
    const categoryDisplay = selectedCategory
      .split('')
      .map((c, i) => i === 0 ? c.toUpperCase() : c)
      .join('');

    await context.reply(`❓ *TRIVIA - ${categoryDisplay}*\n\n` +
      `${questionObj.question}\n\n` +
      `💡 Respuesta: ${questionObj.answer}`);
  }
};