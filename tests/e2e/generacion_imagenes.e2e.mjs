// Prueba en navegador real de la simulación de cortes y ropa. Deja a cli-001 como estaba.
// Por defecto el proveedor se sustituye en la red del navegador y no se gasta crédito.
// Con IMAGENES_REALES=1 usa Replicate y las fotos indicadas en FOTO_ROSTRO, FOTO_CUERPO y FOTO_PRENDA.
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { iniciarSesion, saltarCuestionarioInicial, sql } from './soporte.mjs';

const SHELL = 'http://localhost:3000/';
const CAMILA = ['camila.fernandez', 'Cliente#2026'];
const ESPERA = { timeout: 30000 };
const REALES = process.env.IMAGENES_REALES === '1';
const RETRATO = resolve('../../backend/ms-ia/tests/fixtures/retrato.png');
const FOTO_ROSTRO = process.env.FOTO_ROSTRO ?? RETRATO;
const FOTO_CUERPO = process.env.FOTO_CUERPO ?? RETRATO;
const FOTO_PRENDA = process.env.FOTO_PRENDA ?? RETRATO;
const CAPTURAS = process.env.CAPTURAS;
const PRENDA = `E2E-imagen-${Date.now()}`;
// PNG de un píxel: suficiente para comprobar que la pantalla muestra lo que recibe
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SIMULADA = { image_base64: PIXEL, media_type: 'image/png', label: 'Simulación generada con IA: el resultado real puede variar.', remaining_today: 4, approximate: false };

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

const crm = (query) => sql('salon_crm', query);
const perfilOriginal = crm(`SELECT quote_nullable(gender)||','||quote_nullable(age_range) FROM crm_clients WHERE id='cli-001'`);
saltarCuestionarioInicial();
crm(`UPDATE crm_clients SET gender='MALE', age_range='18_29' WHERE id='cli-001'`);

const browser = await chromium.launch();
try {
  const contexto = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const pagina = await iniciarSesion(contexto, SHELL, CAMILA);
  const llamadas = [];
  let ultimoCuerpo = '';
  if (!REALES) {
    await contexto.route('**/api/v1/image-generation/**', (ruta) => {
      llamadas.push(ruta.request().url());
      ultimoCuerpo = ruta.request().postDataBuffer()?.toString('latin1') ?? '';
      return ruta.fulfill({ status: 201, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SIMULADA) });
    });
  }
  const mfe = pagina.locator('#mfe-root');

  // Cortes: desde una recomendación
  await mfe.locator('#recommendations').waitFor(ESPERA);
  const corte = mfe.locator('[data-style^="cut-"]').first();
  const estilo = await corte.getAttribute('data-style');
  check('cada corte recomendado ofrece la simulación', (await corte.locator('.btn-preview').count()) === 1, estilo);
  check('un tratamiento no la ofrece', (await mfe.locator('[data-style^="trat-"] .btn-preview').count()) === 0);
  await corte.locator('.btn-preview').click();

  const dialogo = pagina.locator('#preview-dialog');
  await dialogo.waitFor(ESPERA);
  await dialogo.locator('#preview-consent-text').waitFor(ESPERA);
  const politica = await dialogo.locator('#preview-consent-text').innerText();
  check('la autorización nombra al tercero', politica.includes('Replicate'));
  check('no se puede elegir la foto antes de autorizar', (await dialogo.locator('#preview-file').count()) === 0);
  check('aceptar exige declarar la mayoría de edad', await dialogo.locator('#btn-preview-accept').isDisabled());
  const caja = await dialogo.boundingBox();
  check('la ventana queda centrada y entera en la pantalla', caja.x > 300 && caja.x + caja.width < 1100 && caja.y >= 0 && caja.y + caja.height <= 1200, JSON.stringify(caja));
  if (CAPTURAS) await pagina.screenshot({ path: `${CAPTURAS}/web_autorizacion.png` });

  await dialogo.locator('#preview-adult').check();
  await dialogo.locator('#btn-preview-accept').click();
  await dialogo.locator('#preview-file').waitFor({ state: 'attached', ...ESPERA });

  await dialogo.locator('#preview-file').setInputFiles(FOTO_ROSTRO);
  await dialogo.locator('#preview-image').waitFor({ timeout: 120000 });
  check('muestra la imagen generada', await dialogo.locator('#preview-image').evaluate((img) => img.complete && img.naturalWidth > 0));
  check('la imagen lleva la etiqueta de simulación', (await dialogo.locator('#preview-label').innerText()).includes('Simulación'));
  check('ofrece descargarla', (await dialogo.locator('#preview-download').count()) === 1);
  if (CAPTURAS) await pagina.screenshot({ path: `${CAPTURAS}/web_corte.png` });
  if (!REALES) check('la petición va al endpoint de cortes', llamadas.at(-1).endsWith('/image-generation/haircut'));

  await dialogo.locator('#btn-preview-close').click();
  check('cerrar quita la imagen de la página', (await pagina.locator('#preview-image').count()) === 0);

  // Ropa: desde el clóset
  await mfe.locator('#tab-closet').click();
  await mfe.locator('#closet-name').waitFor(ESPERA);

  // Sin foto propia no se ofrece la prueba
  await mfe.locator('#closet-name').fill(PRENDA);
  await mfe.locator('#closet-color').fill('Terracota');
  await mfe.locator('#closet-category').selectOption('OUTERWEAR');
  await mfe.locator('#closet-save').click();
  const prenda = mfe.locator(`.closet-item[data-name="${PRENDA}"]`);
  await prenda.waitFor(ESPERA);
  check('sin foto no ofrece la prueba', (await prenda.locator('.btn-try-on').count()) === 0);
  check('sin foto explica qué falta', (await prenda.locator('.try-on-hint').count()) === 1);

  // Con foto sí
  await prenda.locator('.btn-edit-item').click();
  await mfe.locator('#closet-file').setInputFiles(FOTO_PRENDA);
  await mfe.locator('#closet-save').click();
  await prenda.locator('.btn-try-on').waitFor(ESPERA);
  check('al subir la foto ofrece probársela', true);

  await prenda.locator('.btn-try-on').click();
  await dialogo.waitFor(ESPERA);
  // La autorización ya dada no se vuelve a pedir
  await dialogo.locator('#preview-file').waitFor({ state: 'attached', ...ESPERA });
  check('no vuelve a pedir la autorización', (await dialogo.locator('#preview-consent-text').count()) === 0);
  await dialogo.locator('#preview-file').setInputFiles(FOTO_CUERPO);
  await dialogo.locator('#preview-image').waitFor({ timeout: 120000 });
  check('muestra la prenda simulada', await dialogo.locator('#preview-image').evaluate((img) => img.complete && img.naturalWidth > 0));
  if (CAPTURAS) await pagina.screenshot({ path: `${CAPTURAS}/web_ropa.png` });
  if (!REALES) check('la petición va al endpoint de ropa', llamadas.at(-1).endsWith('/image-generation/try-on'));

  // Pantalla de teléfono
  await pagina.setViewportSize({ width: 390, height: 800 });
  const estrecha = await dialogo.boundingBox();
  check('la ventana cabe en un teléfono', estrecha.x >= 0 && estrecha.x + estrecha.width <= 390 && estrecha.y >= 0 && estrecha.y + estrecha.height <= 800, JSON.stringify(estrecha));
  await pagina.setViewportSize({ width: 1400, height: 1200 });

  // Conjunto: siempre con el proveedor sustituido, para no gastar crédito
  await dialogo.locator('#btn-preview-close').click();
  if (!REALES) {
    const OTRA = `${PRENDA}-pantalon`;
    await mfe.locator('#closet-name').fill(OTRA);
    await mfe.locator('#closet-color').fill('Gris');
    await mfe.locator('#closet-category').selectOption('BOTTOM');
    await mfe.locator('#closet-file').setInputFiles(FOTO_PRENDA);
    await mfe.locator('#closet-save').click();
    const otra = mfe.locator(`.closet-item[data-name="${OTRA}"]`);
    await otra.locator('.outfit-toggle').waitFor(ESPERA);
    check('sin marcar no ofrece el conjunto', (await mfe.locator('#btn-try-outfit').count()) === 0);
    await prenda.locator('.outfit-toggle').check();
    check('con una prenda no se puede probar el conjunto', await mfe.locator('#btn-try-outfit').isDisabled());
    await otra.locator('.outfit-toggle').check();
    check('con dos prendas sí', await mfe.locator('#btn-try-outfit').isEnabled());
    await mfe.locator('#btn-try-outfit').click();
    await dialogo.locator('#preview-file').waitFor({ state: 'attached', ...ESPERA });
    check('el título nombra las dos prendas', (await dialogo.getAttribute('aria-label')).includes(OTRA));
    await dialogo.locator('#preview-file').setInputFiles(FOTO_CUERPO);
    await dialogo.locator('#preview-image').waitFor({ timeout: 120000 });
    check('la petición va al endpoint de conjuntos', llamadas.at(-1).endsWith('/image-generation/try-on-outfit'));
    const enviadas = /name="item_ids"\r\n\r\n([^\r]+)/.exec(ultimoCuerpo)?.[1].split(',') ?? [];
    check('envía las dos prendas en una sola petición', enviadas.length === 2, enviadas.join(','));
    check('la imagen del conjunto lleva la etiqueta de simulación', (await dialogo.locator('#preview-label').innerText()).includes('Simulación'));
    if (CAPTURAS) await pagina.screenshot({ path: `${CAPTURAS}/web_conjunto.png` });
    await dialogo.locator('#btn-preview-close').click();
    await otra.locator('.btn-remove-item').click();
    await otra.waitFor({ state: 'detached', ...ESPERA });
    check('quitar una prenda la saca del conjunto', await mfe.locator('#btn-try-outfit').isDisabled());
  }
  await prenda.locator('.btn-try-on').click();
  await dialogo.locator('#btn-preview-revoke').waitFor(ESPERA);

  // Retirar
  await dialogo.locator('#btn-preview-revoke').click();
  await dialogo.locator('#preview-consent-text').waitFor(ESPERA);
  check('retirar quita la imagen y vuelve a pedir autorización', (await dialogo.locator('#preview-image').count()) === 0);
  await dialogo.locator('#btn-preview-close').click();

  await prenda.locator('.btn-remove-item').click();
  await prenda.waitFor({ state: 'detached', ...ESPERA });
  check('la prenda de prueba se borró', true);
  await contexto.close();
} catch (error) {
  check('la prueba terminó sin errores', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
  crm(`UPDATE crm_clients SET (gender, age_range) = (${perfilOriginal}) WHERE id='cli-001'`);
}

console.log(fallos === 0 ? 'E2E IMÁGENES: TODO OK' : `E2E IMÁGENES: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
