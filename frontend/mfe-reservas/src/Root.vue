<template>
  <div>
    <nav class="portal-tabs">
      <button
        v-for="item in TABS"
        :id="`portal-tab-${item.id}`"
        :key="item.id"
        type="button"
        :class="{ active: tab === item.id }"
        @click="tab = item.id"
      >
        {{ item.label }}
        <span v-if="item.id === 'notices' && unread > 0" id="unread-count" class="tab-count">{{ unread }}</span>
      </button>
    </nav>

    <!-- Se oculta sin desmontar: cambiar de pestaña no debe perder una reserva en curso -->
    <App ref="booking" v-show="tab === 'book'" />
    <MyAppointments v-if="tab === 'appointments'" />
    <MyInvoices v-if="tab === 'invoices'" />
    <MyProfile v-if="tab === 'profile'" />
    <MyNotices v-if="tab === 'notices'" @changed="refreshUnread" />
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import App from './App.vue';
import MyAppointments from './portal/MyAppointments.vue';
import MyInvoices from './portal/MyInvoices.vue';
import MyNotices from './portal/MyNotices.vue';
import MyProfile from './portal/MyProfile.vue';
import { loadMyNotices } from './api';

const TABS = [
  { id: 'book', label: 'Reservar' },
  { id: 'appointments', label: 'Mis citas' },
  { id: 'invoices', label: 'Mis facturas' },
  { id: 'profile', label: 'Mi perfil' },
  { id: 'notices', label: 'Avisos' },
];

const tab = ref('book');
const unread = ref(0);
const booking = ref(null);

async function refreshUnread() {
  try {
    unread.value = (await loadMyNotices()).filter((notice) => !notice.read).length;
  } catch {
    // El contador es informativo: la pestaña de avisos muestra el error si el servicio falla
  }
}

onMounted(refreshUnread);
watch(tab, (current) => {
  refreshUnread();
  if (current === 'book') booking.value?.refreshCatalog();
});
</script>
