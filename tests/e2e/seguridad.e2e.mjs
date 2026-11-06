// Prueba de extremo a extremo en un navegador real: login, roles, token en MFE, sesión única y logout.
import { chromium } from 'playwright';
import { saltarCuestionarioInicial } from './soporte.mjs';

saltarCuestionarioInicial();

const SHELL = 'http://localhost:3000/';
const ADMIN = ['admin.salon', 'Admin#2026'];
const CLIENT = ['camila.fernandez', 'Cliente#2026'];
let fallos = 0;

function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

async function login(page, [user, pass]) {
  await page.goto(SHELL);
  await page.waitForURL(/localhost:8080/, { timeout: 15000 });
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.click('#kc-login');
  await page.waitForSelector('#current-user', { timeout: 20000 });
}

const browser = await chromium.launch();

// --- Cliente
const ctxCliente = await browser.newContext();
const cliente = await ctxCliente.newPage();
const pedidos = [];
cliente.on('request', (r) => {
  if (r.url().includes(':8002/api')) pedidos.push({ url: r.url(), auth: r.headers().authorization });
});
const respuestas = [];
cliente.on('response', (r) => {
  if (r.url().includes(':8002/api') && r.request().method() === 'POST') respuestas.push(r.status());
});

await cliente.goto(SHELL);
check('sin sesión redirige a Keycloak', /localhost:8080\/realms\/salon/.test((await cliente.waitForURL(/localhost:8080/), cliente.url())));
await login(cliente, CLIENT);
check('cliente ve su nombre real', (await cliente.textContent('#current-user')).includes('Camila Fernandez (CLIENT)'));
check('cliente no ve la pestaña ERP', (await cliente.locator('#tab-mfe-gestion').count()) === 0);
check('no existe el botón de alternar rol', (await cliente.locator('[title="Alternar rol de sesión"]').count()) === 0);

const mfe = cliente.locator('#mfe-root');
// Pide recomendaciones a ms-ia; a mano si todavía no hay consentimiento biométrico
await mfe.locator('#btn-manual, #btn-camera').first().waitFor({ timeout: 20000 });
if (await mfe.locator('#btn-manual').count()) await mfe.locator('#btn-manual').click();
await mfe.locator('#pref-hair').selectOption('CURLY');
await cliente.waitForTimeout(3000);
check('el microfrontend llama a ms-ia con el token', pedidos.length > 0 && Boolean(pedidos[0].auth?.startsWith('Bearer ey')), `(${pedidos.length} llamadas)`);
check('ms-ia acepta el token del Shell', respuestas.length > 0 && respuestas.every((s) => s === 200), JSON.stringify(respuestas));

await cliente.click('#btn-logout');
await cliente.waitForURL(/localhost:8080/, { timeout: 15000 });
check('logout vuelve a pedir credenciales', await cliente.locator('#username').isVisible());
await cliente.goto(SHELL);
await cliente.waitForURL(/localhost:8080/, { timeout: 15000 });
check('tras el logout no hay sesión SSO', await cliente.locator('#username').isVisible());

// --- Admin: sesión única entre dos navegadores
const ctxA = await browser.newContext();
const adminA = await ctxA.newPage();
await login(adminA, ADMIN);
check('admin ve la pestaña ERP', (await adminA.locator('#tab-mfe-gestion').count()) === 1);

const rpcEstados = [];
adminA.on('response', (r) => {
  if (r.url().includes(':4000/mcp') && r.request().method() === 'POST') rpcEstados.push(r.status());
});
await adminA.click('#tab-mfe-gestion');
await adminA.waitForTimeout(1500);
const erp = adminA.locator('#mfe-root');
await erp.getByRole('button', { name: /Agente|MCP|Asistente/i }).first().click();
await erp.locator('.btn-preset').first().click();
await adminA.waitForTimeout(2500);
check('el ERP llama a MCP con token real', rpcEstados.length > 0 && rpcEstados.every((s) => s === 200), JSON.stringify(rpcEstados));

await adminA.waitForTimeout(1200);
const ctxB = await browser.newContext();
const adminB = await ctxB.newPage();
await login(adminB, ADMIN);
await adminB.waitForTimeout(500);
await adminA.waitForSelector('#btn-relogin', { timeout: 25000 });
check('la primera sesión de admin es desplazada', true);
check('la sesión nueva sigue activa', await adminB.locator('#current-user').isVisible());

await adminA.click('#btn-relogin');
await adminA.waitForURL(/localhost:8080/, { timeout: 15000 });
check('la sesión desplazada puede volver a iniciar', await adminA.locator('#username').isVisible());
check('la otra sesión no se vio afectada', await adminB.locator('#current-user').isVisible());

await browser.close();
console.log(fallos === 0 ? 'E2E: TODO OK' : `E2E: ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
