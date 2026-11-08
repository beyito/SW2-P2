// Prueba en navegador real del actor Recepcionista (Fase M): entra directo al ERP, registra llegadas y ausencias,
// y atiende en el mostrador a un cliente sin reserva cobrándole en efectivo o anulando la atención.
// No usa Stripe. Usa un día de 2040 para el mostrador y citas de hoy a medianoche para la agenda; al terminar las borra
// y restaura stock y puntos.
import { chromium } from 'playwright';
import { fotoDePuntos, iniciarSesion, limpiarCitasDePrueba, saltarCuestionarioInicial, sql } from './soporte.mjs';

saltarCuestionarioInicial();

const SHELL = 'http://localhost:3000/';
const RECEPCION = ['recepcion.salon', 'Recepcion#2026'];
const ESPERA = { timeout: 30000 };
const PREFIJO = 'tc-e2e-recep-';
// Primer lunes de junio de 2040: día laborable lejano, sin citas reales
const DIA = (() => {
  const dia = new Date(Date.UTC(2040, 5, 1));
  while (dia.getUTCDay() !== 1) dia.setUTCDate(dia.getUTCDate() + 1);
  return dia.toISOString().slice(0, 10);
})();

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

const gestion = (consulta) => sql('salon_gestion', consulta);
const crm = (consulta) => sql('salon_crm', consulta);
const hoy = () => {
  const ahora = new Date();
  const pad = (valor) => String(valor).padStart(2, '0');
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
};

/** Cita de hoy a medianoche, de un minuto, para probar llegada y ausencia sin chocar con citas reales. */
function citaDeHoy(sufijo, minuto) {
  const id = `${PREFIJO}${sufijo}`;
  gestion(`INSERT INTO appointments (id, client_id, stylist_id, service_name, appointment_date, duration_minutes, total_price, status, created_at, updated_at)
           VALUES ('${id}', 'cli-002', 'sty-101', 'Prueba ${sufijo}', '${hoy()}'::timestamp + INTERVAL '${minuto} minutes', 1, 10, 'CONFIRMED', NOW(), NOW())`);
  return id;
}

const puntos = fotoDePuntos();
const browser = await chromium.launch();
try {
  const llegada = citaDeHoy('llegada', 1);
  const ausente = citaDeHoy('ausente', 3);

  const contexto = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const pagina = await iniciarSesion(contexto, SHELL, RECEPCION);
  const erp = pagina.locator('#mfe-root');

  // 1. Entra directo al ERP, sin pulsar la pestaña, y solo ve sus pestañas
  await erp.locator('#erp-tab-agenda').waitFor(ESPERA);
  const pestanas = await erp.locator('nav.tabs button').evaluateAll((botones) => botones.map((boton) => boton.id));
  check('la recepción empieza en el ERP con sus cuatro pestañas', pestanas.join() === 'erp-tab-agenda,erp-tab-counter,erp-tab-stylists,erp-tab-clients', pestanas.join());
  const barra = await pagina.locator('header nav button').evaluateAll((botones) => botones.map((boton) => boton.id));
  check('la barra del Shell solo ofrece el ERP, sin estudio ni reservas', barra.join() === 'tab-mfe-gestion', barra.join());

  // 2. Agenda: llegada y ausencia
  const filaLlegada = erp.locator('.agenda-row', { hasText: 'Prueba llegada' });
  await filaLlegada.waitFor(ESPERA);
  check('la agenda ofrece "Llegó" y no "Marcar atendida"', await filaLlegada.locator('.btn-check-in').count() === 1 && await filaLlegada.locator('.btn-complete').count() === 0);
  await filaLlegada.locator('.btn-check-in').click();
  await filaLlegada.locator('.arrived').waitFor(ESPERA);
  check('registra la llegada', Boolean(gestion(`SELECT checked_in_at FROM appointments WHERE id='${llegada}'`)));
  check('con el cliente en el salón ya no ofrece "No asistió"', await filaLlegada.locator('.btn-no-show').count() === 0);

  const filaAusente = erp.locator('.agenda-row', { hasText: 'Prueba ausente' });
  await filaAusente.locator('.btn-no-show').click();
  await filaAusente.locator('.badge', { hasText: 'No asistió' }).waitFor(ESPERA);
  check('registra la ausencia', gestion(`SELECT status FROM appointments WHERE id='${ausente}'`) === 'NO_SHOW');

  // 3. Estilistas: puede abrir cualquier horario, pero no registrar estilistas
  await erp.locator('#erp-tab-stylists').click();
  await erp.locator('.stylist-row').first().waitFor(ESPERA);
  check('puede editar horarios', await erp.locator('.btn-schedule').count() === await erp.locator('.stylist-row').count());
  check('no registra ni edita estilistas', await erp.locator('#stylist-save, .btn-edit').count() === 0);

  // 4. Mostrador: cliente sin reserva que paga en efectivo
  await erp.locator('#erp-tab-counter').click();
  async function elegirTurno() {
    await erp.locator('#counter-client-search').fill('Alejandro');
    await erp.locator('#counter-client').selectOption('cli-002');
    await erp.locator('#counter-service').selectOption('srv-03');
    await erp.locator('#counter-stylist').selectOption('sty-101');
    await erp.locator('#counter-date').fill(DIA);
    await erp.locator('#counter-slots').click();
    await erp.locator('#counter-slot-list .slot').first().click(ESPERA);
  }
  await erp.locator('#counter-client option[value="cli-002"]').waitFor({ state: 'attached', ...ESPERA });
  await elegirTurno();
  await erp.locator('#counter-cash').check();
  await erp.locator('#counter-reserve').click();
  await erp.locator('#counter-total').waitFor(ESPERA);
  check('muestra el total del catálogo', (await erp.locator('#counter-total').textContent()).includes('45.00'));
  check('la cita queda apartada sin pagar', gestion(`SELECT status FROM appointments WHERE appointment_date::date='${DIA}' AND client_id='cli-002'`) === 'PENDING_PAYMENT');

  await erp.locator('#counter-received').fill('50');
  await erp.locator('#counter-change').waitFor(ESPERA);
  check('calcula el cambio', (await erp.locator('#counter-change').textContent()).includes('5.00'));
  await erp.locator('#counter-pay').click();
  await erp.locator('#counter-invoice').waitFor(ESPERA);
  const numero = (await erp.locator('#counter-invoice').textContent()).trim();
  const cita = gestion(`SELECT id || '|' || status FROM appointments WHERE appointment_date::date='${DIA}' AND client_id='cli-002' AND status <> 'CANCELLED'`);
  const [citaId, estado] = cita.split('|');
  check('el cobro confirma la cita', estado === 'CONFIRMED', cita);
  check('la factura indica efectivo', crm(`SELECT payment_method || '|' || invoice_number FROM invoices WHERE appointment_id='${citaId}'`) === `CASH|${numero}`);

  const [comprobante] = await Promise.all([contexto.waitForEvent('page', ESPERA), erp.locator('#counter-receipt').click()]);
  await comprobante.waitForLoadState();
  check('el comprobante muestra la forma de pago', (await comprobante.textContent('body')).includes('Efectivo en el mostrador'));
  await comprobante.close();

  // 5. Mostrador: el cliente se retira sin pagar
  await erp.locator('#counter-next').click();
  await elegirTurno();
  await erp.locator('#counter-card').check();
  await erp.locator('#counter-reserve').click();
  await erp.locator('#counter-void').click(ESPERA);
  await erp.locator('#counter-failed').waitFor(ESPERA);
  check('anular informa que no se cobró', (await erp.locator('#counter-failed').textContent()).includes('no se cobró nada'));
  check('la cita anulada queda cancelada y sin factura',
    gestion(`SELECT count(*) FROM appointments WHERE appointment_date::date='${DIA}' AND status='CANCELLED'`) === '1'
    && crm(`SELECT count(*) FROM invoices WHERE appointment_id IN ('${citaId}')`) === '1');
} catch (error) {
  check('la prueba terminó sin errores', false, error.message);
} finally {
  await browser.close();
  await limpiarCitasDePrueba(DIA, puntos);
  gestion(`DELETE FROM appointments WHERE id LIKE '${PREFIJO}%'`);
  const restos = gestion(`SELECT count(*) FROM appointments WHERE id LIKE '${PREFIJO}%' OR appointment_date::date = '${DIA}'`);
  check('no quedan citas de prueba', restos === '0', restos);
}

console.log(fallos === 0 ? 'E2E RECEPCIÓN: TODO OK' : `E2E RECEPCIÓN: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
