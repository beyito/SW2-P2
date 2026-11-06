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
import { loadMyProfile, updateMyPhone } from '../api';
import { currentUser } from '../auth';

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
