/**
 * Mensajería con RabbitMQ: topología, publicación confirmada y consumo de eventos.
 */
const amqp = require('amqplib');

const EXCHANGE = 'salon.saga';
const DEAD_LETTER_EXCHANGE = 'salon.saga.dlx';
const EVENTS_QUEUE = 'saga.orchestrator.events';
const COMMANDS_QUEUE = 'gestion.saga.commands';
const CRM_QUEUE = 'crm.saga.events';
const DEAD_LETTER_QUEUE = 'saga.dead-letter';
const PAYMENT_DELAY_QUEUE = 'saga.payment.delay';

class SagaMessaging {
  constructor(url) {
    this.url = url;
  }

  async connect() {
    this.connection = await amqp.connect(this.url);
    this.connection.on('close', () => {
      // Sin broker no hay SAGA: el contenedor se reinicia y reconecta
      console.error('[SAGA] Se perdió la conexión con RabbitMQ');
      process.exit(1);
    });
    this.channel = await this.connection.createConfirmChannel();

    const { channel } = this;
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });

    const deadLetters = { deadLetterExchange: DEAD_LETTER_EXCHANGE };
    await channel.assertQueue(EVENTS_QUEUE, { durable: true, ...deadLetters });
    await channel.bindQueue(EVENTS_QUEUE, EXCHANGE, 'saga.event.#');
    // Se declara también aquí para no perder comandos si ms-gestion aún no arrancó
    await channel.assertQueue(COMMANDS_QUEUE, { durable: true, ...deadLetters });
    await channel.bindQueue(COMMANDS_QUEUE, EXCHANGE, 'saga.command.#');
    await channel.assertQueue(CRM_QUEUE, { durable: true, ...deadLetters });
    await channel.bindQueue(CRM_QUEUE, EXCHANGE, 'saga.completed');
    await channel.bindQueue(CRM_QUEUE, EXCHANGE, 'crm.command.#');
    await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
    await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '#');

    // Cola de espera: al vencer el mensaje, RabbitMQ lo reenvía como evento de la SAGA
    await channel.assertQueue(PAYMENT_DELAY_QUEUE, {
      durable: true,
      deadLetterExchange: EXCHANGE,
      deadLetterRoutingKey: 'saga.event.payment.timeout',
    });
  }

  /** Publica y espera la confirmación del broker. */
  async publish(routingKey, body) {
    await new Promise((resolve, reject) => {
      this.channel.publish(
        EXCHANGE,
        routingKey,
        Buffer.from(JSON.stringify(body)),
        { persistent: true, contentType: 'application/json' },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  /**
   * Entrega el mensaje a la SAGA cuando pasa la espera indicada.
   * RabbitMQ vence los mensajes desde la cabeza de la cola: todos deben usar el mismo plazo.
   */
  async publishDelayed(body, delayMs) {
    await new Promise((resolve, reject) => {
      this.channel.sendToQueue(
        PAYMENT_DELAY_QUEUE,
        Buffer.from(JSON.stringify(body)),
        {
          persistent: true,
          contentType: 'application/json',
          expiration: String(delayMs),
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  /** Consume eventos de uno en uno, lo que serializa las transiciones. */
  async consumeEvents(handler) {
    await this.channel.prefetch(1);
    await this.channel.consume(EVENTS_QUEUE, async (message) => {
      if (!message) return;
      try {
        const body = JSON.parse(message.content.toString());
        const type = message.fields.routingKey.replace('saga.event.', '');
        await handler({ ...body, type }, { redelivered: message.fields.redelivered });
        this.channel.ack(message);
      } catch (error) {
        // Primer fallo: se reintenta una vez. Si se repite, va a la cola de mensajes muertos.
        console.error(`[SAGA] Error al procesar ${message.fields.routingKey}: ${error.message}`);
        this.channel.nack(message, false, !message.fields.redelivered);
      }
    });
  }

  async close() {
    this.connection.removeAllListeners('close');
    await this.connection.close();
  }
}

module.exports = { SagaMessaging };
