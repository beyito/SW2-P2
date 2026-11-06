<template>
  <section class="glass-box portal-panel">
    <h3 class="gold-text section-title">Mi perfil</h3>
    <p v-if="error" class="portal-error" role="alert">{{ error }}</p>
    <p v-if="saved" class="portal-success" role="status">{{ saved }}</p>
    <p v-if="loading">Cargando...</p>

    <template v-if="client">
      <div class="portal-card">
        <div><strong id="profile-name">{{ client.fullName }}</strong></div>
        <div class="portal-muted">{{ client.email }}</div>
        <form class="portal-row portal-form" @submit.prevent="savePhone">
          <label>Teléfono <input id="profile-phone" v-model="phone" maxlength="30" /></label>
          <button id="profile-save" type="submit" class="portal-btn">Guardar</button>
        </form>
        <label class="portal-row portal-muted" style="margin-top: 10px;">
          <input id="profile-whatsapp" type="checkbox" :checked="client.whatsappOptIn" :disabled="!phone" @change="toggleWhatsapp($event.target.checked)" />
          Quiero recibir confirmaciones y recordatorios por WhatsApp en este teléfono
        </label>
      </div>

      <div class="portal-card">
        <div><strong>Para tus recomendaciones</strong></div>
        <div class="portal-muted">Es opcional y el personal del salón no lo ve.</div>
        <form class="portal-row portal-form" @submit.prevent="saveStyle">
          <label v-for="question in QUESTIONS" :key="question.field">
            {{ question.label }}
            <select :id="`style-${question.field}`" v-model="style[question.field]">
              <option value="">Sin responder</option>
              <option v-for="(text, value) in question.options" :key="value" :value="value">{{ text }}</option>
            </select>
          </label>
          <button id="style-save" type="submit" class="portal-btn">Guardar</button>
        </form>
      </div>

      <div class="portal-card">
        <div>Puntos disponibles: <strong id="profile-points">{{ client.loyaltyPoints }}</strong></div>
        <div class="portal-muted">Ganas 10 puntos por cada dólar pagado; cada punto vale $0.01 en tu próxima reserva.</div>
        <table class="portal-table">
          <tbody>
            <tr v-for="movement in history" :key="movement.id" class="points-row">
              <td>{{ movement.createdAt }}</td>
              <td>{{ movement.description }}</td>
              <td>{{ movement.points > 0 ? '+' : '' }}{{ movement.points }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { loadMyProfile, setWhatsappOptIn, updateMyPhone, updateMyStyleProfile } from '../api';
import { currentUser } from '../auth';

const QUESTIONS = [
  { field: 'gender', label: 'Estilos', options: { FEMALE: 'Para mujer', MALE: 'Para hombre', NON_BINARY: 'Todos (no binario)', UNDISCLOSED: 'Todos (prefiero no decirlo)' } },
  { field: 'ageRange', label: 'Edad', options: { UNDER_18: 'Menos de 18', '18_29': '18 a 29', '30_44': '30 a 44', '45_59': '45 a 59', '60_PLUS': '60 o más' } },
  { field: 'preferredLength', label: 'Largo', options: { SHORT: 'Corto', MEDIUM: 'Medio', LONG: 'Largo' } },
  { field: 'maintenance', label: 'Mantenimiento', options: { LOW: 'Bajo', MEDIUM: 'Medio', HIGH: 'Alto' } },
  { field: 'vibe', label: 'Estilo', options: { NATURAL: 'Natural', PROFESSIONAL: 'Profesional', TRENDY: 'En tendencia', BOLD: 'Atrevido' } },
];

const style = ref({ gender: '', ageRange: '', preferredLength: '', maintenance: '', vibe: '' });
const client = ref(null);
const history = ref([]);
const phone = ref('');
const loading = ref(true);
const error = ref(null);
const saved = ref(null);

async function load() {
  const { id } = await currentUser();
  const profile = await loadMyProfile(id);
  client.value = profile.client;
  history.value = profile.history;
  phone.value = profile.client.phone;
  const saved = profile.client.styleProfile ?? {};
  for (const { field } of QUESTIONS) style.value[field] = saved[field] ?? '';
}

async function toggleWhatsapp(enabled) {
  error.value = null;
  saved.value = null;
  try {
    await setWhatsappOptIn(enabled);
    client.value = { ...client.value, whatsappOptIn: enabled };
    saved.value = enabled ? 'Recibirás mensajes por WhatsApp.' : 'Ya no recibirás mensajes por WhatsApp.';
  } catch (failure) {
    error.value = failure.message;
  }
}

async function saveStyle() {
  error.value = null;
  saved.value = null;
  try {
    // Lo que queda sin responder se guarda vacío, no como texto en blanco
    const input = Object.fromEntries(Object.entries(style.value).filter(([, value]) => value));
    await updateMyStyleProfile(input);
    saved.value = 'Preferencias actualizadas.';
  } catch (failure) {
    error.value = failure.message;
  }
}

async function savePhone() {
  error.value = null;
  saved.value = null;
  try {
    await updateMyPhone(phone.value);
    await load();
    saved.value = 'Teléfono actualizado.';
  } catch (failure) {
    error.value = failure.message;
  }
}

onMounted(async () => {
  try {
    await load();
  } catch (failure) {
    error.value = failure.message;
  } finally {
    loading.value = false;
  }
});
</script>
