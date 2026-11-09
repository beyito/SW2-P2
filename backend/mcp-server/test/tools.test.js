const test = require('node:test');
const assert = require('node:assert/strict');
const { BackendError, createBackends } = require('../src/backends');
const { createGeminiGenerator } = require('../src/gemini');
const { createToolRunner, periodRange, toolsFor } = require('../src/tools');

const SUMMARY = { totalAppointments: 4, pendingPayment: 0, active: 2, completed: 1, cancelled: 1, bookedValue: 165, occupancyRate: 0.125 };
const BILLING = { revenue: 120, refunded: 45, invoicesIssued: 3, payingClients: 2, totalClients: 5, pointsEarned: 1650, pointsRedeemed: 500 };
const CRITICAL = [
  { id: 'i1', code: 'KER', name: 'Keratina', category: 'TRATAMIENTOS', currentStock: 3, minimumStock: 4 },
  { id: 'i2', code: 'TIN', name: 'Tinte', category: 'COLORACION', currentStock: 5, minimumStock: 5 },
];

function fakeBackends(overrides = {}) {
  return {
    stylists: async () => [{ id: 'sty-1', name: 'Ana' }],
    services: async () => [{ id: 'largo', durationMinutes: 120 }, { id: 'corto', durationMinutes: 30 }],
    availableSlots: async () => [{ start: '2026-11-09T09:00:00', end: '2026-11-09T09:30:00' }],
    criticalStock: async () => CRITICAL,
    panelSummary: async () => SUMMARY,
    crmMetrics: async () => BILLING,
    ...overrides,
  };
}

const NOW = () => new Date('2026-11-06T15:00:00Z');
const runner = (backends = fakeBackends(), generateText = async () => null) =>
  createToolRunner({ backends, generateText, now: NOW, timeZone: 'America/La_Paz' });

test('periodRange calcula periodos que terminan hoy en la zona del salón', () => {
  assert.deepEqual(periodRange('DAILY', NOW(), 'America/La_Paz'), { from: '2026-11-06', to: '2026-11-06' });
  assert.deepEqual(periodRange('WEEKLY', NOW(), 'America/La_Paz'), { from: '2026-10-31', to: '2026-11-06' });
  assert.deepEqual(periodRange('MONTHLY', NOW(), 'America/La_Paz'), { from: '2026-10-08', to: '2026-11-06' });
  // A las 02:00 UTC todavía es el día anterior en La Paz
  assert.equal(periodRange('DAILY', new Date('2026-11-06T02:00:00Z'), 'America/La_Paz').to, '2026-11-05');
  assert.throws(() => periodRange('ANUAL', NOW(), 'UTC'), BackendError);
});

test('toolsFor solo muestra lo que cada rol puede usar', () => {
  const names = (roles) => toolsFor(roles).map((tool) => tool.name);
  assert.deepEqual(names(['CLIENT']), ['listar_estilistas', 'consultar_disponibilidad_estilista']);
  assert.ok(names(['STYLIST']).includes('consultar_stock_critico'));
  assert.ok(!names(['STYLIST']).includes('obtener_metricas_negocio'));
  assert.equal(names(["ADMIN"]).length, 14);
  // Los reportes incluyen datos de clientes y facturación: solo la administración
  assert.ok(names(['ADMIN']).includes('generar_reporte'));
  assert.ok(!names(['STYLIST']).includes('generar_reporte'));
  assert.ok(!names(['STYLIST']).includes('catalogo_reportes'));
});

test('la disponibilidad usa el servicio más corto si no se indica uno', async () => {
  let service;
  const backends = fakeBackends({ availableSlots: async (_, serviceId) => { service = serviceId; return []; } });
  const result = await runner(backends)('consultar_disponibilidad_estilista', { stylistId: 'sty-1', date: '2026-11-09' });
  assert.equal(service, 'corto');
  assert.equal(result.isFullyBooked, true);
});

test('la disponibilidad rechaza una fecha mal escrita', async () => {
  await assert.rejects(runner()('consultar_disponibilidad_estilista', { stylistId: 'sty-1', date: 'mañana' }), BackendError);
});

test('el stock crítico calcula el faltante y filtra por categoría', async () => {
  const all = await runner()('consultar_stock_critico');
  assert.equal(all.criticalItemsCount, 2);
  assert.equal(all.items[0].shortage, 1);
  assert.equal(all.items[1].shortage, 0);

  const filtered = await runner()('consultar_stock_critico', { category: 'COLORACION' });
  assert.deepEqual(filtered.items.map((item) => item.code), ['TIN']);
});

test('las métricas combinan la operación de ms-gestion y la facturación de ms-crm', async () => {
  const ranges = [];
  const backends = fakeBackends({
    panelSummary: async (from, to) => { ranges.push([from, to]); return SUMMARY; },
    crmMetrics: async (from, to) => { ranges.push([from, to]); return BILLING; },
  });
  const result = await runner(backends)('obtener_metricas_negocio', { period: 'DAILY' });
  assert.deepEqual(ranges, [['2026-11-06', '2026-11-06'], ['2026-11-06', '2026-11-06']]);
  assert.equal(result.appointments.totalAppointments, 4);
  assert.equal(result.billing.revenue, 120);
});

test('un fallo del servicio se propaga: nunca se inventan métricas', async () => {
  const backends = fakeBackends({ crmMetrics: async () => { throw new BackendError('CRM caído'); } });
  await assert.rejects(runner(backends)('obtener_metricas_negocio'), /CRM caído/);
});

test('el reporte usa el modelo con los datos reales del salón', async () => {
  let received;
  const generate = async (prompt, context) => { received = { prompt, context }; return { engine: 'Modelo X', text: 'Informe' }; };
  const result = await runner(fakeBackends(), generate)('generar_reporte_lenguaje_natural', { prompt: '¿Cómo vamos?' });
  assert.equal(result.engine, 'Modelo X');
  assert.equal(result.generatedReport, 'Informe');
  assert.equal(received.context.metrics.billing.revenue, 120);
  assert.equal(received.context.criticalStock.criticalItemsCount, 2);
});

test('sin modelo, el reporte se arma solo con cifras reales', async () => {
  const result = await runner()('generar_reporte_lenguaje_natural', { prompt: '¿Cómo vamos?' });
  assert.equal(result.engine, 'Resumen sin modelo de lenguaje');
  assert.match(result.generatedReport, /\$120\.00/);
  assert.match(result.generatedReport, /12\.5%/);
  assert.match(result.generatedReport, /Keratina \(3 de mínimo 4\)/);
});

test('el reporte exige una pregunta', async () => {
  await assert.rejects(runner()('generar_reporte_lenguaje_natural', { prompt: '  ' }), BackendError);
});

test('los clientes GraphQL reenvían el token y traducen los errores', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    return { ok: true, status: 200, json: async () => ({ errors: [{ message: 'Rol insuficiente' }] }) };
  };
  const backends = createBackends({ gestionUrl: 'http://gestion', crmUrl: 'http://crm', fetchImpl })('token-abc');

  await assert.rejects(backends.crmMetrics('2026-01-01', '2026-01-02'), /Rol insuficiente/);
  assert.deepEqual(calls, [{ url: 'http://crm', auth: 'Bearer token-abc' }]);
});

test('un servicio inalcanzable se informa sin detalles internos', async () => {
  const fetchImpl = async () => { throw new Error('connect ECONNREFUSED 172.18.0.5:8081'); };
  const backends = createBackends({ gestionUrl: 'http://gestion', crmUrl: 'http://crm', fetchImpl })('t');
  await assert.rejects(backends.stylists(), (error) => {
    assert.ok(error instanceof BackendError);
    assert.doesNotMatch(error.message, /ECONNREFUSED|172\.18/);
    return true;
  });
});

test('Gemini: sin clave no llama a la API y envía la clave por cabecera, no en la URL', async () => {
  assert.equal(await createGeminiGenerator({ apiKey: '', fetchImpl: () => assert.fail('no debe llamar') })('p', {}), null);

  let call;
  const fetchImpl = async (url, options) => {
    call = { url, key: options.headers['x-goog-api-key'] };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: ' Hola ' }] } }] }) };
  };
  const result = await createGeminiGenerator({ apiKey: 'secreta', model: 'modelo-x', fetchImpl })('p', {});
  assert.deepEqual(result, { engine: 'Google modelo-x', text: 'Hola' });
  assert.equal(call.key, 'secreta');
  assert.doesNotMatch(call.url, /secreta/);
});

test('Gemini: un error de la API devuelve null para usar el resumen real', async () => {
  const failing = createGeminiGenerator({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(await failing('p', {}), null);
});
