// Prueba en navegador real del checkout: reserva y pago con Stripe en modo prueba (CU-06, CU-10).
// Requiere el backend en Docker Compose y los microfrontends shell y reservas en ejecución.
import { chromium } from 'playwright';
import { fotoDePuntos, limpiarCitasDePrueba, saltarCuestionarioInicial } from './soporte.mjs';

saltarCuestionarioInicial();

const SHELL = 'http://localhost:3000/';
const CLIENT = ['camila.fernandez', 'Cliente#2026'];
let fallos = 0;

function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

// Un sábado lejano distinto en cada ejecución, para que el turno esté libre
function futureDate(offsetWeeks) {
  const date = new Date(Date.UTC(2040, 0, 7));
  date.setUTCDate(date.getUTCDate() + 7 * (Math.floor(Math.random() * 300) + offsetWeeks));
  return date.toISOString().slice(0, 10);
}

async function reserveUntilPayment(mfe, serviceId, date) {
  await mfe.locator(`[data-service="${serviceId}"]`).click();
  await mfe.locator('#btn-to-schedule').click();
  await mfe.locator('#booking-date').fill(date);
  await mfe.locator('#booking-date').dispatchEvent('change');
  await mfe.locator('.slot-btn').first().waitFor({ timeout: 15000 });
  const slot = (await mfe.locator('.slot-btn').first().textContent()).trim();
  await mfe.locator('.slot-btn').first().click();
  await mfe.locator('#btn-to-checkout').click();
  await mfe.locator('#btn-pay').waitFor({ timeout: 30000 });
  return slot;
}

async function fillCard(mfe, card) {
  // El botón se habilita cuando el campo de tarjeta de Stripe terminó de cargar
  await mfe.locator('#btn-pay:enabled').waitFor({ timeout: 30000 });
  const stripe = mfe.frameLocator('#payment-element iframe').first();
  await stripe.locator('input[name="cardnumber"]').fill(card, { timeout: 30000 });
  await stripe.locator('input[name="exp-date"]').fill('12 / 34');
  await stripe.locator('input[name="cvc"]').fill('123');
}

const puntosIniciales = fotoDePuntos();
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

await page.goto(SHELL);
await page.waitForURL(/localhost:8080/, { timeout: 15000 });
await page.fill('#username', CLIENT[0]);
await page.fill('#password', CLIENT[1]);
await page.click('#kc-login');
await page.waitForSelector('#current-user', { timeout: 20000 });
await page.click('#tab-mfe-reservas');

const mfe = page.locator('#mfe-root');

// --- Pago aprobado
await mfe.locator('[data-service="srv-03"]').waitFor({ timeout: 15000 });
check('el catálogo viene del backend', (await mfe.locator('.service-card').count()) >= 3);

const date = futureDate(0);
const slot = await reserveUntilPayment(mfe, 'srv-03', date);
check('se bloqueó un turno y aparece el formulario de pago', true, slot);
await fillCard(mfe, '4242424242424242');
await mfe.locator('#btn-pay').click();
await mfe.locator('#booking-success').waitFor({ timeout: 60000 });
check('tarjeta aprobada: reserva confirmada', true);

// El turno pagado ya no se ofrece
await mfe.locator('#btn-new-booking').click();
await mfe.locator('[data-service="srv-03"]').click();
await mfe.locator('#btn-to-schedule').click();
await mfe.locator('#booking-date').fill(date);
await mfe.locator('#booking-date').dispatchEvent('change');
await mfe.locator('.slot-btn').first().waitFor({ timeout: 15000 });
const offered = await mfe.locator('.slot-btn').allTextContents();
check('el turno pagado desaparece de la disponibilidad', !offered.map((text) => text.trim()).includes(slot));

// --- Pago rechazado: el turno vuelve a estar disponible
const declinedSlot = (await mfe.locator('.slot-btn').first().textContent()).trim();
await mfe.locator('.slot-btn').first().click();
await mfe.locator('#btn-to-checkout').click();
await mfe.locator('#btn-pay').waitFor({ timeout: 30000 });
await fillCard(mfe, '4000000000000002');
await mfe.locator('#btn-pay').click();
await mfe.locator('#booking-failure').waitFor({ timeout: 60000 });
check('tarjeta rechazada: reserva revertida', (await mfe.locator('#booking-failure').textContent()).includes('rechazó'));

await mfe.locator('#btn-new-booking').click();
await mfe.locator('[data-service="srv-03"]').click();
await mfe.locator('#btn-to-schedule').click();
await mfe.locator('#booking-date').fill(date);
await mfe.locator('#booking-date').dispatchEvent('change');
await mfe.locator('.slot-btn').first().waitFor({ timeout: 15000 });
const afterDecline = await mfe.locator('.slot-btn').allTextContents();
check('el turno rechazado vuelve a estar disponible', afterDecline.map((text) => text.trim()).includes(declinedSlot));

// --- Cancelar una cita pagada: reembolso y turno disponible otra vez
const refundSlot = (await mfe.locator('.slot-btn').first().textContent()).trim();
await mfe.locator('.slot-btn').first().click();
await mfe.locator('#btn-to-checkout').click();
await mfe.locator('#btn-pay').waitFor({ timeout: 30000 });
await fillCard(mfe, '4242424242424242');
await mfe.locator('#btn-pay').click();
await mfe.locator('#booking-success').waitFor({ timeout: 60000 });
await mfe.locator('#btn-cancel-booking').click();
await mfe.locator('#booking-refunded').waitFor({ timeout: 60000 });
check('cancelar una cita pagada la reembolsa', true);

await mfe.locator('#btn-new-booking').click();
await mfe.locator('[data-service="srv-03"]').click();
await mfe.locator('#btn-to-schedule').click();
await mfe.locator('#booking-date').fill(date);
await mfe.locator('#booking-date').dispatchEvent('change');
await mfe.locator('.slot-btn').first().waitFor({ timeout: 15000 });
const afterRefund = await mfe.locator('.slot-btn').allTextContents();
check('el turno reembolsado vuelve a estar disponible', afterRefund.map((text) => text.trim()).includes(refundSlot));

// --- Canje: los puntos ganados bajan el total a pagar
await mfe.locator('#points-to-redeem').waitFor({ timeout: 15000 });
await mfe.locator('#points-to-redeem').fill('100');
check('el canje de 100 puntos descuenta $1.00', (await mfe.locator('#total-to-pay').textContent()).includes('$44.00'));

await browser.close();
// Las fechas de esta prueba empiezan en 2040: nunca tocan citas reales
await limpiarCitasDePrueba('2040-01-01', puntosIniciales);
console.log(fallos === 0 ? 'E2E RESERVAS: TODO OK' : `E2E RESERVAS: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
