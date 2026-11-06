import Keycloak from 'keycloak-js';

const ASESORIA_URL = import.meta.env.VITE_ASESORIA_URL || 'http://localhost:3100';

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: 'salon',
  clientId: 'salon-web',
});

let initialization;

/** Inicializa Keycloak una sola vez; redirige al login si no hay sesión (CU-01). */
export function initAuth() {
  initialization ??= keycloak.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    checkLoginIframe: false,
  });
  return initialization;
}

/** Identidad del usuario según el token. */
export function currentUser() {
  const token = keycloak.tokenParsed ?? {};
  const name = token.name ?? token.preferred_username ?? 'Usuario';
  const roles = token.realm_access?.roles ?? [];
  const role = ['ADMIN', 'STYLIST', 'CLIENT'].find((candidate) => roles.includes(candidate)) ?? 'CLIENT';
  const initials = name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return { id: token.salon_id ?? token.sub, name, role, avatar: initials };
}

/** Renueva el token si le quedan menos de 30 segundos de vida. */
export async function freshToken() {
  // Sin conexión no se puede renovar: las peticiones fallarán por la red y pasarán a la cola local
  if (!navigator.onLine) return keycloak.token;
  await keycloak.updateToken(30);
  return keycloak.token;
}

/** Confirma con el backend que esta sesión no fue cerrada ni desplazada. */
export async function isSessionActive() {
  try {
    const response = await fetch(`${ASESORIA_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${await freshToken()}` },
    });
    return response.status !== 401;
  } catch {
    // Un fallo de red no significa que la sesión haya terminado
    return true;
  }
}

/** Revoca la sesión en los servicios y luego la cierra en Keycloak (CU-02). */
export async function logout() {
  try {
    await fetch(`${ASESORIA_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${keycloak.token}` },
    });
  } finally {
    await keycloak.logout({ redirectUri: window.location.origin + '/' });
  }
}

/** Termina en Keycloak una sesión desplazada para poder iniciar una nueva. */
export function restartLogin() {
  return keycloak.logout({ redirectUri: window.location.origin + '/' });
}
