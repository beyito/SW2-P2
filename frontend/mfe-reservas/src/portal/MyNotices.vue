<template>
  <section class="glass-box portal-panel">
    <h3 class="gold-text section-title">Avisos</h3>
    <p v-if="error" class="portal-error" role="alert">{{ error }}</p>
    <p v-if="loading">Cargando...</p>
    <p v-else-if="!notices.length" class="portal-muted">No tienes avisos.</p>

    <article v-for="notice in notices" :key="notice.id" class="portal-card notice-card" :data-type="notice.type">
      <div class="portal-row">
        <div>
          <strong>{{ notice.title }}</strong>
          <span v-if="!notice.read" class="portal-badge notice-new">Nuevo</span>
          <div class="notice-message">{{ notice.message }}</div>
          <div class="portal-muted">{{ notice.createdAt }}</div>
        </div>
        <button v-if="!notice.read" type="button" class="portal-btn btn-read" @click="read(notice)">Marcar como leído</button>
      </div>
    </article>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { loadMyNotices, markNoticeRead } from '../api';

const emit = defineEmits(['changed']);

const notices = ref([]);
const loading = ref(true);
const error = ref(null);

async function read(notice) {
  error.value = null;
  try {
    await markNoticeRead(notice.id);
    notice.read = true;
    emit('changed');
  } catch (failure) {
    error.value = failure.message;
  }
}

onMounted(async () => {
  try {
    notices.value = await loadMyNotices();
  } catch (failure) {
    error.value = failure.message;
  } finally {
    loading.value = false;
  }
});
</script>
