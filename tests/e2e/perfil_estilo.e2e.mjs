// Prueba en navegador real del cuestionario inicial y de su efecto en las recomendaciones.
// Deja el perfil de cli-001 como estaba al empezar.
import { chromium } from 'playwright';
import { iniciarSesion, sql } from './soporte.mjs';

const SHELL = 'http://localhost:3000/';
const CAMILA = ['camila.fernandez', 'Cliente#2026'];
const ESPERA = { timeout: 30000 };
const COLUMNAS = 'gender, age_range, preferred_length, maintenance, style_vibe, onboarded_at';

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

const crm = (query) => sql('salon_crm', query);
const original = crm(`SELECT quote_nullable(gender)||','||quote_nullable(age_range)||','||quote_nullable(preferred_length)||','||quote_nullable(maintenance)||','||quote_nullable(style_vibe)||','||quote_nullable(onboarded_at) FROM crm_clients WHERE id='cli-001'`);
crm(`UPDATE crm_clients SET (${COLUMNAS}) = (NULL, NULL, NULL, NULL, NULL, NULL) WHERE id='cli-001'`);

const browser = await chromium.launch();
try {
  const contexto = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const pagina = await iniciarSesion(contexto, SHELL, CAMILA);
  await pagina.locator('#onboarding').waitFor(ESPERA);
  check('la primera sesión muestra el cuestionario', true);
  check('el cuestionario no deja ver todavía el estudio', (await pagina.locator('#mfe-root').count()) === 0);

  // Omitir no se vuelve a preguntar
  await pagina.locator('#onboarding-skip').click();
  await pagina.locator('#mfe-root').waitFor(ESPERA);
  check('omitir lleva a la plataforma', crm("SELECT onboarded_at IS NOT NULL FROM crm_clients WHERE id='cli-001'") === 't');
  check('omitir no guarda respuestas', crm("SELECT gender IS NULL FROM crm_clients WHERE id='cli-001'") === 't');
  await pagina.reload();
  await pagina.locator('#mfe-root').waitFor(ESPERA);
  check('quien omitió no vuelve a verlo', (await pagina.locator('#onboarding').count()) === 0);

  // Responder como hombre
  crm("UPDATE crm_clients SET onboarded_at = NULL WHERE id='cli-001'");
  await pagina.reload();
  await pagina.locator('#onboarding').waitFor(ESPERA);
  await pagina.selectOption('#onboarding-gender', 'MALE');
  await pagina.selectOption('#onboarding-ageRange', '60_PLUS');
  await pagina.selectOption('#onboarding-maintenance', 'LOW');
  await pagina.locator('#onboarding-save').click();
  const mfe = pagina.locator('#mfe-root');
  await mfe.locator('#recommendations').waitFor(ESPERA);
  check('las respuestas se guardan', crm("SELECT gender||age_range||maintenance FROM crm_clients WHERE id='cli-001'") === 'MALE60_PLUSLOW');
  check('el perfil se aplica sin pedir nada más', (await mfe.locator('#pref-gender').inputValue()) === 'MALE');

  const estilos = () => mfe.locator('[data-style]').evaluateAll((nodos) => nodos.map((nodo) => nodo.dataset.style));
  const hombre = await estilos();
  check('un hombre no recibe estilos de mujer', !hombre.some((id) => ['cut-pixie', 'cut-bob', 'cut-capas', 'color-miel', 'color-cobre'].includes(id)), hombre.join(','));
  check('a los 60 o más se sugiere el camuflaje de canas', hombre.includes('color-canas'));
  check('un estilo sin servicio no ofrece reservar', (await mfe.locator('[data-style="color-canas"] .btn-book').count()) === 0);

  // Cambiar el público en la pantalla cambia el resultado
  await mfe.locator('#pref-gender').selectOption('FEMALE');
  await pagina.waitForTimeout(1500);
  const mujer = await estilos();
  check('para mujer salen otros estilos', !mujer.some((id) => ['cut-fade', 'cut-raya', 'cut-undercut', 'color-canas'].includes(id)), mujer.join(','));

  // Menor de edad: sin diagnóstico automático
  await pagina.click('#tab-mfe-reservas');
  const portal = pagina.locator('#mfe-root');
  await portal.locator('#portal-tab-profile').click(ESPERA);
  await portal.locator('#style-ageRange').waitFor(ESPERA);
  check('"Mi perfil" muestra lo que respondió', (await portal.locator('#style-gender').inputValue()) === 'MALE');
  await portal.locator('#style-ageRange').selectOption('UNDER_18');
  await portal.locator('#style-save').click();
  await portal.locator('.portal-success').waitFor(ESPERA);
  check('"Mi perfil" guarda los cambios', crm("SELECT age_range FROM crm_clients WHERE id='cli-001'") === 'UNDER_18');

  await pagina.click('#tab-mfe-estudio-ia');
  const estudio = pagina.locator('#mfe-root');
  await estudio.locator('#consent-minor').waitFor(ESPERA);
  check('un menor no puede aceptar el diagnóstico automático', (await estudio.locator('#btn-consent').count()) === 0);
  check('un menor puede usar el modo a mano', (await estudio.locator('#btn-manual').count()) === 1);
  await contexto.close();
} catch (error) {
  check('la prueba terminó sin errores', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
  crm(`UPDATE crm_clients SET (${COLUMNAS}) = (${original}) WHERE id='cli-001'`);
}

console.log(fallos === 0 ? 'E2E PERFIL: TODO OK' : `E2E PERFIL: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
