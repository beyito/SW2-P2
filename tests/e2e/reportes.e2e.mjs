// Prueba en navegador real de los reportes dinámicos (CU-18): la administración arma un reporte en Excel
// y otro en PDF desde el ERP, los descarga y se comprueba su contenido contra la base. No usa el modelo
// de lenguaje ni cambia datos. Requiere el backend y los microfrontends en ejecución.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { iniciarSesion } from './soporte.mjs';

const require = createRequire(import.meta.url);
const ExcelJS = require('../../backend/mcp-server/node_modules/exceljs');

const SHELL = 'http://localhost:3000/';
const ADMIN = ['admin.salon', 'Admin#2026'];
const ESTILISTA = ['valentina.rossi', 'Estilista#2026'];
const ESPERA = { timeout: 45000 };

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!ok) fallos += 1;
}

const sql = (base, consulta) =>
  execFileSync('docker', ['exec', 'salon-postgres', 'psql', '-U', 'salon_admin', '-d', base, '-Atc', consulta], { encoding: 'utf8' }).trim();

const browser = await chromium.launch();
try {
  const contexto = await browser.newContext({ viewport: { width: 1400, height: 1200 }, acceptDownloads: true });
  const pagina = await iniciarSesion(contexto, SHELL, ADMIN);
  const erp = pagina.locator('#mfe-root');
  await pagina.click('#tab-mfe-gestion');
  await erp.locator('#erp-tab-reports').click(ESPERA);
  await erp.locator('#report-entity').waitFor(ESPERA);
  check('la administración ve la pestaña Reportes', true);

  // 1) Inventario en Excel, solo tres columnas
  await erp.locator('#report-entity').selectOption('inventario');
  for (const columna of ['codigo', 'reservado', 'faltante', 'precio_unitario', 'valor_stock', 'critico', 'categoria']) {
    await erp.locator(`.report-column[data-column="${columna}"]`).uncheck();
  }
  await erp.locator('#report-generate').click();
  await erp.locator('.report-result').first().waitFor(ESPERA);
  const insumos = Number(sql('salon_gestion', 'SELECT count(*) FROM inventory_items'));
  check('la vista previa muestra todos los insumos', (await erp.locator('.report-result').first().locator('.report-row').count()) === insumos, `(${insumos})`);

  const [descargaExcel] = await Promise.all([pagina.waitForEvent('download'), erp.locator('.btn-download').first().click()]);
  const rutaExcel = await descargaExcel.path();
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(readFileSync(rutaExcel));
  const hoja = libro.worksheets[0];
  check('el Excel descargado trae las columnas elegidas', JSON.stringify(hoja.getRow(4).values.slice(1)) === JSON.stringify(['Insumo', 'Stock', 'Mínimo']),
    JSON.stringify(hoja.getRow(4).values.slice(1)));
  const stockTotal = Number(sql('salon_gestion', 'SELECT sum(current_stock) FROM inventory_items'));
  check('el total de stock del Excel coincide con la base', hoja.getRow(4 + insumos + 1).getCell(2).value === stockTotal, `(${stockTotal})`);
  check('el archivo se llama como el reporte', descargaExcel.suggestedFilename() === 'reporte_de_inventario.xlsx', descargaExcel.suggestedFilename());

  // 2) Facturas en PDF agrupadas por servicio
  await erp.locator('#report-entity').selectOption('facturas');
  await erp.locator('#report-group').selectOption('servicio');
  await erp.locator('#report-format').selectOption('pdf');
  await erp.locator('#report-generate').click();
  await erp.locator('.report-result >> nth=0 >> text=Descargar PDF').waitFor(ESPERA);
  const servicios = Number(sql('salon_crm', "SELECT count(DISTINCT coalesce(service_name, '')) FROM invoices"));
  check('el agrupado tiene una fila por servicio', (await erp.locator('.report-result').first().locator('.report-row').count()) === servicios, `(${servicios})`);
  const [descargaPdf] = await Promise.all([pagina.waitForEvent('download'), erp.locator('.btn-download').first().click()]);
  const pdf = readFileSync(await descargaPdf.path());
  check('el PDF descargado es un PDF', pdf.subarray(0, 5).toString() === '%PDF-');

  await contexto.close();

  // 3) Una estilista no ve la pestaña: los reportes traen datos de clientes
  const otro = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const estilista = await iniciarSesion(otro, SHELL, ESTILISTA);
  const suErp = estilista.locator('#mfe-root');
  await estilista.click('#tab-mfe-gestion');
  await suErp.locator('#erp-tab-panel').waitFor(ESPERA);
  check('una estilista no ve la pestaña Reportes', (await suErp.locator('#erp-tab-reports').count()) === 0);
  await otro.close();
} finally {
  await browser.close();
}

console.log(fallos ? `E2E REPORTES: ${fallos} FALLAS` : 'E2E REPORTES: TODO OK');
process.exit(fallos ? 1 : 0);
