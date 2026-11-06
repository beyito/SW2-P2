/**
 * Máquina de estados de la SAGA de reserva y pago (CU-10, RF-07, RNF-03).
 * Es lógica pura: dado un estado y un evento, indica el siguiente estado,
 * los comandos a publicar y los efectos a ejecutar.
 *
 * Paso pivote: el pago. Antes de él, cualquier fallo se compensa en orden inverso.
 * Después de él, la SAGA solo avanza: lo que falle se reintenta, nunca se revierte.
 */

const STATES = Object.freeze({
  RESERVING_APPOINTMENT: 'RESERVING_APPOINTMENT',
  RESERVING_STOCK: 'RESERVING_STOCK',
  CREATING_PAYMENT: 'CREATING_PAYMENT',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  CONFIRMING_APPOINTMENT: 'CONFIRMING_APPOINTMENT',
  COMMITTING_STOCK: 'COMMITTING_STOCK',
  COMPLETED: 'COMPLETED',
  COMPENSATING_STOCK: 'COMPENSATING_STOCK',
  COMPENSATING_APPOINTMENT: 'COMPENSATING_APPOINTMENT',
  COMPENSATED: 'COMPENSATED',
  FAILED: 'FAILED',
});

const S = STATES;

/** Estados en los que la reserva ya se revirtió o se está revirtiendo. */
const REVERTED_STATES = [S.COMPENSATING_STOCK, S.COMPENSATING_APPOINTMENT, S.COMPENSATED, S.FAILED];

const TERMINAL_STATES = [S.COMPLETED, S.COMPENSATED, S.FAILED];

const cancelAppointment = (saga, reason) => ({
  routingKey: 'saga.command.appointment.cancel',
  body: { sagaId: saga.sagaId, reason },
});

const command = (saga, name) => ({ routingKey: `saga.command.${name}`, body: { sagaId: saga.sagaId } });

/**
 * Transiciones por tipo de evento. `patch` guarda datos en la SAGA; `commands` y
 * `effects` se ejecutan después de persistir, y se repiten si el evento se reentrega.
 */
const TRANSITIONS = {
  'appointment.reserved': {
    from: S.RESERVING_APPOINTMENT,
    to: S.RESERVING_STOCK,
    patch: (event) => ({
      appointmentId: event.appointmentId,
      serviceName: event.serviceName,
      amountCents: event.amountCents,
    }),
    commands: (saga) => [command(saga, 'inventory.reserve')],
  },
  'appointment.reserve_failed': {
    from: S.RESERVING_APPOINTMENT,
    to: S.FAILED,
    patch: (event) => ({ failureReason: event.reason }),
  },
  'inventory.reserved': {
    from: S.RESERVING_STOCK,
    to: S.CREATING_PAYMENT,
    effects: () => ['createPayment'],
  },
  'inventory.reserve_failed': {
    from: S.RESERVING_STOCK,
    to: S.COMPENSATING_APPOINTMENT,
    patch: (event) => ({ failureReason: event.reason }),
    commands: (saga, event) => [cancelAppointment(saga, event.reason)],
  },
  'payment.created': {
    from: S.CREATING_PAYMENT,
    to: S.AWAITING_PAYMENT,
    patch: (event) => ({ paymentIntentId: event.paymentIntentId, clientSecret: event.clientSecret }),
    effects: () => ['schedulePaymentTimeout'],
  },
  'payment.create_failed': {
    from: S.CREATING_PAYMENT,
    to: S.COMPENSATING_STOCK,
    patch: () => ({ failureReason: 'PAYMENT_UNAVAILABLE' }),
    commands: (saga) => [command(saga, 'inventory.release')],
  },
  'payment.succeeded': {
    from: S.AWAITING_PAYMENT,
    to: S.CONFIRMING_APPOINTMENT,
    patch: () => ({ paid: true, clientSecret: null }),
    commands: (saga) => [command(saga, 'appointment.confirm')],
  },
  'payment.failed': {
    from: S.AWAITING_PAYMENT,
    to: S.COMPENSATING_STOCK,
    patch: (event) => ({ failureReason: event.reason || 'PAYMENT_DECLINED', clientSecret: null }),
    commands: (saga) => [command(saga, 'inventory.release')],
  },
  'payment.expired': {
    from: S.AWAITING_PAYMENT,
    to: S.COMPENSATING_STOCK,
    patch: () => ({ failureReason: 'PAYMENT_TIMEOUT', clientSecret: null }),
    commands: (saga) => [command(saga, 'inventory.release')],
  },
  'appointment.confirmed': {
    from: S.CONFIRMING_APPOINTMENT,
    to: S.COMMITTING_STOCK,
    commands: (saga) => [command(saga, 'inventory.commit')],
  },
  'inventory.committed': {
    from: S.COMMITTING_STOCK,
    to: S.COMPLETED,
    commands: (saga) => [{
      routingKey: 'saga.completed',
      body: {
        sagaId: saga.sagaId,
        appointmentId: saga.appointmentId,
        clientId: saga.clientId,
        serviceName: saga.serviceName,
        amountCents: saga.amountCents,
        paymentIntentId: saga.paymentIntentId,
      },
    }],
  },
  'inventory.released': {
    from: S.COMPENSATING_STOCK,
    to: S.COMPENSATING_APPOINTMENT,
    commands: (saga) => [cancelAppointment(saga, saga.failureReason)],
  },
  'appointment.released': {
    from: S.COMPENSATING_APPOINTMENT,
    to: S.COMPENSATED,
    commands: (saga) => [{
      routingKey: 'saga.compensated',
      body: { sagaId: saga.sagaId, clientId: saga.clientId, reason: saga.failureReason },
    }],
  },
};

/**
 * Calcula qué hacer con un evento.
 * @returns {{to?: string, patch?: object, commands: object[], effects: string[], persist: boolean}|null}
 *          null si el evento está obsoleto y debe ignorarse.
 */
function decide(saga, event, { redelivered = false } = {}) {
  // Un cobro que llega tarde sobre una reserva ya revertida se devuelve al cliente
  if (event.type === 'payment.succeeded' && REVERTED_STATES.includes(saga.state)) {
    return { commands: [], effects: saga.refunded ? [] : ['refundPayment'], persist: false };
  }
  // Vencimiento del plazo de pago: antes de revertir se consulta el estado real del cobro
  if (event.type === 'payment.timeout') {
    return saga.state === S.AWAITING_PAYMENT ? { commands: [], effects: ['expirePayment'], persist: false } : null;
  }

  const transition = TRANSITIONS[event.type];
  if (!transition) return null;

  const patch = transition.patch ? transition.patch(event) : {};
  const merged = { ...saga, ...patch };
  const commands = transition.commands ? transition.commands(merged, event) : [];
  const effects = transition.effects ? transition.effects(merged, event) : [];

  if (saga.state === transition.from) {
    return { to: transition.to, patch, commands, effects, persist: true };
  }
  // Se cayó el proceso tras guardar y antes de publicar: el mensaje reentregado repite la publicación
  if (saga.state === transition.to && redelivered) {
    return { commands: transition.commands ? transition.commands(saga, event) : [], effects, persist: false };
  }
  return null;
}

module.exports = { STATES, TERMINAL_STATES, decide };
