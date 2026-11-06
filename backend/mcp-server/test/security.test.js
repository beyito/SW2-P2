const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { AuthError, createAuthenticator } = require('../src/security');
const { BackendError } = require('../src/backends');
const { McpHttpServer } = require('../src/server');
const { canUseTool } = require('../src/tools');

const CLAIMS = {
  admin: { sub: 'u-admin', sid: 's1', auth_time: 100, realm_access: { roles: ['ADMIN'] } },
  client: { sub: 'u-client', sid: 's3', auth_time: 100, realm_access: { roles: ['CLIENT'] } },
  agent: { sub: 'u-agent', azp: 'salon-agent', realm_access: { roles: ['ADMIN'] } },
};

function fakeSessions(overrides = {}) {
  return {
    isRevoked: async () => false,
    findActive: async () => null,
    claimActive: async () => true,
    ...overrides,
  };
}

function authenticatorWith(sessions = fakeSessions()) {
  return createAuthenticator({
    sessions,
    verify: async (token) => {
      if (!CLAIMS[token]) throw new Error('firma inválida');
      return CLAIMS[token];
    },
  });
}

async function rejectedWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test('rechaza una petición sin token', () => rejectedWith(authenticatorWith()(undefined), 401, 'TOKEN_MISSING'));

test('rechaza un token inválido', () => rejectedWith(authenticatorWith()('Bearer basura'), 401, 'TOKEN_INVALID'));

test('acepta la cuenta de servicio de un agente sin consultar sesiones', async () => {
  const sessions = fakeSessions({ isRevoked: async () => assert.fail('no debe consultar') });
  const user = await authenticatorWith(sessions)('Bearer agent');
  assert.deepEqual(user.roles, ['ADMIN']);
});

test('rechaza una sesión cerrada', () =>
  rejectedWith(authenticatorWith(fakeSessions({ isRevoked: async () => true }))('Bearer client'), 401, 'SESSION_CLOSED'));

test('la sesión de ADMIN desplazada recibe 401', () =>
  rejectedWith(
    authenticatorWith(fakeSessions({ findActive: async () => ({ sessionId: 's2', authTime: 200 }) }))('Bearer admin'),
    401,
    'SESSION_SUPERSEDED',
  ));

test('si el registro falla, rechaza el acceso', () =>
  rejectedWith(
    authenticatorWith(fakeSessions({ isRevoked: async () => { throw new Error('caído'); } }))('Bearer client'),
    401,
    'SESSION_UNAVAILABLE',
  ));

test('las métricas son solo para ADMIN', () => {
  assert.equal(canUseTool('obtener_metricas_negocio', ['ADMIN']), true);
  assert.equal(canUseTool('obtener_metricas_negocio', ['STYLIST']), false);
  assert.equal(canUseTool('obtener_metricas_negocio', ['CLIENT']), false);
  assert.equal(canUseTool('herramienta_inexistente', ['ADMIN']), false);
});

// Pruebas del protocolo sobre el servidor real, con datos de prueba en lugar de los microservicios
const tokensSeen = [];
const server = new McpHttpServer({
  port: 0,
  authenticate: authenticatorWith(),
  generateText: async () => null,
  backendsFor: (token) => {
    tokensSeen.push(token);
    return {
      panelSummary: async () => ({ totalAppointments: 7, active: 1, completed: 2, cancelled: 3, occupancyRate: 0.5 }),
      crmMetrics: async () => ({ revenue: 99.5 }),
      stylists: async () => { throw new BackendError('Servicio caído'); },
    };
  },
});
let port;
let url;

async function rpc(token, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: response.status, body: await response.json() };
}

/** Cliente MCP oficial: comprueba que el servidor cumple el protocolo real, handshake incluido. */
async function connectClient(token) {
  const client = new Client({ name: 'prueba', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

test.before(async () => {
  const instance = await server.start();
  port = instance.address().port;
  url = `http://127.0.0.1:${port}/mcp`;
});

test.after(() => server.stop());

test('HTTP: sin token responde 401', async () => {
  const { status, body } = await rpc(null, 'tools/list');
  assert.equal(status, 401);
  assert.equal(body.error.data.code, 'TOKEN_MISSING');
});

test('HTTP: un cliente recibe 403 al invocar una herramienta de ADMIN', async () => {
  const { status, body } = await rpc('client', 'tools/call', { name: 'obtener_metricas_negocio', arguments: {} });
  assert.equal(status, 403);
  assert.equal(body.error.data.code, 'INSUFFICIENT_ROLE');
});

test('HTTP: un lote no puede esconder una herramienta prohibida', async () => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer client' },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'obtener_metricas_negocio', arguments: {} } },
    ]),
  });
  assert.equal(response.status, 403);
});

test('HTTP: un cuerpo que no es JSON responde 400', async () => {
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: '{roto' });
  assert.equal(response.status, 400);
});

test('HTTP: la ruta antigua ya no existe y GET no está permitido', async () => {
  const old = await fetch(`http://127.0.0.1:${port}/mcp/rpc`, { method: 'POST', body: '{}' });
  assert.equal(old.status, 404);
  assert.equal((await fetch(url)).status, 405);
});

test('MCP: el handshake del SDK oficial funciona e informa las capacidades', async () => {
  const client = await connectClient('admin');
  assert.equal(client.getServerVersion().name, 'salon-mcp');
  assert.ok(client.getServerCapabilities().tools);
  await client.close();
});

test('MCP: tools/list solo muestra lo permitido al rol, con su inputSchema', async () => {
  const client = await connectClient('client');
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['listar_estilistas', 'consultar_disponibilidad_estilista']);
  assert.equal(tools[1].inputSchema.type, 'object');
  await client.close();
});

test('MCP: un agente autorizado invoca la herramienta y el token llega a los servicios', async () => {
  const client = await connectClient('agent');
  const result = await client.callTool({ name: 'obtener_metricas_negocio', arguments: { period: 'DAILY' } });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.billing.revenue, 99.5);
  assert.equal(JSON.parse(result.content[0].text).appointments.totalAppointments, 7);
  assert.ok(tokensSeen.includes('agent'));
  await client.close();
});

test('MCP: el fallo de un servicio llega como error de herramienta, sin datos inventados', async () => {
  const client = await connectClient('client');
  const result = await client.callTool({ name: 'listar_estilistas', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Servicio caído/);
  await client.close();
});
