const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES: S, decide } = require('../src/saga-engine');
const { SagaRunner } = require('../src/saga-runner');
const { createApi } = require('../src/http-api');
const { AuthError } = require('../src/security');

const silent = { info() {}, warn() {}, error() {} };

/** Repositorio en memoria con el mismo contrato que el de DynamoDB. */
class MemoryRepository {
  constructor() {
    this.sagas = new Map();
  }
  async createIfAbsent(saga) {
    if (!this.sagas.has(saga.sagaId)) this.sagas.set(saga.sagaId, saga);
  }
  async get(id) {
    return this.sagas.get(id) ?? null;
  }
  async transition(saga, state, patch = {}) {
    const next = { ...saga, ...patch, state, version: saga.version + 1, history: [...saga.history, { state }] };
    this.sagas.set(saga.sagaId, next);
    return next;
  }
  async patch(saga, patch) {
    const next = { ...saga, ...patch, version: saga.version + 1 };
    this.sagas.set(saga.sagaId, next);
    return next;
  }
}

function setup(paymentOverrides = {}) {
  const published = [];
  const delayed = [];
  const payments = {
    created: 0,
    refunds: 0,
    createPayment: async function () {
      this.created += 1;
      return { id: 'pi_1', clientSecret: 'secreto' };
    },
    cancelPayment: async () => 'canceled',
    refundPayment: async function () {
      this.refunds += 1;
    },
    getPayment: async () => ({ status: 'requires_payment_method', declined: false }),
    ...paymentOverrides,
  };
  const publisher = {
    publish: async (routingKey, body) => published.push({ routingKey, body }),
    publishDelayed: async (body, delayMs) => delayed.push({ body, delayMs }),
  };
  const repository = new MemoryRepository();
  const runner = new SagaRunner({ repository, publisher, payments, paymentTimeoutMs: 1000, logger: silent });
  return { runner, repository, publisher, payments, published, delayed };
}

const routingKeys = (published) => published.map((message) => message.routingKey);
const START = { sagaId: 's1', clientId: 'cli-001', stylistId: 'sty-101', serviceId: 'srv-01', appointmentDate: '2031-01-06T10:00:00' };

/** Lleva la SAGA hasta el estado de espera del pago. */
async function untilAwaitingPayment(context) {
  await context.runner.start(START);
  await context.runner.handle({ type: 'appointment.reserved', sagaId: 's1', appointmentId: 'apt-1', serviceName: 'Corte', amountCents: 4500 });
  await context.runner.handle({ type: 'inventory.reserved', sagaId: 's1' });
}

test('flujo exitoso: reserva, cobro, confirmación y descuento de stock', async () => {
  const context = setup();
  await untilAwaitingPayment(context);

  let saga = await context.repository.get('s1');
  assert.equal(saga.state, S.AWAITING_PAYMENT);
  assert.equal(saga.clientSecret, 'secreto');
  assert.equal(context.delayed.length, 1);

  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.confirmed', sagaId: 's1' });
  await context.runner.handle({ type: 'inventory.committed', sagaId: 's1' });

  saga = await context.repository.get('s1');
  assert.equal(saga.state, S.COMPLETED);
  assert.equal(saga.paid, true);
  assert.equal(saga.clientSecret, null);
  assert.deepEqual(routingKeys(context.published), [
    'saga.command.appointment.reserve',
    'saga.command.inventory.reserve',
    'saga.command.appointment.confirm',
    'saga.command.inventory.commit',
    'saga.completed',
  ]);
});

test('turno ocupado: falla sin compensar nada, porque nada se reservó', async () => {
  const context = setup();
  await context.runner.start(START);
  await context.runner.handle({ type: 'appointment.reserve_failed', sagaId: 's1', reason: 'SLOT_TAKEN' });

  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.FAILED);
  assert.equal(saga.failureReason, 'SLOT_TAKEN');
  assert.deepEqual(routingKeys(context.published), ['saga.command.appointment.reserve']);
});

test('stock insuficiente: libera el turno y no intenta cobrar', async () => {
  const context = setup();
  await context.runner.start(START);
  await context.runner.handle({ type: 'appointment.reserved', sagaId: 's1', appointmentId: 'apt-1', amountCents: 4500 });
  await context.runner.handle({ type: 'inventory.reserve_failed', sagaId: 's1', reason: 'STOCK_INSUFFICIENT' });
  await context.runner.handle({ type: 'appointment.released', sagaId: 's1' });

  assert.equal((await context.repository.get('s1')).state, S.COMPENSATED);
  assert.equal(context.payments.created, 0);
  assert.ok(routingKeys(context.published).includes('saga.command.appointment.cancel'));
  assert.ok(!routingKeys(context.published).includes('saga.command.inventory.release'));
});

test('pago rechazado: compensa en orden inverso, primero stock y luego turno', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.failed', sagaId: 's1', reason: 'PAYMENT_DECLINED' });
  await context.runner.handle({ type: 'inventory.released', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.released', sagaId: 's1' });

  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.COMPENSATED);
  assert.equal(saga.failureReason, 'PAYMENT_DECLINED');
  const keys = routingKeys(context.published);
  assert.ok(keys.indexOf('saga.command.inventory.release') < keys.indexOf('saga.command.appointment.cancel'));
  assert.equal(keys.at(-1), 'saga.compensated');
});

test('si la pasarela no crea el cobro, también compensa', async () => {
  const context = setup({ createPayment: async () => { throw new Error('Stripe caído'); } });
  await untilAwaitingPayment(context);
  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.COMPENSATING_STOCK);
  assert.equal(saga.failureReason, 'PAYMENT_UNAVAILABLE');
});

test('vence el plazo sin pago: cancela el cobro y compensa', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.timeout', sagaId: 's1' });
  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.COMPENSATING_STOCK);
  assert.equal(saga.failureReason, 'PAYMENT_TIMEOUT');
});

test('vence el plazo pero ya estaba pagado: confirma en lugar de revertir', async () => {
  const context = setup({ cancelPayment: async () => 'succeeded' });
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.timeout', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).state, S.CONFIRMING_APPOINTMENT);
});

test('el plazo vencido no afecta a una SAGA ya pagada', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  await context.runner.handle({ type: 'payment.timeout', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).state, S.CONFIRMING_APPOINTMENT);
});

test('tras el paso pivote un rechazo tardío no revierte la reserva', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  await context.runner.handle({ type: 'payment.failed', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).state, S.CONFIRMING_APPOINTMENT);
  assert.ok(!routingKeys(context.published).includes('saga.command.inventory.release'));
});

test('un cobro que llega tras revertir se reembolsa una sola vez', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.failed', sagaId: 's1' });
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });

  const saga = await context.repository.get('s1');
  assert.equal(context.payments.refunds, 1);
  assert.equal(saga.refunded, true);
  assert.equal(saga.state, S.COMPENSATING_STOCK);
});

test('un evento repetido no avanza dos veces ni duplica comandos', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  const before = context.published.length;
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  assert.equal(context.published.length, before);
});

test('un evento reentregado tras una caída repite la publicación', () => {
  const saga = { sagaId: 's1', state: S.RESERVING_STOCK };
  const decision = decide(saga, { type: 'appointment.reserved', sagaId: 's1' }, { redelivered: true });
  assert.equal(decision.persist, false);
  assert.equal(decision.commands[0].routingKey, 'saga.command.inventory.reserve');
});

test('evento de una SAGA inexistente se ignora', async () => {
  const context = setup();
  assert.equal(await context.runner.handle({ type: 'payment.succeeded', sagaId: 'no-existe' }), null);
});

// --- Canje de puntos

async function untilAwaitingPaymentWithPoints(context) {
  await context.runner.start({ ...START, pointsToRedeem: 500 });
  await context.runner.handle({ type: 'appointment.reserved', sagaId: 's1', appointmentId: 'apt-1', serviceName: 'Corte', amountCents: 4500 });
  await context.runner.handle({ type: 'inventory.reserved', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).state, S.RESERVING_POINTS);
  await context.runner.handle({ type: 'points.reserved', sagaId: 's1', pointsRedeemed: 500, discountCents: 500 });
}

test('canje: aparta puntos antes de cobrar y cobra el monto con descuento', async () => {
  let charged;
  const context = setup({
    createPayment: async ({ amountCents }) => {
      charged = amountCents;
      return { id: 'pi_1', clientSecret: 'secreto' };
    },
  });
  await untilAwaitingPaymentWithPoints(context);
  assert.equal(charged, 4000);
  assert.ok(routingKeys(context.published).includes('crm.command.points.reserve'));
  assert.equal((await context.repository.get('s1')).state, S.AWAITING_PAYMENT);
});

test('canje: saldo insuficiente devuelve el stock y libera el turno sin cobrar', async () => {
  const context = setup();
  await context.runner.start({ ...START, pointsToRedeem: 500 });
  await context.runner.handle({ type: 'appointment.reserved', sagaId: 's1', appointmentId: 'apt-1', amountCents: 4500 });
  await context.runner.handle({ type: 'inventory.reserved', sagaId: 's1' });
  await context.runner.handle({ type: 'points.reserve_failed', sagaId: 's1', reason: 'POINTS_INSUFFICIENT' });
  await context.runner.handle({ type: 'inventory.released', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.released', sagaId: 's1' });

  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.COMPENSATED);
  assert.equal(saga.failureReason, 'POINTS_INSUFFICIENT');
  assert.equal(context.payments.created, 0);
});

test('canje: un pago rechazado devuelve puntos, luego stock y luego turno', async () => {
  const context = setup();
  await untilAwaitingPaymentWithPoints(context);
  await context.runner.handle({ type: 'payment.failed', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).state, S.COMPENSATING_POINTS);
  await context.runner.handle({ type: 'points.released', sagaId: 's1' });
  await context.runner.handle({ type: 'inventory.released', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.released', sagaId: 's1' });

  assert.equal((await context.repository.get('s1')).state, S.COMPENSATED);
  const keys = routingKeys(context.published);
  assert.ok(keys.indexOf('crm.command.points.release') < keys.indexOf('saga.command.inventory.release'));
  assert.ok(keys.indexOf('saga.command.inventory.release') < keys.indexOf('saga.command.appointment.cancel'));
});

// --- Cancelación de una reserva pagada

async function untilCompleted(context) {
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.confirmed', sagaId: 's1' });
  await context.runner.handle({ type: 'inventory.committed', sagaId: 's1' });
}

test('cancelación: cita, reembolso, nota de crédito, en ese orden', async () => {
  const context = setup();
  await untilCompleted(context);
  await context.runner.handle({ type: 'cancel.requested', sagaId: 's1' });
  assert.equal(context.payments.refunds, 0);
  await context.runner.handle({ type: 'appointment.cancelled', sagaId: 's1' });
  assert.equal(context.payments.refunds, 1);
  assert.equal((await context.repository.get('s1')).state, S.ISSUING_CREDIT_NOTE);
  await context.runner.handle({ type: 'refund.applied', sagaId: 's1' });

  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.REFUNDED);
  assert.equal(saga.refunded, true);
  const keys = routingKeys(context.published);
  assert.ok(keys.indexOf('saga.command.appointment.cancel_paid') < keys.indexOf('crm.command.refund.apply'));
  assert.equal(keys.at(-1), 'saga.refunded');
});

test('cancelación rechazada: no reembolsa y la reserva sigue vigente', async () => {
  const context = setup();
  await untilCompleted(context);
  await context.runner.handle({ type: 'cancel.requested', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.cancel_rejected', sagaId: 's1', reason: 'TOO_LATE' });

  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.COMPLETED);
  assert.equal(saga.cancelRejectedReason, 'TOO_LATE');
  assert.equal(context.payments.refunds, 0);
});

test('no se puede pedir la cancelación de una reserva sin pagar', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'cancel.requested', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).state, S.AWAITING_PAYMENT);
});

test('si Stripe falla al reembolsar, el error llega al consumidor para reintentar', async () => {
  const context = setup({ refundPayment: async () => { throw new Error('Stripe caído'); } });
  await untilCompleted(context);
  await context.runner.handle({ type: 'cancel.requested', sagaId: 's1' });
  await assert.rejects(context.runner.handle({ type: 'appointment.cancelled', sagaId: 's1' }), /Stripe caído/);
  assert.equal((await context.repository.get('s1')).state, S.REFUNDING_PAYMENT);
});

// --- API HTTP

function apiContext() {
  const context = setup();
  const claims = new Map();
  let ids = 0;
  const server = createApi({
    authenticate: async (authorization) => {
      if (authorization === 'Bearer cliente') return { subject: 'u1', id: 'cli-001', roles: ['CLIENT'] };
      if (authorization === 'Bearer otro') return { subject: 'u2', id: 'cli-002', roles: ['CLIENT'] };
      if (authorization === 'Bearer recepcion') return { subject: 'u9', id: 'rec-001', roles: ['RECEPTIONIST'] };
      throw new AuthError(401, 'TOKEN_MISSING', 'Sin token');
    },
    runner: context.runner,
    repository: context.repository,
    idempotency: {
      claim: async (key, sagaId, requestHash) => {
        if (claims.has(key)) return { claimed: false, ...claims.get(key) };
        claims.set(key, { sagaId, requestHash });
        return { claimed: true, sagaId, requestHash };
      },
    },
    gateway: {
      parseWebhook: (raw, signature) => {
        if (signature !== 'firma-valida') throw new Error('firma');
        return { routingKey: 'saga.event.payment.succeeded', body: { sagaId: 's1' } };
      },
    },
    publisher: context.publisher,
    publishableKey: 'pk_test_x',
    allowedOrigins: ['http://localhost:3002'],
    newId: () => `saga-${++ids}`,
  });
  return { ...context, server };
}

async function withApi(run) {
  const context = apiContext();
  await new Promise((resolve) => context.server.listen(0, resolve));
  const base = `http://localhost:${context.server.address().port}`;
  try {
    await run(base, context);
  } finally {
    await new Promise((resolve) => context.server.close(resolve));
  }
}

const BOOKING = { serviceId: 'srv-03', stylistId: 'sty-101', appointmentDate: '2031-01-06T10:00:00' };

function post(base, body, { token = 'cliente', key = 'k1' } = {}) {
  return fetch(`${base}/bookings`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('API: exige autenticación', () => withApi(async (base) => {
  assert.equal((await post(base, BOOKING, { token: null })).status, 401);
}));

test('API: exige Idempotency-Key', () => withApi(async (base) => {
  const response = await post(base, BOOKING, { key: null });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');
}));

test('API: valida los datos de la reserva', () => withApi(async (base) => {
  assert.equal((await post(base, { serviceId: 'srv-03' })).status, 400);
}));

test('API: inicia la SAGA con el cliente del token', () => withApi(async (base, { published }) => {
  const response = await post(base, { ...BOOKING, clientId: 'cli-999' });
  assert.equal(response.status, 202);
  assert.equal(published[0].routingKey, 'saga.command.appointment.reserve');
  assert.equal(published[0].body.clientId, 'cli-001');
}));

test('API: el reintento devuelve la misma SAGA sin iniciar otra', () => withApi(async (base, { published }) => {
  const first = await (await post(base, BOOKING)).json();
  const retry = await post(base, BOOKING);
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get('x-idempotent-replay'), 'true');
  assert.equal((await retry.json()).sagaId, first.sagaId);
  assert.equal(published.length, 1);
}));

test('API: la misma llave con otros datos responde 422', () => withApi(async (base) => {
  await post(base, BOOKING);
  assert.equal((await post(base, { ...BOOKING, serviceId: 'srv-01' })).status, 422);
}));

test('API: rechaza puntos inválidos', () => withApi(async (base) => {
  assert.equal((await post(base, { ...BOOKING, pointsToRedeem: -5 })).status, 400);
  assert.equal((await post(base, { ...BOOKING, pointsToRedeem: 1.5 }, { key: 'k2' })).status, 400);
}));

test('API: solo se cancela una reserva pagada y solo su dueño', () => withApi(async (base, { published }) => {
  const { sagaId } = await (await post(base, BOOKING)).json();
  const cancel = (token) => fetch(`${base}/bookings/${sagaId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await cancel('otro')).status, 403);
  assert.equal((await cancel('cliente')).status, 409);
  assert.ok(!routingKeys(published).includes('saga.event.cancel.requested'));
}));

test('API: un cliente no ve la reserva de otro', () => withApi(async (base) => {
  const { sagaId } = await (await post(base, BOOKING)).json();
  const headers = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await fetch(`${base}/bookings/${sagaId}`, headers('cliente'))).status, 200);
  assert.equal((await fetch(`${base}/bookings/${sagaId}`, headers('otro'))).status, 403);
  assert.equal((await fetch(`${base}/bookings/no-existe`, headers('cliente'))).status, 404);
}));

test('API: rechaza webhooks sin firma válida', () => withApi(async (base, { published }) => {
  const webhook = (signature) => fetch(`${base}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: '{}',
  });
  assert.equal((await webhook('falsa')).status, 400);
  assert.equal(published.length, 0);
  assert.equal((await webhook('firma-valida')).status, 200);
  assert.equal(published[0].routingKey, 'saga.event.payment.succeeded');
}));

test('API: CORS solo para orígenes permitidos', () => withApi(async (base) => {
  const allowed = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:3002' } });
  const denied = await fetch(`${base}/health`, { headers: { Origin: 'http://atacante.test' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3002');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
}));

// --- Mostrador: cliente sin reserva que paga al agendar (Fase M)

const COUNTER = { ...START, channel: 'COUNTER', paymentMethod: 'CASH', cashierId: 'rec-001', clientName: 'Ana Pérez' };

async function counterAwaitingPayment(context) {
  await context.runner.start(COUNTER);
  await context.runner.handle({ type: 'appointment.reserved', sagaId: 's1', appointmentId: 'apt-1', serviceName: 'Corte', amountCents: 4500 });
  await context.runner.handle({ type: 'inventory.reserved', sagaId: 's1' });
}

test('mostrador: espera el cobro sin crear un pago en Stripe', async () => {
  const context = setup();
  await counterAwaitingPayment(context);
  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.AWAITING_PAYMENT);
  assert.equal(saga.clientSecret, null);
  assert.equal(context.payments.created, 0);
  assert.equal(context.delayed.length, 1, 'también vence si nadie confirma el cobro');
});

test('mostrador: el cobro confirmado emite la factura con la forma de pago y la cajera', async () => {
  const context = setup();
  await counterAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1', cashierId: 'rec-001' });
  await context.runner.handle({ type: 'appointment.confirmed', sagaId: 's1' });
  await context.runner.handle({ type: 'inventory.committed', sagaId: 's1' });
  const completed = context.published.find((message) => message.routingKey === 'saga.completed').body;
  assert.equal(completed.paymentMethod, 'CASH');
  assert.equal(completed.channel, 'COUNTER');
  assert.equal(completed.cashierId, 'rec-001');
  assert.equal(completed.clientName, 'Ana Pérez');
});

test('en línea: la factura sigue indicando tarjeta', async () => {
  const context = setup();
  await untilAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.confirmed', sagaId: 's1' });
  await context.runner.handle({ type: 'inventory.committed', sagaId: 's1' });
  const completed = context.published.find((message) => message.routingKey === 'saga.completed').body;
  assert.equal(completed.paymentMethod, 'CARD');
  assert.equal(completed.channel, 'ONLINE');
});

test('mostrador: vence sin cobro y compensa sin consultar a Stripe', async () => {
  const context = setup({ cancelPayment: async () => assert.fail('no debe llamar a Stripe') });
  await counterAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.timeout', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).state, S.COMPENSATING_STOCK);
});

test('mostrador: anular libera stock y turno', async () => {
  const context = setup();
  await counterAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.failed', sagaId: 's1', reason: 'COUNTER_VOIDED' });
  await context.runner.handle({ type: 'inventory.released', sagaId: 's1' });
  await context.runner.handle({ type: 'appointment.released', sagaId: 's1' });
  const saga = await context.repository.get('s1');
  assert.equal(saga.state, S.COMPENSATED);
  assert.equal(saga.failureReason, 'COUNTER_VOIDED');
});

test('mostrador: cancelar una reserva cobrada no llama a Stripe y emite nota de crédito', async () => {
  const context = setup({ refundPayment: async () => assert.fail('no debe llamar a Stripe') });
  await counterAwaitingPayment(context);
  for (const type of ['payment.succeeded', 'appointment.confirmed', 'inventory.committed', 'cancel.requested', 'appointment.cancelled']) {
    await context.runner.handle({ type, sagaId: 's1' });
  }
  assert.equal((await context.repository.get('s1')).state, S.ISSUING_CREDIT_NOTE);
  assert.ok(routingKeys(context.published).includes('crm.command.refund.apply'));
});

test('mostrador: un cobro sobre una reserva ya revertida solo queda registrado', async () => {
  const context = setup({ refundPayment: async () => assert.fail('no debe llamar a Stripe') });
  await counterAwaitingPayment(context);
  await context.runner.handle({ type: 'payment.failed', sagaId: 's1', reason: 'COUNTER_VOIDED' });
  await context.runner.handle({ type: 'payment.succeeded', sagaId: 's1' });
  assert.equal((await context.repository.get('s1')).refunded, true);
});

const DESK = { ...BOOKING, clientId: 'cli-002', clientName: 'Ana Pérez', clientEmail: 'ana@correo.test', paymentMethod: 'CASH' };

function postCounter(base, body, { token = 'recepcion', key = 'm1' } = {}) {
  return fetch(`${base}/counter/bookings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });
}

const counterAction = (base, sagaId, action, token = 'recepcion') =>
  fetch(`${base}/counter/bookings/${sagaId}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

/** Avanza en memoria la SAGA creada por la API hasta esperar el cobro. */
async function counterReady(context, sagaId) {
  await context.runner.handle({ type: 'appointment.reserved', sagaId, appointmentId: 'apt-9', serviceName: 'Corte', amountCents: 4500 });
  await context.runner.handle({ type: 'inventory.reserved', sagaId });
}

test('API mostrador: un cliente no puede usarlo', () => withApi(async (base) => {
  assert.equal((await postCounter(base, DESK, { token: 'cliente' })).status, 403);
}));

test('API mostrador: agenda al cliente elegido, no a la recepcionista', () => withApi(async (base, { published, repository }) => {
  const response = await postCounter(base, DESK);
  assert.equal(response.status, 202);
  const view = await response.json();
  assert.equal(view.channel, 'COUNTER');
  assert.equal(published[0].body.clientId, 'cli-002');
  const saga = await repository.get(view.sagaId);
  assert.equal(saga.cashierId, 'rec-001');
  assert.equal(saga.pointsRequested, 0);
}));

test('API mostrador: exige llave, cliente y forma de pago válida', () => withApi(async (base) => {
  assert.equal((await postCounter(base, DESK, { key: null })).status, 400);
  assert.equal((await postCounter(base, { ...DESK, clientId: '' }, { key: 'a' })).status, 400);
  assert.equal((await postCounter(base, { ...DESK, paymentMethod: 'BITCOIN' }, { key: 'b' })).status, 400);
  assert.equal((await postCounter(base, { ...DESK, clientEmail: 'no-es-correo' }, { key: 'c' })).status, 400);
}));

test('API mostrador: reintentar no agenda dos veces', () => withApi(async (base, { published }) => {
  const first = await (await postCounter(base, DESK)).json();
  const retry = await postCounter(base, DESK);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).sagaId, first.sagaId);
  assert.equal(published.filter((message) => message.routingKey === 'saga.command.appointment.reserve').length, 1);
}));

test('API mostrador: cobrar antes de apartar el turno responde 409', () => withApi(async (base) => {
  const { sagaId } = await (await postCounter(base, DESK)).json();
  const response = await counterAction(base, sagaId, 'pay');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'NOT_READY');
}));

test('API mostrador: cobrar publica el pago una vez y repetir no cobra de nuevo', () => withApi(async (base, context) => {
  const { sagaId } = await (await postCounter(base, DESK)).json();
  await counterReady(context, sagaId);
  assert.equal((await counterAction(base, sagaId, 'pay')).status, 202);
  const paid = context.published.filter((message) => message.routingKey === 'saga.event.payment.succeeded');
  assert.equal(paid.length, 1);
  assert.equal(paid[0].body.cashierId, 'rec-001');
  await context.runner.handle({ type: 'payment.succeeded', sagaId, cashierId: 'rec-001' });
  assert.equal((await counterAction(base, sagaId, 'pay')).status, 200);
  assert.equal(context.published.filter((message) => message.routingKey === 'saga.event.payment.succeeded').length, 1);
  assert.equal((await counterAction(base, sagaId, 'void')).status, 409, 'lo cobrado no se anula sin reembolso');
}));

test('API mostrador: anular publica el rechazo y luego ya no se puede cobrar', () => withApi(async (base, context) => {
  const { sagaId } = await (await postCounter(base, DESK)).json();
  await counterReady(context, sagaId);
  assert.equal((await counterAction(base, sagaId, 'void')).status, 202);
  const failed = context.published.find((message) => message.routingKey === 'saga.event.payment.failed');
  assert.equal(failed.body.reason, 'COUNTER_VOIDED');
  await context.runner.handle({ type: 'payment.failed', sagaId, reason: 'COUNTER_VOIDED' });
  const response = await counterAction(base, sagaId, 'pay');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'BOOKING_REVERTED');
}));

test('API mostrador: no cobra reservas en línea ni deja cobrar a un cliente', () => withApi(async (base) => {
  const online = await (await post(base, BOOKING)).json();
  assert.equal((await counterAction(base, online.sagaId, 'pay')).status, 409);
  const { sagaId } = await (await postCounter(base, DESK)).json();
  assert.equal((await counterAction(base, sagaId, 'pay', 'cliente')).status, 403);
  assert.equal((await counterAction(base, 'no-existe', 'pay')).status, 404);
}));

test('API mostrador: la recepción puede consultar la reserva que agendó', () => withApi(async (base) => {
  const { sagaId } = await (await postCounter(base, DESK)).json();
  const response = await fetch(`${base}/bookings/${sagaId}`, { headers: { Authorization: 'Bearer recepcion' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paymentMethod, 'CASH');
}));
