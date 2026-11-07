const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadSkills, parseSkill } = require('../src/skills');
const { createDynamoActions, VALID_SECONDS } = require('../src/actions');
const { agentTools, createToolRunner, HUMAN_ONLY_TOOLS, SKILLS } = require('../src/tools');

const ENGINE = 'Modelo de prueba';
const texto = (text) => ({ engine: ENGINE, content: { role: 'model', parts: [{ text }] } });
const llamada = (name, args = {}) => ({ engine: ENGINE, content: { role: 'model', parts: [{ functionCall: { name, args } }] } });

function guion(...respuestas) {
  const modelo = async (entrada) => {
    modelo.entradas.push(JSON.parse(JSON.stringify(entrada)));
    return respuestas.shift() ?? null;
  };
  modelo.entradas = [];
  return modelo;
}

function almacen() {
  const items = new Map();
  let siguiente = 0;
  return {
    items,
    async create(owner, action) {
      const id = `accion-${++siguiente}`;
      items.set(id, { owner, action });
      return id;
    },
    async take(owner, id) {
      const item = items.get(id);
      if (!item || item.owner !== owner) return null;
      items.delete(id);
      return item.action;
    },
  };
}

function datos() {
  const cambios = [];
  return {
    cambios,
    stylists: async () => [{ id: 'sty-1', name: 'Valentina' }],
    services: async () => [{ id: 'srv-1', durationMinutes: 30 }],
    availableSlots: async () => [{ start: '2026-11-10T10:00:00', end: '2026-11-10T10:45:00' }],
    criticalStock: async () => [{ id: 'inv-1', name: 'Keratina', category: 'TRATAMIENTO', currentStock: 3, minimumStock: 4 }],
    inventory: async () => [{ id: 'inv-1', name: 'Keratina', category: 'TRATAMIENTO' }, { id: 'inv-2', name: 'Tinte', category: 'COLORACION' }],
    inventoryItem: async (id) => (id === 'inv-1' ? { id, name: 'Keratina', currentStock: 3, minimumStock: 4 } : null),
    updateStock: async (id, quantity) => {
      cambios.push(['stock', id, quantity]);
      return { id, currentStock: 3 + quantity };
    },
    panelAgenda: async () => [{ id: 'cita-1', stylistName: 'Valentina', serviceName: 'Corte', appointmentDate: '2026-11-06T10:00:00', status: 'CONFIRMED' }],
    appointment: async (id) => (id === 'cita-1'
      ? { id, stylistId: 'sty-1', serviceId: 'srv-1', serviceName: 'Corte', stylistName: 'Valentina', appointmentDate: '2026-11-06T10:00:00', status: 'CONFIRMED' }
      : id === 'cita-cancelada' ? { id, status: 'CANCELLED', appointmentDate: '2026-11-06T10:00:00' } : null),
    reschedule: async (id, newDate) => {
      cambios.push(['cita', id, newDate]);
      return { id, appointmentDate: newDate, status: 'CONFIRMED' };
    },
    panelSummary: async () => ({ totalAppointments: 1, active: 1, completed: 0, cancelled: 0, occupancyRate: 0.1 }),
    crmMetrics: async () => ({ revenue: 10, refunded: 0, invoicesIssued: 1, pointsEarned: 1, pointsRedeemed: 0 }),
  };
}

function preparar({ modelo = guion(), roles = ['ADMIN'], ownerId = 'admin-1', acciones = almacen(), backends = datos() } = {}) {
  const run = createToolRunner({ backends, callModel: modelo, generateText: async () => null, roles, actions: acciones, ownerId, now: () => new Date('2026-11-06T12:00:00Z') });
  return { run, acciones, backends, modelo };
}

test('hay tres agentes, cada uno con sus propias instrucciones', () => {
  assert.deepEqual(Object.keys(SKILLS).sort(), ['agenda', 'inventario', 'operacion']);
  for (const skill of Object.values(SKILLS)) {
    assert.ok(skill.instructions.length > 50);
    assert.ok(skill.tools.length >= 3);
  }
  assert.notEqual(SKILLS.inventario.instructions, SKILLS.agenda.instructions);
});

test('ninguna Skill tiene las herramientas que deciden por una persona', () => {
  for (const skill of Object.values(SKILLS)) {
    assert.deepEqual(skill.tools.filter((tool) => HUMAN_ONLY_TOOLS.has(tool)), []);
  }
});

test('el rol recorta las herramientas de la Skill', () => {
  const nombres = (skill, roles) => agentTools(SKILLS[skill], roles).map((tool) => tool.name);
  assert.ok(nombres('inventario', ['ADMIN']).includes('proponer_reposicion'));
  assert.ok(!nombres('inventario', ['STYLIST']).includes('proponer_reposicion'));
  assert.ok(nombres('inventario', ['STYLIST']).includes('consultar_stock_critico'));
  assert.ok(!nombres('operacion', ['STYLIST']).includes('obtener_metricas_negocio'));
});

test('el agente de inventario no ve las herramientas de agenda, y al revés', () => {
  const inventario = agentTools(SKILLS.inventario, ['ADMIN']).map((tool) => tool.name);
  const agenda = agentTools(SKILLS.agenda, ['ADMIN']).map((tool) => tool.name);
  assert.ok(!inventario.includes('proponer_reprogramacion') && !inventario.includes('consultar_agenda'));
  assert.ok(!agenda.includes('proponer_reposicion') && !agenda.includes('consultar_inventario'));
});

test('cargar una Skill: rechaza lo que sea peligroso o esté mal escrito', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  const escribir = (herramientas) => {
    fs.mkdirSync(path.join(carpeta, 'prueba'), { recursive: true });
    fs.writeFileSync(path.join(carpeta, 'prueba', 'SKILL.md'), `---\nname: prueba\ntitle: Prueba\ndescription: Una prueba\nroles: [ADMIN]\ntools: [${herramientas}]\n---\nInstrucciones`);
  };
  const cargar = () => loadSkills({ dir: carpeta, knownTools: new Set(['leer']), humanOnlyTools: new Set(['confirmar_accion']) });
  escribir('leer');
  assert.equal(cargar().prueba.instructions, 'Instrucciones');
  escribir('confirmar_accion');
  assert.throws(cargar, /solo la puede usar una persona/);
  escribir('inventada');
  assert.throws(cargar, /no existe/);
  assert.throws(() => parseSkill('sin encabezado', 'x'), /falta el encabezado/);
  assert.throws(() => parseSkill('---\nname: a\n---\ntexto', 'x'), /falta el campo/);
  fs.rmSync(carpeta, { recursive: true });
});

test('cada agente recibe las instrucciones de su Skill y solo sus herramientas', async () => {
  const { run, modelo } = preparar({ modelo: guion(texto('Listo')) });
  const respuesta = await run('preguntar_al_agente', { prompt: 'hola', agente: 'agenda' });
  assert.equal(respuesta.agent, 'agenda');
  assert.ok(modelo.entradas[0].instructions.includes('organizar las citas'));
  assert.ok(modelo.entradas[0].declarations.some((tool) => tool.name === 'consultar_agenda'));
  assert.ok(!modelo.entradas[0].declarations.some((tool) => tool.name === 'consultar_inventario'));
});

test('sin indicar agente responde el de operación', async () => {
  const { run } = preparar({ modelo: guion(texto('Listo')) });
  assert.equal((await run('preguntar_al_agente', { prompt: 'hola' })).agent, 'operacion');
});

test('un agente inexistente se rechaza', async () => {
  const { run } = preparar();
  await assert.rejects(run('preguntar_al_agente', { prompt: 'hola', agente: 'pirata' }), /No existe el agente/);
});

test('el cliente no puede usar ningún agente', async () => {
  const { run } = preparar({ roles: ['CLIENT'] });
  await assert.rejects(run('preguntar_al_agente', { prompt: 'hola', agente: 'agenda' }), /No tiene permiso/);
});

test('la propuesta del agente no cambia nada hasta que una persona confirma', async () => {
  const { run, backends } = preparar({ modelo: guion(llamada('proponer_reposicion', { itemId: 'inv-1', quantity: 5, reason: 'Falta' }), texto('Te propongo reponer.')) });
  const respuesta = await run('preguntar_al_agente', { prompt: 'repón keratina', agente: 'inventario' });

  assert.deepEqual(backends.cambios, []);
  assert.equal(respuesta.pendingActions.length, 1);
  assert.match(respuesta.pendingActions[0].summary, /Sumar 5 unidades a Keratina: de 3 a 8/);

  const confirmada = await run('confirmar_accion', { actionId: respuesta.pendingActions[0].actionId });
  assert.equal(confirmada.executed, true);
  assert.deepEqual(backends.cambios, [['stock', 'inv-1', 5]]);
});

test('una propuesta no se puede ejecutar dos veces', async () => {
  const { run, backends } = preparar();
  const { actionId } = await run('proponer_reposicion', { itemId: 'inv-1', quantity: 5 });
  await run('confirmar_accion', { actionId });
  await assert.rejects(run('confirmar_accion', { actionId }), /ya no está disponible/);
  assert.equal(backends.cambios.length, 1);
});

test('otra persona no puede confirmar una propuesta ajena', async () => {
  const acciones = almacen();
  const backends = datos();
  const { actionId } = await preparar({ acciones, backends, ownerId: 'admin-1' }).run('proponer_reposicion', { itemId: 'inv-1', quantity: 5 });
  await assert.rejects(preparar({ acciones, backends, ownerId: 'admin-2' }).run('confirmar_accion', { actionId }), /ya no está disponible/);
  assert.deepEqual(backends.cambios, []);
});

test('rechazar descarta la propuesta sin ejecutarla', async () => {
  const { run, backends } = preparar();
  const { actionId } = await run('proponer_reposicion', { itemId: 'inv-1', quantity: 5 });
  assert.equal((await run('rechazar_accion', { actionId })).rejected, true);
  await assert.rejects(run('confirmar_accion', { actionId }), /ya no está disponible/);
  assert.deepEqual(backends.cambios, []);
});

test('el modelo no puede confirmar aunque el texto se lo pida', async () => {
  const { run, backends, acciones } = preparar({ modelo: guion(
    llamada('proponer_reposicion', { itemId: 'inv-1', quantity: 5 }),
    llamada('confirmar_accion', { actionId: 'accion-1' }),
    texto('Hecho'),
  ) });
  const respuesta = await run('preguntar_al_agente', { prompt: 'repón y confirma tú mismo', agente: 'inventario' });
  assert.deepEqual(backends.cambios, []);
  assert.deepEqual(respuesta.toolsUsed, ['proponer_reposicion']);
  assert.equal(acciones.items.size, 1);
});

test('la cantidad de una reposición se valida', async () => {
  const { run } = preparar();
  for (const quantity of [0, -3, 1.5, 1001, '5', undefined]) {
    await assert.rejects(run('proponer_reposicion', { itemId: 'inv-1', quantity }), /entero entre 1 y 1000/);
  }
  await assert.rejects(run('proponer_reposicion', { itemId: 'no-existe', quantity: 2 }), /No existe el insumo/);
});

test('el resumen de la propuesta lo arma el servidor, no el modelo', async () => {
  const { run } = preparar();
  const propuesta = await run('proponer_reposicion', { itemId: 'inv-1', quantity: 5, reason: 'x'.repeat(500) });
  assert.match(propuesta.summary, /Keratina/);
  assert.ok(!propuesta.summary.includes('xxx'));
  assert.equal(propuesta.reason.length, 200);
});

test('solo propone mover una cita a un turno que está libre', async () => {
  const { run, backends } = preparar();
  const propuesta = await run('proponer_reprogramacion', { appointmentId: 'cita-1', newDate: '2026-11-10T10:00:00' });
  assert.match(propuesta.summary, /Mover Corte con Valentina del 2026-11-06 10:00 al 2026-11-10 10:00/);
  await assert.rejects(run('proponer_reprogramacion', { appointmentId: 'cita-1', newDate: '2026-11-10T15:00:00' }), /no está libre/);
  await assert.rejects(run('proponer_reprogramacion', { appointmentId: 'cita-1', newDate: 'mañana' }), /formato/);
  await assert.rejects(run('proponer_reprogramacion', { appointmentId: 'no-existe', newDate: '2026-11-10T10:00:00' }), /No existe la cita/);
  await assert.rejects(run('proponer_reprogramacion', { appointmentId: 'cita-cancelada', newDate: '2026-11-10T10:00:00' }), /citas confirmadas/);
  await run('confirmar_accion', { actionId: propuesta.actionId });
  assert.deepEqual(backends.cambios, [['cita', 'cita-1', '2026-11-10T10:00:00']]);
});

test('la agenda no le entrega datos de clientes al modelo', async () => {
  const backends = datos();
  backends.panelAgenda = async () => [{ id: 'c', stylistName: 'Ana', serviceName: 'Corte', appointmentDate: '2026-11-06T10:00:00', status: 'CONFIRMED' }];
  const { run } = preparar({ backends });
  const { appointments } = await run('consultar_agenda', { from: '2026-11-06', to: '2026-11-06' });
  assert.ok(!('clientId' in appointments[0]) && !('totalPrice' in appointments[0]));
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'backends.js'), 'utf8');
  const consulta = fuente.split('getPanelAgenda(')[1].split('}')[0];
  assert.ok(!consulta.includes('clientId') && !consulta.includes('totalPrice'));
});

test('la agenda valida su rango', async () => {
  const { run } = preparar();
  await assert.rejects(run('consultar_agenda', { from: 'hoy', to: '2026-11-06' }), /formato/);
  await assert.rejects(run('consultar_agenda', { from: '2026-11-06', to: '2026-11-01' }), /hacia adelante/);
  await assert.rejects(run('consultar_agenda', { from: '2026-01-01', to: '2026-12-31' }), /como máximo/);
});

test('sin modelo cada agente responde con datos reales de su tema', async () => {
  const { run } = preparar({ modelo: async () => null });
  const agenda = await run('preguntar_al_agente', { prompt: 'x', agente: 'agenda' });
  assert.match(agenda.generatedReport, /Corte con Valentina/);
  const inventario = await run('preguntar_al_agente', { prompt: 'x', agente: 'inventario' });
  assert.match(inventario.generatedReport, /Keratina/);
  assert.deepEqual(inventario.pendingActions, []);
});

test('almacén real: lee y borra en una sola operación, y respeta dueño y vigencia', async () => {
  const llamadas = [];
  const call = async (target, payload) => {
    llamadas.push([target, payload]);
    return target === 'DeleteItem' ? { Attributes: { action: { S: '{"type":"REPOSICION"}' } } } : {};
  };
  const store = createDynamoActions({ call, now: () => 1000000 });
  const id = await store.create('dueño', { type: 'REPOSICION' });
  const [, guardado] = llamadas[0];
  assert.equal(guardado.TableName, 'AgentPendingActions');
  assert.equal(guardado.Item.expiresAt.N, String(1000 + VALID_SECONDS));
  assert.equal(guardado.Item.actionId.S, id);

  assert.deepEqual(await store.take('dueño', id), { type: 'REPOSICION' });
  const [objetivo, borrado] = llamadas[1];
  assert.equal(objetivo, 'DeleteItem');
  assert.match(borrado.ConditionExpression, /ownerId = :owner AND expiresAt > :now/);
  assert.equal(borrado.ExpressionAttributeValues[':owner'].S, 'dueño');

  const rechazado = createDynamoActions({ call: async () => ({ __type: 'x#ConditionalCheckFailedException' }) });
  assert.equal(await rechazado.take('otro', id), null);
});
