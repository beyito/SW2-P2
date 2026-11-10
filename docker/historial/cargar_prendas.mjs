// Agrega al clóset de una clienta las prendas de demostración de prendas/prendas.json (Fase Y).
// Entra al portal como esa clienta (Keycloak con PKCE, como una persona), toma su token y usa la API
// real de ms-asesoria: POST /media para la foto (GridFS en local, S3 en la nube) y POST /closet.
// Es idempotente: omite las prendas cuyo nombre ya está en su clóset. Con --borrar quita las de demostración.
//
//   CLAVE=... node docker/historial/cargar_prendas.mjs <portal> <asesoria> <usuario> [--borrar]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(aqui, '../../tests/e2e/package.json'));
const { chromium } = require('playwright');

const [portal, asesoria, usuario, opcion] = process.argv.slice(2);
const clave = process.env.CLAVE;
if (!portal || !asesoria || !usuario || !clave) {
  console.error('Uso: CLAVE=... node cargar_prendas.mjs <portal> <asesoria> <usuario> [--borrar]');
  process.exit(2);
}

// 1. Inicio de sesión real y captura del token que el Shell entrega a los microfrontends
const navegador = await chromium.launch();
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
await navegador.close();
if (!token) throw new Error('No se obtuvo el token de la sesión');

const datos = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const clienteId = datos.salon_id;
if (!clienteId) throw new Error('El token no trae salon_id: ¿es una cuenta de cliente?');

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`${asesoria}${ruta}`, { ...opciones, headers: { Authorization: token, ...opciones.headers } });
  if (!respuesta.ok) throw new Error(`${opciones.method ?? 'GET'} ${ruta}: ${respuesta.status} ${await respuesta.text()}`);
  return respuesta.json();
}

const actuales = await api(`/closet/client/${clienteId}`);
const prendas = JSON.parse(readFileSync(join(aqui, 'prendas', 'prendas.json'), 'utf8'));

if (opcion === '--borrar') {
  // Solo las prendas de demostración: llevan la etiqueta "demo" y un nombre de la lista
  const nombres = new Set(prendas.map((p) => p.name));
  const borrar = actuales.filter((p) => p.tags?.includes('demo') && nombres.has(p.name));
  for (const p of borrar) await api(`/closet/${p.id}`, { method: 'DELETE' });
  console.log(`${clienteId}: ${borrar.length} prendas de demostración borradas`);
  process.exit(0);
}

// 2. Una prenda por vez: primero la foto, después la prenda con su dirección
const existentes = new Set(actuales.map((p) => p.name));
let agregadas = 0;
for (const prenda of prendas) {
  if (existentes.has(prenda.name)) continue;
  const formulario = new FormData();
  formulario.append('file', new Blob([readFileSync(join(aqui, 'prendas', prenda.archivo))], { type: 'image/jpeg' }), prenda.archivo);
  const foto = await api('/media', { method: 'POST', body: formulario });
  const { archivo, ...campos } = prenda;
  await api('/closet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...campos, imageUrl: foto.url }),
  });
  agregadas++;
}
const total = (await api(`/closet/client/${clienteId}`)).length;
console.log(`${clienteId}: ${agregadas} prendas agregadas, ${prendas.length - agregadas} ya estaban; ahora tiene ${total}`);
