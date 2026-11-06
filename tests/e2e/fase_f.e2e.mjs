// Prueba en navegador real de la Fase F: ERP en Angular, comunidad y clóset en React, portal del cliente en Vue.
// Requiere el backend en Docker Compose y los microfrontends en ejecución. Borra lo que crea al terminar.
import { chromium } from 'playwright';
import { borrarPublicacionesDePrueba, fotoDePuntos, iniciarSesion, limpiarCitasDePrueba, sql, usarErpCompilado } from './soporte.mjs';

const SHELL = 'http://localhost:3000/';
const ADMIN = ['admin.salon', 'Admin#2026'];
const CAMILA = ['camila.fernandez', 'Cliente#2026'];
const ALEJANDRO = ['alejandro.morales', 'Cliente#2026'];
const PREFIJO = '[e2e-f]';
const UNICO = Date.now().toString(36);
const CODIGO = `E2E-${UNICO}`;
const ESPERA = { timeout: 20000 };
// PNG real de un píxel
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg==',
  'base64',
);
const imagen = { name: 'look.png', mimeType: 'image/png', buffer: PNG };

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

const crm = (query) => sql('salon_crm', query);
const gestion = (query) => sql('salon_gestion', query);

function fechaLejana() {
  const date = new Date(Date.UTC(2041, 0, 7));
  date.setUTCDate(date.getUTCDate() + 7 * Math.floor(Math.random() * 400));
  return date.toISOString().slice(0, 10);
}

function ahoraLocal() {
  const now = new Date(Date.now() - 3 * 60 * 1000);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

async function abrirModulo(page, tab) {
  await page.click(tab);
  return page.frameLocator('#mfe-frame');
}

const browser = await chromium.launch();
const puntosIniciales = fotoDePuntos();
const stockInicial = gestion("SELECT id || '=' || current_stock || '=' || minimum_stock FROM inventory_items WHERE id LIKE 'inv-00%'");
const citaHoy = crypto.randomUUID();

try {
  // ------------------------------------------------------------ Cliente: clóset y comunidad (React)
  const ctxCamila = await browser.newContext();
  await usarErpCompilado(ctxCamila);
  const camila = await iniciarSesion(ctxCamila, SHELL, CAMILA);
  const estudio = await abrirModulo(camila, '#tab-mfe-estudio-ia');

  await estudio.getByRole('button', { name: /Clóset/ }).click();
  const prenda = `${PREFIJO} Blazer ${UNICO}`;
  await estudio.locator('#closet-name').fill(prenda);
  await estudio.locator('#closet-color').fill('Beige');
  await estudio.locator('#closet-file').setInputFiles(imagen);
  await estudio.locator('#closet-save').click();
  const tarjeta = estudio.locator(`.closet-item[data-name="${prenda}"]`);
  await tarjeta.waitFor(ESPERA);
  const foto = tarjeta.locator('img');
  await foto.waitFor(ESPERA);
  await camila.waitForTimeout(500);
  check('la prenda se guarda con su foto real', await foto.evaluate((img) => img.complete && img.naturalWidth === 1));

  await tarjeta.locator('.btn-edit-item').click();
  await estudio.locator('#closet-color').fill('Negro');
  await estudio.locator('#closet-save').click();
  await tarjeta.locator('.closet-detail', { hasText: 'Negro' }).waitFor(ESPERA);
  check('la prenda se edita', true);

  // La prueba de que no es estado local: sobrevive a recargar el módulo
  await camila.getByRole('button', { name: 'Recargar' }).click();
  const estudio2 = camila.frameLocator('#mfe-frame');
  await estudio2.getByRole('button', { name: /Clóset/ }).click();
  await estudio2.locator(`.closet-item[data-name="${prenda}"] .closet-detail`, { hasText: 'Negro' }).waitFor(ESPERA);
  check('la prenda sigue ahí tras recargar: viene del servidor', true);

  await estudio2.locator(`.closet-item[data-name="${prenda}"] .btn-remove-item`).click();
  await estudio2.locator(`.closet-item[data-name="${prenda}"]`).waitFor({ state: 'detached', ...ESPERA });
  check('la prenda se elimina', true);

  await estudio2.getByRole('button', { name: /Comunidad/ }).click();
  const titulo = `${PREFIJO} Look ${UNICO}`;
  await estudio2.locator('#post-title').fill(titulo);
  await estudio2.locator('#post-description').fill('Mi balayage');
  await estudio2.locator('#post-submit').click();
  await estudio2.locator('#community-error').waitFor(ESPERA);
  check('publicar sin imagen se rechaza', (await estudio2.locator('#community-error').textContent()).includes('imagen'));

  await estudio2.locator('#post-file').setInputFiles({ name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') });
  await estudio2.locator('#post-submit').click();
  await estudio2.locator('#community-error', { hasText: 'JPEG' }).waitFor(ESPERA);
  check('un archivo que no es imagen se rechaza con su mensaje', true);

  await estudio2.locator('#post-file').setInputFiles(imagen);
  await estudio2.locator('#post-submit').click();
  const publicacion = estudio2.locator(`.post-card[data-title="${titulo}"]`);
  await publicacion.waitFor(ESPERA);
  check('la publicación aparece en el muro', true);

  await publicacion.locator('.btn-like').click();
  await publicacion.locator('.like-count', { hasText: '1' }).waitFor(ESPERA);
  await publicacion.locator('.btn-like').click();
  await publicacion.locator('.like-count', { hasText: '0' }).waitFor(ESPERA);
  check('el like alterna contra el servidor', true);

  await publicacion.locator('.comment-input').fill('Primer comentario');
  await publicacion.locator('.btn-send-comment').click();
  const nivel1 = publicacion.locator('.comment[data-depth="1"]').first();
  await nivel1.waitFor(ESPERA);
  await nivel1.locator('.btn-reply').first().click();
  await nivel1.locator('.reply-input').fill('Una respuesta');
  await nivel1.locator('.btn-send-reply').click();
  const nivel2 = publicacion.locator('.comment[data-depth="2"]');
  await nivel2.waitFor(ESPERA);
  check('los comentarios quedan en cascada', (await nivel2.textContent()).includes('Una respuesta'));

  // ------------------------------------------------------------ Otro cliente denuncia
  const ctxAlejandro = await browser.newContext();
  const alejandro = await iniciarSesion(ctxAlejandro, SHELL, ALEJANDRO);
  const estudioAle = await abrirModulo(alejandro, '#tab-mfe-estudio-ia');
  await estudioAle.getByRole('button', { name: /Comunidad/ }).click();
  const vistaAle = estudioAle.locator(`.post-card[data-title="${titulo}"]`);
  await vistaAle.waitFor(ESPERA);
  check('otro usuario ve la publicación y sus comentarios', (await vistaAle.locator('.comment').count()) === 2);
  check('otro usuario no puede eliminarla', (await vistaAle.locator('.btn-delete-post').count()) === 0);
  await vistaAle.locator('.btn-like').click();
  await vistaAle.locator('.like-count', { hasText: '1' }).waitFor(ESPERA);
  await vistaAle.locator('.btn-report').click();
  await vistaAle.locator('.report-reason').fill('Contenido inapropiado');
  await vistaAle.locator('.btn-send-report').click();
  await vistaAle.locator('.reported').waitFor(ESPERA);
  check('un cliente denuncia una publicación ajena', true);

  // ------------------------------------------------------------ Administrador: ERP (Angular)
  const fechaCita = ahoraLocal();
  gestion(
    'INSERT INTO appointments (id, client_id, stylist_id, service_name, appointment_date, duration_minutes, total_price, status) '
    + `VALUES ('${citaHoy}', 'cli-001', 'sty-103', '${PREFIJO} Cita', '${fechaCita}', 1, 10, 'CONFIRMED')`,
  );

  const ctxAdmin = await browser.newContext();
  await usarErpCompilado(ctxAdmin);
  const admin = await iniciarSesion(ctxAdmin, SHELL, ADMIN);
  const erp = await abrirModulo(admin, '#tab-mfe-gestion');

  await erp.locator('#erp-tab-panel').waitFor(ESPERA);
  check('el ERP es Angular real', (await erp.locator('app-root[ng-version]').count()) === 1);

  await erp.locator('#kpi-total').waitFor(ESPERA);
  const criticos = Number(gestion('SELECT COUNT(*) FROM inventory_items WHERE is_critical_stock'));
  check('el panel muestra los insumos críticos reales', (await erp.locator('.critical-item').count()) === criticos);
  check('el panel muestra ingresos reales', (await erp.locator('#kpi-revenue').textContent()).startsWith('$'));

  // Inventario
  await erp.locator('#erp-tab-inventory').click();
  await erp.locator('#new-code').fill(CODIGO);
  await erp.locator('#new-name').fill(`${PREFIJO} Tinte`);
  await erp.locator('#new-stock').fill('10');
  await erp.locator('#new-minimum').fill('2');
  await erp.locator('#new-price').fill('5.5');
  await erp.locator('#create-item').click();
  const fila = erp.locator(`.inventory-row[data-code="${CODIGO}"]`);
  await fila.waitFor(ESPERA);
  check('CU-08: se registra un insumo', gestion(`SELECT current_stock FROM inventory_items WHERE code='${CODIGO}'`) === '10');

  await fila.locator('.btn-edit').click();
  await erp.locator('#edit-minimum').fill('20');
  await erp.locator('#save-minimum').click();
  await fila.locator('.minimum', { hasText: '20' }).waitFor(ESPERA);
  check('CU-09: el stock mínimo cambia en la base', gestion(`SELECT minimum_stock FROM inventory_items WHERE code='${CODIGO}'`) === '20');
  check('CU-09: el insumo pasa a nivel crítico', (await fila.locator('.badge.bad').count()) === 1);

  await erp.locator('#edit-change').fill('-3');
  await erp.locator('#edit-reason').fill(`${PREFIJO} merma`);
  await erp.locator('#save-movement').click();
  await fila.locator('.stock', { hasText: '7' }).waitFor(ESPERA);
  const movimiento = gestion(`SELECT quantity_change FROM inventory_logs WHERE reason='${PREFIJO} merma' AND item_id=(SELECT id FROM inventory_items WHERE code='${CODIGO}')`);
  check('el movimiento queda registrado con su motivo', movimiento === '-3');

  await erp.locator('#edit-change').fill('-100');
  await erp.locator('#edit-reason').fill(`${PREFIJO} exceso`);
  await erp.locator('#save-movement').click();
  await erp.locator('#inventory-error').waitFor(ESPERA);
  check('un stock imposible muestra el error del servidor', true);

  // Estilistas y horarios
  await erp.locator('#erp-tab-stylists').click();
  const estilista = `${PREFIJO} Marta ${UNICO}`;
  await erp.locator('#stylist-name').fill(estilista);
  await erp.locator('#stylist-specialty').fill('Color');
  await erp.locator('#stylist-save').click();
  const filaEstilista = erp.locator(`.stylist-row[data-name="${estilista}"]`);
  await filaEstilista.waitFor(ESPERA);
  check('CU-04: se registra un estilista', true);

  await filaEstilista.locator('.btn-schedule').click();
  const lunes = erp.locator('.schedule-row[data-day="1"]');
  await lunes.locator('.sch-available').check();
  await lunes.locator('.sch-start').fill('10:00');
  await lunes.locator('.sch-end').fill('14:00');
  await lunes.locator('.sch-save').click();
  await erp.getByText('Horario del Lunes guardado.').waitFor(ESPERA);
  const bloque = gestion(`SELECT start_time, end_time, is_available FROM stylist_schedules WHERE stylist_name='${estilista}' AND day_of_week=1`);
  check('CU-05: el horario se guarda en la base', bloque === '10:00:00|14:00:00|t', bloque);

  await filaEstilista.locator('.btn-toggle').click();
  await filaEstilista.locator('.status', { hasText: 'Inactivo' }).waitFor(ESPERA);
  check('CU-04: el estilista se desactiva', true);

  // Clientes
  await erp.locator('#erp-tab-clients').click();
  const correo = `e2e-${UNICO}@ejemplo.com`;
  await erp.locator('#client-name').fill(`${PREFIJO} Cliente`);
  await erp.locator('#client-email').fill(correo);
  await erp.locator('#client-phone').fill('70000000');
  await erp.locator('#client-save').click();
  await erp.locator(`.client-row[data-email="${correo}"]`).waitFor(ESPERA);
  check('CU-03: el personal registra un cliente', true);

  await erp.locator('#client-name').fill(`${PREFIJO} Repetido`);
  await erp.locator('#client-email').fill(correo);
  await erp.locator('#client-phone').fill('70000000');
  await erp.locator('#client-save').click();
  await erp.locator('#client-error').waitFor(ESPERA);
  check('CU-03: un correo repetido se rechaza', true);

  // Agenda
  await erp.locator('#erp-tab-agenda').click();
  const fechaAgenda = fechaCita.slice(0, 10);
  await erp.locator('#agenda-from').fill(fechaAgenda);
  await erp.locator('#agenda-to').fill(fechaAgenda);
  await erp.locator('#agenda-search').click();
  const filaCita = erp.locator('.agenda-row', { hasText: `${PREFIJO} Cita` });
  await filaCita.waitFor(ESPERA);
  check('la agenda muestra el nombre real del cliente', (await filaCita.textContent()).includes('Camila'));
  await filaCita.getByRole('button', { name: 'Marcar atendida' }).click();
  await filaCita.locator('.badge', { hasText: 'Atendida' }).waitFor(ESPERA);
  check('el personal marca la cita como atendida', gestion(`SELECT status FROM appointments WHERE id='${citaHoy}'`) === 'COMPLETED');

  // Moderación
  await erp.locator('#erp-tab-moderation').click();
  const moderada = erp.locator(`.moderation-item[data-title="${titulo}"]`);
  await moderada.waitFor(ESPERA);
  check('la denuncia llega a la cola de moderación', (await moderada.textContent()).includes('Contenido inapropiado'));
  await moderada.locator('.mod-reason').fill('Incumple las normas');
  await moderada.locator('.btn-hide').click();
  await moderada.locator('.badge.bad', { hasText: 'Oculta' }).waitFor(ESPERA);
  check('el personal oculta la publicación', true);

  await admin.getByRole('button', { name: 'Recargar' }).click();

  // Agente MCP
  const erp2 = admin.frameLocator('#mfe-frame');
  await erp2.locator('#erp-tab-agent').click();
  await erp2.locator('.btn-preset').first().waitFor(ESPERA);
  await erp2.getByRole('button', { name: 'Stock crítico' }).click();
  await erp2.locator('.bubble.agent', { hasText: 'Tinte' }).first().waitFor(ESPERA);
  check('el agente responde con un insumo creado en esta prueba', (await erp2.locator('#agent-chat').textContent()).includes(`${PREFIJO} Tinte`));

  await erp2.getByRole('button', { name: 'Métricas de la semana' }).click();
  await erp2.locator('.bubble.agent', { hasText: 'Ingresos netos' }).waitFor(ESPERA);
  check('el agente entrega métricas', true);

  await erp2.locator('#agent-prompt').fill('¿Qué insumos debo reponer primero?');
  await erp2.locator('#agent-send').click();
  await erp2.locator('.agent-note').waitFor({ timeout: 45000 });
  check('el reporte en lenguaje natural responde', true, await erp2.locator('.agent-note').textContent());

  // ------------------------------------------------------------ Efecto de la moderación
  await alejandro.getByRole('button', { name: 'Recargar' }).click();
  const estudioAle2 = alejandro.frameLocator('#mfe-frame');
  await estudioAle2.getByRole('button', { name: /Comunidad/ }).click();
  await estudioAle2.locator('#post-title').waitFor(ESPERA);
  await alejandro.waitForTimeout(1500);
  check('la publicación oculta desaparece para los demás', (await estudioAle2.locator(`.post-card[data-title="${titulo}"]`).count()) === 0);

  await camila.getByRole('button', { name: 'Recargar' }).click();
  const estudio3 = camila.frameLocator('#mfe-frame');
  await estudio3.getByRole('button', { name: /Comunidad/ }).click();
  const propia = estudio3.locator(`.post-card[data-title="${titulo}"]`);
  await propia.locator('.post-hidden', { hasText: 'Incumple las normas' }).waitFor(ESPERA);
  check('su autora la ve oculta, con el motivo', true);

  // ------------------------------------------------------------ Portal del cliente (Vue)
  const portal = await abrirModulo(camila, '#tab-mfe-reservas');
  await portal.locator('#portal-tab-notices').waitFor(ESPERA);
  await portal.locator('#portal-tab-notices').click();
  const avisoModeracion = portal.locator('.notice-card[data-type="MODERATION"]', { hasText: 'Incumple las normas' });
  await avisoModeracion.waitFor(ESPERA);
  check('llega el aviso de moderación', true);
  const sinLeer = Number(await portal.locator('#unread-count').textContent());
  await avisoModeracion.locator('.btn-read').click();
  await avisoModeracion.locator('.notice-new').waitFor({ state: 'detached', ...ESPERA });
  await camila.waitForTimeout(800);
  const restantes = await portal.locator('#unread-count').count() ? Number(await portal.locator('#unread-count').textContent()) : 0;
  check('un aviso se marca como leído y baja el contador', restantes === sinLeer - 1, `${sinLeer} -> ${restantes}`);

  // Reseña de la cita marcada como atendida en el ERP
  await portal.locator('#portal-tab-appointments').click();
  const tarjetaAtendida = portal.locator(`.appointment-card[data-id="${citaHoy}"]`);
  await tarjetaAtendida.waitFor(ESPERA);
  check('Mis citas muestra la cita atendida', (await tarjetaAtendida.locator('.appointment-status').getAttribute('data-status')) === 'COMPLETED');
  await tarjetaAtendida.locator('.review-rating').selectOption('4');
  await tarjetaAtendida.locator('.review-comment').fill(`${PREFIJO} Excelente`);
  await tarjetaAtendida.locator('.btn-review').click();
  await tarjetaAtendida.locator('.review-done').waitFor(ESPERA);
  check('la reseña se guarda', gestion(`SELECT rating FROM stylist_reviews WHERE appointment_id='${citaHoy}'`) === '4');

  // Reserva pagada desde el flujo real, para reprogramarla y cancelarla desde Mis citas
  await portal.locator('#portal-tab-book').click();
  const fecha = fechaLejana();
  await portal.locator('[data-service="srv-03"]').click();
  await portal.locator('.stylist-card').first().click();
  check('el estilista muestra su calificación', (await portal.locator('[data-stylist-rating="sty-103"]').textContent()).includes('★'));
  await portal.locator('#btn-to-schedule').click();
  await portal.locator('#booking-date').fill(fecha);
  await portal.locator('#booking-date').dispatchEvent('change');
  await portal.locator('.slot-btn').first().waitFor(ESPERA);
  await portal.locator('.slot-btn').first().click();
  await portal.locator('#btn-to-checkout').click();
  await portal.locator('#btn-pay:enabled').waitFor({ timeout: 30000 });
  const stripe = portal.frameLocator('#payment-element iframe').first();
  await stripe.locator('input[name="cardnumber"]').fill('4242424242424242', { timeout: 30000 });
  await stripe.locator('input[name="exp-date"]').fill('12 / 34');
  await stripe.locator('input[name="cvc"]').fill('123');
  await portal.locator('#btn-pay').click();
  await portal.locator('#booking-success').waitFor({ timeout: 60000 });
  check('el pago sigue funcionando con el portal integrado', true);

  const cita = gestion(`SELECT id FROM appointments WHERE client_id='cli-001' AND appointment_date::date='${fecha}' AND status='CONFIRMED'`);
  await portal.locator('#portal-tab-invoices').click();
  const factura = portal.locator(`.invoice-card[data-appointment="${cita}"]`);
  await factura.waitFor({ timeout: 30000 });
  check('Mis facturas muestra la factura real', (await factura.locator('.invoice-total').textContent()).includes('45.00'));

  const [ventana] = await Promise.all([camila.context().waitForEvent('page', { timeout: 15000 }), factura.locator('.btn-receipt').click()]);
  await ventana.waitForLoadState();
  check('el comprobante se abre', (await ventana.content()).includes('45.00'));
  await ventana.close();

  await portal.locator('#portal-tab-profile').click();
  await portal.locator('#profile-points').waitFor(ESPERA);
  const puntos = crm("SELECT loyalty_points FROM crm_clients WHERE id='cli-001'");
  check('el perfil muestra los puntos reales', (await portal.locator('#profile-points').textContent()).trim() === puntos);
  check('el historial de puntos tiene movimientos', (await portal.locator('.points-row').count()) > 0);
  await portal.locator('#profile-phone').fill('+591-70012345');
  await portal.locator('#profile-save').click();
  await portal.getByText('Teléfono actualizado.').waitFor(ESPERA);
  check('el perfil se actualiza', crm("SELECT phone FROM crm_clients WHERE id='cli-001'") === '+591-70012345');

  await portal.locator('#portal-tab-appointments').click();
  const pagada = portal.locator(`.appointment-card[data-id="${cita}"]`);
  await pagada.waitFor(ESPERA);
  await pagada.locator('.btn-reschedule').click();
  const nuevaFecha = fechaLejana();
  await pagada.locator('.reschedule-date').fill(nuevaFecha);
  await pagada.locator('.reschedule-date').dispatchEvent('change');
  await pagada.locator('.reschedule-slot').first().waitFor(ESPERA);
  await pagada.locator('.reschedule-slot').first().click();
  await pagada.locator('.appointment-status[data-status="RESCHEDULED"]').waitFor(ESPERA);
  const fechaNueva = gestion(`SELECT appointment_date::date FROM appointments WHERE id='${cita}'`);
  check('CU-07: la cita se reprograma', fechaNueva === nuevaFecha, fechaNueva);

  await pagada.locator('.btn-cancel').click();
  await pagada.locator('.btn-cancel-yes').click();
  await pagada.locator('.appointment-status[data-status="CANCELLED"]').waitFor({ timeout: 60000 });
  check('CU-07: una cita pagada se cancela desde Mis citas', true);

  await portal.locator('#portal-tab-invoices').click();
  await factura.locator('.invoice-status[data-status="REFUNDED"]').waitFor({ timeout: 30000 });
  check('la factura queda reembolsada, con su nota de crédito', (await factura.locator('.credit-note').count()) === 1);

  await portal.locator('#portal-tab-notices').click();
  await portal.locator('.notice-card[data-type="REFUND"]').first().waitFor(ESPERA);
  check('llega el aviso de reembolso', true);

  // El ERP del cliente sigue vedado
  check('un cliente no ve la pestaña del ERP', (await camila.locator('#tab-mfe-gestion').count()) === 0);

  // Limpieza de la publicación a través de la interfaz de su autora
  const estudio4 = await abrirModulo(camila, '#tab-mfe-estudio-ia');
  await estudio4.getByRole('button', { name: /Comunidad/ }).click();
  const paraBorrar = estudio4.locator(`.post-card[data-title="${titulo}"]`);
  await paraBorrar.locator('.btn-delete-post').click();
  await paraBorrar.waitFor({ state: 'detached', ...ESPERA });
  check('la autora elimina su publicación', true);
} catch (error) {
  fallos += 1;
  console.log(`FALLA excepción: ${error.message}`);
} finally {
  await browser.close();

  // Limpieza: se restauran los datos, aunque la prueba haya fallado a mitad de camino
  gestion(`DELETE FROM stylist_reviews WHERE comment LIKE '${PREFIJO}%'`);
  await limpiarCitasDePrueba('2041-01-01', puntosIniciales);
  borrarPublicacionesDePrueba(PREFIJO);
  crm("DELETE FROM notices WHERE type='MODERATION' AND message LIKE '%[e2e-f]%'");
  crm(`DELETE FROM notices WHERE source_ref LIKE 'stock:${CODIGO}:%'`);
  crm(`DELETE FROM crm_clients WHERE full_name LIKE '${PREFIJO}%'`);
  gestion(`DELETE FROM appointments WHERE service_name='${PREFIJO} Cita'`);
  gestion(`DELETE FROM inventory_logs WHERE item_id IN (SELECT id FROM inventory_items WHERE code='${CODIGO}')`);
  gestion(`DELETE FROM inventory_items WHERE code='${CODIGO}'`);
  for (const linea of stockInicial.split('\n')) {
    const [id, actual, minimo] = linea.split('=');
    gestion(`UPDATE inventory_items SET current_stock=${actual}, minimum_stock=${minimo} WHERE id='${id}'`);
  }
  gestion(`DELETE FROM stylist_schedules WHERE stylist_id IN (SELECT id FROM stylists WHERE name LIKE '${PREFIJO}%')`);
  gestion(`DELETE FROM stylists WHERE name LIKE '${PREFIJO}%'`);
}

console.log(fallos === 0 ? 'E2E FASE F: TODO OK' : `E2E FASE F: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
