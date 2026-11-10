// Inicio de sesión real para los cargadores de demostración (Fase Y): entra al portal con Keycloak
// (PKCE, como una persona) y devuelve el token que el Shell entrega a los microfrontends.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(aqui, '../../tests/e2e/package.json'));
const { chromium } = require('playwright');

export async function iniciarSesion(portal, usuario, clave) {
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    let token = null;
    pagina.on('request', (r) => {
      const valor = r.headers().authorization;
      if (!token && valor?.startsWith('Bearer ') && !r.url().includes('/realms/')) token = valor;
    });
    await pagina.goto(portal, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('#username', { timeout: 60000 });
    await pagina.fill('#username', usuario);
    await pagina.fill('#password', clave);
    await pagina.click('#kc-login');
    await pagina.waitForURL((u) => u.toString().startsWith(portal), { timeout: 60000 });
    for (let i = 0; i < 60 && !token; i++) await pagina.waitForTimeout(500);
    if (!token) throw new Error(`No se obtuvo el token de ${usuario}`);
    return token;
  } finally {
    await navegador.close();
  }
}

/** Cliente de la API de ms-asesoria con el token de una persona; falla con el mensaje del servicio. */
export function clienteApi(base, token) {
  return async function api(ruta, opciones = {}) {
    const respuesta = await fetch(`${base}${ruta}`, { ...opciones, headers: { Authorization: token, ...opciones.headers } });
    if (!respuesta.ok) throw new Error(`${opciones.method ?? 'GET'} ${ruta}: ${respuesta.status} ${await respuesta.text()}`);
    return respuesta.json();
  };
}

/** Sube una foto JPEG por POST /media y devuelve su dirección. */
export async function subirFoto(api, nombre, datos) {
  const formulario = new FormData();
  formulario.append('file', new Blob([datos], { type: 'image/jpeg' }), nombre);
  return (await api('/media', { method: 'POST', body: formulario })).url;
}
