/**
 * Sesión entregada por el Shell al montar este microfrontend. El token solo vive en memoria,
 * y cada petición pide uno vigente en lugar de guardarlo.
 */
let platform = null;

/** La petición no llegó al servidor: no hay conexión o el servicio no responde. */
export class OfflineError extends Error {
  constructor(message = 'Sin conexión. Inténtalo cuando vuelvas a estar en línea.') {
    super(message);
    this.offline = true;
  }
}

/** Cola local y copia de lecturas del Shell; puede no existir si el navegador no tiene almacenamiento. */
export function offlineStore() {
  return platform?.offline ?? null;
}

export function setPlatform(context) {
  platform = context;
}

/** Parámetros de navegación que envió el Shell. */
export function navigationParams() {
  return platform?.params ?? {};
}

async function currentToken() {
  if (!platform) throw new Error('Abre este módulo desde la plataforma para iniciar sesión.');
  return platform.getToken();
}

/** fetch con el token de la sesión; un 401 avisa al Shell de que la sesión terminó. */
export async function authFetch(url, options = {}) {
  const token = await currentToken();
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new OfflineError();
  }
  if (response.status === 401) platform.onSessionLost();
  return response;
}

/** Devuelve quién es el usuario. Solo sirve para decidir qué mostrar: quien autoriza es cada servicio. */
export async function currentUser() {
  const payload = (await currentToken()).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))));
  const roles = claims.realm_access?.roles ?? [];
  return {
    id: claims.salon_id ?? claims.sub,
    name: claims.name ?? claims.preferred_username,
    isStaff: roles.includes('ADMIN') || roles.includes('STYLIST'),
  };
}
