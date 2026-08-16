const assert = require('node:assert/strict');
const test = require('node:test');
const {
  limitText,
  getPrompt,
  buildRequestBody,
  extractResponseContent,
  formatAnswer,
  requestChatGpt
} = require('./plugins/chatgpt');

test('limita y normaliza el texto de ChatGPT', () => {
  assert.equal(limitText('  Hola   mundo  ', 30), 'Hola   mundo');
  assert.equal(limitText('abcdefgh', 4), 'abcd');
});

test('usa el texto escrito y luego el mensaje citado como prompt', () => {
  assert.equal(
    getPrompt({ args: ['¿Qué', 'es', 'Node.js?'], quotedMessage: { conversation: 'ignorado' } }),
    '¿Qué es Node.js?'
  );
  assert.equal(
    getPrompt({ args: [], quotedMessage: { conversation: 'Resume este mensaje.' } }),
    'Resume este mensaje.'
  );
  assert.equal(getPrompt({ args: [], quotedMessage: null }), '');
});

test('construye una solicitud independiente sin historial', () => {
  assert.deepEqual(buildRequestBody('Pregunta de prueba', {
    openAiModel: 'gpt-test',
    openAiMaxOutputTokens: 321
  }), {
    model: 'gpt-test',
    messages: [
      {
        role: 'system',
        content: 'Eres un asistente útil. Responde en español, salvo que la persona solicite otro idioma.'
      },
      { role: 'user', content: 'Pregunta de prueba' }
    ],
    max_tokens: 321,
    temperature: 0.7
  });
});

test('extrae respuestas válidas y rechaza contenido vacío', () => {
  assert.equal(extractResponseContent({ choices: [{ message: { content: '  Hola  ' } }] }), 'Hola');
  assert.equal(extractResponseContent({
    choices: [{ message: { content: [{ text: 'Parte 1' }, { text: 'Parte 2' }] } }]
  }), 'Parte 1 Parte 2');
  assert.equal(extractResponseContent({ choices: [] }), '');
  assert.equal(formatAnswer('x'.repeat(7000)).length, 6000);
});

test('no intenta llamar a OpenAI sin API key', async () => {
  await assert.rejects(
    requestChatGpt('Pregunta', {}),
    error => error?.code === 'missing_api_key'
  );
});
