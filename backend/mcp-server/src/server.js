/**
 * Servidor MCP (Model Context Protocol) de la plataforma, sobre el transporte Streamable HTTP
 * del SDK oficial, sin estado: cada petición lleva su token de Keycloak y se valida por separado.
 * Cumple RNF-02, CU-17 y CU-18: los agentes solo llegan a los datos a través de este servidor.
 */
const http = require('node:http');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { AuthError, DynamoSessionRegistry, createAuthenticator, createKeycloakVerifier } = require('./security');
const { BackendError, createBackends } = require('./backends');
const { createGeminiAgentModel, createGeminiGenerator } = require('./gemini');
const { canUseTool, createToolRunner, toolsFor } = require('./tools');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 1024 * 1024;
const JSON_RPC_INVALID = -32600;
const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_AUTH_ERROR = -32001;

class McpHttpServer {
  constructor({
    port = 4000,
    authenticate = createDefaultAuthenticator(),
    backendsFor = createBackends({
      gestionUrl: process.env.GESTION_GRAPHQL_URL || 'http://localhost:8081/graphql',
      crmUrl: process.env.CRM_GRAPHQL_URL || 'http://localhost:8083/graphql',
    }),
    generateText = createGeminiGenerator(),
    callModel = createGeminiAgentModel(),
  } = {}) {
    this.port = port;
    this.authenticate = authenticate;
    this.backendsFor = backendsFor;
    this.generateText = generateText;
    this.callModel = callModel;
  }

  /** Crea el servidor de protocolo con los permisos y los datos de quien hace la petición. */
  createProtocolServer(user, token) {
    const server = new Server({ name: 'salon-mcp', version: '2.0.0' }, { capabilities: { tools: {} } });
    const runTool = createToolRunner({
      backends: this.backendsFor(token),
      generateText: this.generateText,
      callModel: this.callModel,
      roles: user.roles,
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor(user.roles) }));

    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const { name, arguments: args } = params;
      // Segunda barrera: el rol ya se comprobó antes de abrir el protocolo
      if (!canUseTool(name, user.roles)) {
        return toolError(`No tiene permiso para usar la herramienta '${name}'.`);
      }
      console.log(`[MCP] ${user.agentId} ejecuta ${name}`);
      try {
        const result = await runTool(name, args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        if (error instanceof BackendError) return toolError(error.message);
        console.error(`[MCP] Fallo inesperado en ${name}: ${error.message}`);
        return toolError('No se pudo completar la consulta.');
      }
    });

    return server;
  }

  applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Protocol-Version');
    }
  }

  sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  sendRpcError(res, status, id, code, message, data) {
    this.sendJson(res, status, { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
  }

  async handleMcp(req, res) {
    let rpcId = null;
    try {
      const rawBody = await readBody(req);
      const user = await this.authenticate(req.headers.authorization);

      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return this.sendRpcError(res, 400, null, JSON_RPC_PARSE_ERROR, 'El cuerpo no es JSON válido.');
      }
      rpcId = Array.isArray(body) ? null : (body.id ?? null);

      // Un rol insuficiente recibe 403 antes de entrar al protocolo (RNF-02)
      for (const message of [body].flat()) {
        if (message?.method === 'tools/call' && !canUseTool(message.params?.name, user.roles)) {
          throw new AuthError(403, 'INSUFFICIENT_ROLE', `Rol insuficiente para la herramienta '${message.params?.name}'.`);
        }
      }

      const token = req.headers.authorization.slice('Bearer '.length);
      const protocol = this.createProtocolServer(user, token);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close();
        protocol.close();
      });
      await protocol.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (res.headersSent) return undefined;
      if (error instanceof AuthError) {
        return this.sendRpcError(res, error.status, rpcId, JSON_RPC_AUTH_ERROR, error.message, { code: error.code });
      }
      if (error instanceof BodyTooLargeError) {
        return this.sendRpcError(res, 413, rpcId, JSON_RPC_INVALID, error.message);
      }
      console.error(`[MCP] Error interno: ${error.message}`);
      return this.sendRpcError(res, 500, rpcId, -32603, 'Error interno del servidor MCP.');
    }
    return undefined;
  }

  handle(req, res) {
    this.applyCors(req, res);
    const path = new URL(req.url, 'http://localhost').pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && path === '/health') {
      return this.sendJson(res, 200, { status: 'UP', service: 'mcp-server' });
    }
    if (path !== MCP_PATH) {
      return this.sendJson(res, 404, { error: 'Endpoint MCP no encontrado.' });
    }
    if (req.method !== 'POST') {
      // Sin estado: no hay sesiones ni canal de notificaciones que abrir o cerrar
      res.setHeader('Allow', 'POST, OPTIONS');
      return this.sendRpcError(res, 405, null, JSON_RPC_INVALID, 'Este servidor MCP solo acepta POST.');
    }
    return this.handleMcp(req, res);
  }

  start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[MCP] Servidor activo en el puerto ${this.server.address().port}${MCP_PATH}`);
        resolve(this.server);
      });
    });
  }

  stop() {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(resolve));
  }
}

class BodyTooLargeError extends Error {
  constructor() {
    super('La petición es demasiado grande.');
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function createDefaultAuthenticator() {
  const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/salon';
  return createAuthenticator({
    verify: createKeycloakVerifier({
      issuer,
      audience: process.env.KEYCLOAK_AUDIENCE || 'salon-api',
      jwksUri: process.env.KEYCLOAK_JWKS_URI || `${issuer}/protocol/openid-connect/certs`,
    }),
    sessions: new DynamoSessionRegistry(process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000'),
  });
}

module.exports = { McpHttpServer };

if (require.main === module) {
  new McpHttpServer({ port: Number(process.env.PORT) || 4000 }).start();
}
