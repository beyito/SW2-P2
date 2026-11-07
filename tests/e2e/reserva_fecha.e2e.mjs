// Prueba en navegador real: una respuesta tardía de otra fecha no debe mostrar turnos de un día distinto del elegido.
// Si los mostrara, el cliente pagaría por otro día. No crea ninguna reserva.
import { chromium } from 'playwright';
import { iniciarSesion, saltarCuestionarioInicial } from './soporte.mjs';

saltarCuestionarioInicial();

const SHELL = 'http://localhost:3000/';
const CAMILA = ['camila.fernandez', 'Cliente#2026'];
const ELEGIDA = '2042-03-11';
const TURNO_ELEGIDO = { start: `${ELEGIDA}T11:00:00`, end: `${ELEGIDA}T11:45:00` };
const TURNO_VIEJO = { start: '2030-01-01T09:17:00', end: '2030-01-01T10:02:00' };

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

const browser = await chromium.launch();
try {
  const contexto = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const pagina = await iniciarSesion(contexto, SHELL, CAMILA);
  // La consulta de la fecha inicial tarda más que la de la fecha elegida
  let liberarVieja;
  const vieja = new Promise((resolve) => { liberarVieja = resolve; });
  await contexto.route('**/graphql', async (ruta) => {
    const cuerpo = ruta.request().postData() ?? '';
    if (!cuerpo.includes('getAvailableSlots')) return ruta.fallback();
    const responder = (turno) => ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { getAvailableSlots: [turno] } }),
    });
    if (cuerpo.includes(ELEGIDA)) return responder(TURNO_ELEGIDO);
    await vieja;
    return responder(TURNO_VIEJO);
  });

  await pagina.click('#tab-mfe-reservas');
  const mfe = pagina.locator('#mfe-root');
  await mfe.locator('[data-service="srv-03"]').click({ timeout: 30000 });
  await mfe.locator('.stylist-card').first().click();
  await mfe.locator('#btn-to-schedule').click();
  await mfe.locator('#booking-date').fill(ELEGIDA);
  await mfe.locator('#booking-date').dispatchEvent('change');
  await mfe.locator('.slot-btn').first().waitFor({ timeout: 15000 });
  check('muestra el turno de la fecha elegida', (await mfe.locator('.slot-btn').first().textContent()).includes('11:00'));

  // Llega por fin la respuesta de la fecha anterior
  liberarVieja();
  await pagina.waitForTimeout(1000);
  const turnos = await mfe.locator('.slot-btn').allTextContents();
  check('la respuesta tardía no reemplaza los turnos', turnos.length === 1 && turnos[0].includes('11:00'), turnos.join(' | '));
  check('la fecha mostrada sigue siendo la elegida', (await mfe.locator('#booking-date').inputValue()) === ELEGIDA);
  await contexto.close();
} catch (error) {
  check('la prueba terminó sin errores', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
}

console.log(fallos === 0 ? 'E2E FECHA DE RESERVA: TODO OK' : `E2E FECHA DE RESERVA: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
