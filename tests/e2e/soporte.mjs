// Utilidades compartidas de las pruebas en navegador real.
import { execFileSync } from 'node:child_process';

/** Da por respondido el cuestionario inicial de los clientes de prueba, para llegar directo a los microfrontends. */
export function saltarCuestionarioInicial() {
  sql('salon_crm', "UPDATE crm_clients SET onboarded_at = COALESCE(onboarded_at, NOW()) WHERE id LIKE 'cli-00%'");
}

/**
 * Deja a cli-001 sin preferencias, para que la prueba no dependa de lo que respondió el usuario en el cuestionario.
 * Devuelve la función que restaura sus respuestas.
 */
export function perfilDePruebaVacio() {
  const columnas = 'gender, age_range, preferred_length, maintenance, style_vibe';
  const original = sql('salon_crm', `SELECT quote_nullable(gender)||','||quote_nullable(age_range)||','||quote_nullable(preferred_length)||','||quote_nullable(maintenance)||','||quote_nullable(style_vibe) FROM crm_clients WHERE id='cli-001'`);
  sql('salon_crm', `UPDATE crm_clients SET (${columnas}) = (NULL, NULL, NULL, NULL, NULL) WHERE id='cli-001'`);
  return () => sql('salon_crm', `UPDATE crm_clients SET (${columnas}) = (${original}) WHERE id='cli-001'`);
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
  // Devuelve al stock lo que consumieron esas citas: borrar sus movimientos no lo restituye
  sql('salon_gestion', `UPDATE inventory_items i SET current_stock = current_stock - m.total FROM (
    SELECT item_id, SUM(quantity_change) AS total FROM inventory_logs
    WHERE appointment_id IN (SELECT id FROM appointments WHERE appointment_date >= '${desde}') GROUP BY item_id
  ) m WHERE i.id = m.item_id`);
  sql('salon_gestion', `DELETE FROM inventory_logs WHERE appointment_id IN (SELECT id FROM appointments WHERE appointment_date >= '${desde}')`);
  sql('salon_gestion', `DELETE FROM appointments WHERE appointment_date >= '${desde}'`);
}
