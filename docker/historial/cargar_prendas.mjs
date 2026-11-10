// Agrega al clóset de una persona las prendas de demostración de prendas/prendas.json (Fase Y);
// con LISTA=prendas-hombre.json, las de hombre.
// Entra al portal como esa persona (Keycloak con PKCE), toma su token y usa la API real de ms-asesoria:
// POST /media para la foto (GridFS en local, S3 en la nube) y POST /closet.
// Es idempotente: omite las prendas cuyo nombre ya está en su clóset. Con --borrar quita las de demostración.
//
//   CLAVE=... node docker/historial/cargar_prendas.mjs <portal> <asesoria> <usuario> [--borrar]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clienteApi, iniciarSesion, subirFoto } from './sesion.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const [portal, asesoria, usuario, opcion] = process.argv.slice(2);
const clave = process.env.CLAVE;
if (!portal || !asesoria || !usuario || !clave) {
  console.error('Uso: CLAVE=... node cargar_prendas.mjs <portal> <asesoria> <usuario> [--borrar]');
  process.exit(2);
}

const token = await iniciarSesion(portal, usuario, clave);
const clienteId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).salon_id;
if (!clienteId) throw new Error('El token no trae salon_id: ¿es una cuenta de cliente?');
const api = clienteApi(asesoria, token);

const actuales = await api(`/closet/client/${clienteId}`);
const prendas = JSON.parse(readFileSync(join(aqui, 'prendas', process.env.LISTA || 'prendas.json'), 'utf8'));

if (opcion === '--borrar') {
  // Solo las prendas de demostración: llevan la etiqueta "demo" y un nombre de la lista
  const nombres = new Set(prendas.map((p) => p.name));
  const borrar = actuales.filter((p) => p.tags?.includes('demo') && nombres.has(p.name));
  for (const p of borrar) await api(`/closet/${p.id}`, { method: 'DELETE' });
  console.log(`${clienteId}: ${borrar.length} prendas de demostración borradas`);
  process.exit(0);
}

// Una prenda por vez: primero la foto, después la prenda con su dirección
const existentes = new Set(actuales.map((p) => p.name));
let agregadas = 0;
for (const prenda of prendas) {
  if (existentes.has(prenda.name)) continue;
  const { archivo, ...campos } = prenda;
  const imageUrl = await subirFoto(api, archivo, readFileSync(join(aqui, 'prendas', archivo)));
  await api('/closet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...campos, imageUrl }) });
  agregadas++;
}
const total = (await api(`/closet/client/${clienteId}`)).length;
console.log(`${clienteId}: ${agregadas} prendas agregadas, ${prendas.length - agregadas} ya estaban; ahora tiene ${total}`);
