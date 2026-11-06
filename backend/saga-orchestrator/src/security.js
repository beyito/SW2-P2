/**
 * Seguridad del orquestador: token válido de Keycloak y sesión vigente (RF-01).
 */
const { createRemoteJWKSet, jwtVerify } = require('jose');

const TABLE = 'ActiveUserSessions';
const CONDITION_FAILED = 'ConditionalCheckFailedException';
const EIGHT_HOURS = 28800;

/** Error con su código HTTP semántico. */
class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Registro de sesiones sobre la tabla ActiveUserSessions de DynamoDB. */
class DynamoSessionRegistry {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async call(target, payload) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': `DynamoDB_20120810.${target}`,
        Authorization:
          'AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, SignedHeaders=host, Signature=local',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.json();
    if (!response.ok && !String(body.__type).includes(CONDITION_FAILED)) {
      throw new Error(`DynamoDB respondió ${response.status}`);
    }
    return body;
  }

  get(key) {
    return this.call('GetItem', { TableName: TABLE, ConsistentRead: true, Key: { userId: { S: key } } });
  }

  async isRevoked(sessionId) {
    const { Item } = await this.get(`revoked#${sessionId}`);
    return Boolean(Item);
  }

  async findActive(userId) {
    const { Item } = await this.get(userId);
    return Item ? { sessionId: Item.sessionId.S, authTime: Number(Item.loginTimestamp.N) } : null;
  }

  async claimActive(userId, sessionId, authTime) {
    const result = await this.call('PutItem', {
      TableName: TABLE,
      Item: {
        userId: { S: userId },
        sessionId: { S: sessionId },
        loginTimestamp: { N: String(authTime) },
        ttl: { N: String(authTime + EIGHT_HOURS) },
      },
      ConditionExpression: 'attribute_not_exists(userId) OR loginTimestamp < :t OR sessionId = :s',
      ExpressionAttributeValues: { ':t': { N: String(authTime) }, ':s': { S: sessionId } },
    });
    return !String(result.__type).includes(CONDITION_FAILED);
  }
}

/** Crea el verificador de tokens contra el JWKS de Keycloak. */
function createKeycloakVerifier({ issuer, audience, jwksUri }) {
  const keys = createRemoteJWKSet(new URL(jwksUri));
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'] });
    return payload;
  };
}

async function holdsActiveSession(sessions, claims) {
  const authTime = Number(claims.auth_time ?? 0);
  const active = await sessions.findActive(claims.sub);
  if (active && active.sessionId === claims.sid) return true;
  if (active && authTime <= active.authTime) return false;
  return sessions.claimActive(claims.sub, claims.sid, authTime);
}

/** Rechaza sesiones cerradas y aplica sesión única a ADMIN: gana el login más reciente. */
async function assertSessionValid(sessions, claims, roles) {
  // Las cuentas de servicio de los agentes no tienen sesión de usuario
  if (!claims.sid) return;
  try {
    if (await sessions.isRevoked(claims.sid)) {
      throw new AuthError(401, 'SESSION_CLOSED', 'La sesión fue cerrada.');
    }
    if (roles.includes('ADMIN') && !(await holdsActiveSession(sessions, claims))) {
      throw new AuthError(401, 'SESSION_SUPERSEDED', 'Se inició una sesión más reciente en otro dispositivo.');
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(401, 'SESSION_UNAVAILABLE', 'No se pudo verificar la sesión.');
  }
}

/** Crea la función que autentica la cabecera Authorization y devuelve la identidad. */
function createAuthenticator({ verify, sessions }) {
  return async (authorization) => {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new AuthError(401, 'TOKEN_MISSING', 'Token de acceso no proporcionado.');
    }
    let claims;
    try {
      claims = await verify(authorization.slice('Bearer '.length));
    } catch {
      throw new AuthError(401, 'TOKEN_INVALID', 'Token de acceso inválido o vencido.');
    }
    const roles = claims.realm_access?.roles ?? [];
    await assertSessionValid(sessions, claims, roles);
    return { subject: claims.sub, id: claims.salon_id ?? claims.sub, roles };
  };
}

module.exports = { AuthError, DynamoSessionRegistry, createKeycloakVerifier, createAuthenticator };
