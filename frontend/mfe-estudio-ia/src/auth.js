/**
 * Puente de autenticación con el Shell: el token solo vive en memoria
 * y únicamente se acepta del Shell, verificando origen y ventana.
 */
const SHELL_ORIGIN = import.meta.env.VITE_SHELL_ORIGIN || 'http://localhost:3000';
const TOKEN_WAIT_MS = 5000;

let token = null;
let notifyToken;
const firstToken = new Promise((resolve) => {
  notifyToken = resolve;
});

window.addEventListener('message', (event) => {
  if (event.origin !== SHELL_ORIGIN || event.source !== window.parent) return;
  if (event.data?.type === 'SALON_AUTH' && event.data.token) {
    token = event.data.token;
    notifyToken();
  }
});

if (window.parent !== window) {
  window.parent.postMessage({ type: 'SALON_READY' }, SHELL_ORIGIN);
}

/** fetch con el token de la sesión; un 401 avisa al Shell de que la sesión terminó. */
export async function authFetch(url, options = {}) {
  if (!token) {
    await Promise.race([firstToken, new Promise((resolve) => setTimeout(resolve, TOKEN_WAIT_MS))]);
  }
  if (!token) {
    throw new Error('Abre este módulo desde la plataforma para iniciar sesión.');
  }

  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    window.parent.postMessage({ type: 'SALON_UNAUTHORIZED' }, SHELL_ORIGIN);
  }
  return response;
}
