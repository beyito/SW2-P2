const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { BackendError } = require('../src/backends');
const { MAX_FILAS, catalogo, construirConsulta, generarReporte } = require('../src/reports');
const { createToolRunner } = require('../src/tools');

/** Base simulada: guarda cada consulta y devuelve las filas indicadas. */
function baseFalsa(filas = []) {
  const db = {
    consultas: [],
    async query(base, sql, parametros) {
      db.consultas.push({ base, sql, parametros });
      return typeof filas === 'function' ? filas(sql) : filas;
    },
  };
  return db;
}

const CITAS = [
  { fecha: '2026-11-09', servicio: 'Balayage', estilista: 'Valentina Rossi', estado: 'CONFIRMED', precio: '120.00' },
  { fecha: '2026-11-09', servicio: 'Corte', estilista: 'Valentina Rossi', estado: 'COMPLETED', precio: '45.00' },
];

test('el catálogo expone entidades, columnas, filtros y formatos', () => {
  const { entidades, formatos } = catalogo();
  assert.deepEqual(formatos, ['excel', 'pdf']);
  const citas = entidades.find((e) => e.clave === 'citas');
  assert.ok(citas.columnas.some((c) => c.clave === 'precio' && c.tipo === 'dinero'));
  assert.ok(citas.filtros.find((f) => f.clave === 'estado').valores.includes('Confirmada'));
  assert.equal(entidades.find((e) => e.clave === 'inventario').filtraPorFecha, false);
});

test('solo se aceptan columnas, filtros y entidades del catálogo', () => {
  assert.throws(() => construirConsulta({ entidad: 'usuarios' }), BackendError);
  assert.throws(() => construirConsulta({ entidad: 'citas', columnas: ['precio', 'password'] }), /Columnas no válidas.*password/);
  assert.throws(() => construirConsulta({ entidad: 'citas', filtros: { tarjeta: '4242' } }), /Filtro no válido/);
  assert.throws(() => construirConsulta({ entidad: 'citas', desde: '9/11/2026' }), /AAAA-MM-DD/);
  assert.throws(() => construirConsulta({ entidad: 'inventario', desde: '2026-11-01' }), /no se filtra por fecha/);
});

test('lo que escribe la persona viaja como parámetro, nunca dentro del SQL', () => {
  const ataque = "x'; DROP TABLE invoices; --";
  const { sql, parametros } = construirConsulta({ entidad: 'facturas', filtros: { cliente: ataque }, desde: '2026-11-01', hasta: '2026-11-30' });
  assert.ok(!sql.includes('DROP'));
  assert.match(sql, /f\.client_name ILIKE \$3/);
  assert.deepEqual(parametros, ['2026-11-01', '2026-11-30', `%${ataque}%`]);
  // "hasta" incluye el último día completo
  assert.match(sql, /f\.issued_at < \$2::date \+ 1/);
});

test('los comodines de LIKE escritos por la persona se buscan literalmente', () => {
  const { parametros } = construirConsulta({ entidad: 'citas', filtros: { servicio: '100%_' } });
  assert.deepEqual(parametros, ['%100\\%\\_%']);
});

test('los estados se aceptan en español o con su código interno', () => {
  const { sql, parametros } = construirConsulta({ entidad: 'citas', filtros: { estado: ['Confirmada', 'cancelled'] } });
  assert.match(sql, /a\.status = ANY\(\$1\)/);
  assert.deepEqual(parametros, [['CONFIRMED', 'CANCELLED']]);
  assert.throws(() => construirConsulta({ entidad: 'citas', filtros: { estado: 'Perdida' } }), /Valor no válido/);
});

test('agrupar suma las columnas numéricas pedidas y cuenta registros', () => {
  const { sql, salida } = construirConsulta({ entidad: 'facturas', columnas: ['servicio', 'total', 'cliente'], agrupar_por: 'servicio' });
  assert.match(sql, /count\(\*\) AS "cantidad", sum\(f\.total_amount\) AS "total"/);
  assert.match(sql, /GROUP BY 1/);
  assert.deepEqual(salida.map((c) => c.clave), ['servicio', 'cantidad', 'total']);
  assert.throws(() => construirConsulta({ entidad: 'facturas', agrupar_por: 'total' }), /No se puede agrupar/);
});

test('el reporte en Excel trae encabezados, filas traducidas y totales', async () => {
  const db = baseFalsa(CITAS);
  const reporte = await generarReporte(db, { entidad: 'citas', columnas: ['fecha', 'servicio', 'estado', 'precio'], formato: 'excel' }, new Date('2026-11-09T12:00:00Z'));

  assert.equal(db.consultas[0].base, 'gestion');
  assert.equal(reporte.totalFilas, 2);
  assert.deepEqual(reporte.totales, { precio: 165 });
  assert.equal(reporte.vistaPrevia[0].estado, 'Confirmada');
  assert.equal(reporte.archivo.nombre, 'reporte_de_citas.xlsx');

  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(reporte.archivo.base64, 'base64'));
  const hoja = libro.worksheets[0];
  assert.deepEqual(hoja.getRow(4).values.slice(1), ['Fecha', 'Servicio', 'Estado', 'Precio']);
  assert.deepEqual(hoja.getRow(5).values.slice(1), ['2026-11-09', 'Balayage', 'Confirmada', 120]);
  assert.equal(hoja.getRow(7).getCell(4).value, 165);
});

test('el reporte en PDF es un PDF válido', async () => {
  const reporte = await generarReporte(baseFalsa(CITAS), { entidad: 'citas', formato: 'pdf', titulo: 'Citas de noviembre' });
  const contenido = Buffer.from(reporte.archivo.base64, 'base64');
  assert.equal(contenido.subarray(0, 5).toString(), '%PDF-');
  assert.equal(reporte.archivo.tipoMime, 'application/pdf');
  assert.equal(reporte.archivo.nombre, 'citas_de_noviembre.pdf');
});

test('un reporte enorme se corta en el máximo y lo avisa', async () => {
  const muchas = Array.from({ length: MAX_FILAS + 1 }, (_, i) => ({ codigo: `C${i}`, stock: 1 }));
  const reporte = await generarReporte(baseFalsa(muchas), { entidad: 'inventario', columnas: ['codigo', 'stock'] });
  assert.equal(reporte.totalFilas, MAX_FILAS);
  assert.equal(reporte.truncado, true);
  assert.equal(reporte.vistaPrevia.length, 50);
});

test('un formato desconocido se rechaza antes de consultar la base', async () => {
  const db = baseFalsa();
  await assert.rejects(generarReporte(db, { entidad: 'citas', formato: 'docx' }), /Formato no válido/);
  assert.equal(db.consultas.length, 0);
});

test('el agente de reportes entrega el archivo a la pantalla y al modelo solo los totales', async () => {
  const FACTURAS = [{ cliente: 'Camila Fernandez', total: '120.00' }];
  const recibido = [];
  const modelo = async (entrada) => {
    recibido.push(JSON.parse(JSON.stringify(entrada)));
    return recibido.length === 1
      ? { engine: 'Prueba', content: { role: 'model', parts: [{ functionCall: { name: 'generar_reporte', args: { entidad: 'facturas', columnas: ['cliente', 'total'], formato: 'pdf' } } }] } }
      : { engine: 'Prueba', content: { role: 'model', parts: [{ text: 'Listo: 1 factura por $120.' }] } };
  };
  const ejecutar = createToolRunner({ backends: {}, callModel: modelo, generateText: async () => null, roles: ['ADMIN'], reportDatabases: baseFalsa(FACTURAS) });

  const respuesta = await ejecutar('preguntar_al_agente', { prompt: 'facturas en pdf', agente: 'reportes' });

  assert.equal(respuesta.reports.length, 1);
  assert.ok(respuesta.reports[0].archivo.base64.length > 0);
  // Ni el nombre del cliente ni el archivo llegaron al modelo
  const loQueVioElModelo = JSON.stringify(recibido[1]);
  assert.ok(!loQueVioElModelo.includes('Camila'));
  assert.ok(!loQueVioElModelo.includes(respuesta.reports[0].archivo.base64.slice(0, 40)));
  assert.match(loQueVioElModelo, /"totalFilas":1/);
});

test('un estilista no puede usar el agente de reportes', async () => {
  const ejecutar = createToolRunner({ backends: {}, callModel: async () => null, generateText: async () => null, roles: ['STYLIST'], reportDatabases: baseFalsa() });
  await assert.rejects(ejecutar('preguntar_al_agente', { prompt: 'x', agente: 'reportes' }), /No tiene permiso/);
});
