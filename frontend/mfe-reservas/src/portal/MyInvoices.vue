<template>
  <section class="glass-box portal-panel">
    <h3 class="gold-text section-title">Mis facturas</h3>
    <p v-if="error" class="portal-error" role="alert">{{ error }}</p>
    <p v-if="loading">Cargando...</p>
    <p v-else-if="!invoices.length" class="portal-muted">Todavía no tienes facturas.</p>

    <article v-for="invoice in invoices" :key="invoice.id" class="portal-card invoice-card" :data-appointment="invoice.appointmentId">
      <div class="portal-row">
        <div>
          <strong>Factura {{ invoice.invoiceNumber ?? invoice.id }}</strong> · {{ invoice.serviceName ?? 'Servicio' }}
          <div class="portal-muted">{{ invoice.issuedAt }}</div>
          <div class="portal-muted" v-if="invoice.discountAmount > 0">Descuento por puntos: ${{ invoice.discountAmount.toFixed(2) }}</div>
          <div class="portal-muted">IVA incluido: ${{ invoice.taxAmount.toFixed(2) }}</div>
        </div>
        <div>
          <strong class="invoice-total">${{ invoice.totalAmount.toFixed(2) }}</strong>
          <span class="portal-badge invoice-status" :data-status="invoice.status">{{ invoice.status === 'REFUNDED' ? 'Reembolsada' : 'Emitida' }}</span>
        </div>
      </div>
      <div v-if="noteOf(invoice)" class="portal-muted credit-note">
        Nota de crédito {{ noteOf(invoice).creditNoteNumber }}: ${{ noteOf(invoice).amount.toFixed(2) }} ({{ noteOf(invoice).reason }})
      </div>
      <button type="button" class="portal-btn btn-receipt" @click="receipt(invoice)">Ver comprobante</button>
    </article>
    <p class="portal-muted">Los comprobantes son de demostración y no tienen validez fiscal.</p>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { loadMyBilling, openReceipt } from '../api';
import { currentUser } from '../auth';

const invoices = ref([]);
const notes = ref([]);
const loading = ref(true);
const error = ref(null);

const noteOf = (invoice) => notes.value.find((note) => note.invoiceId === invoice.id);

async function receipt(invoice) {
  error.value = null;
  try {
    await openReceipt(invoice.id);
  } catch (failure) {
    error.value = failure.message;
  }
}

onMounted(async () => {
  try {
    const { id } = await currentUser();
    const { getInvoicesByClient, getCreditNotesByClient } = await loadMyBilling(id);
    invoices.value = getInvoicesByClient;
    notes.value = getCreditNotesByClient;
  } catch (failure) {
    error.value = failure.message;
  } finally {
    loading.value = false;
  }
});
</script>
