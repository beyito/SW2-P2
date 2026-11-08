/**
 * API del orquestador: iniciar reservas, consultar su avance y recibir webhooks de la pasarela.
 */
const crypto = require('crypto');
const http = require('http');
const { STATES, CANCELLATION_STATES, REVERTED_STATES } = require('./saga-engine');
const { isCounter } = require('./saga-runner');
const { AuthError } = require('./security');

const MAX_BODY_BYTES = 1024 * 1024;

/** Roles que atienden el mostrador: agendan y cobran a clientes que llegan sin reserva. */
const DESK_ROLES = ['ADMIN', 'RECEPTIONIST'];
const COUNTER_METHODS = ['CASH', 'CARD_TERMINAL'];
const CLIENT_ID = /^[\w.@-]{1,64}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
/** Estados en los que el cobro del mostrador ya quedó registrado. */
const PAID_STATES = [
  STATES.CONFIRMING_APPOINTMENT, STATES.COMMITTING_STOCK, STATES.COMPLETED, ...CANCELLATION_STATES,
];

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

function parseJson(raw) {
  try {
    return JSON.parse(raw.toString() || '{}');
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'El cuerpo debe ser JSON válido.');
  }
}

function parseBooking(raw) {
  const body = parseJson(raw);
  const { serviceId, stylistId, appointmentDate, pointsToRedeem = 0 } = body;
  const valid = [serviceId, stylistId, appointmentDate].every((value) => typeof value === 'string' && value.length > 0);
  if (!valid) {
    throw new HttpError(400, 'INVALID_BOOKING', 'Se requieren serviceId, stylistId y appointmentDate.');
  }
  if (!Number.isInteger(pointsToRedeem) || pointsToRedeem < 0) {
    throw new HttpError(400, 'INVALID_POINTS', 'pointsToRedeem debe ser un entero no negativo.');
  }
  return { serviceId, stylistId, appointmentDate, pointsToRedeem };
}

/** Reserva del mostrador: además del turno, a qué cliente se le agenda y cómo pagó. */
function parseCounterBooking(raw) {
  const body = parseJson(raw);
  const { serviceId, stylistId, appointmentDate, clientId, clientName, clientEmail, paymentMethod } = body;
  const valid = [serviceId, stylistId, appointmentDate].every((value) => typeof value === 'string' && value.length > 0);
  if (!valid) {
    throw new HttpError(400, 'INVALID_BOOKING', 'Se requieren serviceId, stylistId y appointmentDate.');
  }
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
    throw new HttpError(400, 'INVALID_CLIENT', 'Seleccione un cliente registrado.');
  }
  if (typeof clientName !== 'string' || !clientName.trim() || clientName.length > 120) {
    throw new HttpError(400, 'INVALID_CLIENT', 'Falta el nombre del cliente.');
  }
  if (clientEmail != null && (typeof clientEmail !== 'string' || !EMAIL.test(clientEmail))) {
    throw new HttpError(400, 'INVALID_CLIENT', 'El correo del cliente no es válido.');
  }
  if (!COUNTER_METHODS.includes(paymentMethod)) {
    throw new HttpError(400, 'INVALID_PAYMENT_METHOD', 'La forma de pago debe ser efectivo o tarjeta en el terminal.');
  }
  return {
    serviceId, stylistId, appointmentDate, clientId, clientName: clientName.trim(), clientEmail: clientEmail ?? null, paymentMethod,
  };
}

/** Datos de la SAGA visibles para el usuario; el secreto del cobro solo mientras se espera el pago. */
function toView(saga) {
  return {
    sagaId: saga.sagaId,
    status: saga.state,
    appointmentId: saga.appointmentId ?? null,
    serviceName: saga.serviceName ?? null,
    amountCents: saga.amountCents ?? null,
    discountCents: saga.discountCents ?? 0,
    pointsRedeemed: saga.pointsRedeemed ?? 0,
    amountToPayCents: saga.amountCents != null ? saga.amountCents - (saga.discountCents ?? 0) : null,
    cancelRejectedReason: saga.cancelRejectedReason ?? null,
    clientSecret: saga.state === 'AWAITING_PAYMENT' ? saga.clientSecret : null,
    failureReason: saga.failureReason ?? null,
    refunded: Boolean(saga.refunded),
    channel: saga.channel ?? 'ONLINE',
    paymentMethod: saga.paymentMethod ?? 'CARD',
    clientId: saga.clientId,
    history: saga.history,
  };
}

function createApi({ authenticate, runner, repository, idempotency, gateway, publisher, publishableKey, allowedOrigins, newId = crypto.randomUUID }) {
  const isStaff = (user) => ['ADMIN', 'STYLIST', 'RECEPTIONIST'].some((role) => user.roles.includes(role));
  const isDesk = (user) => DESK_ROLES.some((role) => user.roles.includes(role));

  async function findOwned(sagaId, user) {
    const saga = await repository.get(sagaId);
    if (!saga) throw new HttpError(404, 'NOT_FOUND', 'La reserva no existe.');
    if (saga.clientId !== user.id && !isStaff(user)) {
      throw new HttpError(403, 'NOT_OWNER', 'No puede acceder a la reserva de otro cliente.');
    }
    return saga;
  }

  function requireKey(req) {
    const header = req.headers['idempotency-key'];
    if (!header) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'La cabecera Idempotency-Key es obligatoria.');
    }
    return header;
  }

  /**
   * Reintentar con la misma llave devuelve la misma SAGA y nunca inicia otra (RNF-04).
   * `scope` separa las llaves del portal y las del mostrador.
   */
  async function startOnce(res, key, user, scope, booking, start) {
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(booking)).digest('hex');
    const claim = await idempotency.claim(`${scope}:${user.subject}:${key}`, newId(), requestHash);

    if (claim.requestHash !== requestHash) {
      throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'La Idempotency-Key ya se usó con otros datos.');
    }

    // Si un intento anterior se cayó tras reclamar la llave, la SAGA aún no existe y se inicia aquí
    const existing = claim.claimed ? null : await repository.get(claim.sagaId);
    const saga = existing ?? (await runner.start({ sagaId: claim.sagaId, ...start }));

    if (!claim.claimed) res.setHeader('X-Idempotent-Replay', 'true');
    send(res, claim.claimed ? 202 : 200, toView(saga));
  }

  async function createBooking(req, res) {
    const user = await authenticate(req.headers.authorization);
    const key = requireKey(req);
    const booking = parseBooking(await readBody(req));
    await startOnce(res, key, user, 'booking', booking, {
      clientId: user.id, clientName: user.name, clientEmail: user.email, ...booking,
    });
  }

  async function requireDesk(authorization) {
    const user = await authenticate(authorization);
    if (!isDesk(user)) {
      throw new HttpError(403, 'FORBIDDEN', 'Solo la recepción o la administración atienden el mostrador.');
    }
    return user;
  }

  async function counterSaga(sagaId) {
    const saga = await repository.get(sagaId);
    if (!saga) throw new HttpError(404, 'NOT_FOUND', 'La reserva no existe.');
    if (!isCounter(saga)) throw new HttpError(409, 'NOT_COUNTER', 'Esta reserva se paga en línea, no en el mostrador.');
    return saga;
  }

  /** Cliente sin reserva: la recepción le agenda el turno y le cobra en el momento (CU-06, CU-10). */
  async function createCounterBooking(req, res) {
    const user = await requireDesk(req.headers.authorization);
    const key = requireKey(req);
    const booking = parseCounterBooking(await readBody(req));
    await startOnce(res, key, user, 'counter', booking, {
      ...booking, pointsToRedeem: 0, channel: 'COUNTER', cashierId: user.id,
    });
  }

  /** La recepción confirma que recibió el dinero: es el paso pivote. Repetirlo no cobra dos veces. */
  async function payCounterBooking(res, sagaId, authorization) {
    const user = await requireDesk(authorization);
    const saga = await counterSaga(sagaId);
    if (PAID_STATES.includes(saga.state)) return send(res, 200, toView(saga));
    if (REVERTED_STATES.includes(saga.state)) {
      throw new HttpError(409, 'BOOKING_REVERTED', 'La reserva ya se anuló o venció: no cobre al cliente.');
    }
    if (saga.state !== STATES.AWAITING_PAYMENT) {
      throw new HttpError(409, 'NOT_READY', 'El turno todavía se está apartando. Intente en unos segundos.');
    }
    await publisher.publish('saga.event.payment.succeeded', { sagaId, cashierId: user.id });
    send(res, 202, toView(saga));
  }

  /** El cliente se retiró sin pagar: se libera el turno y se devuelven los insumos. */
  async function voidCounterBooking(res, sagaId, authorization) {
    await requireDesk(authorization);
    const saga = await counterSaga(sagaId);
    if (REVERTED_STATES.includes(saga.state)) return send(res, 200, toView(saga));
    if (PAID_STATES.includes(saga.state)) {
      throw new HttpError(409, 'ALREADY_PAID', 'La reserva ya está cobrada: para anularla hay que cancelarla con reembolso.');
    }
    if (saga.state !== STATES.AWAITING_PAYMENT) {
      throw new HttpError(409, 'NOT_READY', 'El turno todavía se está apartando. Intente en unos segundos.');
    }
    await publisher.publish('saga.event.payment.failed', { sagaId, reason: 'COUNTER_VOIDED' });
    send(res, 202, toView(saga));
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

  /** Cancela una reserva pagada y la reembolsa (CU-07). Repetir la solicitud no tiene efecto. */
  async function cancelBooking(res, sagaId, authorization) {
    const user = await authenticate(authorization);
    const saga = await findOwned(sagaId, user);
    if (CANCELLATION_STATES.includes(saga.state)) {
      return send(res, 200, toView(saga));
    }
    if (saga.state !== STATES.COMPLETED) {
      throw new HttpError(409, 'NOT_CANCELLABLE', 'Solo se puede cancelar una reserva pagada.');
    }
    await publisher.publish('saga.event.cancel.requested', { sagaId });
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
    const bookingMatch = pathname.match(/^\/bookings\/([\w-]+)(?:\/(sync|cancel))?$/);
    const counterMatch = pathname.match(/^\/counter\/bookings\/([\w-]+)\/(pay|void)$/);

    if (req.method === 'GET' && pathname === '/health') return send(res, 200, { status: 'UP', service: 'saga-orchestrator' });
    if (req.method === 'GET' && pathname === '/payments/config') return send(res, 200, { publishableKey });
    if (req.method === 'POST' && pathname === '/webhooks/stripe') return stripeWebhook(req, res);
    if (req.method === 'POST' && pathname === '/bookings') return createBooking(req, res);
    if (req.method === 'POST' && pathname === '/counter/bookings') return createCounterBooking(req, res);
    if (req.method === 'POST' && counterMatch?.[2] === 'pay') return payCounterBooking(res, counterMatch[1], req.headers.authorization);
    if (req.method === 'POST' && counterMatch?.[2] === 'void') return voidCounterBooking(res, counterMatch[1], req.headers.authorization);
    if (req.method === 'GET' && bookingMatch && !bookingMatch[2]) return getBooking(res, bookingMatch[1], req.headers.authorization);
    if (req.method === 'POST' && bookingMatch?.[2] === 'sync') return syncBooking(res, bookingMatch[1], req.headers.authorization);
    if (req.method === 'POST' && bookingMatch?.[2] === 'cancel') return cancelBooking(res, bookingMatch[1], req.headers.authorization);
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
