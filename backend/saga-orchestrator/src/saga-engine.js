/**
 * Máquina de estados de la SAGA de reserva y pago (CU-07, CU-10, RF-07, RNF-03).
 * Es lógica pura: dado un estado y un evento, indica el siguiente estado,
 * los comandos a publicar y los efectos a ejecutar.
 *
 * Paso pivote: el pago. Antes de él, cualquier fallo se compensa en orden inverso.
 * Después de él, la SAGA solo avanza: lo que falle se reintenta, nunca se revierte.
 * Cancelar una reserva pagada es un flujo aparte que también solo avanza:
 * cita, dinero y por último factura y puntos.
 */

const STATES = Object.freeze({
  RESERVING_APPOINTMENT: 'RESERVING_APPOINTMENT',
  RESERVING_STOCK: 'RESERVING_STOCK',
  RESERVING_POINTS: 'RESERVING_POINTS',
  CREATING_PAYMENT: 'CREATING_PAYMENT',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  CONFIRMING_APPOINTMENT: 'CONFIRMING_APPOINTMENT',
  COMMITTING_STOCK: 'COMMITTING_STOCK',
  COMPLETED: 'COMPLETED',
  COMPENSATING_POINTS: 'COMPENSATING_POINTS',
  COMPENSATING_STOCK: 'COMPENSATING_STOCK',
  COMPENSATING_APPOINTMENT: 'COMPENSATING_APPOINTMENT',
  COMPENSATED: 'COMPENSATED',
  FAILED: 'FAILED',
  CANCELLING_APPOINTMENT: 'CANCELLING_APPOINTMENT',
  REFUNDING_PAYMENT: 'REFUNDING_PAYMENT',
  ISSUING_CREDIT_NOTE: 'ISSUING_CREDIT_NOTE',
  REFUNDED: 'REFUNDED',
});

const S = STATES;

/** Estados en los que la reserva ya se revirtió o se está revirtiendo. */
const REVERTED_STATES = [S.COMPENSATING_POINTS, S.COMPENSATING_STOCK, S.COMPENSATING_APPOINTMENT, S.COMPENSATED, S.FAILED];

const TERMINAL_STATES = [S.COMPLETED, S.COMPENSATED, S.FAILED, S.REFUNDED];

/** Estados de una cancelación en curso o terminada. */
const CANCELLATION_STATES = [S.CANCELLING_APPOINTMENT, S.REFUNDING_PAYMENT, S.ISSUING_CREDIT_NOTE, S.REFUNDED];

const command = (saga, name) => ({ routingKey: `saga.command.${name}`, body: { sagaId: saga.sagaId } });

const cancelAppointment = (saga, reason) => ({
  routingKey: 'saga.command.appointment.cancel',
  body: { sagaId: saga.sagaId, reason },
});

const reservePoints = (saga) => ({
  routingKey: 'crm.command.points.reserve',
  body: { sagaId: saga.sagaId, clientId: saga.clientId, points: saga.pointsRequested, amountCents: saga.amountCents },
});

const releasePoints = (saga) => ({
  routingKey: 'crm.command.points.release',
  body: { sagaId: saga.sagaId, clientId: saga.clientId },
});

/** Primer paso de la compensación tras el pago: lo último que se reservó, primero se devuelve. */
const compensationState = (saga) => (saga.pointsRedeemed > 0 ? S.COMPENSATING_POINTS : S.COMPENSATING_STOCK);
const compensationCommands = (saga) => [saga.pointsRedeemed > 0 ? releasePoints(saga) : command(saga, 'inventory.release')];

const usesPoints = (saga) => saga.pointsRequested > 0;

/**
 * Transiciones por tipo de evento. `to` puede depender de la SAGA. `patch` guarda datos;
 * `commands` y `effects` se ejecutan después de persistir, y se repiten si el evento se reentrega.
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
    to: (saga) => (usesPoints(saga) ? S.RESERVING_POINTS : S.CREATING_PAYMENT),
    commands: (saga) => (usesPoints(saga) ? [reservePoints(saga)] : []),
    effects: (saga) => (usesPoints(saga) ? [] : ['createPayment']),
  },
  'inventory.reserve_failed': {
    from: S.RESERVING_STOCK,
    to: S.COMPENSATING_APPOINTMENT,
    patch: (event) => ({ failureReason: event.reason }),
    commands: (saga, event) => [cancelAppointment(saga, event.reason)],
  },
  'points.reserved': {
    from: S.RESERVING_POINTS,
    to: S.CREATING_PAYMENT,
    patch: (event) => ({ pointsRedeemed: event.pointsRedeemed, discountCents: event.discountCents }),
    effects: () => ['createPayment'],
  },
  'points.reserve_failed': {
    from: S.RESERVING_POINTS,
    to: S.COMPENSATING_STOCK,
    patch: (event) => ({ failureReason: event.reason }),
    commands: (saga) => [command(saga, 'inventory.release')],
  },
  'payment.created': {
    from: S.CREATING_PAYMENT,
    to: S.AWAITING_PAYMENT,
    patch: (event) => ({ paymentIntentId: event.paymentIntentId, clientSecret: event.clientSecret }),
    effects: () => ['schedulePaymentTimeout'],
  },
  'payment.create_failed': {
    from: S.CREATING_PAYMENT,
    to: compensationState,
    patch: () => ({ failureReason: 'PAYMENT_UNAVAILABLE' }),
    commands: compensationCommands,
  },
  'payment.succeeded': {
    from: S.AWAITING_PAYMENT,
    to: S.CONFIRMING_APPOINTMENT,
    patch: () => ({ paid: true, clientSecret: null }),
    commands: (saga) => [command(saga, 'appointment.confirm')],
  },
  'payment.failed': {
    from: S.AWAITING_PAYMENT,
    to: compensationState,
    patch: (event) => ({ failureReason: event.reason || 'PAYMENT_DECLINED', clientSecret: null }),
    commands: compensationCommands,
  },
  'payment.expired': {
    from: S.AWAITING_PAYMENT,
    to: compensationState,
    patch: () => ({ failureReason: 'PAYMENT_TIMEOUT', clientSecret: null }),
    commands: compensationCommands,
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
        clientName: saga.clientName,
        clientEmail: saga.clientEmail,
        serviceName: saga.serviceName,
        amountCents: saga.amountCents,
        discountCents: saga.discountCents ?? 0,
        pointsRedeemed: saga.pointsRedeemed ?? 0,
        paymentIntentId: saga.paymentIntentId,
      },
    }],
  },
  'points.released': {
    from: S.COMPENSATING_POINTS,
    to: S.COMPENSATING_STOCK,
    commands: (saga) => [command(saga, 'inventory.release')],
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
  // Cancelación de una reserva ya pagada (CU-07)
  'cancel.requested': {
    from: S.COMPLETED,
    to: S.CANCELLING_APPOINTMENT,
    patch: () => ({ cancelRejectedReason: null }),
    commands: (saga) => [command(saga, 'appointment.cancel_paid')],
  },
  'appointment.cancel_rejected': {
    from: S.CANCELLING_APPOINTMENT,
    to: S.COMPLETED,
    patch: (event) => ({ cancelRejectedReason: event.reason }),
  },
  'appointment.cancelled': {
    from: S.CANCELLING_APPOINTMENT,
    to: S.REFUNDING_PAYMENT,
    effects: () => ['refundBooking'],
  },
  'payment.refunded': {
    from: S.REFUNDING_PAYMENT,
    to: S.ISSUING_CREDIT_NOTE,
    commands: (saga) => [{
      routingKey: 'crm.command.refund.apply',
      body: { sagaId: saga.sagaId, reason: 'Cancelación de la reserva' },
    }],
  },
  'refund.applied': {
    from: S.ISSUING_CREDIT_NOTE,
    to: S.REFUNDED,
    patch: () => ({ refunded: true }),
    commands: (saga) => [{
      routingKey: 'saga.refunded',
      body: { sagaId: saga.sagaId, clientId: saga.clientId, appointmentId: saga.appointmentId },
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
  const target = typeof transition.to === 'function' ? transition.to(merged) : transition.to;
  const commands = transition.commands ? transition.commands(merged, event) : [];
  const effects = transition.effects ? transition.effects(merged, event) : [];

  if (saga.state === transition.from) {
    return { to: target, patch, commands, effects, persist: true };
  }
  // Se cayó el proceso tras guardar y antes de publicar: el mensaje reentregado repite la publicación
  if (saga.state === target && redelivered) {
    return { commands, effects, persist: false };
  }
  return null;
}

module.exports = { STATES, TERMINAL_STATES, CANCELLATION_STATES, decide };
