// Prueba en navegador real de la Fase G, con cámara y micrófono simulados por Chromium a partir de archivos reales:
// un video de un rostro y una pregunta hablada en español. Requiere el backend y los microfrontends en ejecución.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { iniciarSesion, perfilDePruebaVacio, saltarCuestionarioInicial } from './soporte.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VIDEO_CAMARA = join(AQUI, 'fixtures', 'rostro.y4m');
const AUDIO_MICROFONO = join(AQUI, '../../backend/ms-ia/tests/fixtures/pregunta.wav');
const RETRATO = join(AQUI, '../../backend/ms-ia/tests/fixtures/retrato.png');

const SHELL = 'http://localhost:3000/';
const ORIGENES = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3003'];
const CAMILA = ['camila.fernandez', 'Cliente#2026'];
const ADMIN = ['admin.salon', 'Admin#2026'];
const ESPERA = { timeout: 45000 };

/** PNG real de 300x300 en un solo color: se puede decodificar, pero no contiene ningún rostro. */
function pngSinRostro() {
  const bloque = (tipo, datos) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const control = Buffer.alloc(4);
    control.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, control]);
  };
  const lado = 300;
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(lado, 0);
  cabecera.writeUInt32BE(lado, 4);
  cabecera.set([8, 2, 0, 0, 0], 8);
  const filas = Buffer.alloc((lado * 3 + 1) * lado, 90);
  for (let fila = 0; fila < lado; fila += 1) filas[fila * (lado * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', cabecera),
    bloque('IDAT', deflateSync(filas)),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

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

const limpiar = () => {
  mongo("db.biometric_diagnoses.deleteMany({clientId: 'cli-001'}); db.biometric_consents.deleteMany({clientId: 'cli-001'})");
};
const diagnosticos = () => Number(mongo("db.biometric_diagnoses.countDocuments({clientId: 'cli-001'})"));

saltarCuestionarioInicial();
const restaurarPerfil = perfilDePruebaVacio();
limpiar();
const imagenesAntes = mongo("db.getCollection('media.files').countDocuments()");

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${VIDEO_CAMARA}`,
    `--use-file-for-fake-audio-capture=${AUDIO_MICROFONO}%noloop`,
  ],
});

try {
  // --- Cliente
  const contexto = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  for (const origen of ORIGENES) await contexto.grantPermissions(['camera', 'microphone'], { origin: origen });
  const pagina = await iniciarSesion(contexto, SHELL, CAMILA);
  const mfe = pagina.locator('#mfe-root');

  await mfe.locator('#consent-text').waitFor(ESPERA);
  check('sin consentimiento muestra la política', (await mfe.locator('#consent-text').textContent()).includes('se descartan'));
  check('sin consentimiento no se ofrece la cámara', (await mfe.locator('#btn-camera').count()) === 0);
  check('sin consentimiento no se puede subir un archivo', (await mfe.locator('#scan-file').count()) === 0);

  // Alternativa voluntaria, sin ningún análisis
  await mfe.locator('#btn-manual').click();
  await mfe.locator('#pref-hair').selectOption('CURLY');
  await mfe.locator('#recommendations').waitFor(ESPERA);
  check('sin consentimiento recomienda con rasgos a mano', (await mfe.locator('[data-style="trat-keratina"]').count()) === 1);
  check('a mano no se guarda ningún diagnóstico', diagnosticos() === 0);
  await mfe.locator('#pref-hair').selectOption('');
  await mfe.locator('#btn-show-consent').click();

  check('sin declarar la mayoría de edad no se puede aceptar', await mfe.locator('#btn-consent').isDisabled());
  await mfe.locator('#consent-adult').check();
  await mfe.locator('#btn-consent').click();
  await mfe.locator('#btn-camera').waitFor(ESPERA);
  check('el consentimiento queda registrado', mongo("db.biometric_consents.countDocuments({clientId: 'cli-001', revokedAt: null})") === '1');

  // Foto con la cámara
  await mfe.locator('#btn-camera').click();
  await mfe.locator('#btn-photo').waitFor(ESPERA);
  await pagina.waitForTimeout(1500);
  await mfe.locator('#btn-photo').click();
  await mfe.locator('#diagnosis').waitFor(ESPERA);
  check('la foto de la cámara produce un diagnóstico', diagnosticos() === 1, await mfe.locator('#result-shape').textContent());
  check('la foto se identifica como tal', (await mfe.locator('#result-source').textContent()) === 'Foto');
  check('la cámara se apaga después de la foto', (await mfe.locator('#btn-camera').count()) === 1);
  check('muestra la paleta del diagnóstico', (await mfe.locator('#result-palette span').count()) === 6);
  await mfe.locator('#recommendations').waitFor(ESPERA);
  check('recomienda estilos con el precio del catálogo', (await mfe.locator('[data-style] .btn-book').count()) >= 6);
  check(
    'la afinidad no es la misma en todos',
    new Set(await mfe.locator('[data-style] strong + span').allTextContents()).size > 1,
  );

  // Video grabado por el navegador: WebM real, sin duración en su cabecera
  await mfe.locator('#btn-camera').click();
  await mfe.locator('#btn-record').waitFor(ESPERA);
  await pagina.waitForTimeout(1000);
  await mfe.locator('#btn-record').click();
  await mfe.locator('#result-source', { hasText: 'Video' }).waitFor(ESPERA);
  check('el video de 4 s produce un diagnóstico', diagnosticos() === 2, await mfe.locator('#result-source').textContent());

  // Archivos rechazados
  await mfe.locator('#scan-file').setInputFiles({ name: 'paisaje.png', mimeType: 'image/png', buffer: pngSinRostro() });
  await mfe.locator('#scan-error').waitFor(ESPERA);
  check('una imagen sin rostro se rechaza con su motivo', (await mfe.locator('#scan-error').textContent()).includes('rostro'));
  check('el rechazo no crea un diagnóstico', diagnosticos() === 2);

  await mfe.locator('#scan-file').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('no soy una imagen') });
  await mfe.locator('#scan-error', { hasText: 'JPEG' }).waitFor(ESPERA);
  check('un archivo falso se rechaza por su contenido', diagnosticos() === 2);

  // Subida de una foto real
  await mfe.locator('#scan-file').setInputFiles({ name: 'retrato.png', mimeType: 'image/png', buffer: readFileSync(RETRATO) });
  await mfe.locator('#result-source', { hasText: 'Foto' }).waitFor(ESPERA);
  check('una foto subida produce un diagnóstico', diagnosticos() === 3);
  check('ninguna imagen se guardó en el servidor', mongo("db.getCollection('media.files').countDocuments()") === imagenesAntes);

  // Las preferencias cambian la recomendación
  const primerCorte = () => mfe.locator('[data-style^="cut-"]').first().getAttribute('data-style');
  await mfe.locator('#pref-length').selectOption('LONG');
  await mfe.locator('#pref-vibe').selectOption('NATURAL');
  await pagina.waitForTimeout(1500);
  const corteLargo = await primerCorte();
  await mfe.locator('#pref-length').selectOption('SHORT');
  await mfe.locator('#pref-vibe').selectOption('BOLD');
  await pagina.waitForTimeout(1500);
  const corteCorto = await primerCorte();
  check('las preferencias cambian el primer corte', corteLargo !== corteCorto, `${corteLargo} -> ${corteCorto}`);

  // Borrar un resultado
  await mfe.locator('#btn-delete-result').click();
  await pagina.waitForTimeout(800);
  check('borrar un resultado lo elimina de la base', diagnosticos() === 2);
  check('al borrar se muestra el anterior', await mfe.locator('#diagnosis').isVisible());

  // Marca personal con el diagnóstico real
  await mfe.locator('#tab-brand').click();
  await mfe.locator('#brand-sector').fill('diseño');
  await mfe.locator('#brand-goal').fill('Conseguir clientes');
  await mfe.locator('#brand-submit').click();
  await mfe.locator('#brand-result').waitFor(ESPERA);
  check('la asesoría usa el diagnóstico', (await mfe.locator('#brand-personalized').textContent()).startsWith('Personalizada'));
  check('propone biografía e ideas', (await mfe.locator('#brand-bio').textContent()).length > 0 && (await mfe.locator('#brand-ideas li').count()) >= 1);
  console.log(`     Motor de textos: ${await mfe.locator('#brand-engine').textContent()}`);

  // Del diagnóstico a la reserva
  await mfe.locator('#tab-biometrics').click();
  await mfe.locator('#recommendations').waitFor(ESPERA);
  await mfe.locator('[data-style^="color-"] .btn-book').first().click();
  const reservas = pagina.locator('#mfe-root');
  await reservas.locator('.service-card.selected, .selected').first().waitFor(ESPERA);
  const elegido = await reservas.locator('.selected').first().textContent();
  check('reservar abre el portal con el servicio recomendado', elegido.includes('Balayage'), elegido.trim().slice(0, 40));

  // Revocar
  await pagina.click('#tab-mfe-estudio-ia');
  await mfe.locator('#btn-revoke').waitFor(ESPERA);
  await mfe.locator('#btn-revoke').click();
  await mfe.locator('#btn-revoke-confirm').click();
  await mfe.locator('#consent-text').waitFor(ESPERA);
  check('revocar borra todos los resultados', diagnosticos() === 0);
  check('revocar deja constancia de la fecha', mongo("db.biometric_consents.countDocuments({clientId: 'cli-001', revokedAt: {$ne: null}})") === '1');
  check('tras revocar desaparece el resultado', (await mfe.locator('#diagnosis').count()) === 0);
  check('tras revocar no se ofrece la cámara', (await mfe.locator('#btn-camera').count()) === 0);
  await contexto.close();

  // --- Administrador: reporte por voz
  const contextoAdmin = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  for (const origen of ORIGENES) await contextoAdmin.grantPermissions(['camera', 'microphone'], { origin: origen });
  const admin = await iniciarSesion(contextoAdmin, SHELL, ADMIN);
  await admin.click('#tab-mfe-gestion');
  const erp = admin.locator('#mfe-root');
  await erp.getByRole('button', { name: /Asistentes/ }).click(ESPERA);
  await erp.locator('#agent-mic').waitFor(ESPERA);
  await erp.locator('#agent-mic').click();
  await erp.locator('#agent-mic', { hasText: 'Detener' }).waitFor(ESPERA);
  // La pregunta dura 5,6 s; el resto de la grabación es silencio
  await admin.waitForTimeout(6500);
  await erp.locator('#agent-mic').click();
  await erp.locator('.bubble.user').first().waitFor(ESPERA);
  const pregunta = await erp.locator('.bubble.user').first().textContent();
  check('la voz se transcribe a la pregunta', pregunta.toLowerCase().includes('ingresos'), pregunta.trim());
  await erp.locator('.bubble.agent:not(.muted)').first().waitFor({ timeout: 60000 });
  const reporte = await erp.locator('.bubble.agent:not(.muted)').first();
  check('el agente responde por el Servidor MCP', !(await reporte.getAttribute('class')).includes('failed'), (await reporte.locator('.agent-note').textContent()).trim());
  check('el micrófono se libera al terminar', (await erp.locator('#agent-mic').textContent()).includes('Preguntar por voz'));
  await contextoAdmin.close();
} catch (error) {
  check('la prueba terminó sin errores', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
  restaurarPerfil();
  limpiar();
}

check('la prueba no dejó datos biométricos', diagnosticos() === 0);
console.log(fallos === 0 ? 'E2E FASE G: TODO OK' : `E2E FASE G: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
