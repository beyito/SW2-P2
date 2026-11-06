// Utilidades compartidas de las pruebas en navegador real.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ERP_DIST = join(dirname(fileURLToPath(import.meta.url)), '../../frontend/mfe-gestion/dist/browser');
const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };

let servidorErp;

/** Servidor local del ERP compilado, en un puerto libre; no retiene el cierre de la prueba. */
function iniciarServidorErp() {
  servidorErp ??= new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      const file = join(ERP_DIST, path === '/' ? 'index.html' : path);
      if (!existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
  return servidorErp;
}

/**
 * Con ERP_DESDE_DIST=1, el navegador recibe el ERP compilado (ng build) al pedir localhost:3003.
 * Sirve cuando ese puerto está ocupado por otro proceso: el origen y los servicios siguen siendo los reales.
 */
export async function usarErpCompilado(context) {
  if (process.env.ERP_DESDE_DIST !== '1') return;
  if (!existsSync(join(ERP_DIST, 'index.html'))) throw new Error('Ejecute primero: npm run build en frontend/mfe-gestion');
  const base = await iniciarServidorErp();
  await context.route('http://localhost:3003/**', (route) => {
    const { pathname } = new URL(route.request().url());
    return route.continue({ url: `${base}${pathname}` });
  });
}

/** Consulta PostgreSQL dentro de su contenedor; solo para preparar y comprobar datos de prueba. */
export function sql(database, query) {
  return execFileSync(
    'docker',
    ['exec', 'salon-postgres', 'psql', '-U', 'salon_admin', '-d', database, '-Atc', query],
    { encoding: 'utf8' },
  ).trim();
}

export async function iniciarSesion(context, shell, [usuario, clave]) {
  const page = await context.newPage();
  await page.goto(shell);
  await page.waitForURL(/localhost:8080/, { timeout: 15000 });
  await page.fill('#username', usuario);
  await page.fill('#password', clave);
  await page.click('#kc-login');
  await page.waitForSelector('#current-user', { timeout: 20000 });
  return page;
}

/** Borra de MongoDB las publicaciones de prueba: las identifica su prefijo en el título. */
export function borrarPublicacionesDePrueba(prefijo) {
  // Un rango de texto, porque las barras de una expresión regular no sobreviven a los argumentos en Windows
  const eliminadas = execFileSync(
    'docker',
    [
      'exec', 'salon-mongodb', 'mongosh', '--quiet', '-u', 'mongo_admin', '-p', 'mongo_secret_pass', '--authenticationDatabase', 'admin',
      'salon_asesoria', '--eval', `db.community_posts.deleteMany({ title: { $gte: '${prefijo}', $lt: '${prefijo}~' } }).deletedCount`,
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number(eliminadas);
}

/** Saldo actual de los clientes de prueba, para restaurarlo al terminar. */
export function fotoDePuntos() {
  return sql('salon_crm', "SELECT id || '=' || loyalty_points FROM crm_clients WHERE id LIKE 'cli-00%'");
}

/** Borra las citas con fecha desde la indicada, todo lo que generaron en el CRM, y restaura los saldos. */
export async function limpiarCitasDePrueba(desde, foto) {
  // El worker procesa los eventos en segundo plano: se le da tiempo para no limpiar antes de que lleguen
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const sagas = sql('salon_gestion', `SELECT saga_id FROM appointments WHERE appointment_date >= '${desde}' AND saga_id IS NOT NULL`)
    .split('\n').filter(Boolean);
  for (const saga of sagas) {
    sql('salon_crm', `DELETE FROM credit_notes WHERE invoice_id IN (SELECT id FROM invoices WHERE saga_id='${saga}')`);
    sql('salon_crm', `DELETE FROM invoices WHERE saga_id='${saga}'`);
    sql('salon_crm', `DELETE FROM loyalty_transactions WHERE source_ref LIKE 'saga:${saga}:%'`);
    sql('salon_crm', `DELETE FROM notices WHERE source_ref LIKE 'saga:${saga}:%'`);
  }
  for (const linea of foto.split('\n')) {
    const [id, puntos] = linea.split('=');
    sql('salon_crm', `UPDATE crm_clients SET loyalty_points=${puntos} WHERE id='${id}'`);
  }
  sql('salon_gestion', `DELETE FROM inventory_logs WHERE appointment_id IN (SELECT id FROM appointments WHERE appointment_date >= '${desde}')`);
  sql('salon_gestion', `DELETE FROM appointments WHERE appointment_date >= '${desde}'`);
}
