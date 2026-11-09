/**
 * Reportes dinámicos (CU-18, RF-11). El Servidor MCP consulta PostgreSQL con un usuario de solo
 * lectura: el agente nunca ve la base, solo pide un reporte por esta herramienta (RNF-02).
 *
 * Quien pide elige la entidad, las columnas, los filtros, una agrupación opcional y el formato
 * (Excel o PDF). Todo sale de un catálogo cerrado: los nombres de tablas y columnas del SQL
 * vienen de aquí y los valores del usuario viajan siempre como parámetros, nunca como texto.
 */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Pool } = require('pg');
const { BackendError } = require('./backends');

const MAX_FILAS = 5000;
const FILAS_VISTA_PREVIA = 50;
const TIEMPO_MAXIMO_MS = 10000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATOS = { excel: 'xlsx', pdf: 'pdf' };
const TIPOS_MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

const ESTADOS_CITA = {
  PENDING_PAYMENT: 'Pendiente de pago', SCHEDULED: 'Agendada', CONFIRMED: 'Confirmada', COMPLETED: 'Atendida',
  CANCELLED: 'Cancelada', RESCHEDULED: 'Reprogramada', NO_SHOW: 'No asistió',
};
const ESTADOS_FACTURA = { ISSUED: 'Emitida', PAID: 'Pagada', CANCELLED: 'Anulada', REFUNDED: 'Reembolsada' };
// Los mismos nombres que usa el CRM (Invoice::PAYMENT_METHODS)
const METODOS_PAGO = { CARD: 'Tarjeta en línea', CASH: 'Efectivo en el mostrador', CARD_TERMINAL: 'Tarjeta en el mostrador' };
const TIPOS_PUNTOS = { ACCUMULATION: 'Acumulación', REDEMPTION: 'Canje' };

/**
 * Catálogo. Cada columna tiene su expresión SQL fija; tipo: texto, numero o dinero.
 * "valores" traduce códigos internos a español, en la salida y en los filtros.
 */
const ENTIDADES = {
  citas: {
    base: 'gestion',
    titulo: 'Citas',
    origen: 'FROM appointments a LEFT JOIN stylists s ON s.id = a.stylist_id',
    fecha: 'a.appointment_date',
    orden: 'a.appointment_date',
    columnas: {
      fecha: { etiqueta: 'Fecha', sql: "to_char(a.appointment_date, 'YYYY-MM-DD')" },
      hora: { etiqueta: 'Hora', sql: "to_char(a.appointment_date, 'HH24:MI')" },
      servicio: { etiqueta: 'Servicio', sql: 'a.service_name' },
      estilista: { etiqueta: 'Estilista', sql: "coalesce(s.name, 'Sin asignar')" },
      estado: { etiqueta: 'Estado', sql: 'a.status', valores: ESTADOS_CITA },
      duracion_min: { etiqueta: 'Duración (min)', sql: 'a.duration_minutes', tipo: 'numero' },
      precio: { etiqueta: 'Precio', sql: 'a.total_price', tipo: 'dinero' },
    },
    filtros: {
      estilista: { sql: 's.name', modo: 'contiene' },
      servicio: { sql: 'a.service_name', modo: 'contiene' },
      estado: { sql: 'a.status', modo: 'igual', valores: ESTADOS_CITA },
    },
  },
  facturas: {
    base: 'crm',
    titulo: 'Facturas',
    origen: 'FROM invoices f',
    fecha: 'f.issued_at',
    orden: 'f.issued_at',
    columnas: {
      numero: { etiqueta: 'N.º', sql: 'f.invoice_number', tipo: 'numero' },
      fecha: { etiqueta: 'Fecha', sql: "to_char(f.issued_at, 'YYYY-MM-DD')" },
      cliente: { etiqueta: 'Cliente', sql: 'f.client_name' },
      servicio: { etiqueta: 'Servicio', sql: "coalesce(f.service_name, '')" },
      metodo_pago: { etiqueta: 'Método de pago', sql: 'f.payment_method', valores: METODOS_PAGO },
      estado: { etiqueta: 'Estado', sql: 'f.status', valores: ESTADOS_FACTURA },
      subtotal: { etiqueta: 'Subtotal', sql: 'coalesce(f.subtotal_amount, f.total_amount)', tipo: 'dinero' },
      descuento: { etiqueta: 'Descuento', sql: 'f.discount_amount', tipo: 'dinero' },
      impuesto: { etiqueta: 'Impuesto', sql: 'f.tax_amount', tipo: 'dinero' },
      total: { etiqueta: 'Total', sql: 'f.total_amount', tipo: 'dinero' },
    },
    filtros: {
      cliente: { sql: 'f.client_name', modo: 'contiene' },
      servicio: { sql: 'f.service_name', modo: 'contiene' },
      estado: { sql: 'f.status', modo: 'igual', valores: ESTADOS_FACTURA },
      metodo_pago: { sql: 'f.payment_method', modo: 'igual', valores: METODOS_PAGO },
    },
  },
  inventario: {
    base: 'gestion',
    titulo: 'Inventario',
    origen: 'FROM inventory_items i',
    fecha: null,
    orden: 'i.category, i.name',
    columnas: {
      codigo: { etiqueta: 'Código', sql: 'i.code' },
      insumo: { etiqueta: 'Insumo', sql: 'i.name' },
      categoria: { etiqueta: 'Categoría', sql: 'i.category' },
      stock: { etiqueta: 'Stock', sql: 'i.current_stock', tipo: 'numero' },
      reservado: { etiqueta: 'Reservado', sql: 'i.reserved_stock', tipo: 'numero' },
      minimo: { etiqueta: 'Mínimo', sql: 'i.minimum_stock', tipo: 'numero' },
      faltante: { etiqueta: 'Faltante', sql: 'greatest(i.minimum_stock - i.current_stock, 0)', tipo: 'numero' },
      precio_unitario: { etiqueta: 'Precio unitario', sql: 'i.unit_price', tipo: 'dinero' },
      valor_stock: { etiqueta: 'Valor en stock', sql: 'i.current_stock * i.unit_price', tipo: 'dinero' },
      critico: { etiqueta: 'Crítico', sql: "CASE WHEN i.is_critical_stock THEN 'Sí' ELSE 'No' END" },
    },
    filtros: {
      categoria: { sql: 'i.category', modo: 'contiene' },
      insumo: { sql: 'i.name', modo: 'contiene' },
      solo_criticos: { sql: 'i.is_critical_stock', modo: 'verdadero' },
    },
  },
  movimientos_inventario: {
    base: 'gestion',
    titulo: 'Movimientos de inventario',
    origen: 'FROM inventory_logs l JOIN inventory_items i ON i.id = l.item_id',
    fecha: 'l.created_at',
    orden: 'l.created_at',
    columnas: {
      fecha: { etiqueta: 'Fecha', sql: "to_char(l.created_at, 'YYYY-MM-DD HH24:MI')" },
      insumo: { etiqueta: 'Insumo', sql: 'i.name' },
      categoria: { etiqueta: 'Categoría', sql: 'i.category' },
      cambio: { etiqueta: 'Cambio', sql: 'l.quantity_change', tipo: 'numero' },
      stock_anterior: { etiqueta: 'Stock anterior', sql: 'l.previous_stock', tipo: 'numero' },
      stock_nuevo: { etiqueta: 'Stock nuevo', sql: 'l.new_stock', tipo: 'numero' },
      motivo: { etiqueta: 'Motivo', sql: 'l.reason' },
    },
    filtros: {
      insumo: { sql: 'i.name', modo: 'contiene' },
      categoria: { sql: 'i.category', modo: 'contiene' },
      motivo: { sql: 'l.reason', modo: 'contiene' },
    },
  },
  puntos: {
    base: 'crm',
    titulo: 'Movimientos de puntos',
    origen: 'FROM loyalty_transactions t JOIN crm_clients c ON c.id = t.client_id',
    fecha: 't.created_at',
    orden: 't.created_at',
    columnas: {
      fecha: { etiqueta: 'Fecha', sql: "to_char(t.created_at, 'YYYY-MM-DD')" },
      cliente: { etiqueta: 'Cliente', sql: 'c.full_name' },
      tipo: { etiqueta: 'Tipo', sql: 't.type', valores: TIPOS_PUNTOS },
      puntos: { etiqueta: 'Puntos', sql: 't.points', tipo: 'numero' },
      descripcion: { etiqueta: 'Descripción', sql: 't.description' },
    },
    filtros: {
      cliente: { sql: 'c.full_name', modo: 'contiene' },
      tipo: { sql: 't.type', modo: 'igual', valores: TIPOS_PUNTOS },
    },
  },
  clientes: {
    base: 'crm',
    titulo: 'Clientes',
    origen: 'FROM crm_clients c',
    fecha: 'c.created_at',
    orden: 'c.full_name',
    columnas: {
      cliente: { etiqueta: 'Cliente', sql: 'c.full_name' },
      email: { etiqueta: 'Correo', sql: 'c.email' },
      telefono: { etiqueta: 'Teléfono', sql: 'c.phone' },
      puntos: { etiqueta: 'Puntos', sql: 'c.loyalty_points', tipo: 'numero' },
      registrado: { etiqueta: 'Registrado', sql: "to_char(c.created_at, 'YYYY-MM-DD')" },
      facturas: { etiqueta: 'Facturas', sql: '(SELECT count(*) FROM invoices f WHERE f.client_id = c.id)', tipo: 'numero' },
      total_gastado: { etiqueta: 'Total gastado', sql: "(SELECT coalesce(sum(f.total_amount), 0) FROM invoices f WHERE f.client_id = c.id AND f.status <> 'REFUNDED')", tipo: 'dinero' },
    },
    filtros: {
      cliente: { sql: 'c.full_name', modo: 'contiene' },
    },
  },
};

const esNumerica = (columna) => columna.tipo === 'numero' || columna.tipo === 'dinero';

/** Lo que se puede pedir, para el formulario del ERP y para el modelo. */
function catalogo() {
  return {
    formatos: Object.keys(FORMATOS),
    entidades: Object.entries(ENTIDADES).map(([clave, entidad]) => ({
      clave,
      titulo: entidad.titulo,
      filtraPorFecha: Boolean(entidad.fecha),
      columnas: Object.entries(entidad.columnas).map(([c, col]) => ({ clave: c, etiqueta: col.etiqueta, tipo: col.tipo ?? 'texto' })),
      filtros: Object.entries(entidad.filtros).map(([f, filtro]) => ({
        clave: f, modo: filtro.modo, ...(filtro.valores ? { valores: Object.values(filtro.valores) } : {}),
      })),
    })),
  };
}

/** Acepta un código interno o su nombre en español, sin distinguir mayúsculas. */
function codigoDe(valores, texto) {
  const buscado = String(texto).trim().toLowerCase();
  const encontrado = Object.entries(valores).find(([codigo, nombre]) => codigo.toLowerCase() === buscado || nombre.toLowerCase() === buscado);
  if (!encontrado) throw new BackendError(`Valor no válido: '${texto}'. Use uno de: ${Object.values(valores).join(', ')}.`);
  return encontrado[0];
}

/**
 * Valida la petición contra el catálogo y arma la consulta. Solo se interpolan expresiones del
 * catálogo; todo lo que escribió la persona va en "parametros".
 */
function construirConsulta({ entidad, columnas, filtros = {}, desde, hasta, agrupar_por: agruparPor }) {
  const definicion = ENTIDADES[entidad];
  if (!definicion) throw new BackendError(`Entidad no válida: use ${Object.keys(ENTIDADES).join(', ')}.`);

  const claves = Array.isArray(columnas) && columnas.length ? [...new Set(columnas)] : Object.keys(definicion.columnas);
  const desconocidas = claves.filter((clave) => !definicion.columnas[clave]);
  if (desconocidas.length) {
    throw new BackendError(`Columnas no válidas para ${entidad}: ${desconocidas.join(', ')}. Use: ${Object.keys(definicion.columnas).join(', ')}.`);
  }

  const parametros = [];
  const condiciones = [];
  const aplicados = [];
  const parametro = (valor) => { parametros.push(valor); return `$${parametros.length}`; };

  for (const [nombre, valor] of [['desde', desde], ['hasta', hasta]]) {
    if (valor === undefined || valor === null || valor === '') continue;
    if (!definicion.fecha) throw new BackendError(`El reporte de ${entidad} no se filtra por fecha.`);
    if (!FECHA.test(valor)) throw new BackendError(`La fecha '${nombre}' debe tener el formato AAAA-MM-DD.`);
    // "hasta" incluye el día completo
    condiciones.push(nombre === 'desde' ? `${definicion.fecha} >= ${parametro(valor)}::date` : `${definicion.fecha} < ${parametro(valor)}::date + 1`);
    aplicados.push(`${nombre} ${valor}`);
  }

  for (const [clave, valor] of Object.entries(filtros ?? {})) {
    if (valor === undefined || valor === null || valor === '') continue;
    const filtro = definicion.filtros[clave];
    if (!filtro) throw new BackendError(`Filtro no válido para ${entidad}: ${clave}. Use: ${Object.keys(definicion.filtros).join(', ')}.`);
    if (filtro.modo === 'contiene') {
      condiciones.push(`${filtro.sql} ILIKE ${parametro(`%${String(valor).replace(/[%_\\]/g, '\\$&')}%`)}`);
      aplicados.push(`${clave} contiene "${valor}"`);
    } else if (filtro.modo === 'igual') {
      const lista = (Array.isArray(valor) ? valor : [valor]).map((v) => codigoDe(filtro.valores, v));
      condiciones.push(`${filtro.sql} = ANY(${parametro(lista)})`);
      aplicados.push(`${clave}: ${lista.map((codigo) => filtro.valores[codigo]).join(', ')}`);
    } else if (filtro.modo === 'verdadero' && (valor === true || valor === 'true')) {
      condiciones.push(filtro.sql);
      aplicados.push(clave.replace(/_/g, ' '));
    }
  }

  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  if (agruparPor) {
    const grupo = definicion.columnas[agruparPor];
    if (!grupo || esNumerica(grupo)) {
      const opciones = Object.entries(definicion.columnas).filter(([, c]) => !esNumerica(c)).map(([clave]) => clave);
      throw new BackendError(`No se puede agrupar por '${agruparPor}'. Use: ${opciones.join(', ')}.`);
    }
    // Agrupado: la columna elegida, la cantidad de registros y la suma de cada columna numérica pedida
    const sumas = claves.filter((clave) => clave !== agruparPor && esNumerica(definicion.columnas[clave]));
    const salida = [
      { clave: agruparPor, ...grupo },
      { clave: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero' },
      ...sumas.map((clave) => ({ clave, ...definicion.columnas[clave], etiqueta: `${definicion.columnas[clave].etiqueta} (suma)` })),
    ];
    const select = [`${grupo.sql} AS "${agruparPor}"`, 'count(*) AS "cantidad"', ...sumas.map((clave) => `sum(${definicion.columnas[clave].sql}) AS "${clave}"`)];
    return {
      definicion, salida, parametros, aplicados,
      sql: `SELECT ${select.join(', ')} ${definicion.origen} ${donde} GROUP BY 1 ORDER BY 1 LIMIT ${MAX_FILAS + 1}`,
    };
  }

  const salida = claves.map((clave) => ({ clave, ...definicion.columnas[clave] }));
  const select = salida.map((columna) => `${columna.sql} AS "${columna.clave}"`);
  return {
    definicion, salida, parametros, aplicados,
    sql: `SELECT ${select.join(', ')} ${definicion.origen} ${donde} ORDER BY ${definicion.orden} LIMIT ${MAX_FILAS + 1}`,
  };
}

/** Convierte cada fila: números de PostgreSQL a número y códigos a su nombre en español. */
function normalizar(filas, salida) {
  return filas.map((fila) => Object.fromEntries(salida.map((columna) => {
    let valor = fila[columna.clave];
    if (esNumerica(columna) && valor !== null && valor !== undefined) valor = Number(valor);
    if (columna.valores && valor in columna.valores) valor = columna.valores[valor];
    return [columna.clave, valor ?? ''];
  })));
}

function totalesDe(filas, salida) {
  return Object.fromEntries(salida.filter(esNumerica).filter((c) => c.clave !== 'numero').map((columna) => [
    columna.clave, Math.round(filas.reduce((suma, fila) => suma + (Number(fila[columna.clave]) || 0), 0) * 100) / 100,
  ]));
}

const textoDe = (valor, columna) => (columna.tipo === 'dinero' && valor !== '' ? `$${Number(valor).toFixed(2)}` : String(valor));

async function generarExcel({ titulo, subtitulo, salida, filas, totales }) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Salón & IA Studio';
  const hoja = libro.addWorksheet(titulo.slice(0, 31));
  hoja.addRow([titulo]).font = { bold: true, size: 14, color: { argb: 'FF9E6066' } };
  hoja.addRow([subtitulo]).font = { italic: true, color: { argb: 'FF7D6A65' } };
  hoja.addRow([]);
  const encabezado = hoja.addRow(salida.map((c) => c.etiqueta));
  encabezado.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9E6066' } };
  });
  for (const fila of filas) hoja.addRow(salida.map((c) => fila[c.clave]));
  if (Object.keys(totales).length) {
    const total = hoja.addRow(salida.map((c, i) => (c.clave in totales ? totales[c.clave] : i === 0 ? 'Total' : '')));
    total.font = { bold: true };
  }
  salida.forEach((columna, i) => {
    const ancho = Math.max(columna.etiqueta.length, ...filas.slice(0, 200).map((f) => textoDe(f[columna.clave], columna).length));
    hoja.getColumn(i + 1).width = Math.min(Math.max(ancho + 2, 10), 45);
    if (columna.tipo === 'dinero') hoja.getColumn(i + 1).numFmt = '"$"#,##0.00';
  });
  hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: salida.length } };
  hoja.views = [{ state: 'frozen', ySplit: 4 }];
  return Buffer.from(await libro.xlsx.writeBuffer());
}

function generarPdf({ titulo, subtitulo, salida, filas, totales }) {
  return new Promise((resolve, reject) => {
    const documento = new PDFDocument({ size: 'A4', layout: salida.length > 5 ? 'landscape' : 'portrait', margin: 36, bufferPages: true });
    const partes = [];
    documento.on('data', (parte) => partes.push(parte));
    documento.on('end', () => resolve(Buffer.concat(partes)));
    documento.on('error', reject);

    const izquierda = documento.page.margins.left;
    const anchoUtil = documento.page.width - izquierda - documento.page.margins.right;
    // Ancho de cada columna según su contenido, sin bajar de un mínimo legible
    const pesos = salida.map((c) => Math.min(Math.max(c.etiqueta.length, ...filas.slice(0, 100).map((f) => textoDe(f[c.clave], c).length), 6), 40));
    const suma = pesos.reduce((a, b) => a + b, 0);
    const anchos = pesos.map((p) => (p / suma) * anchoUtil);
    const ALTO = 18;

    documento.fillColor('#9E6066').font('Helvetica-Bold').fontSize(16).text(titulo);
    documento.fillColor('#7D6A65').font('Helvetica').fontSize(9).text(subtitulo).moveDown(0.8);

    const fila = (valores, { negrita = false, fondo = null, color = '#3D2F2D' } = {}) => {
      if (documento.y + ALTO > documento.page.height - documento.page.margins.bottom - 14) {
        documento.addPage();
        encabezado();
      }
      const y = documento.y;
      if (fondo) documento.rect(izquierda, y, anchoUtil, ALTO).fill(fondo);
      let x = izquierda;
      valores.forEach((valor, i) => {
        documento.fillColor(color).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
          .text(valor, x + 3, y + 5, { width: anchos[i] - 6, height: ALTO - 6, ellipsis: true, lineBreak: false, align: esNumerica(salida[i]) ? 'right' : 'left' });
        x += anchos[i];
      });
      documento.x = izquierda;
      documento.y = y + ALTO;
    };
    const encabezado = () => fila(salida.map((c) => c.etiqueta), { negrita: true, fondo: '#9E6066', color: '#FFFFFF' });

    encabezado();
    filas.forEach((datos, i) => fila(salida.map((c) => textoDe(datos[c.clave], c)), { fondo: i % 2 ? '#F7E7E4' : null }));
    if (Object.keys(totales).length) {
      fila(salida.map((c, i) => (c.clave in totales ? textoDe(totales[c.clave], c) : i === 0 ? 'Total' : '')), { negrita: true, fondo: '#F3EADF' });
    }

    const paginas = documento.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      documento.switchToPage(i);
      documento.fillColor('#8E7A75').fontSize(7).text(`Salón & IA Studio · página ${i + 1} de ${paginas.count}`,
        izquierda, documento.page.height - documento.page.margins.bottom + 6, { width: anchoUtil, align: 'center', lineBreak: false });
    }
    documento.end();
  });
}

/**
 * Conexiones de solo lectura, una por base. En la nube cada una apunta a su servidor
 * (RDS y Azure); el usuario salon_reportes solo tiene SELECT sobre las tablas del catálogo.
 */
function createReportDatabases({ gestionUrl = process.env.REPORTES_GESTION_DB_URL, crmUrl = process.env.REPORTES_CRM_DB_URL } = {}) {
  const pools = {};
  const urls = { gestion: gestionUrl, crm: crmUrl };
  return {
    async query(base, sql, parametros) {
      if (!urls[base]) throw new BackendError('Los reportes no están configurados en este servidor.');
      pools[base] ??= new Pool({ connectionString: urls[base], max: 3, connectionTimeoutMillis: 5000 });
      const cliente = await pools[base].connect();
      try {
        // Segunda barrera además del usuario de solo lectura: la transacción tampoco puede escribir
        await cliente.query('BEGIN READ ONLY');
        await cliente.query(`SET LOCAL statement_timeout = ${TIEMPO_MAXIMO_MS}`);
        const resultado = await cliente.query(sql, parametros);
        await cliente.query('COMMIT');
        return resultado.rows;
      } catch (error) {
        await cliente.query('ROLLBACK').catch(() => {});
        console.error(`[MCP] Reporte fallido en ${base}: ${error.message}`);
        throw new BackendError('No se pudo consultar la base de datos del reporte.');
      } finally {
        cliente.release();
      }
    },
  };
}

/** Ejecuta el reporte y arma el archivo. Devuelve también una vista previa para la pantalla. */
async function generarReporte(databases, peticion, ahora = new Date()) {
  const formato = String(peticion.formato ?? 'excel').toLowerCase();
  const extension = FORMATOS[formato];
  if (!extension) throw new BackendError('Formato no válido: use excel o pdf.');

  const consulta = construirConsulta(peticion);
  const crudas = await databases.query(consulta.definicion.base, consulta.sql, consulta.parametros);
  const truncado = crudas.length > MAX_FILAS;
  const filas = normalizar(crudas.slice(0, MAX_FILAS), consulta.salida);
  const totales = totalesDe(filas, consulta.salida);

  const titulo = peticion.titulo?.trim()?.slice(0, 80) || `Reporte de ${consulta.definicion.titulo.toLowerCase()}`;
  const generado = ahora.toISOString().slice(0, 16).replace('T', ' ');
  const subtitulo = [
    `Generado el ${generado} UTC`,
    `${filas.length} registros${truncado ? ` (limitado a ${MAX_FILAS})` : ''}`,
    consulta.aplicados.length ? `Filtros: ${consulta.aplicados.join('; ')}` : 'Sin filtros',
    peticion.agrupar_por ? `Agrupado por ${consulta.salida[0].etiqueta.toLowerCase()}` : null,
  ].filter(Boolean).join(' · ');

  const datos = { titulo, subtitulo, salida: consulta.salida, filas, totales };
  const contenido = extension === 'xlsx' ? await generarExcel(datos) : await generarPdf(datos);
  const nombre = `${titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase()}.${extension}`;

  return {
    titulo,
    entidad: peticion.entidad,
    formato,
    columnas: consulta.salida.map(({ clave, etiqueta, tipo }) => ({ clave, etiqueta, tipo: tipo ?? 'texto' })),
    filtrosAplicados: consulta.aplicados,
    agrupadoPor: peticion.agrupar_por ?? null,
    totalFilas: filas.length,
    truncado,
    totales,
    vistaPrevia: filas.slice(0, FILAS_VISTA_PREVIA),
    archivo: { nombre, tipoMime: TIPOS_MIME[extension], bytes: contenido.length, base64: contenido.toString('base64') },
  };
}

/** Lo que ve el modelo de un reporte: sin filas ni archivo, para que ningún dato de clientes salga hacia él. */
function resumenParaModelo(reporte) {
  const { titulo, entidad, formato, columnas, filtrosAplicados, agrupadoPor, totalFilas, truncado, totales } = reporte;
  return { titulo, entidad, formato, columnas: columnas.map((c) => c.etiqueta), filtrosAplicados, agrupadoPor, totalFilas, truncado, totales, archivo: 'listo para descargar en la pantalla' };
}

module.exports = { ENTIDADES, MAX_FILAS, catalogo, construirConsulta, createReportDatabases, generarReporte, resumenParaModelo };
