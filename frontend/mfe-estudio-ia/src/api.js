import { authFetch } from './auth';

const ASESORIA_URL = import.meta.env.VITE_ASESORIA_URL || 'http://localhost:3100';
const IA_URL = import.meta.env.VITE_IA_URL || 'http://localhost:8002/api/v1';

async function request(path, method = 'GET', body) {
  const response = await authFetch(`${ASESORIA_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message ?? `El servicio respondió ${response.status}.`);
  }
  return payload;
}

/** Sube una imagen y devuelve su ruta interna. */
export async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await authFetch(`${ASESORIA_URL}/media`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(response.status === 413 ? 'La imagen supera los 5 MB.' : payload.message ?? `No se pudo subir la imagen (${response.status}).`);
  }
  return payload.url;
}

/** Las imágenes propias se guardan como ruta interna; los datos antiguos pueden tener una URL completa. */
export const imageSource = (url) => (url?.startsWith('/media/') ? `${ASESORIA_URL}${url}` : url);

/** Error de ms-ia con su código, para que la pantalla pueda reaccionar a cada caso. */
async function iaRequest(path, options) {
  let response;
  try {
    response = await authFetch(`${IA_URL}${path}`, options);
  } catch (failure) {
    throw new Error(failure.message === 'Failed to fetch' ? 'El servicio de diagnóstico no responde.' : failure.message);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === 'object' && !Array.isArray(payload.detail) ? payload.detail : {};
    const error = new Error(detail.message ?? `El servicio respondió ${response.status}.`);
    error.code = detail.code;
    throw error;
  }
  return payload;
}

const jsonRequest = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const iaApi = {
  scan: (file) => {
    const form = new FormData();
    form.append('file', file);
    return iaRequest('/biometrics/scan', { method: 'POST', body: form });
  },
  recommend: (attributes) => iaRequest('/recommendations/styles', jsonRequest(attributes)),
  brand: (request) => iaRequest('/brand/strategy', jsonRequest(request)),
};

export const biometricsApi = {
  consent: () => request('/biometrics/consent'),
  grant: (policyVersion) => request('/biometrics/consent', 'POST', { policyVersion }),
  revoke: () => request('/biometrics/consent', 'DELETE'),
  diagnoses: () => request('/biometrics/diagnoses'),
  deleteDiagnosis: (id) => request(`/biometrics/diagnoses/${id}`, 'DELETE'),
};

export const closetApi = {
  list: (clientId) => request(`/closet/client/${clientId}`),
  create: (item) => request('/closet', 'POST', item),
  update: (id, changes) => request(`/closet/${id}`, 'PATCH', changes),
  remove: (id) => request(`/closet/${id}`, 'DELETE'),
};

export const communityApi = {
  wall: () => request('/community'),
  create: (post) => request('/community', 'POST', post),
  remove: (id) => request(`/community/${id}`, 'DELETE'),
  like: (id) => request(`/community/${id}/like`, 'POST'),
  comment: (id, content, parentId) => request(`/community/${id}/comment`, 'POST', { content, parentId }),
  removeComment: (id, commentId) => request(`/community/${id}/comment/${commentId}`, 'DELETE'),
  report: (id, reason) => request(`/community/${id}/report`, 'POST', { reason }),
};
