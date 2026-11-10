const assert = require('node:assert/strict');
const test = require('node:test');
const { createOllamaAgentModel, createOllamaGenerator, firstAvailable, toGeminiContent, toOllamaMessages, toOllamaTools } = require('../src/ollama');
const { runAgent } = require('../src/agent');

/** Ollama simulado: responde en orden y guarda cada petición. */
function ollamaFalso(...respuestas) {
  const llamadas = [];
  const fetchImpl = async (url, init) => {
    llamadas.push({ url, body: JSON.parse(init.body) });
    const message = respuestas.shift();
    return new Response(JSON.stringify({ message }), { status: message ? 200 : 500 });
  };
  return { fetchImpl, llamadas };
}

test('los mensajes del agente se traducen al chat de Ollama', () => {
  const mensajes = toOllamaMessages([
    { role: 'user', parts: [{ text: '¿qué falta?' }] },
    { role: 'model', parts: [{ functionCall: { name: 'consultar_stock_critico', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'consultar_stock_critico', response: { result: { items: [] } } } }] },
  ], 'Reglas del salón');
  assert.deepEqual(mensajes.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(mensajes[2].tool_calls[0].function.name, 'consultar_stock_critico');
  assert.equal(mensajes[3].tool_name, 'consultar_stock_critico');
  assert.deepEqual(JSON.parse(mensajes[3].content), { result: { items: [] } });
});

test('una herramienta sin parámetros lleva igual un objeto vacío', () => {
  const [herramienta] = toOllamaTools([{ name: 'listar_estilistas', description: 'Lista' }]);
  assert.deepEqual(herramienta, { type: 'function', function: { name: 'listar_estilistas', description: 'Lista', parameters: { type: 'object', properties: {} } } });
});

test('la respuesta de Ollama vuelve al formato del agente, también con argumentos en texto', () => {
  const contenido = toGeminiContent({ content: '', tool_calls: [{ function: { name: 'generar_reporte', arguments: '{"entidad":"citas"}' } }] });
  assert.deepEqual(contenido.parts, [{ functionCall: { name: 'generar_reporte', args: { entidad: 'citas' } } }]);
  assert.equal(toGeminiContent({ content: '  ' }), null);
});

test('el agente completa su ciclo con el modelo local', async () => {
  const { fetchImpl, llamadas } = ollamaFalso(
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'consultar_stock_critico', arguments: {} } }] },
    { role: 'assistant', content: 'Falta keratina.' },
  );
  const callModel = createOllamaAgentModel({ url: 'http://ollama:11434', model: 'qwen2.5:3b', fetchImpl });
  const resultado = await runAgent({
    prompt: '¿qué falta?',
    tools: [{ name: 'consultar_stock_critico', description: 'Stock', inputSchema: { type: 'object', properties: {} } }],
    runTool: async () => ({ items: [{ name: 'Keratina' }] }),
    callModel,
    today: '2026-11-09',
    timeZone: 'America/La_Paz',
  });
  assert.equal(resultado.answer, 'Falta keratina.');
  assert.equal(resultado.engine, 'Ollama qwen2.5:3b (local)');
  assert.deepEqual(resultado.toolsUsed, ['consultar_stock_critico']);
  assert.equal(llamadas[0].url, 'http://ollama:11434/api/chat');
  assert.equal(llamadas[0].body.stream, false);
  // La segunda vuelta le devuelve al modelo el resultado real de la herramienta
  assert.equal(llamadas[1].body.messages.at(-1).role, 'tool');
  assert.match(llamadas[1].body.messages.at(-1).content, /Keratina/);
});

test('sin OLLAMA_URL o con el modelo caído no responde, y se usa el respaldo', async () => {
  assert.equal(await createOllamaAgentModel({ url: '' })({ contents: [], declarations: [] }), null);
  const { fetchImpl } = ollamaFalso(null);
  const local = createOllamaGenerator({ url: 'http://ollama:11434', fetchImpl });
  const respaldo = async () => ({ engine: 'Google gemini', text: 'respaldo' });
  assert.deepEqual(await firstAvailable(local, respaldo)('pregunta', {}), { engine: 'Google gemini', text: 'respaldo' });
});

test('en la nube envía la clave del proxy de Ollama', async () => {
  const cabeceras = [];
  const fetchImpl = async (url, init) => {
    cabeceras.push(init.headers);
    return new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 });
  };
  process.env.OLLAMA_API_KEY = 'clave-del-proxy';
  try {
    await createOllamaGenerator({ url: 'https://llm', fetchImpl })('pregunta', {});
  } finally {
    delete process.env.OLLAMA_API_KEY;
  }
  assert.equal(cabeceras[0].Authorization, 'Bearer clave-del-proxy');
});

test('si el modelo local responde, no se consulta el respaldo', async () => {
  let respaldoUsado = false;
  const local = async () => ({ engine: 'Ollama', text: 'local' });
  const respaldo = async () => { respaldoUsado = true; return null; };
  assert.equal((await firstAvailable(local, respaldo)()).text, 'local');
  assert.equal(respaldoUsado, false);
});
