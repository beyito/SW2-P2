import { authFetch, offlineStore, OfflineError } from './auth';

const ASESORIA_URL = import.meta.env.VITE_ASESORIA_URL || 'http://localhost:3100';
const IA_URL = import.meta.env.VITE_IA_URL || 'http://localhost:8002/api/v1';
const CRM_URL = import.meta.env.VITE_CRM_URL || 'http://localhost:8083/graphql';

const QUEUED = { queued: true };

async function parsed(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message ?? `El servicio respondió ${response.status}.`);
  }
  return payload;
}

/** Lectura con copia local: sin conexión muestra lo último que se vio. */
async function read(path) {
  const store = offlineStore();
  try {
    const payload = await parsed(await authFetch(`${ASESORIA_URL}${path}`));
    await store?.cachePut(path, payload);
    return payload;
  } catch (failure) {
    const saved = failure.offline ? await store?.cacheGet(path) : undefined;
    if (saved === undefined) throw failure;
    return saved;
  }
}

/**
 * Escritura que no se pierde: la llave se crea antes del primer intento, así que si la respuesta se perdió
 * en el camino, reenviarla desde la cola no la repite (RNF-04, CU-22).
 */
async function write(path, method, body, label) {
  const idempotencyKey = crypto.randomUUID();
  try {
    return await parsed(await authFetch(`${ASESORIA_URL}${path}`, {
      method,
      headers: {
        'Idempotency-Key': idempotencyKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }));
  } catch (failure) {
    const store = offlineStore();
    if (!failure.offline || !store) throw failure;
    await store.enqueue({ kind: 'ASESORIA', label, url: `${ASESORIA_URL}${path}`, method, body, idempotencyKey });
    return QUEUED;
  }
}

/** Datos biométricos: nunca pasan por la cola ni por la copia local, para que revocar los borre de verdad. */
async function online(path, method = 'GET', body) {
  return parsed(await authFetch(`${ASESORIA_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }));
}

/** Sube una imagen y devuelve su ruta interna. */
export async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  let response;
  try {
    response = await authFetch(`${ASESORIA_URL}/media`, { method: 'POST', body: form });
  } catch (failure) {
    throw failure.offline ? new OfflineError('Subir una imagen requiere conexión. Inténtalo al volver a estar en línea.') : failure;
  }
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
    throw failure.offline ? new OfflineError('Esta función de IA requiere conexión.') : failure;
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

/** Preferencias declaradas por el cliente; si el CRM no responde, se recomienda sin ellas. */
export async function loadStyleProfile() {
  try {
    const response = await authFetch(CRM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ getMyProfile { styleProfile { gender ageRange preferredLength maintenance vibe } } }' }),
    });
    const body = await response.json();
    return body.data?.getMyProfile?.styleProfile ?? {};
  } catch {
    return {};
  }
}

export const biometricsApi = {
  consent: () => online('/biometrics/consent'),
  grant: (policyVersion) => online('/biometrics/consent', 'POST', { policyVersion, declaresAdult: true }),
  revoke: () => online('/biometrics/consent', 'DELETE'),
  diagnoses: () => online('/biometrics/diagnoses'),
  deleteDiagnosis: (id) => online(`/biometrics/diagnoses/${id}`, 'DELETE'),
};

/** Generar una imagen envía la foto a un tercero: sin cola, sin copia local y siempre con conexión. */
function generateImage(path, file, field, value) {
  const form = new FormData();
  form.append('file', file);
  form.append(field, value);
  return iaRequest(`/image-generation/${path}`, { method: 'POST', body: form });
}

export const imageGenApi = {
  consent: () => online('/biometrics/image-consent'),
  grant: (policyVersion) => online('/biometrics/image-consent', 'POST', { policyVersion, declaresAdult: true }),
  revoke: () => online('/biometrics/image-consent', 'DELETE'),
  haircut: (file, styleId) => generateImage('haircut', file, 'style_id', styleId),
  tryOn: (file, itemId) => generateImage('try-on', file, 'item_id', itemId),
  tryOnOutfit: (file, itemIds) => generateImage('try-on-outfit', file, 'item_ids', itemIds.join(',')),
};

export const closetApi = {
  list: (clientId) => read(`/closet/client/${clientId}`),
  create: (item) => write('/closet', 'POST', item, `Agregar prenda: ${item.name}`),
  update: (id, changes) => write(`/closet/${id}`, 'PATCH', changes, `Editar prenda: ${changes.name}`),
  remove: (id) => write(`/closet/${id}`, 'DELETE', undefined, 'Eliminar prenda'),
};

export const communityApi = {
  wall: () => read('/community'),
  create: (post) => write('/community', 'POST', post, `Publicar: ${post.title}`),
  remove: (id) => write(`/community/${id}`, 'DELETE', undefined, 'Eliminar publicación'),
  like: (id) => write(`/community/${id}/like`, 'POST', undefined, 'Reaccionar a una publicación'),
  comment: (id, content, parentId) => write(`/community/${id}/comment`, 'POST', { content, parentId }, `Comentar: ${content.slice(0, 40)}`),
  removeComment: (id, commentId) => write(`/community/${id}/comment/${commentId}`, 'DELETE', undefined, 'Eliminar comentario'),
  report: (id, reason) => write(`/community/${id}/report`, 'POST', { reason }, 'Denunciar una publicación'),
};
