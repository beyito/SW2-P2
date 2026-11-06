// Prueba en navegador real del modo offline web (RF-10, CU-22) y del aislamiento de Module Federation.
// Corta la conexión de verdad en el navegador. Usa fechas de 2042 y borra lo que crea al terminar.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { fotoDePuntos, iniciarSesion, limpiarCitasDePrueba, saltarCuestionarioInicial, sql } from './soporte.mjs';

const SHELL = 'http://localhost:3000/';
const ALEJANDRO = ['alejandro.morales', 'Cliente#2026'];
const CLIENTE_ID = 'cli-002';
const PREFIJO = '[e2e-h]';
const UNICO = Date.now().toString(36);
const ESPERA = { timeout: 30000 };
const FECHA = '2042-03-03';
const HORA = '10:00';

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

function mongo(script) {
  return execFileSync(
    'docker',
    ['exec', 'salon-mongodb', 'mongosh', '--quiet', '-u', 'mongo_admin', '-p', 'mongo_secret_pass', '--authenticationDatabase', 'admin', 'salon_asesoria', '--eval', script],
    { encoding: 'utf8' },
  ).trim();
}

const prendas = (nombre) => Number(mongo(`db.virtual_closet_items.countDocuments({ name: '${nombre}' })`));
const citas = () => Number(sql('salon_gestion', `SELECT count(*) FROM appointments WHERE appointment_date >= '2042-01-01' AND status <> 'CANCELLED' AND client_id='${CLIENTE_ID}'`));
const esperarHasta = async (condicion, limite = 40000) => {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await condicion()) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
};

function limpiarMongo() {
  mongo(`db.virtual_closet_items.deleteMany({ name: { $gte: '${PREFIJO}', $lt: '${PREFIJO}~' } })`);
  mongo(`db.community_posts.updateMany({}, { $pull: { comments: { content: { $gte: '${PREFIJO}', $lt: '${PREFIJO}~' } } } })`);
}

async function agregarPrenda(mfe, nombre) {
  await mfe.locator('#closet-name').fill(nombre);
  await mfe.locator('#closet-color').fill('Negro');
  await mfe.locator('#closet-save').click();
}

saltarCuestionarioInicial();
limpiarMongo();
const puntos = fotoDePuntos();
const browser = await chromium.launch();

try {
  const contexto = await browser.newContext({ viewport: { width: 1400, height: 1300 } });
  const pagina = await iniciarSesion(contexto, SHELL, ALEJANDRO);
  const mfe = pagina.locator('#mfe-root');

  // Con conexión se visitan las pantallas, para que quede la copia local
  await mfe.locator('#tab-closet').click(ESPERA);
  await mfe.locator('#closet-name').waitFor(ESPERA);
  await pagina.waitForTimeout(800);
  await mfe.locator('#tab-community').click();
  await mfe.locator('.comment-input').first().waitFor(ESPERA);
  const publicaciones = await mfe.locator('.comment-input').count();
  await pagina.click('#tab-mfe-reservas');
  await mfe.locator('#btn-to-schedule').waitFor(ESPERA);
  await pagina.click('#tab-mfe-estudio-ia');
  await mfe.locator('#tab-closet').click(ESPERA);
  await mfe.locator('#closet-name').waitFor(ESPERA);

  // --- Sin conexión
  await contexto.setOffline(true);
  await pagina.locator('#offline-state').waitFor(ESPERA);
  check('el Shell avisa que no hay conexión', true);

  const prenda = `${PREFIJO} Blazer ${UNICO}`;
  await agregarPrenda(mfe, prenda);
  await pagina.locator('#offline-pending[data-count="1"]').waitFor(ESPERA);
  check('una prenda sin conexión queda en la cola', prendas(prenda) === 0);

  await mfe.locator('#tab-community').click();
  await mfe.locator('.comment-input').first().waitFor(ESPERA);
  check('el muro se puede consultar sin conexión', (await mfe.locator('.comment-input').count()) === publicaciones);
  const comentario = `${PREFIJO} Comentario ${UNICO}`;
  await mfe.locator('.comment-input').first().fill(comentario);
  await mfe.locator('.btn-send-comment').first().click();
  await pagina.locator('#offline-pending[data-count="2"]').waitFor(ESPERA);
  check('un comentario sin conexión queda en la cola', true);

  await mfe.locator('#tab-biometrics').click();
  await pagina.click('#tab-mfe-reservas');
  await mfe.locator('#btn-to-schedule').waitFor(ESPERA);
  check('cambiar de módulo funciona sin conexión', true);
  check('el catálogo se muestra sin conexión', (await mfe.locator('.service-card').count()) > 0 || (await mfe.locator('.selected').count()) > 0);

  await mfe.locator('#btn-to-schedule').click();
  await mfe.locator('#booking-date').fill(FECHA);
  await mfe.locator('#offline-time').waitFor(ESPERA);
  await mfe.locator('#offline-time').fill(HORA);
  await mfe.locator('#btn-save-offline').click();
  await mfe.locator('#offline-saved').waitFor(ESPERA);
  await pagina.locator('#offline-pending[data-count="3"]').waitFor(ESPERA);
  check('una reserva sin conexión queda en la cola', citas() === 0);

  // --- Vuelve la conexión: el envío es automático
  await contexto.setOffline(false);
  check('al volver la conexión la prenda llega una sola vez', await esperarHasta(() => prendas(prenda) === 1));
  check('al volver la conexión el comentario llega', await esperarHasta(() => Number(mongo(`db.community_posts.countDocuments({ 'comments.content': '${comentario}' })`)) === 1));
  check('al volver la conexión la reserva llega', await esperarHasta(() => citas() === 1));
  await pagina.locator('.offline-item[data-status="DONE"]').waitFor(ESPERA);
  check('la reserva enviada pide completar el pago', await pagina.locator('.offline-pay').isVisible());
  check('la cola queda vacía', (await pagina.locator('#offline-pending').count()) === 0);

  // Pago real con Stripe de la reserva hecha sin conexión
  await pagina.locator('.offline-pay').click();
  await mfe.locator('#btn-pay:enabled').waitFor({ timeout: 40000 });
  const stripe = mfe.frameLocator('#payment-element iframe').first();
  await stripe.locator('input[name="cardnumber"]').fill('4242 4242 4242 4242', { timeout: 30000 });
  await stripe.locator('input[name="exp-date"]').fill('12 / 34');
  await stripe.locator('input[name="cvc"]').fill('123');
  await mfe.locator('#btn-pay').click();
  const pagada = await esperarHasta(() => sql('salon_gestion', `SELECT status FROM appointments WHERE appointment_date >= '2042-01-01' AND client_id='${CLIENTE_ID}' AND status <> 'CANCELLED'`) === 'CONFIRMED', 60000);
  check('la reserva hecha sin conexión se paga y queda confirmada', pagada);
  check('el aviso de pago desaparece', (await pagina.locator('.offline-item[data-status="DONE"]').count()) === 0);

  // --- Conflicto: otra persona ya tiene ese turno
  await pagina.click('#tab-mfe-estudio-ia');
  await mfe.locator('#tab-biometrics').waitFor(ESPERA);
  await pagina.click('#tab-mfe-reservas');
  await mfe.locator('#btn-to-schedule').waitFor(ESPERA);
  await contexto.setOffline(true);
  await mfe.locator('#btn-to-schedule').click();
  await mfe.locator('#booking-date').fill(FECHA);
  await mfe.locator('#offline-time').fill(HORA);
  await mfe.locator('#btn-save-offline').click();
  await mfe.locator('#offline-saved').waitFor(ESPERA);
  await contexto.setOffline(false);
  // La SAGA valida el turno después de aceptar la solicitud: el resultado se ve al continuar
  await pagina.locator('.offline-pay').click(ESPERA);
  await mfe.locator('#booking-failure').waitFor({ timeout: 60000 });
  check('un turno ya ocupado se informa como rechazado', (await mfe.locator('#booking-failure').textContent()).trim().length > 0, (await mfe.locator('#booking-failure').textContent()).trim().slice(0, 90));
  check('una reserva repetida no crea otra cita', citas() === 1);

  // --- La cola sobrevive a cerrar la plataforma
  await pagina.click('#tab-mfe-estudio-ia');
  await mfe.locator('#tab-closet').click(ESPERA);
  await mfe.locator('#closet-name').waitFor(ESPERA);
  await contexto.setOffline(true);
  const persistente = `${PREFIJO} Bufanda ${UNICO}`;
  await agregarPrenda(mfe, persistente);
  await pagina.locator('#offline-pending').waitFor(ESPERA);
  await pagina.close();
  await contexto.setOffline(false);
  const nueva = await contexto.newPage();
  await nueva.goto(SHELL);
  check('al volver a abrir la plataforma se envía lo pendiente', await esperarHasta(() => prendas(persistente) === 1));

  // --- Respuesta perdida: el servidor guardó, pero el navegador no se enteró
  const nuevaMfe = nueva.locator('#mfe-root');
  await nuevaMfe.locator('#tab-closet').click(ESPERA);
  await nuevaMfe.locator('#closet-name').waitFor(ESPERA);
  const perdida = `${PREFIJO} Perdida ${UNICO}`;
  let cortadas = 0;
  await nueva.route('http://localhost:3100/closet', async (route) => {
    if (route.request().method() === 'POST' && cortadas === 0) {
      cortadas += 1;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await agregarPrenda(nuevaMfe, perdida);
  check('si se pierde la respuesta, el servidor ya la guardó', await esperarHasta(() => prendas(perdida) === 1, 8000));
  await nueva.locator('#offline-pending').waitFor(ESPERA);
  check('la operación queda en la cola para reintentar', true);
  const vacia = await esperarHasta(async () => (await nueva.locator('#offline-pending').count()) === 0, 45000);
  check('el reintento termina', vacia);
  check('el reintento no duplica gracias a la llave de idempotencia', prendas(perdida) === 1, `(${prendas(perdida)} prenda)`);
  await contexto.close();

  // --- Module Federation: un módulo caído no tumba al resto
  const aislado = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await aislado.route('http://localhost:3002/**', (route) => route.abort());
  const conFallo = await iniciarSesion(aislado, SHELL, ALEJANDRO);
  await conFallo.locator('#mfe-root #tab-closet').waitFor(ESPERA);
  check('con Reservas caído, el Estudio funciona', true);
  await conFallo.click('#tab-mfe-reservas');
  await conFallo.locator('#mfe-error').waitFor(ESPERA);
  check('la pestaña de Reservas informa el fallo', true);
  await conFallo.click('#tab-mfe-estudio-ia');
  await conFallo.locator('#mfe-root #tab-closet').waitFor(ESPERA);
  check('se puede volver a un módulo que funciona', (await conFallo.locator('#mfe-error').count()) === 0);
  await aislado.close();
} catch (error) {
  check('la prueba terminó sin errores', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
  limpiarMongo();
  await limpiarCitasDePrueba('2042-01-01', puntos);
}

console.log(fallos === 0 ? 'E2E OFFLINE: TODO OK' : `E2E OFFLINE: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
