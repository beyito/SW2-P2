/**
 * Herramientas MCP del salón (CU-05, CU-17, CU-18, RF-03, RF-11). Todos sus datos salen de los
 * microservicios; si un servicio falla se informa el error en lugar de inventar una respuesta.
 */
const { BackendError } = require('./backends');

const DEFAULT_TIMEZONE = 'America/La_Paz';
const PERIOD_DAYS = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 };
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PERIOD = 'WEEKLY';

// Roles autorizados por herramienta (RNF-02)
const TOOL_ROLES = {
  listar_estilistas: ['ADMIN', 'STYLIST', 'CLIENT'],
  consultar_disponibilidad_estilista: ['ADMIN', 'STYLIST', 'CLIENT'],
  consultar_stock_critico: ['ADMIN', 'STYLIST'],
  obtener_metricas_negocio: ['ADMIN'],
  generar_reporte_lenguaje_natural: ['ADMIN'],
};

const TOOLS = [
  {
    name: 'listar_estilistas',
    description: 'Lista los estilistas que reciben reservas, con su especialidad y calificación.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_disponibilidad_estilista',
    description: 'Consulta los turnos libres de un estilista en una fecha (CU-05).',
    inputSchema: {
      type: 'object',
      properties: {
        stylistId: { type: 'string', description: 'ID del estilista; se obtiene con listar_estilistas.' },
        date: { type: 'string', description: 'Fecha en formato AAAA-MM-DD.' },
        serviceId: { type: 'string', description: 'Servicio a reservar; si se omite se usa el de menor duración.' },
      },
      required: ['stylistId', 'date'],
    },
  },
  {
    name: 'consultar_stock_critico',
    description: 'Lista los insumos cosméticos en su nivel mínimo o por debajo (RF-03, CU-09).',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filtro opcional por categoría, por ejemplo COLORACION.' },
      },
    },
  },
  {
    name: 'obtener_metricas_negocio',
    description: 'Obtiene citas, ocupación, ingresos cobrados, reembolsos y fidelización de un periodo que termina hoy (CU-17).',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: Object.keys(PERIOD_DAYS), default: DEFAULT_PERIOD },
      },
    },
  },
  {
    name: 'generar_reporte_lenguaje_natural',
    description: 'Responde en lenguaje natural una pregunta sobre la operación del salón, usando sus datos reales (CU-18).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Pregunta o instrucción en lenguaje natural.' },
      },
      required: ['prompt'],
    },
  },
];

function canUseTool(toolName, roles) {
  return (TOOL_ROLES[toolName] || []).some((role) => roles.includes(role));
}

function toolsFor(roles) {
  return TOOLS.filter((tool) => canUseTool(tool.name, roles));
}

/** Fecha AAAA-MM-DD en la zona horaria del salón. */
function localDate(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Periodo de N días que termina hoy, ambos extremos incluidos. */
function periodRange(period, now, timeZone) {
  const days = PERIOD_DAYS[period];
  if (!days) throw new BackendError(`Periodo no válido: use ${Object.keys(PERIOD_DAYS).join(', ')}.`);
  const to = localDate(now, timeZone);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to };
}

const formatMoney = (value) => `$${Number(value).toFixed(2)}`;
const formatPercent = (rate) => `${(Number(rate) * 100).toFixed(1)}%`;

/** Informe armado solo con datos reales, para cuando no hay modelo de lenguaje disponible. */
function buildPlainReport({ metrics, criticalStock }) {
  const { appointments: a, billing: b, range } = metrics;
  const stock = criticalStock.items.length
    ? criticalStock.items.map((item) => `${item.name} (${item.currentStock} de mínimo ${item.minimumStock})`).join('; ')
    : 'ninguno';
  return [
    `Resumen del ${range.from} al ${range.to}:`,
    `- Citas: ${a.totalAppointments} en total, ${a.active} activas, ${a.completed} completadas, ${a.cancelled} canceladas. Ocupación: ${formatPercent(a.occupancyRate)}.`,
    `- Ingresos cobrados: ${formatMoney(b.revenue)} con ${b.invoicesIssued} facturas; reembolsado: ${formatMoney(b.refunded)}.`,
    `- Puntos: ${b.pointsEarned} ganados y ${b.pointsRedeemed} canjeados.`,
    `- Insumos en nivel crítico: ${stock}.`,
  ].join('\n');
}

/** Crea el ejecutor de herramientas para los datos de una petición autenticada. */
function createToolRunner({ backends, generateText, now = () => new Date(), timeZone = process.env.SALON_TIMEZONE || DEFAULT_TIMEZONE }) {
  const handlers = {
    listar_estilistas: async () => ({ stylists: await backends.stylists() }),

    consultar_disponibilidad_estilista: async ({ stylistId, date, serviceId }) => {
      if (!stylistId || !DATE_FORMAT.test(date ?? '')) {
        throw new BackendError('Indique stylistId y una fecha con formato AAAA-MM-DD.');
      }
      const service = serviceId ?? [...(await backends.services())].sort((a, b) => a.durationMinutes - b.durationMinutes)[0]?.id;
      if (!service) throw new BackendError('El salón no tiene servicios activos.');
      const slots = await backends.availableSlots(stylistId, service, date);
      return { stylistId, serviceId: service, date, availableSlots: slots, isFullyBooked: slots.length === 0 };
    },

    consultar_stock_critico: async ({ category }) => {
      const all = await backends.criticalStock();
      const items = category ? all.filter((item) => item.category === category) : all;
      return {
        criticalItemsCount: items.length,
        items: items.map((item) => ({ ...item, shortage: Math.max(item.minimumStock - item.currentStock, 0) })),
      };
    },

    obtener_metricas_negocio: async ({ period = DEFAULT_PERIOD }) => {
      const range = periodRange(period, now(), timeZone);
      const [appointments, billing] = await Promise.all([
        backends.panelSummary(range.from, range.to),
        backends.crmMetrics(range.from, range.to),
      ]);
      return { period, range, appointments, billing };
    },

    generar_reporte_lenguaje_natural: async ({ prompt }) => {
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new BackendError('Escriba la pregunta del reporte.');
      }
      // Solo cifras agregadas: ningún dato personal de clientes sale hacia el modelo
      const context = {
        metrics: await handlers.obtener_metricas_negocio({ period: 'MONTHLY' }),
        criticalStock: await handlers.consultar_stock_critico({}),
      };
      const generated = await generateText(prompt, context);
      return generated
        ? { query: prompt, engine: generated.engine, generatedReport: generated.text, data: context }
        : { query: prompt, engine: 'Resumen sin modelo de lenguaje', generatedReport: buildPlainReport(context), data: context };
    },
  };

  return (toolName, args) => handlers[toolName](args ?? {});
}

module.exports = { TOOLS, canUseTool, toolsFor, createToolRunner, periodRange };
