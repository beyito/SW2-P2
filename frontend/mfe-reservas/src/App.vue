<template>
  <div class="mfe-reservas-container">
    <header class="glass-box header-bar">
      <div class="brand-group">
        <div class="vue-badge">Vue 3</div>
        <div>
          <h2 class="gold-text title">Reservas y Pago</h2>
          <span class="subtitle">Agenda tu cita y paga en línea</span>
        </div>
      </div>
      <div class="wizard-steps">
        <span :class="{ active: currentStep >= 1 }">1. Servicio</span>
        <span class="arrow">→</span>
        <span :class="{ active: currentStep >= 2 }">2. Horario</span>
        <span class="arrow">→</span>
        <span :class="{ active: currentStep >= 3 }">3. Pago</span>
      </div>
    </header>

    <div v-if="errorMessage" id="booking-error" class="status-banner error" style="margin-bottom: 16px;">
      {{ errorMessage }}
    </div>

    <div v-if="loading" class="glass-box" style="padding: 24px;">Cargando catálogo...</div>

    <!-- PASO 1: Servicio y estilista -->
    <div v-else-if="currentStep === 1" class="step-layout">
      <div class="glass-box panel-left">
        <h3 class="gold-text section-title">Servicios</h3>
        <div class="services-list">
          <div
            v-for="srv in services"
            :key="srv.id"
            class="service-card"
            :class="{ selected: selectedService?.id === srv.id }"
            :data-service="srv.id"
            @click="selectedService = srv"
          >
            <div class="srv-top">
              <span class="srv-name">{{ srv.name }}</span>
              <span class="srv-price">${{ srv.price.toFixed(2) }}</span>
            </div>
            <p class="srv-desc">{{ srv.description }}</p>
            <div class="srv-meta">
              <span>⏱ {{ srv.durationMinutes }} min</span>
            </div>
          </div>
        </div>
      </div>

      <div class="glass-box panel-right">
        <h3 class="gold-text section-title">Estilista</h3>
        <div class="stylist-list">
          <div
            v-for="sty in stylists"
            :key="sty.id"
            class="stylist-card"
            :class="{ selected: selectedStylist?.id === sty.id }"
            @click="selectedStylist = sty"
          >
            <div class="avatar">{{ initials(sty.name) }}</div>
            <div class="stylist-info">
              <div class="stylist-name">{{ sty.name }}</div>
            </div>
          </div>
        </div>

        <button id="btn-to-schedule" class="btn-primary" :disabled="!selectedService || !selectedStylist" @click="goToSchedule">
          Continuar a Fecha y Turno →
        </button>
      </div>
    </div>

    <!-- PASO 2: Fecha y turno -->
    <div v-else-if="currentStep === 2" class="step-layout">
      <div class="glass-box panel-left">
        <h3 class="gold-text section-title">Fecha y Turno</h3>
        <div class="field-group">
          <label>Fecha de la cita:</label>
          <input id="booking-date" v-model="selectedDate" type="date" class="input-date" :min="today" @change="refreshSlots" />
        </div>

        <h4 style="margin: 20px 0 10px; font-size: 0.95rem;">Turnos disponibles con {{ selectedStylist.name }}:</h4>
        <p v-if="slotsLoading" class="hint">Consultando disponibilidad...</p>
        <p v-else-if="slots.length === 0" id="no-slots" class="hint">No hay turnos disponibles en esta fecha.</p>
        <div class="slots-grid">
          <button
            v-for="slot in slots"
            :key="slot.start"
            class="slot-btn"
            :class="{ selected: selectedSlot?.start === slot.start }"
            @click="selectedSlot = slot"
          >
            {{ timeOf(slot.start) }} - {{ timeOf(slot.end) }}
          </button>
        </div>
      </div>

      <div class="glass-box panel-right">
        <h3 class="gold-text section-title">Resumen</h3>
        <div class="summary-box">
          <div class="sum-row"><span>Servicio:</span> <strong>{{ selectedService.name }}</strong></div>
          <div class="sum-row"><span>Estilista:</span> <strong>{{ selectedStylist.name }}</strong></div>
          <div class="sum-row"><span>Fecha:</span> <strong>{{ selectedDate }} {{ selectedSlot ? timeOf(selectedSlot.start) : '' }}</strong></div>
          <div class="divider"></div>
          <div class="sum-row"><span>Precio:</span> <strong>${{ selectedService.price.toFixed(2) }} USD</strong></div>
          <div v-if="myPoints > 0" class="field-group" style="margin-top: 12px;">
            <label>Usar puntos (tienes {{ myPoints }}; cada punto vale $0.01):</label>
            <input id="points-to-redeem" v-model.number="pointsToRedeem" type="number" min="0" :max="maxRedeemablePoints" class="input-date" />
          </div>
          <div class="sum-row total"><span>Total a pagar:</span> <strong id="total-to-pay" style="color: #42B883;">${{ totalToPay.toFixed(2) }} USD</strong></div>
        </div>

        <div class="action-buttons">
          <button class="btn-outline" @click="currentStep = 1">← Volver</button>
          <button id="btn-to-checkout" class="btn-primary" :disabled="!selectedSlot || sagaBusy" @click="reserve">
            {{ sagaBusy ? 'Reservando turno...' : 'Reservar y continuar al pago →' }}
          </button>
        </div>
      </div>
    </div>

    <!-- PASO 3: Pago con Stripe y avance real de la SAGA -->
    <div v-else class="step-layout saga-view">
      <div class="glass-box panel-left">
        <h3 class="gold-text section-title">Pago</h3>

        <div v-if="booking?.status === 'AWAITING_PAYMENT'">
          <p class="hint">Tu turno está bloqueado durante 15 minutos mientras completas el pago.</p>
          <div id="payment-element" style="margin: 16px 0;"></div>
          <button id="btn-pay" class="btn-primary" :disabled="paying || !paymentReady" @click="pay">
            {{ paying ? 'Procesando pago...' : `Pagar $${(booking.amountToPayCents / 100).toFixed(2)} USD` }}
          </button>
          <p class="hint" style="margin-top: 12px;">
            Modo de prueba. Aprobada: 4242 4242 4242 4242. Rechazada: 4000 0000 0000 0002. Fecha futura y cualquier CVC.
          </p>
        </div>

        <p v-else-if="!isFinished" class="hint">Procesando tu reserva...</p>

        <button
          v-if="booking?.status === 'COMPLETED'"
          id="btn-cancel-booking"
          class="btn-outline"
          style="margin-bottom: 10px;"
          :disabled="cancelling"
          @click="cancel"
        >
          {{ cancelling ? 'Cancelando...' : 'Cancelar la cita y reembolsar' }}
        </button>
        <button v-if="isFinished && !cancelling" id="btn-new-booking" class="btn-primary" @click="restart">Hacer otra reserva</button>
      </div>

      <div class="glass-box panel-right">
        <h3 class="gold-text section-title">Avance de la reserva</h3>
        <div class="console-box">
          <div v-for="(step, index) in booking?.history ?? []" :key="index" class="console-line" :class="stepClass(step.state)">
            <span class="ts">[{{ new Date(step.at).toLocaleTimeString() }}]</span> {{ stepLabel(step.state) }}
          </div>
        </div>
        <div v-if="booking?.status === 'COMPLETED'" id="booking-success" class="status-banner success">
          ✅ Reserva confirmada: tu pago se procesó y el turno es tuyo.
        </div>
        <div v-if="isFailure" id="booking-failure" class="status-banner error">
          ⚠️ {{ failureMessage }} No se realizó ningún cobro y el turno quedó libre.
        </div>
        <div v-if="booking?.status === 'REFUNDED'" id="booking-refunded" class="status-banner success">
          ✅ Cita cancelada: el pago se reembolsó y se emitió una nota de crédito.
        </div>
        <div v-if="booking?.cancelRejectedReason" id="cancel-rejected" class="status-banner error">
          ⚠️ {{ cancelRejectedMessage }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { loadStripe } from '@stripe/stripe-js';
import { cancelBooking, getBooking, getPublishableKey, loadCatalog, loadMyPoints, loadSlots, startBooking, syncBooking } from './api';

const POLL_MS = 700;
const TERMINAL = ['COMPLETED', 'COMPENSATED', 'FAILED', 'REFUNDED'];
const MINIMUM_CHARGE = 0.5;
const STEP_LABELS = {
  RESERVING_APPOINTMENT: 'Bloqueando el turno',
  RESERVING_STOCK: 'Apartando los insumos',
  RESERVING_POINTS: 'Aplicando tus puntos',
  CREATING_PAYMENT: 'Preparando el cobro',
  AWAITING_PAYMENT: 'Esperando el pago',
  CONFIRMING_APPOINTMENT: 'Pago recibido: confirmando la cita',
  COMMITTING_STOCK: 'Descontando los insumos',
  COMPLETED: 'Reserva completada',
  COMPENSATING_POINTS: 'Devolviendo tus puntos',
  COMPENSATING_STOCK: 'Devolviendo los insumos',
  COMPENSATING_APPOINTMENT: 'Liberando el turno',
  COMPENSATED: 'Reserva revertida',
  FAILED: 'Reserva rechazada',
  CANCELLING_APPOINTMENT: 'Cancelando la cita',
  REFUNDING_PAYMENT: 'Reembolsando el pago',
  ISSUING_CREDIT_NOTE: 'Emitiendo la nota de crédito',
  REFUNDED: 'Pago reembolsado',
};
const FAILURE_MESSAGES = {
  SLOT_TAKEN: 'Ese turno acaba de ser tomado por otra persona.',
  OUTSIDE_WORKING_HOURS: 'Ese horario ya no está disponible.',
  STOCK_INSUFFICIENT: 'Por ahora no hay insumos suficientes para este servicio.',
  PAYMENT_DECLINED: 'El banco rechazó el pago.',
  PAYMENT_TIMEOUT: 'Venció el tiempo para pagar.',
  PAYMENT_UNAVAILABLE: 'El servicio de pagos no está disponible.',
  POINTS_INSUFFICIENT: 'No tienes puntos suficientes.',
  POINTS_EXCEED_LIMIT: 'Esa cantidad de puntos supera el máximo permitido para este servicio.',
};

const loading = ref(true);
const errorMessage = ref(null);
const currentStep = ref(1);
const services = ref([]);
const stylists = ref([]);
const selectedService = ref(null);
const selectedStylist = ref(null);
const today = new Date().toISOString().slice(0, 10);
const selectedDate = ref(today);
const slots = ref([]);
const slotsLoading = ref(false);
const selectedSlot = ref(null);

const booking = ref(null);
const sagaBusy = ref(false);
const paying = ref(false);
const paymentReady = ref(false);
const cancelling = ref(false);
const myPoints = ref(0);
const pointsToRedeem = ref(0);
let idempotencyKey = null;
let pollTimer = null;
let stripe = null;
let elements = null;
let cardElement = null;
let paymentSecret = null;

const isFinished = computed(() => TERMINAL.includes(booking.value?.status));
const isFailure = computed(() => ['COMPENSATED', 'FAILED'].includes(booking.value?.status));
const failureMessage = computed(() => FAILURE_MESSAGES[booking.value?.failureReason] ?? 'No se pudo completar la reserva.');

const cancelRejectedMessage = computed(() => (
  booking.value?.cancelRejectedReason === 'TOO_LATE'
    ? 'La cita ya comenzó o ya pasó: no se puede cancelar.'
    : 'Esta cita no se puede cancelar en su estado actual.'
));
// El cobro no puede quedar por debajo del mínimo de la pasarela
const maxRedeemablePoints = computed(() => {
  const limit = Math.round(((selectedService.value?.price ?? 0) - MINIMUM_CHARGE) * 100);
  return Math.max(0, Math.min(myPoints.value, limit));
});
const validPoints = computed(() => Math.min(Math.max(0, Math.floor(pointsToRedeem.value || 0)), maxRedeemablePoints.value));
const totalToPay = computed(() => (selectedService.value?.price ?? 0) - validPoints.value / 100);

const initials = (name) => name.split(' ').slice(0, 2).map((part) => part[0]).join('');
const timeOf = (iso) => iso.slice(11, 16);
const stepLabel = (state) => STEP_LABELS[state] ?? state;
const stepClass = (state) => {
  if (state === 'COMPLETED') return 'success';
  if (state === 'FAILED' || state === 'COMPENSATED') return 'error';
  return state.startsWith('COMPENSATING') ? 'warning' : 'info';
};

onMounted(async () => {
  try {
    const catalog = await loadCatalog();
    services.value = catalog.services;
    stylists.value = catalog.stylists;
    selectedService.value = catalog.services[0] ?? null;
    selectedStylist.value = catalog.stylists[0] ?? null;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => clearTimeout(pollTimer));

async function refreshSlots() {
  // Nunca se muestran turnos anteriores mientras llega la disponibilidad actual
  slots.value = [];
  selectedSlot.value = null;
  slotsLoading.value = true;
  errorMessage.value = null;
  try {
    slots.value = await loadSlots(selectedStylist.value.id, selectedService.value.id, selectedDate.value);
  } catch (error) {
    slots.value = [];
    errorMessage.value = error.message;
  } finally {
    slotsLoading.value = false;
  }
}

function goToSchedule() {
  currentStep.value = 2;
  pointsToRedeem.value = 0;
  refreshSlots();
  loadMyPoints().then((points) => {
    myPoints.value = points;
  }).catch(() => {
    myPoints.value = 0;
  });
}

/** La llave se conserva entre reintentos del mismo intento: así un doble clic no reserva dos veces. */
async function reserve() {
  errorMessage.value = null;
  sagaBusy.value = true;
  idempotencyKey ??= crypto.randomUUID();
  try {
    booking.value = await startBooking(
      {
        serviceId: selectedService.value.id,
        stylistId: selectedStylist.value.id,
        appointmentDate: selectedSlot.value.start,
        pointsToRedeem: validPoints.value,
      },
      idempotencyKey,
    );
    currentStep.value = 3;
    poll();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    sagaBusy.value = false;
  }
}

async function poll() {
  try {
    booking.value = await getBooking(booking.value.sagaId);
  } catch (error) {
    errorMessage.value = error.message;
  }
  if (booking.value.status === 'AWAITING_PAYMENT' && !elements) {
    await mountPaymentForm();
  }
  // Mientras se cancela, la reserva sigue en COMPLETED hasta que la SAGA procesa la solicitud
  const waitingCancellation = cancelling.value
    && booking.value.status !== 'REFUNDED'
    && !booking.value.cancelRejectedReason;
  if (!isFinished.value || waitingCancellation) {
    pollTimer = setTimeout(poll, POLL_MS);
  } else {
    idempotencyKey = null;
    cancelling.value = false;
  }
}

async function cancel() {
  errorMessage.value = null;
  cancelling.value = true;
  booking.value = { ...booking.value, cancelRejectedReason: null };
  try {
    await cancelBooking(booking.value.sagaId);
    poll();
  } catch (error) {
    errorMessage.value = error.message;
    cancelling.value = false;
  }
}

/** Solo tarjeta: es síncrona y encaja con el paso pivote de la SAGA. */
async function mountPaymentForm() {
  stripe ??= await loadStripe(await getPublishableKey());
  paymentSecret = booking.value.clientSecret;
  elements = stripe.elements();
  await nextTick();
  cardElement = elements.create('card', {
    hidePostalCode: true,
    style: {
      base: { color: '#F3F4F6', fontSize: '16px', '::placeholder': { color: '#9CA3AF' } },
      invalid: { color: '#FF4B4B' },
    },
  });
  cardElement.on('ready', () => {
    paymentReady.value = true;
  });
  cardElement.mount('#payment-element');
}

async function pay() {
  paying.value = true;
  errorMessage.value = null;
  const { error } = await stripe.confirmCardPayment(paymentSecret, { payment_method: { card: cardElement } });
  // Datos incompletos no son un rechazo: el cliente puede corregirlos sin perder el turno
  if (error && error.type === 'validation_error') {
    errorMessage.value = error.message;
    paying.value = false;
    return;
  }
  await syncBooking(booking.value.sagaId).catch(() => undefined);
  paying.value = false;
}

function restart() {
  clearTimeout(pollTimer);
  booking.value = null;
  // Stripe admite un solo elemento de tarjeta activo: el anterior debe destruirse
  cardElement?.destroy();
  elements = null;
  cardElement = null;
  paymentSecret = null;
  paymentReady.value = false;
  selectedSlot.value = null;
  idempotencyKey = null;
  currentStep.value = 1;
}
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
