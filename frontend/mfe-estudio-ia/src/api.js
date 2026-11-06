import { authFetch } from './auth';

const ASESORIA_URL = import.meta.env.VITE_ASESORIA_URL || 'http://localhost:3100';

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
