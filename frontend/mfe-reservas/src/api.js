import { authFetch } from './auth';

const GESTION_URL = import.meta.env.VITE_GESTION_URL || 'http://localhost:8081/graphql';
const SAGA_URL = import.meta.env.VITE_SAGA_URL || 'http://localhost:4100';

async function graphql(query, variables = {}) {
  const response = await authFetch(GESTION_URL, {
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
  const data = await graphql('{ getServices { id name description durationMinutes price } getStylists { id name } }');
  return { services: data.getServices, stylists: data.getStylists };
}

export async function loadSlots(stylistId, serviceId, date) {
  const data = await graphql(
    'query ($stylistId: String!, $serviceId: String!, $date: String!) {' +
      ' getAvailableSlots(stylistId: $stylistId, serviceId: $serviceId, date: $date) { start end } }',
    { stylistId, serviceId, date },
  );
  return data.getAvailableSlots;
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

export async function getPublishableKey() {
  const response = await fetch(`${SAGA_URL}/payments/config`);
  const { publishableKey } = await response.json();
  return publishableKey;
}
