const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { AuthError, createAuthenticator } = require('../src/security');
const { McpServer, canUseTool } = require('../src/server');

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

// Pruebas del protocolo HTTP sobre el servidor real
const server = new McpServer(0, authenticatorWith());
let port;

function rpc(token, method, params) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { port, path: '/mcp/rpc', method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

test.before(async () => {
  const instance = await server.start();
  port = instance.address().port;
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

test('HTTP: tools/list solo muestra las herramientas permitidas al rol', async () => {
  const { status, body } = await rpc('client', 'tools/list');
  assert.equal(status, 200);
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ['consultar_disponibilidad_estilista']);
});

test('HTTP: un agente autorizado invoca la herramienta', async () => {
  const { status, body } = await rpc('agent', 'tools/call', { name: 'obtener_metricas_negocio', arguments: {} });
  assert.equal(status, 200);
  assert.ok(body.result);
});
