const riddles = [
  {
    question: '¿Qué tiene ojos pero no puede ver?',
    answer: 'Una aguja'
  },
  {
    question: '¿Qué tiene llaves pero no abre puertas, tiene espacio pero no es una habitación y puedes entrar pero no salir?',
    answer: 'Un teclado'
  },
  {
    question: '¿Qué sube y baja pero no se mueve?',
    answer: 'La temperatura'
  },
  {
    question: '¿Qué tiene un cuello pero no tiene cabeza?',
    answer: 'Una botella'
  },
  {
    question: '¿Qué es más útil cuando está roto?',
    answer: 'Un huevo'
  }
];

module.exports = {
  name: 'adivinanza',
  aliases: [],
  description: 'Adivinanza: .adivinanza (muestra una adivinanza y su respuesta)',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const riddle = riddles[Math.floor(Math.random() * riddles.length)];
    await context.reply(`❓ *ADIVINANZA*\n\n${riddle.question}\n\n💡 Respuesta: ${riddle.answer}`);
  }
};