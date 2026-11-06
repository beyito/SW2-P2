/**
 * Adaptador de la pasarela de pago sobre Stripe. El orquestador solo conoce esta interfaz,
 * así que otra pasarela se puede incorporar sin tocar la SAGA.
 */
const Stripe = require('stripe');

const CURRENCY = 'usd';

class StripeGateway {
  constructor({ secretKey, webhookSecret, client }) {
    this.stripe = client || new Stripe(secretKey);
    this.webhookSecret = webhookSecret;
  }

  /** La llave de idempotencia de Stripe impide un segundo cobro para la misma SAGA. */
  async createPayment({ sagaId, amountCents, description }) {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: CURRENCY,
        description,
        // Sin redirecciones: el cobro se resuelve dentro del checkout del microfrontend
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { sagaId },
      },
      { idempotencyKey: `saga-payment-${sagaId}` },
    );
    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async getPayment(paymentIntentId) {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    return { status: intent.status, declined: Boolean(intent.last_payment_error) };
  }

  /** Cancela el cobro y devuelve su estado final; si ya se pagó, devuelve 'succeeded'. */
  async cancelPayment(paymentIntentId) {
    try {
      const intent = await this.stripe.paymentIntents.cancel(paymentIntentId);
      return intent.status;
    } catch (error) {
      if (error.code !== 'payment_intent_unexpected_state') throw error;
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return intent.status;
    }
  }

  async refundPayment({ sagaId, paymentIntentId }) {
    await this.stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `saga-refund-${sagaId}` },
    );
  }

  /**
   * Verifica la firma del webhook y lo traduce a un evento de la SAGA.
   * @returns {{routingKey: string, body: object}|null} null si no interesa a la SAGA.
   * @throws si la firma no es válida.
   */
  parseWebhook(rawBody, signature) {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const sagaId = event.data.object.metadata?.sagaId;
    if (!sagaId) return null;

    if (event.type === 'payment_intent.succeeded') {
      return { routingKey: 'saga.event.payment.succeeded', body: { sagaId } };
    }
    if (event.type === 'payment_intent.payment_failed') {
      return { routingKey: 'saga.event.payment.failed', body: { sagaId, reason: 'PAYMENT_DECLINED' } };
    }
    return null;
  }
}

module.exports = { StripeGateway };
