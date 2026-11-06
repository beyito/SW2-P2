<template>
  <div class="mfe-reservas-container">
    <!-- Header Vue Component -->
    <header class="glass-box header-bar">
      <div class="brand-group">
        <div class="vue-badge">Vue 3</div>
        <div>
          <h2 class="gold-text title">MFE Reservas & SAGA Checkout</h2>
          <span class="subtitle">Componente Autónomo Vue.js (Module Federation / Remote)</span>
        </div>
      </div>
      <div class="wizard-steps">
        <span :class="{ active: currentStep >= 1 }">1. Servicio</span>
        <span class="arrow">→</span>
        <span :class="{ active: currentStep >= 2 }">2. Horario</span>
        <span class="arrow">→</span>
        <span :class="{ active: currentStep >= 3 }">3. SAGA Transaccional</span>
      </div>
    </header>

    <!-- STEP 1: Servicio y Estilista -->
    <div v-if="currentStep === 1" class="step-layout">
      <div class="glass-box panel-left">
        <h3 class="gold-text section-title">Catálogo de Servicios Profesionales (CU-06)</h3>
        <div class="services-list">
          <div
            v-for="srv in services"
            :key="srv.id"
            class="service-card"
            :class="{ selected: selectedService.id === srv.id }"
            @click="selectedService = srv"
          >
            <div class="srv-top">
              <span class="srv-name">{{ srv.name }}</span>
              <span class="srv-price">${{ srv.price.toFixed(2) }}</span>
            </div>
            <p class="srv-desc">{{ srv.description }}</p>
            <div class="srv-meta">
              <span>⏱ {{ srv.duration }}</span>
              <span class="srv-supply">Insumo: {{ srv.requiredSupply }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="glass-box panel-right">
        <h3 class="gold-text section-title">Estilista Asignado (CU-05)</h3>
        <div class="stylist-list">
          <div
            v-for="sty in stylists"
            :key="sty.id"
            class="stylist-card"
            :class="{ selected: selectedStylist.id === sty.id }"
            @click="selectedStylist = sty"
          >
            <div class="avatar">{{ sty.avatar }}</div>
            <div class="stylist-info">
              <div class="stylist-name">{{ sty.name }}</div>
              <div class="stylist-spec">{{ sty.specialty }}</div>
            </div>
            <span class="rating-badge">★ {{ sty.rating }}</span>
          </div>
        </div>

        <button class="btn-primary" @click="currentStep = 2">
          Continuar a Fecha y Turno →
        </button>
      </div>
    </div>

    <!-- STEP 2: Fecha y Turno -->
    <div v-if="currentStep === 2" class="step-layout">
      <div class="glass-box panel-left">
        <h3 class="gold-text section-title">Fecha y Turno del Servicio</h3>
        <div class="field-group">
          <label>Fecha de la Cita:</label>
          <input type="date" v-model="selectedDate" class="input-date" min="2026-11-03" />
        </div>

        <h4 style="margin: 20px 0 10px; font-size: 0.95rem;">Turnos Disponibles con {{ selectedStylist.name }}:</h4>
        <div class="slots-grid">
          <button
            v-for="slot in timeSlots"
            :key="slot"
            class="slot-btn"
            :class="{ selected: selectedSlot === slot }"
            @click="selectedSlot = slot"
          >
            {{ slot }}
          </button>
        </div>
      </div>

      <div class="glass-box panel-right">
        <h3 class="gold-text section-title">Resumen de Agendamiento</h3>
        <div class="summary-box">
          <div class="sum-row"><span>Servicio:</span> <strong>{{ selectedService.name }}</strong></div>
          <div class="sum-row"><span>Estilista:</span> <strong>{{ selectedStylist.name }}</strong></div>
          <div class="sum-row"><span>Fecha:</span> <strong>{{ selectedDate }} ({{ selectedSlot }})</strong></div>
          <div class="divider"></div>
          <div class="sum-row total"><span>Total:</span> <strong style="color: #42B883;">${{ selectedService.price.toFixed(2) }} USD</strong></div>
        </div>

        <div class="action-buttons">
          <button class="btn-outline" @click="currentStep = 1">← Volver</button>
          <button class="btn-primary" @click="currentStep = 3">Continuar a Checkout SAGA →</button>
        </div>
      </div>
    </div>

    <!-- STEP 3: SAGA Checkout & Idempotencia -->
    <div v-if="currentStep === 3" class="step-layout saga-view">
      <div class="glass-box panel-left">
        <h3 class="gold-text section-title">Control SAGA & Idempotency-Key (CU-10, RNF-04)</h3>
        
        <div class="field-group">
          <label>Header Idempotency-Key (DynamoDB):</label>
          <div class="idem-row">
            <input type="text" :value="idempotencyKey" readonly class="input-idem" />
            <button class="btn-outline" @click="refreshIdemKey">↺</button>
          </div>
        </div>

        <div class="fail-toggle-box">
          <label class="checkbox-label">
            <input type="checkbox" v-model="simulateFailure" />
            <span>Simular Fallo de Pago (Demostrar Compensación / Rollback SAGA)</span>
          </label>
          <p class="hint">Si se activa, el paso pivote fallará y RabbitMQ emitirá los eventos compensatorios de devolución de inventario y cancelación.</p>
        </div>

        <button class="btn-primary" :disabled="sagaRunning" @click="executeSaga">
          <span v-if="sagaRunning">Ejecutando SAGA en Tiempo Real...</span>
          <span v-else>Ejecutar Reserva y Pago Transaccional</span>
        </button>
        <button class="btn-outline" style="margin-top: 10px;" :disabled="sagaRunning" @click="currentStep = 2">
          Modificar Datos
        </button>
      </div>

      <div class="glass-box panel-right">
        <h3 class="gold-text section-title">Eventos SAGA (RabbitMQ & DynamoDB)</h3>
        <div class="console-box">
          <div v-if="sagaLogs.length === 0" class="console-empty">
            Haga clic en "Ejecutar Reserva y Pago Transaccional" para observar la orquestación distribuida.
          </div>
          <div v-for="(log, idx) in sagaLogs" :key="idx" class="console-line" :class="log.status">
            <span class="ts">[{{ log.time }}]</span> {{ log.text }}
          </div>
        </div>
        <div v-if="sagaResult === 'SUCCESS'" class="status-banner success">
          ✅ SAGA COMPLETADA: Cita confirmada, insumo reservado y factura emitida.
        </div>
        <div v-if="sagaResult === 'COMPENSATED'" class="status-banner error">
          ⚠️ SAGA COMPENSADA: Rollbacks automáticos ejecutados sin inconsistencias.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const currentStep = ref(1);

const services = [
  { id: 'srv-01', name: 'Balayage Deluxe & Matizado', price: 120.0, duration: '150 min', requiredSupply: 'Tinte Rubio Cenizo 8.1 (120ml)', description: 'Aclarado a mano alzada con tonalizado y nutrición.' },
  { id: 'srv-02', name: 'Tratamiento Keratina Brasileña', price: 95.0, duration: '120 min', requiredSupply: 'Keratina Hidrolizada Premium (80ml)', description: 'Alisado termoactivo y sellado de cutícula sin formol.' },
  { id: 'srv-03', name: 'Corte Visagista & Styling', price: 45.0, duration: '60 min', requiredSupply: 'Sérum Termo-Protector Argán (15ml)', description: 'Corte adaptado al visagismo biométrico computacional.' }
];

const stylists = [
  { id: 'sty-001', name: 'Valentina Rossi', specialty: 'Master Colorista', rating: 4.9, avatar: 'VR' },
  { id: 'sty-002', name: 'Carlos Mendoza', specialty: 'Visagismo & Corte', rating: 4.8, avatar: 'CM' },
  { id: 'sty-003', name: 'Sofía Morales', specialty: 'Tratamientos & SPA', rating: 4.9, avatar: 'SM' }
];

const timeSlots = ['09:00 - 11:30', '10:00 - 12:30', '14:00 - 16:30', '16:30 - 19:00'];

const selectedService = ref(services[0]);
const selectedStylist = ref(stylists[0]);
const selectedDate = ref('2026-11-15');
const selectedSlot = ref('10:00 - 12:30');

const idempotencyKey = ref('idem-' + Math.random().toString(36).substring(2, 10));
const simulateFailure = ref(false);
const sagaRunning = ref(false);
const sagaLogs = ref([]);
const sagaResult = ref(null);

const refreshIdemKey = () => {
  idempotencyKey.value = 'idem-' + Math.random().toString(36).substring(2, 10);
};

const executeSaga = async () => {
  sagaRunning.value = true;
  sagaLogs.value = [];
  sagaResult.value = null;

  const pushLog = (text, status = 'info', delay = 500) => {
    return new Promise(resolve => {
      setTimeout(() => {
        sagaLogs.value.push({ text, status, time: new Date().toLocaleTimeString() });
        resolve();
      }, delay);
    });
  };

  await pushLog(`[DynamoDB] Validando Idempotency-Key '${idempotencyKey.value}'...`, 'info', 400);
  await pushLog(`[DynamoDB] Llave verificada (MISS). Transacción registrada en estado PENDING.`, 'success', 500);

  await pushLog(`[RabbitMQ SAGA] Emitiendo evento 'saga.appointment.created' para ${selectedService.value.name}...`, 'info', 500);
  await pushLog(`[ms-gestion] Cita reservada en PostgreSQL (salon_gestion).`, 'success', 500);

  await pushLog(`[RabbitMQ SAGA] Descontando insumo: ${selectedService.value.requiredSupply}...`, 'info', 500);
  await pushLog(`[ms-gestion] Stock de inventario decrementado exitosamente.`, 'success', 500);

  await pushLog(`[RabbitMQ SAGA] Procesando cobro $${selectedService.value.price.toFixed(2)} USD...`, 'info', 600);

  if (simulateFailure.value) {
    await pushLog(`[Pasarela Pagos] ERROR: Pago rechazado por la entidad bancaria.`, 'error', 700);
    await pushLog(`[SAGA Rollback] Emitiendo 'saga.compensation.inventory' a RabbitMQ...`, 'warning', 500);
    await pushLog(`[ms-gestion] Stock de insumos restituido en PostgreSQL.`, 'success', 500);
    await pushLog(`[SAGA Rollback] Emitiendo 'saga.compensation.appointment'...`, 'warning', 500);
    await pushLog(`[ms-gestion] Cita marcada como CANCELLED_BY_SAGA. Consistencia distribuida preservada.`, 'success', 500);
    sagaResult.value = 'COMPENSATED';
  } else {
    await pushLog(`[ms-crm] Pago confirmado. Emisión de Factura con 13% IVA en PostgreSQL.`, 'success', 500);
    await pushLog(`[ms-crm] +${Math.round(selectedService.value.price * 10)} puntos acumulados en el perfil del cliente.`, 'success', 400);
    await pushLog(`[n8n] Trigger emitido a RabbitMQ: Notificación agendada por WhatsApp a 24h.`, 'info', 400);
    await pushLog(`[SAGA Orchestrator] Transacción distribuida finalizada con éxito total.`, 'success', 400);
    sagaResult.value = 'SUCCESS';
  }

  sagaRunning.value = false;
};
</script>

<style scoped>
.mfe-reservas-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px;
}
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  margin-bottom: 24px;
}
.brand-group {
  display: flex;
  align-items: center;
  gap: 14px;
}
.vue-badge {
  background: #42B883;
  color: #0A0E17;
  font-weight: 800;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.85rem;
}
.title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
}
.subtitle {
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.wizard-steps {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.wizard-steps .active {
  color: var(--gold-primary);
  font-weight: 700;
}
.arrow {
  color: var(--text-muted);
}
.step-layout {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 24px;
}
.panel-left, .panel-right {
  padding: 24px;
}
.section-title {
  margin: 0 0 16px;
  font-size: 1.15rem;
  font-weight: 700;
}
.services-list, .stylist-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.service-card, .stylist-card {
  padding: 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-glass);
  cursor: pointer;
  transition: all 0.2s;
}
.service-card.selected, .stylist-card.selected {
  border-color: var(--gold-primary);
  background: rgba(212, 175, 55, 0.08);
}
.srv-top {
  display: flex;
  justify-content: space-between;
  font-weight: 700;
  margin-bottom: 6px;
}
.srv-price {
  color: #42B883;
}
.srv-desc {
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin: 0 0 8px;
}
.srv-meta {
  display: flex;
  gap: 14px;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.srv-supply {
  color: var(--gold-primary);
}
.stylist-card {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #F5D061, #D4AF37);
  color: #0A0E17;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
}
.stylist-info {
  flex: 1;
}
.stylist-name {
  font-weight: 700;
  font-size: 0.95rem;
}
.stylist-spec {
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.rating-badge {
  color: var(--gold-primary);
  font-weight: 700;
  font-size: 0.85rem;
}
.btn-primary {
  width: 100%;
  padding: 14px;
  margin-top: 18px;
  background: linear-gradient(135deg, #F5D061, #D4AF37);
  color: #0A0E17;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.95rem;
}
.btn-outline {
  padding: 12px;
  background: transparent;
  color: var(--gold-primary);
  border: 1px solid var(--border-glass);
  border-radius: 10px;
  cursor: pointer;
}
.field-group {
  margin-bottom: 16px;
}
.field-group label {
  display: block;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.input-date {
  width: 100%;
  padding: 12px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border-glass);
  color: #fff;
  border-radius: 8px;
}
.slots-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.slot-btn {
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-glass);
  color: var(--text-secondary);
  border-radius: 8px;
  cursor: pointer;
}
.slot-btn.selected {
  border-color: var(--gold-primary);
  color: var(--gold-primary);
  background: rgba(212, 175, 55, 0.15);
}
.summary-box {
  background: rgba(0, 0, 0, 0.3);
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--border-glass);
  margin-bottom: 20px;
}
.sum-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 0.85rem;
}
.sum-row.total {
  font-size: 1.1rem;
}
.divider {
  height: 1px;
  background: var(--border-glass);
  margin: 12px 0;
}
.action-buttons {
  display: flex;
  gap: 12px;
}
.action-buttons button {
  flex: 1;
}
.idem-row {
  display: flex;
  gap: 8px;
}
.input-idem {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border-glass);
  color: #fff;
  padding: 10px;
  border-radius: 8px;
  font-family: monospace;
}
.fail-toggle-box {
  background: rgba(255, 255, 255, 0.02);
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--border-glass);
  margin-bottom: 20px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--crimson-alert);
  font-weight: 600;
  cursor: pointer;
}
.hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 6px 0 0 24px;
}
.console-box {
  background: #06090F;
  border-radius: 10px;
  padding: 14px;
  min-height: 240px;
  max-height: 320px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 0.8rem;
  border: 1px solid var(--border-glass);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.console-empty {
  color: var(--text-muted);
  text-align: center;
  padding: 40px 0;
}
.console-line {
  line-height: 1.4;
}
.console-line.info { color: #60A5FA; }
.console-line.success { color: #42B883; }
.console-line.warning { color: #F5D061; }
.console-line.error { color: #FF4B4B; }
.console-line .ts { color: #4A5568; }
.status-banner {
  margin-top: 14px;
  padding: 12px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 700;
}
.status-banner.success {
  background: rgba(66, 184, 131, 0.15);
  color: #42B883;
  border: 1px solid rgba(66, 184, 131, 0.3);
}
.status-banner.error {
  background: rgba(255, 75, 75, 0.15);
  color: #FF4B4B;
  border: 1px solid rgba(255, 75, 75, 0.3);
}
</style>
