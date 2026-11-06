/**
 * API del orquestador: iniciar reservas, consultar su avance y recibir webhooks de la pasarela.
 */
const crypto = require('crypto');
const http = require('http');
const { AuthError } = require('./security');

const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(400, 'BODY_TOO_LARGE', 'El cuerpo de la petición es demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBooking(raw) {
  let body;
  try {
    body = JSON.parse(raw.toString() || '{}');
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'El cuerpo debe ser JSON válido.');
  }
  const { serviceId, stylistId, appointmentDate } = body;
  const valid = [serviceId, stylistId, appointmentDate].every((value) => typeof value === 'string' && value.length > 0);
  if (!valid) {
    throw new HttpError(400, 'INVALID_BOOKING', 'Se requieren serviceId, stylistId y appointmentDate.');
  }
  return { serviceId, stylistId, appointmentDate };
}

/** Datos de la SAGA visibles para el usuario; el secreto del cobro solo mientras se espera el pago. */
function toView(saga) {
  return {
    sagaId: saga.sagaId,
    status: saga.state,
    appointmentId: saga.appointmentId ?? null,
    serviceName: saga.serviceName ?? null,
    amountCents: saga.amountCents ?? null,
    clientSecret: saga.state === 'AWAITING_PAYMENT' ? saga.clientSecret : null,
    failureReason: saga.failureReason ?? null,
    refunded: Boolean(saga.refunded),
    history: saga.history,
  };
}

function createApi({ authenticate, runner, repository, idempotency, gateway, publisher, publishableKey, allowedOrigins, newId = crypto.randomUUID }) {
  const isStaff = (user) => user.roles.includes('ADMIN') || user.roles.includes('STYLIST');

  async function findOwned(sagaId, user) {
    const saga = await repository.get(sagaId);
    if (!saga) throw new HttpError(404, 'NOT_FOUND', 'La reserva no existe.');
    if (saga.clientId !== user.id && !isStaff(user)) {
      throw new HttpError(403, 'NOT_OWNER', 'No puede acceder a la reserva de otro cliente.');
    }
    return saga;
  }

  /** Reintentar con la misma llave devuelve la misma SAGA y nunca inicia otra (RNF-04). */
  async function createBooking(req, res) {
    const user = await authenticate(req.headers.authorization);
    const header = req.headers['idempotency-key'];
    if (!header) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'La cabecera Idempotency-Key es obligatoria.');
    }

    const booking = parseBooking(await readBody(req));
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(booking)).digest('hex');
    const claim = await idempotency.claim(`booking:${user.subject}:${header}`, newId(), requestHash);

    if (claim.requestHash !== requestHash) {
      throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'La Idempotency-Key ya se usó con otros datos.');
    }

    // Si un intento anterior se cayó tras reclamar la llave, la SAGA aún no existe y se inicia aquí
    const existing = claim.claimed ? null : await repository.get(claim.sagaId);
    const saga = existing ?? (await runner.start({ sagaId: claim.sagaId, clientId: user.id, ...booking }));

    if (!claim.claimed) res.setHeader('X-Idempotent-Replay', 'true');
    send(res, claim.claimed ? 202 : 200, toView(saga));
  }

  async function getBooking(res, sagaId, authorization) {
    const user = await authenticate(authorization);
    send(res, 200, toView(await findOwned(sagaId, user)));
  }

  async function syncBooking(res, sagaId, authorization) {
    const user = await authenticate(authorization);
    const saga = await findOwned(sagaId, user);
    await runner.syncPayment(saga);
    send(res, 202, toView(saga));
  }

  async function stripeWebhook(req, res) {
    const raw = await readBody(req);
    let event;
    try {
      event = gateway.parseWebhook(raw, req.headers['stripe-signature']);
    } catch {
      throw new HttpError(400, 'INVALID_SIGNATURE', 'Firma de webhook inválida.');
    }
    if (event) await publisher.publish(event.routingKey, event.body);
    send(res, 200, { received: true });
  }

  function send(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  function applyCors(req, res) {
    const { origin } = req.headers;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      res.setHeader('Access-Control-Expose-Headers', 'X-Idempotent-Replay');
    }
  }

  async function route(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const bookingMatch = pathname.match(/^\/bookings\/([\w-]+)(\/sync)?$/);

    if (req.method === 'GET' && pathname === '/health') return send(res, 200, { status: 'UP', service: 'saga-orchestrator' });
    if (req.method === 'GET' && pathname === '/payments/config') return send(res, 200, { publishableKey });
    if (req.method === 'POST' && pathname === '/webhooks/stripe') return stripeWebhook(req, res);
    if (req.method === 'POST' && pathname === '/bookings') return createBooking(req, res);
    if (req.method === 'GET' && bookingMatch && !bookingMatch[2]) return getBooking(res, bookingMatch[1], req.headers.authorization);
    if (req.method === 'POST' && bookingMatch?.[2]) return syncBooking(res, bookingMatch[1], req.headers.authorization);
    throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado.');
  }

  return http.createServer(async (req, res) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      await route(req, res);
    } catch (error) {
      if (error instanceof HttpError || error instanceof AuthError) {
        send(res, error.status, { code: error.code, message: error.message });
      } else {
        console.error('[SAGA] Error interno:', error);
        send(res, 500, { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' });
      }
    }
  });
}

module.exports = { createApi };
