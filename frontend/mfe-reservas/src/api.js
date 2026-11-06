import { authFetch } from './auth';

const GESTION_URL = import.meta.env.VITE_GESTION_URL || 'http://localhost:8081/graphql';
const SAGA_URL = import.meta.env.VITE_SAGA_URL || 'http://localhost:4100';
const CRM_BASE_URL = import.meta.env.VITE_CRM_BASE_URL || 'http://localhost:8083';
const CRM_URL = `${CRM_BASE_URL}/graphql`;

async function gestion(query, variables = {}) {
  return graphqlAt(GESTION_URL, query, variables);
}

async function crm(query, variables = {}) {
  return graphqlAt(CRM_URL, query, variables);
}

async function graphqlAt(url, query, variables) {
  const response = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

/** Catálogo y estilistas reales del salón. */
export async function loadCatalog() {
  const data = await gestion('{ getServices { id name description durationMinutes price } getStylists { id name specialty rating { average count } } }');
  return { services: data.getServices, stylists: data.getStylists };
}

export async function loadSlots(stylistId, serviceId, date) {
  const data = await gestion(
    'query ($stylistId: String!, $serviceId: String!, $date: String!) {' +
      ' getAvailableSlots(stylistId: $stylistId, serviceId: $serviceId, date: $date) { start end } }',
    { stylistId, serviceId, date },
  );
  return data.getAvailableSlots;
}

/** Saldo de puntos del cliente; 0 si todavía no tiene ficha en el CRM. */
export async function loadMyPoints() {
  const data = await crm('{ getMyProfile { loyaltyPoints } }');
  return data.getMyProfile?.loyaltyPoints ?? 0;
}

// ---------- Portal del cliente ----------

const APPOINTMENT_FIELDS = 'id stylistId stylistName serviceId serviceName appointmentDate durationMinutes totalPrice status sagaId reviewed';

export async function loadMyAppointments() {
  return (await gestion(`{ getMyAppointments { ${APPOINTMENT_FIELDS} } }`)).getMyAppointments;
}

export async function rescheduleAppointment(id, newDate) {
  await gestion('mutation ($id: ID!, $d: String!) { rescheduleAppointment(id: $id, newDate: $d) { id } }', { id, d: newDate });
}

/** Cancela una cita que no se pagó en línea; la pagada pasa por cancelBooking para reembolsarla. */
export async function cancelUnpaidAppointment(id) {
  await gestion('mutation ($id: ID!) { cancelAppointment(id: $id, reason: "Cancelada por el cliente") { id } }', { id });
}

export async function createReview(appointmentId, rating, comment) {
  await gestion('mutation ($i: CreateReviewInput!) { createReview(input: $i) { id } }', { i: { appointmentId, rating, comment } });
}

export async function loadStylistReviews(stylistId) {
  const data = await gestion('query ($id: String!) { getStylistReviews(stylistId: $id) { id rating comment createdAt } }', { id: stylistId });
  return data.getStylistReviews;
}

export async function loadMyBilling(clientId) {
  return crm(
    'query ($id: String!) {' +
      ' getInvoicesByClient(clientId: $id) { id invoiceNumber appointmentId serviceName subtotalAmount discountAmount totalAmount taxAmount status issuedAt }' +
      ' getCreditNotesByClient(clientId: $id) { id creditNoteNumber invoiceId amount reason issuedAt } }',
    { id: clientId },
  );
}

/** Abre el comprobante en una pestaña nueva; la petición lleva el token, un enlace normal no podría. */
export async function openReceipt(invoiceId) {
  const response = await authFetch(`${CRM_BASE_URL}/api/invoices/${invoiceId}/comprobante`);
  if (!response.ok) throw new Error(`No se pudo obtener el comprobante (${response.status}).`);
  const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Datos del perfil; crea la ficha del CRM si la cuenta todavía no la tiene. */
export async function loadMyProfile(clientId) {
  const profile = 'id fullName email phone loyaltyPoints';
  const { getMyProfile } = await crm(`{ getMyProfile { ${profile} } }`);
  const client = getMyProfile ?? (await crm(`mutation { syncMyProfile { ${profile} } }`)).syncMyProfile;
  const { getLoyaltyHistory } = await crm(
    'query ($id: String!) { getLoyaltyHistory(clientId: $id) { id points type description createdAt } }',
    { id: clientId },
  );
  return { client, history: getLoyaltyHistory };
}

export async function updateMyPhone(phone) {
  await crm('mutation ($p: String) { syncMyProfile(phone: $p) { id } }', { p: phone });
}

export async function loadMyNotices() {
  return (await crm('{ getMyNotices { id type title message read createdAt } }')).getMyNotices;
}

export async function markNoticeRead(id) {
  await crm('mutation ($id: ID!) { markNoticeRead(id: $id) }', { id });
}

async function sagaResponse(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `La reserva respondió ${response.status}.`);
  return body;
}

/** Inicia la reserva; repetirla con la misma llave devuelve la misma SAGA (RNF-04). */
export async function startBooking(booking, idempotencyKey) {
  return sagaResponse(await authFetch(`${SAGA_URL}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(booking),
  }));
}

export async function getBooking(sagaId) {
  return sagaResponse(await authFetch(`${SAGA_URL}/bookings/${sagaId}`));
}

/** Pide confirmar el pago con la pasarela, por si el webhook se demora. */
export async function syncBooking(sagaId) {
  return sagaResponse(await authFetch(`${SAGA_URL}/bookings/${sagaId}/sync`, { method: 'POST' }));
}

/** Cancela una reserva pagada: libera el turno y reembolsa el pago (CU-07). */
export async function cancelBooking(sagaId) {
  return sagaResponse(await authFetch(`${SAGA_URL}/bookings/${sagaId}/cancel`, { method: 'POST' }));
}

export async function getPublishableKey() {
  const response = await fetch(`${SAGA_URL}/payments/config`);
  const { publishableKey } = await response.json();
  return publishableKey;
}
