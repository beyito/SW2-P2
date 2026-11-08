<template>
  <section class="glass-box portal-panel">
    <h3 class="gold-text section-title">Mis citas</h3>
    <p v-if="error" id="portal-error" class="portal-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="portal-success" role="status">{{ notice }}</p>
    <p v-if="loading">Cargando...</p>
    <p v-else-if="!appointments.length" class="portal-muted">Todavía no tienes citas.</p>

    <article v-for="item in appointments" :key="item.id" class="portal-card appointment-card" :data-id="item.id" :data-service="item.serviceName">
      <div class="portal-row">
        <div>
          <strong>{{ item.serviceName }}</strong>
          <div class="portal-muted">{{ formatDate(item.appointmentDate) }} · {{ item.stylistName }} · ${{ item.totalPrice.toFixed(2) }}</div>
        </div>
        <span class="portal-badge appointment-status" :data-status="item.status">{{ STATUS[item.status] ?? item.status }}</span>
      </div>

      <div v-if="isOpen(item)" class="portal-row portal-actions">
        <button type="button" class="portal-btn btn-reschedule" @click="startReschedule(item)">Reprogramar</button>
        <button v-if="confirmingId !== item.id" type="button" class="portal-btn danger btn-cancel" @click="confirmingId = item.id">Cancelar cita</button>
        <template v-else>
          <span>{{ item.sagaId ? 'Se reembolsará tu pago. ¿Cancelar?' : '¿Cancelar la cita?' }}</span>
          <button type="button" class="portal-btn danger btn-cancel-yes" :disabled="busy" @click="cancel(item)">Sí, cancelar</button>
          <button type="button" class="portal-btn" @click="confirmingId = null">No</button>
        </template>
      </div>

      <div v-if="rescheduling?.id === item.id" class="portal-form">
        <label>Nueva fecha
          <input class="reschedule-date" v-model="newDate" type="date" :min="today" @change="loadOptions(item)" />
        </label>
        <p v-if="!slots.length && newDate && !slotsLoading" class="portal-muted">No hay turnos libres ese día.</p>
        <div class="portal-row">
          <button
            v-for="slot in slots"
            :key="slot.start"
            type="button"
            class="portal-btn reschedule-slot"
            :disabled="busy"
            @click="reschedule(item, slot.start)"
          >{{ slot.start.slice(11, 16) }}</button>
        </div>
      </div>

      <form v-if="item.status === 'COMPLETED' && !item.reviewed" class="portal-form review-form" @submit.prevent="sendReview(item)">
        <label>Califica a {{ item.stylistName }}
          <select v-model.number="rating[item.id]" class="review-rating">
            <option v-for="value in [5, 4, 3, 2, 1]" :key="value" :value="value">{{ value }} ★</option>
          </select>
        </label>
        <label>Comentario
          <input v-model="comment[item.id]" class="review-comment" maxlength="500" />
        </label>
        <button type="submit" class="portal-btn btn-review" :disabled="busy">Enviar reseña</button>
      </form>
      <p v-else-if="item.reviewed" class="portal-muted review-done">Ya dejaste tu reseña. ¡Gracias!</p>
    </article>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import {
  cancelBooking, cancelUnpaidAppointment, createReview, getBooking, loadMyAppointments, loadSlots, rescheduleAppointment,
  localDate,
} from '../api';

const STATUS = {
  PENDING_PAYMENT: 'Pendiente de pago',
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  RESCHEDULED: 'Reprogramada',
  COMPLETED: 'Atendida',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
};
const OPEN_STATUSES = ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'];
const POLL_MS = 700;
const REFUND_WAIT_MS = 45000;
const DEFAULT_RATING = 5;

const appointments = ref([]);
const loading = ref(true);
const busy = ref(false);
const error = ref(null);
const notice = ref(null);
const confirmingId = ref(null);
const rescheduling = ref(null);
const newDate = ref('');
const slots = ref([]);
const slotsLoading = ref(false);
let slotsRequest = 0;
const rating = ref({});
const comment = ref({});
const today = localDate();

const formatDate = (iso) => new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
const isOpen = (item) => OPEN_STATUSES.includes(item.status) && new Date(item.appointmentDate) > new Date();

async function load() {
  try {
    appointments.value = await loadMyAppointments();
    for (const item of appointments.value) rating.value[item.id] ??= DEFAULT_RATING;
  } catch (failure) {
    error.value = failure.message;
  } finally {
    loading.value = false;
  }
}

/** Ejecuta una acción y recarga, para mostrar siempre lo que quedó guardado en el servidor. */
async function run(action, message) {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    await action();
    notice.value = message;
    await load();
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

/** El reembolso es asíncrono: espera a que la SAGA termine antes de confirmarlo. */
async function waitForRefund(sagaId) {
  const limit = Date.now() + REFUND_WAIT_MS;
  while (Date.now() < limit) {
    const { status, cancelRejectedReason } = await getBooking(sagaId);
    if (status === 'REFUNDED') return;
    if (cancelRejectedReason) throw new Error('La cita ya no se puede cancelar.');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('El reembolso sigue en proceso; revisa tus avisos en unos minutos.');
}

function cancel(item) {
  confirmingId.value = null;
  return run(async () => {
    if (item.sagaId) {
      await cancelBooking(item.sagaId);
      await waitForRefund(item.sagaId);
    } else {
      await cancelUnpaidAppointment(item.id);
    }
  }, item.sagaId ? 'Cita cancelada y pago reembolsado.' : 'Cita cancelada.');
}

function startReschedule(item) {
  rescheduling.value = item;
  newDate.value = '';
  slots.value = [];
}

async function loadOptions(item) {
  // Solo vale la consulta más reciente: una respuesta tardía movería la cita a otro día distinto del que se ve
  const request = ++slotsRequest;
  slots.value = [];
  slotsLoading.value = true;
  error.value = null;
  try {
    const available = newDate.value ? await loadSlots(item.stylistId, item.serviceId, newDate.value) : [];
    if (request === slotsRequest) slots.value = available;
  } catch (failure) {
    if (request === slotsRequest) error.value = failure.message;
  } finally {
    if (request === slotsRequest) slotsLoading.value = false;
  }
}

function reschedule(item, start) {
  return run(async () => {
    await rescheduleAppointment(item.id, start);
    rescheduling.value = null;
    slots.value = [];
  }, 'Cita reprogramada.');
}

function sendReview(item) {
  return run(() => createReview(item.id, rating.value[item.id], comment.value[item.id] ?? null), '¡Gracias por tu reseña!');
}

onMounted(load);
</script>
