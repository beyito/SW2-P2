// Publica en el muro de la comunidad las publicaciones de demostración de comunidad/publicaciones.json
// (Fase Y), con sus comentarios, respuestas y reacciones. Usa la API real de ms-asesoria con la sesión
// de cada cuenta, así que el autor de cada publicación y comentario sale de su token, como en la app.
// Es idempotente: omite las publicaciones cuyo título ya está en el muro. Con --borrar, cada autor
// borra las suyas (y con ellas su foto en GridFS o S3).
//
//   CLAVE_VALENTINA=... CLAVE_CAMILA=... CLAVE_ALEJANDRO=... node docker/historial/cargar_comunidad.mjs <portal> <asesoria> [--borrar]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clienteApi, iniciarSesion, subirFoto } from './sesion.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const [portal, asesoria, opcion] = process.argv.slice(2);
const CUENTAS = {
  valentina: ['valentina.rossi', process.env.CLAVE_VALENTINA],
  camila: ['camila.fernandez', process.env.CLAVE_CAMILA],
  alejandro: ['alejandro.morales', process.env.CLAVE_ALEJANDRO],
};
if (!portal || !asesoria || Object.values(CUENTAS).some(([, clave]) => !clave)) {
  console.error('Uso: CLAVE_VALENTINA=... CLAVE_CAMILA=... CLAVE_ALEJANDRO=... node cargar_comunidad.mjs <portal> <asesoria> [--borrar]');
  process.exit(2);
}

// Los tokens duran 5 minutos: se piden todos al inicio y la carga entera tarda menos que eso
const api = {};
for (const [alias, [usuario, clave]] of Object.entries(CUENTAS)) {
  api[alias] = clienteApi(asesoria, await iniciarSesion(portal, usuario, clave));
}

const publicaciones = JSON.parse(readFileSync(join(aqui, 'comunidad', 'publicaciones.json'), 'utf8'));
const titulos = new Set(publicaciones.map((p) => p.title));
const muro = await api.valentina('/community');

if (opcion === '--borrar') {
  let borradas = 0;
  for (const post of muro.filter((p) => titulos.has(p.title))) {
    const autor = publicaciones.find((p) => p.title === post.title).autor;
    await api[autor](`/community/${post.id}`, { method: 'DELETE' });
    borradas++;
  }
  console.log(`${borradas} publicaciones de demostración borradas`);
  process.exit(0);
}

const existentes = new Set(muro.map((p) => p.title));
let creadas = 0;
for (const publicacion of publicaciones) {
  if (existentes.has(publicacion.title)) continue;
  const del = api[publicacion.autor];
  const imageUrl = await subirFoto(del, publicacion.archivo, readFileSync(join(aqui, 'comunidad', publicacion.archivo)));
  const post = await del('/community', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: publicacion.title, description: publicacion.description, imageUrl }),
  });
  // Comentarios en orden: una respuesta apunta al comentario ya creado de la misma publicación
  const creados = [];
  for (const comentario of publicacion.comentarios) {
    const parentId = comentario.respondeA === null ? undefined : creados[comentario.respondeA];
    const nuevo = await api[comentario.autor](`/community/${post.id}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: comentario.content, parentId }),
    });
    creados.push(nuevo.id);
  }
  for (const alias of publicacion.reacciones) await api[alias](`/community/${post.id}/like`, { method: 'POST' });
  creadas++;
}
const total = (await api.valentina('/community')).length;
console.log(`${creadas} publicaciones creadas, ${publicaciones.length - creadas} ya estaban; el muro tiene ${total}`);
