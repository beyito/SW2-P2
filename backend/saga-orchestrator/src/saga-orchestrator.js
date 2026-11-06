const amqp = require('amqplib');

const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://rabbit_admin:rabbit_secret_pass@localhost:5672';
const EXCHANGE_NAME = 'salon.saga.exchange';

class SagaOrchestrator {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async init() {
    console.log('[SAGA-ORCHESTRATOR] Conectando a RabbitMQ...');
    this.connection = await amqp.connect(RABBIT_URL);
    this.channel = await this.connection.createChannel();

    // Declarar Exchange de tipo Topic para orquestación de eventos
    await this.channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    // Declarar colas de la SAGA
    await this.channel.assertQueue('saga.appointment.queue', { durable: true });
    await this.channel.assertQueue('saga.inventory.queue', { durable: true });
    await this.channel.assertQueue('saga.payment.queue', { durable: true });
    await this.channel.assertQueue('saga.compensation.queue', { durable: true });
    await this.channel.assertQueue('saga.notification.queue', { durable: true });

    // Enlazar colas al Exchange
    await this.channel.bindQueue('saga.appointment.queue', EXCHANGE_NAME, 'saga.appointment.*');
    await this.channel.bindQueue('saga.inventory.queue', EXCHANGE_NAME, 'saga.inventory.*');
    await this.channel.bindQueue('saga.payment.queue', EXCHANGE_NAME, 'saga.payment.*');
    await this.channel.bindQueue('saga.compensation.queue', EXCHANGE_NAME, 'saga.compensation.*');
    await this.channel.bindQueue('saga.notification.queue', EXCHANGE_NAME, 'saga.completed');

    console.log('[SAGA-ORCHESTRATOR] Exchange y Colas declaradas con éxito.');
  }

  async publishEvent(routingKey, message) {
    const payload = Buffer.from(JSON.stringify(message));
    this.channel.publish(EXCHANGE_NAME, routingKey, payload, { persistent: true });
    console.log(`[EVENTO PUBLICADO] -> [${routingKey}]:`, JSON.stringify(message));
  }

  /**
   * Ejecuta el flujo transaccional distribuido SAGA (CU-10, RF-07, RNF-03)
   * Pasos:
   * 1. Bloqueo preliminar de cita
   * 2. Reserva de insumos cosméticos
   * 3. Paso Pivote: Cobro / Pago transaccional
   * 4. Confirmación definitiva y emisión de factura
   * Si el paso pivote falla -> Compensación automática en reversa (Rollback)
   */
  async executeBookingSaga(sagaData) {
    const sagaId = sagaData.sagaId || 'saga-' + Date.now();
    console.log(`\n===============================================================`);
    console.log(`>>> INICIANDO SAGA TRANSACCIONAL: [${sagaId}] <<<`);
    console.log(`===============================================================`);

    const executionLog = [];

    try {
      // -------------------------------------------------------------
      // PASO 1: Bloquear Cita en ms-gestion
      // -------------------------------------------------------------
      console.log(`\n[SAGA PASO 1/4] Solicitando bloqueo preliminar de cita...`);
      const appointmentEvent = {
        sagaId,
        appointmentId: sagaData.appointmentId,
        clientId: sagaData.clientId,
        stylistId: sagaData.stylistId,
        date: sagaData.appointmentDate,
        status: 'PENDING_PAYMENT',
        timestamp: new Date().toISOString()
      };
      await this.publishEvent('saga.appointment.created', appointmentEvent);
      executionLog.push({ step: 'APPOINTMENT_RESERVED', success: true });

      // -------------------------------------------------------------
      // PASO 2: Reservar Insumo Cosmético en ms-gestion
      // -------------------------------------------------------------
      console.log(`\n[SAGA PASO 2/4] Reservando stock de insumo cosmético...`);
      if (sagaData.simulateStockFailure) {
        throw new Error('STOCK_INSUFICIENTE: No hay suficiente tinte/keratina disponible.');
      }
      const inventoryEvent = {
        sagaId,
        itemId: sagaData.itemId,
        quantity: sagaData.quantity || 1,
        status: 'STOCK_RESERVED',
        timestamp: new Date().toISOString()
      };
      await this.publishEvent('saga.inventory.reserved', inventoryEvent);
      executionLog.push({ step: 'INVENTORY_RESERVED', success: true });

      // -------------------------------------------------------------
      // PASO 3 (PASO PIVOTE): Procesar Cobro / Pago
      // -------------------------------------------------------------
      console.log(`\n[SAGA PASO 3/4 - PIVOTE] Ejecutando pago con validación de Idempotencia...`);
      if (sagaData.simulatePaymentFailure) {
        throw new Error('PAGO_RECHAZADO: Fondos insuficientes o pasarela no autorizada.');
      }
      const paymentEvent = {
        sagaId,
        clientId: sagaData.clientId,
        amount: sagaData.totalAmount,
        paymentMethod: sagaData.paymentMethod || 'CREDIT_CARD',
        status: 'PAYMENT_SUCCESS',
        idempotencyKey: sagaData.idempotencyKey,
        timestamp: new Date().toISOString()
      };
      await this.publishEvent('saga.payment.processed', paymentEvent);
      executionLog.push({ step: 'PAYMENT_COMPLETED', success: true });

      // -------------------------------------------------------------
      // PASO 4: Confirmación Definitiva y Emisión de Factura
      // -------------------------------------------------------------
      console.log(`\n[SAGA PASO 4/4] Confirmando cita y emitiendo factura electrónica...`);
      const confirmedEvent = {
        sagaId,
        appointmentId: sagaData.appointmentId,
        invoiceId: 'inv-' + Date.now(),
        clientId: sagaData.clientId,
        status: 'SAGA_COMPLETED_SUCCESSFULLY',
        timestamp: new Date().toISOString()
      };
      await this.publishEvent('saga.completed', confirmedEvent);
      executionLog.push({ step: 'SAGA_COMPLETED', success: true });

      console.log(`\n>>> SAGA [${sagaId}] FINALIZADA CON ÉXITO <<<`);
      return { success: true, sagaId, status: 'COMPLETED', log: executionLog };

    } catch (error) {
      console.error(`\n[ALERTA SAGA FALLIDA] -> Causa: ${error.message}`);
      console.log(`\n[SAGA COMPENSACIÓN / ROLLBACK AUTOMÁTICO (RNF-03)]`);

      // Ejecutar compensaciones en orden inverso
      if (executionLog.some(l => l.step === 'INVENTORY_RESERVED')) {
        console.log(`-> Compensando Paso 2: Liberando insumo cosmético reservado...`);
        await this.publishEvent('saga.compensation.inventory', {
          sagaId,
          itemId: sagaData.itemId,
          action: 'RELEASE_STOCK',
          reason: error.message
        });
      }

      if (executionLog.some(l => l.step === 'APPOINTMENT_RESERVED')) {
        console.log(`-> Compensando Paso 1: Cancelando bloqueo de turno de cita...`);
        await this.publishEvent('saga.compensation.appointment', {
          sagaId,
          appointmentId: sagaData.appointmentId,
          action: 'CANCEL_APPOINTMENT',
          reason: error.message
        });
      }

      console.log(`>>> SAGA [${sagaId}] COMPENSADA Y REVERTIDA EN SU TOTALIDAD <<<\n`);
      return { success: false, sagaId, status: 'COMPENSATED', reason: error.message };
    }
  }

  async close() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }
}

module.exports = SagaOrchestrator;

// Si se ejecuta directamente, correr prueba
if (require.main === module) {
  (async () => {
    const orchestrator = new SagaOrchestrator();
    await orchestrator.init();

    // 1. Caso Exitoso
    console.log('\n--- PRUEBA 1: FLUJO SAGA EXITOSO (HAPPY PATH) ---');
    await orchestrator.executeBookingSaga({
      appointmentId: 'app-saga-001',
      clientId: 'cli-001',
      stylistId: 'sty-101',
      itemId: 'inv-001',
      totalAmount: 45.00,
      idempotencyKey: 'idem-saga-happy-path'
    });

    // 2. Caso con Fallo y Rollback Automático (Compensación)
    console.log('\n--- PRUEBA 2: FLUJO SAGA CON FALLO EN PAGO (ROLLBACK AUTOMÁTICO) ---');
    await orchestrator.executeBookingSaga({
      appointmentId: 'app-saga-002',
      clientId: 'cli-002',
      stylistId: 'sty-102',
      itemId: 'inv-002',
      totalAmount: 120.00,
      simulatePaymentFailure: true,
      idempotencyKey: 'idem-saga-fail-path'
    });

    await orchestrator.close();
    console.log('[SAGA-ORCHESTRATOR] Pruebas finalizadas.');
  })();
}
