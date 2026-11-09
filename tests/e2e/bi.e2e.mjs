// Prueba en navegador real del tablero de inteligencia de negocios en Python (Streamlit): inicio de sesión
// con Keycloak, KPI calculados sobre el dataset y acceso solo para la administración.
// Requiere el entorno levantado, con el servicio bi-dashboard.
import { chromium } from 'playwright';

const BI = process.env.BI_URL || 'http://localhost:8501/';
// En la nube las cuentas de demostración tienen otras contraseñas: se pasan por el entorno
const ADMIN = ['admin.salon', process.env.CLAVE_ADMIN || 'Admin#2026'];
const ESTILISTA = ['valentina.rossi', process.env.CLAVE_ESTILISTA || 'Estilista#2026'];
const ESPERA = { timeout: 60000 };

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

async function entrar(navegador, [usuario, clave]) {
  const contexto = await navegador.newContext({ viewport: { width: 1500, height: 1100 } });
  const pagina = await contexto.newPage();
  await pagina.goto(BI);
  await pagina.getByRole('button', { name: 'Iniciar sesión' }).click(ESPERA);
  await pagina.waitForURL(/\/realms\/salon\//, ESPERA);
  await pagina.fill('#username', usuario);
  await pagina.fill('#password', clave);
  await pagina.click('#kc-login');
  await pagina.waitForURL((url) => url.toString().startsWith(BI), ESPERA);
  return { contexto, pagina };
}

const navegador = await chromium.launch();
try {
  const { contexto, pagina } = await entrar(navegador, ADMIN);
  await pagina.getByText('Ingresos netos').waitFor(ESPERA);
  check('la administración entra al tablero', true);
  const metricas = await pagina.locator('[data-testid="stMetric"]').count();
  check('muestra los ocho KPI', metricas === 8, `(${metricas})`);
  const ingresos = await pagina.locator('[data-testid="stMetric"]').first().locator('[data-testid="stMetricValue"]').innerText();
  check('los ingresos son una cifra en dólares', /^\$[\d,]+$/.test(ingresos), ingresos);
  check('informa el tamaño del dataset', /Dataset: [\d,]+ registros/.test(await pagina.locator('[data-testid="stSidebar"]').innerText()));
  for (const pestana of ['Agenda', 'Estilistas', 'Clientes', 'Servicios e insumos']) {
    await pagina.getByRole('tab', { name: pestana }).click();
    await pagina.waitForTimeout(1500);
  }
  check('recorre las pestañas sin errores', (await pagina.locator('[data-testid="stException"]').count()) === 0);
  await pagina.getByRole('tab', { name: 'Clientes' }).click();
  await pagina.getByText('Mejores clientes del periodo').waitFor(ESPERA);
  await pagina.screenshot({ path: process.env.CAPTURA || 'bi_tablero.png', fullPage: false });
  await contexto.close();

  const otra = await entrar(navegador, ESTILISTA);
  await otra.pagina.getByText('no tiene acceso').waitFor(ESPERA);
  check('una estilista no ve los datos', (await otra.pagina.getByText('Ingresos netos').count()) === 0);
  await otra.contexto.close();
} finally {
  await navegador.close();
}

console.log(fallos ? `E2E BI: ${fallos} FALLAS` : 'E2E BI: TODO OK');
process.exit(fallos ? 1 : 0);
