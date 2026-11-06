/**
 * Ejecuta la SAGA: persiste cada transición, publica comandos y realiza los efectos.
 * Las dependencias se inyectan para poder probarla sin infraestructura.
 */
const { STATES, decide } = require('./saga-engine');

class SagaRunner {
  constructor({ repository, publisher, payments, paymentTimeoutMs, logger = console }) {
    this.repository = repository;
    this.publisher = publisher;
    this.payments = payments;
    this.paymentTimeoutMs = paymentTimeoutMs;
    this.logger = logger;
  }

  /** Crea la SAGA si no existe y solicita bloquear el turno. Se puede repetir sin efectos dobles. */
  async start({ sagaId, clientId, stylistId, serviceId, appointmentDate }) {
    const saga = {
      sagaId,
      clientId,
      stylistId,
      serviceId,
      appointmentDate,
      state: STATES.RESERVING_APPOINTMENT,
      version: 1,
      history: [{ state: STATES.RESERVING_APPOINTMENT, at: new Date().toISOString() }],
    };
    await this.repository.createIfAbsent(saga);
    await this.publisher.publish('saga.command.appointment.reserve', {
      sagaId,
      clientId,
      stylistId,
      serviceId,
      appointmentDate,
    });
    return saga;
  }

  /** Procesa un evento; un evento desconocido u obsoleto se ignora. */
  async handle(event, { redelivered = false } = {}) {
    const saga = await this.repository.get(event.sagaId);
    if (!saga) {
      this.logger.warn(`[SAGA] Evento ${event.type} de una SAGA inexistente: ${event.sagaId}`);
      return null;
    }

    const decision = decide(saga, event, { redelivered });
    if (!decision) {
      this.logger.info(`[SAGA] ${saga.sagaId}: evento ${event.type} ignorado en estado ${saga.state}`);
      return saga;
    }

    let current = saga;
    if (decision.persist) {
      current = await this.repository.transition(saga, decision.to, decision.patch);
      this.logger.info(`[SAGA] ${saga.sagaId}: ${saga.state} -> ${decision.to} (${event.type})`);
    }

    for (const { routingKey, body } of decision.commands) {
      await this.publisher.publish(routingKey, body);
    }
    for (const effect of decision.effects) {
      await this[effect](current);
    }
    return current;
  }

  /** Crea el cobro; el sagaId como llave impide dos cobros aunque se repita. */
  async createPayment(saga) {
    try {
      const payment = await this.payments.createPayment({
        sagaId: saga.sagaId,
        amountCents: saga.amountCents,
        description: saga.serviceName,
      });
      await this.handle({
        type: 'payment.created',
        sagaId: saga.sagaId,
        paymentIntentId: payment.id,
        clientSecret: payment.clientSecret,
      });
    } catch (error) {
      this.logger.error(`[SAGA] ${saga.sagaId}: no se pudo crear el cobro: ${error.message}`);
      await this.handle({ type: 'payment.create_failed', sagaId: saga.sagaId });
    }
  }

  async schedulePaymentTimeout(saga) {
    await this.publisher.publishDelayed({ sagaId: saga.sagaId }, this.paymentTimeoutMs);
  }

  /** Venció el plazo: cancela el cobro, salvo que se haya pagado justo antes. */
  async expirePayment(saga) {
    const status = await this.payments.cancelPayment(saga.paymentIntentId);
    const type = status === 'succeeded' ? 'payment.succeeded' : 'payment.expired';
    await this.handle({ type, sagaId: saga.sagaId });
  }

  /** Devuelve un cobro que llegó cuando la reserva ya se había revertido. */
  async refundPayment(saga) {
    await this.payments.refundPayment({ sagaId: saga.sagaId, paymentIntentId: saga.paymentIntentId });
    await this.repository.patch(saga, { refunded: true });
    this.logger.warn(`[SAGA] ${saga.sagaId}: cobro tardío reembolsado`);
  }

  /** Reconcilia con la pasarela: sirve cuando el webhook no llega. */
  async syncPayment(saga) {
    if (saga.state !== STATES.AWAITING_PAYMENT) return saga;
    const payment = await this.payments.getPayment(saga.paymentIntentId);
    if (payment.status === 'succeeded') {
      await this.publisher.publish('saga.event.payment.succeeded', { sagaId: saga.sagaId });
    } else if (payment.declined) {
      await this.publisher.publish('saga.event.payment.failed', { sagaId: saga.sagaId, reason: 'PAYMENT_DECLINED' });
    }
    return saga;
  }
}

module.exports = { SagaRunner };
