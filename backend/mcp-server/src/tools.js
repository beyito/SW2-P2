/**
 * Herramientas MCP del salón (CU-05, CU-17, CU-18, RF-03, RF-11). Todos sus datos salen de los
 * microservicios; si un servicio falla se informa el error en lugar de inventar una respuesta.
 */
const { runAgent } = require('./agent');
const { BackendError } = require('./backends');
const { loadSkills } = require('./skills');
const { ENTIDADES, catalogo, generarReporte, resumenParaModelo } = require('./reports');

const DEFAULT_TIMEZONE = 'America/La_Paz';
const PERIOD_DAYS = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 };
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PERIOD = 'WEEKLY';
const DATE_TIME_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const MAX_RESTOCK_UNITS = 1000;
const MAX_REASON_CHARS = 200;
const MAX_AGENDA_DAYS = 31;
const DAY_MS = 86400000;
// Una cita ya atendida, cancelada o sin pagar no se mueve desde un agente
const MOVABLE_STATUSES = new Set(['CONFIRMED']);
const RESTOCK = 'REPOSICION';
const RESCHEDULE = 'REPROGRAMACION';
const DEFAULT_AGENT = 'operacion';

// Roles autorizados por herramienta (RNF-02)
const TOOL_ROLES = {
  listar_estilistas: ['ADMIN', 'STYLIST', 'CLIENT'],
  consultar_disponibilidad_estilista: ['ADMIN', 'STYLIST', 'CLIENT'],
  consultar_stock_critico: ['ADMIN', 'STYLIST'],
  obtener_metricas_negocio: ['ADMIN'],
  generar_reporte_lenguaje_natural: ['ADMIN'],
  preguntar_al_agente: ['ADMIN', 'STYLIST'],
  consultar_inventario: ['ADMIN', 'STYLIST'],
  consultar_agenda: ['ADMIN', 'STYLIST'],
  proponer_reposicion: ['ADMIN'],
  proponer_reprogramacion: ['ADMIN', 'STYLIST'],
  confirmar_accion: ['ADMIN', 'STYLIST'],
  rechazar_accion: ['ADMIN', 'STYLIST'],
  // Los reportes incluyen datos de clientes y facturación: solo la administración
  catalogo_reportes: ['ADMIN'],
  generar_reporte: ['ADMIN'],
};

const AGENT_TOOL = 'preguntar_al_agente';
// Decidir sobre una propuesta es de una persona: ninguna Skill puede dárselas al modelo
const HUMAN_ONLY_TOOLS = new Set(['confirmar_accion', 'rechazar_accion']);

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
  {
    name: AGENT_TOOL,
    description: 'Agente autónomo: decide qué herramientas de las permitidas por su Skill y por el usuario necesita (CU-17, RF-11).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Pregunta en lenguaje natural.' },
        agente: { type: 'string', enum: ['operacion', 'inventario', 'agenda', 'reportes'], description: 'Agente que responde; por defecto, operacion.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'consultar_inventario',
    description: 'Lista todos los insumos con su identificador, existencias y mínimo (CU-08).',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filtro opcional por categoría, por ejemplo COLORACION.' },
      },
    },
  },
  {
    name: 'consultar_agenda',
    description: 'Lista las citas de un rango de fechas, sin datos de clientes ni precios (CU-06).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Primer día, en formato AAAA-MM-DD.' },
        to: { type: 'string', description: 'Último día, en formato AAAA-MM-DD. Máximo 31 días después.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'proponer_reposicion',
    description: 'Prepara sumar unidades a un insumo. No cambia nada: una persona debe confirmarlo (RF-03).',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: 'ID del insumo; se obtiene de las consultas de inventario.' },
        quantity: { type: 'integer', description: 'Unidades a sumar, mayor que cero.' },
        reason: { type: 'string', description: 'Motivo breve que verá la persona.' },
      },
      required: ['itemId', 'quantity'],
    },
  },
  {
    name: 'proponer_reprogramacion',
    description: 'Prepara mover una cita a un turno libre. No cambia nada: una persona debe confirmarlo (CU-07).',
    inputSchema: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string', description: 'ID de la cita; se obtiene de consultar_agenda.' },
        newDate: { type: 'string', description: 'Inicio del turno libre, en formato AAAA-MM-DDTHH:MM:SS.' },
        reason: { type: 'string', description: 'Motivo breve que verá la persona.' },
      },
      required: ['appointmentId', 'newDate'],
    },
  },
  {
    name: 'catalogo_reportes',
    description: 'Lista las entidades, columnas, filtros y formatos que admite generar_reporte (CU-18).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'generar_reporte',
    description: `Genera un reporte en Excel o PDF con datos reales, consultados en la base con un usuario de solo lectura (CU-18). Columnas por entidad: ${
      Object.entries(ENTIDADES).map(([clave, entidad]) => `${clave} (${Object.keys(entidad.columnas).join(', ')})`).join('; ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        entidad: { type: 'string', enum: Object.keys(ENTIDADES), description: 'Qué se reporta.' },
        columnas: { type: 'array', items: { type: 'string' }, description: 'Columnas en el orden deseado; si se omite, todas.' },
        desde: { type: 'string', description: 'Primer día incluido, AAAA-MM-DD. No aplica a inventario.' },
        hasta: { type: 'string', description: 'Último día incluido, AAAA-MM-DD. No aplica a inventario.' },
        filtros: {
          type: 'object',
          description: 'Criterios de selección; solo los que correspondan a la entidad.',
          properties: {
            estilista: { type: 'string', description: 'citas: parte del nombre del estilista.' },
            servicio: { type: 'string', description: 'citas y facturas: parte del nombre del servicio.' },
            estado: { type: 'string', description: 'citas: Confirmada, Atendida, Cancelada, Reprogramada, Pendiente de pago, No asistió. facturas: Emitida, Pagada, Anulada, Reembolsada.' },
            cliente: { type: 'string', description: 'facturas, puntos y clientes: parte del nombre del cliente.' },
            metodo_pago: { type: 'string', description: 'facturas: Tarjeta en línea, Efectivo en el mostrador o Tarjeta en el mostrador.' },
            categoria: { type: 'string', description: 'inventario y movimientos: parte de la categoría, por ejemplo COLORACION.' },
            insumo: { type: 'string', description: 'inventario y movimientos: parte del nombre del insumo.' },
            motivo: { type: 'string', description: 'movimientos: parte del motivo.' },
            tipo: { type: 'string', description: 'puntos: Acumulación o Canje.' },
            solo_criticos: { type: 'boolean', description: 'inventario: solo insumos en nivel crítico.' },
          },
        },
        agrupar_por: { type: 'string', description: 'Columna de texto por la que agrupar; suma las columnas numéricas pedidas y cuenta registros.' },
        formato: { type: 'string', enum: ['excel', 'pdf'], description: 'Formato del archivo; por defecto, excel.' },
        titulo: { type: 'string', description: 'Título opcional del reporte.' },
      },
      required: ['entidad'],
    },
  },
  {
    name: 'confirmar_accion',
    description: 'Ejecuta una propuesta de un agente. Es la decisión de una persona: el modelo no puede usarla.',
    inputSchema: {
      type: 'object',
      properties: { actionId: { type: 'string', description: 'Identificador de la propuesta.' } },
      required: ['actionId'],
    },
  },
  {
    name: 'rechazar_accion',
    description: 'Descarta una propuesta de un agente sin ejecutarla. Es la decisión de una persona: el modelo no puede usarla.',
    inputSchema: {
      type: 'object',
      properties: { actionId: { type: 'string', description: 'Identificador de la propuesta.' } },
      required: ['actionId'],
    },
  },
];

// Se carga al arrancar: una Skill inválida debe impedir el inicio, no aparecer en una consulta
const SKILLS = loadSkills({ knownTools: new Set(TOOLS.map((tool) => tool.name)), humanOnlyTools: HUMAN_ONLY_TOOLS });

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

/** Herramientas que un agente puede usar con el rol de quien pregunta. */
function agentTools(skill, roles) {
  return TOOLS.filter((tool) => skill.tools.includes(tool.name) && canUseTool(tool.name, roles));
}

const shortText = (text) => (typeof text === 'string' ? text.trim().slice(0, MAX_REASON_CHARS) : '');
const minutesOf = (dateTime) => String(dateTime).slice(0, 16);

/** Sin modelo disponible, se informa lo que el rol puede ver con datos reales, sin intentar interpretar la pregunta. */
async function plainSummaryFor(agent, roles, handlers, today) {
  if (agent === 'reportes') {
    return 'El asistente no está disponible ahora. Puede armar el mismo reporte con el formulario: elija entidad, columnas, filtros y formato.';
  }
  if (agent === 'agenda') {
    const { appointments } = await handlers.consultar_agenda({ from: today, to: today });
    const lines = appointments.map((item) => `- ${minutesOf(item.appointmentDate).slice(11)} ${item.serviceName} con ${item.stylistName}`);
    return `El asistente no está disponible. Citas de hoy: ${lines.length ? `\n${lines.join('\n')}` : 'ninguna'}.`;
  }
  const criticalStock = await handlers.consultar_stock_critico({});
  if (canUseTool('obtener_metricas_negocio', roles)) {
    return buildPlainReport({ metrics: await handlers.obtener_metricas_negocio({ period: 'MONTHLY' }), criticalStock });
  }
  const items = criticalStock.items.map((item) => `${item.name} (${item.currentStock} de mínimo ${item.minimumStock})`).join('; ');
  return `El asistente no está disponible. Insumos en nivel crítico: ${items || 'ninguno'}.`;
}

/** Crea el ejecutor de herramientas para los datos de una petición autenticada. */
function createToolRunner({ backends, generateText, callModel, roles = [], actions, ownerId, reportDatabases, now = () => new Date(), timeZone = process.env.SALON_TIMEZONE || DEFAULT_TIMEZONE }) {
  /** Guarda la propuesta; el resumen lo arma este servidor con datos reales, no el texto del modelo. */
  async function propose(action, summary, reason) {
    const actionId = await actions.create(ownerId, action);
    return { actionId, status: 'PENDIENTE_DE_CONFIRMACION', summary, reason: shortText(reason), message: 'Todavía no se hizo ningún cambio: la persona debe confirmarlo.' };
  }

  const handlers = {
    consultar_inventario: async ({ category }) => {
      const all = await backends.inventory();
      return { items: category ? all.filter((item) => item.category === category) : all };
    },

    consultar_agenda: async ({ from, to }) => {
      if (!DATE_FORMAT.test(from ?? '') || !DATE_FORMAT.test(to ?? '')) {
        throw new BackendError('Indique las fechas con formato AAAA-MM-DD.');
      }
      const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
      if (!(days >= 0 && days <= MAX_AGENDA_DAYS)) {
        throw new BackendError(`El rango debe ir hacia adelante y abarcar como máximo ${MAX_AGENDA_DAYS} días.`);
      }
      return { from, to, appointments: await backends.panelAgenda(from, to) };
    },

    proponer_reposicion: async ({ itemId, quantity, reason }) => {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_RESTOCK_UNITS) {
        throw new BackendError(`La cantidad debe ser un entero entre 1 y ${MAX_RESTOCK_UNITS}.`);
      }
      const item = await backends.inventoryItem(itemId);
      if (!item) throw new BackendError(`No existe el insumo '${itemId}'.`);
      return propose(
        { type: RESTOCK, itemId: item.id, quantity },
        `Sumar ${quantity} unidades a ${item.name}: de ${item.currentStock} a ${item.currentStock + quantity} (mínimo ${item.minimumStock}).`,
        reason,
      );
    },

    proponer_reprogramacion: async ({ appointmentId, newDate, reason }) => {
      if (!DATE_TIME_FORMAT.test(newDate ?? '')) {
        throw new BackendError('Indique el nuevo turno con formato AAAA-MM-DDTHH:MM:SS.');
      }
      const appointment = await backends.appointment(appointmentId);
      if (!appointment) throw new BackendError(`No existe la cita '${appointmentId}'.`);
      if (!MOVABLE_STATUSES.has(appointment.status)) throw new BackendError('Solo se pueden mover citas confirmadas.');
      const slots = await backends.availableSlots(appointment.stylistId, appointment.serviceId, newDate.slice(0, 10));
      const slot = slots.find(({ start }) => minutesOf(start) === minutesOf(newDate));
      if (!slot) throw new BackendError('Ese turno no está libre: consulte la disponibilidad y elija otro.');
      return propose(
        { type: RESCHEDULE, appointmentId: appointment.id, newDate: slot.start },
        `Mover ${appointment.serviceName} con ${appointment.stylistName} del ${minutesOf(appointment.appointmentDate).replace('T', ' ')} al ${minutesOf(slot.start).replace('T', ' ')}.`,
        reason,
      );
    },

    /** Se ejecuta con el token de quien confirma, y cada servicio vuelve a validar su rol. */
    confirmar_accion: async ({ actionId }) => {
      const action = await takeAction(actionId);
      if (action.type === RESTOCK) {
        const item = await backends.updateStock(action.itemId, action.quantity, 'Reposición propuesta por el agente de inventario y confirmada por una persona');
        return { executed: true, type: action.type, item };
      }
      if (action.type === RESCHEDULE) {
        const appointment = await backends.reschedule(action.appointmentId, action.newDate);
        return { executed: true, type: action.type, appointment };
      }
      throw new BackendError('Esa propuesta no se reconoce.');
    },

    rechazar_accion: async ({ actionId }) => {
      await takeAction(actionId);
      return { rejected: true };
    },

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

    catalogo_reportes: async () => catalogo(),

    generar_reporte: async (peticion) => {
      if (!reportDatabases) throw new BackendError('Los reportes no están configurados en este servidor.');
      return generarReporte(reportDatabases, peticion, now());
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

  async function takeAction(actionId) {
    if (typeof actionId !== 'string' || !actionId) throw new BackendError('Indique la propuesta.');
    const action = await actions.take(ownerId, actionId);
    if (!action) throw new BackendError('Esa propuesta ya no está disponible: ya se respondió, venció o no es suya.');
    return action;
  }

  handlers[AGENT_TOOL] = async ({ prompt, agente = DEFAULT_AGENT }) => {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new BackendError('Escriba la pregunta para el agente.');
    }
    const skill = SKILLS[agente];
    if (!skill) throw new BackendError(`No existe el agente '${agente}'.`);
    if (!skill.roles.some((role) => roles.includes(role))) throw new BackendError(`No tiene permiso para usar el agente '${agente}'.`);

    const pendingActions = [];
    const reports = [];
    const today = localDate(now(), timeZone);
    const result = await runAgent({
      prompt,
      tools: agentTools(skill, roles),
      callModel,
      skillInstructions: skill.instructions,
      runTool: async (name, args) => {
        const output = await handlers[name](args ?? {});
        if (output?.actionId) pendingActions.push({ actionId: output.actionId, summary: output.summary, reason: output.reason });
        // El archivo y las filas quedan para la pantalla; al modelo solo le llegan los totales
        if (output?.archivo) {
          reports.push(output);
          return resumenParaModelo(output);
        }
        return output;
      },
      today,
      timeZone,
    });
    if (result) {
      return { query: prompt, agent: skill.name, engine: result.engine ?? 'Agente sin respuesta', generatedReport: result.answer, toolsUsed: result.toolsUsed, pendingActions, reports };
    }
    return { query: prompt, agent: skill.name, engine: 'Resumen sin modelo de lenguaje', generatedReport: await plainSummaryFor(skill.name, roles, handlers, today), toolsUsed: [], pendingActions, reports };
  };

  return (toolName, args) => handlers[toolName](args ?? {});
}

module.exports = { HUMAN_ONLY_TOOLS, SKILLS, TOOLS, agentTools, canUseTool, toolsFor, createToolRunner, periodRange };
