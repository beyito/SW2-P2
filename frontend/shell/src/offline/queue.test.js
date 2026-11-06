import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFLICT, createOfflineStore, DONE, PENDING } from './queue';

let counter = 0;
const respuesta = (status, body = {}) => new Response(JSON.stringify(body), { status });

async function crear(fetchImpl, extra = {}) {
  counter += 1;
  return createOfflineStore({ userId: `usuario-${counter}`, getToken: async () => 'token', fetchImpl, ...extra });
}

const operacion = (cambios = {}) => ({ kind: 'CLOSET', label: 'Agregar prenda', url: 'http://api/closet', method: 'POST', body: { name: 'Blazer' }, ...cambios });

describe('cola local', () => {
  beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));

  it('guarda la operación sin enviarla', async () => {
    const fetchImpl = vi.fn();
    const store = await crear(fetchImpl);
    await store.enqueue(operacion());
    const [item] = await store.list();
    expect(item.status).toBe(PENDING);
    expect(item.idempotencyKey).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('envía con el token, el cuerpo y la llave, y la retira al confirmarse', async () => {
    const fetchImpl = vi.fn(async () => respuesta(201));
    const store = await crear(fetchImpl);
    await store.enqueue(operacion({ idempotencyKey: 'llave-1' }));
    await store.sync();
    const [url, opciones] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/closet');
    expect(opciones.headers.Authorization).toBe('Bearer token');
    expect(opciones.headers['Idempotency-Key']).toBe('llave-1');
    expect(JSON.parse(opciones.body)).toEqual({ name: 'Blazer' });
    expect(await store.list()).toEqual([]);
  });

  it('una operación sin cuerpo no declara JSON', async () => {
    const fetchImpl = vi.fn(async () => respuesta(200));
    const store = await crear(fetchImpl);
    await store.enqueue(operacion({ method: 'DELETE', body: undefined }));
    await store.sync();
    expect(fetchImpl.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });

  it('respeta el orden en que se hicieron las operaciones', async () => {
    const orden = [];
    let reloj = 0;
    const store = await crear(async (_, { body }) => {
      orden.push(JSON.parse(body).name);
      return respuesta(201);
    }, { now: () => (reloj += 1) });
    await store.enqueue(operacion({ body: { name: 'primera' } }));
    await store.enqueue(operacion({ body: { name: 'segunda' } }));
    await store.enqueue(operacion({ body: { name: 'tercera' } }));
    await store.sync();
    expect(orden).toEqual(['primera', 'segunda', 'tercera']);
  });

  it('sin red conserva todo, con su misma llave, para reintentar', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('sin red')).mockResolvedValue(respuesta(201));
    const store = await crear(fetchImpl);
    await store.enqueue(operacion());
    await store.sync();
    expect(await store.list()).toHaveLength(1);
    await store.sync();
    expect(await store.list()).toEqual([]);
    const llaves = fetchImpl.mock.calls.map(([, opciones]) => opciones.headers['Idempotency-Key']);
    expect(llaves[0]).toBe(llaves[1]);
  });

  it('un error del servidor detiene el envío sin saltarse el orden', async () => {
    const fetchImpl = vi.fn(async () => respuesta(503));
    let reloj = 0;
    const store = await crear(fetchImpl, { now: () => (reloj += 1) });
    await store.enqueue(operacion());
    await store.enqueue(operacion());
    await store.sync();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await store.list()).toHaveLength(2);
  });

  it('un rechazo definitivo se muestra como conflicto y no bloquea a las demás', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(respuesta(409, { message: 'El turno ya no está disponible.' }))
      .mockResolvedValueOnce(respuesta(201));
    let reloj = 0;
    const store = await crear(fetchImpl, { now: () => (reloj += 1) });
    await store.enqueue(operacion());
    await store.enqueue(operacion());
    await store.sync();
    const [conflicto, ...resto] = await store.list();
    expect(conflicto.status).toBe(CONFLICT);
    expect(conflicto.error).toBe('El turno ya no está disponible.');
    expect(resto).toEqual([]);
  });

  it('un conflicto no se reenvía y se puede descartar', async () => {
    const fetchImpl = vi.fn(async () => respuesta(422, { detail: { message: 'No válido' } }));
    const store = await crear(fetchImpl);
    await store.enqueue(operacion());
    await store.sync();
    await store.sync();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [item] = await store.list();
    expect(item.error).toBe('No válido');
    await store.discard(item.id);
    expect(await store.list()).toEqual([]);
  });

  it('borrar algo que ya no existe cuenta como hecho', async () => {
    const store = await crear(async () => respuesta(404));
    await store.enqueue(operacion({ method: 'DELETE', body: undefined }));
    await store.sync();
    expect(await store.list()).toEqual([]);
  });

  it('una sesión vencida avisa y conserva la cola', async () => {
    const onSessionLost = vi.fn();
    const store = await crear(async () => respuesta(401), { onSessionLost });
    await store.enqueue(operacion());
    await store.sync();
    expect(onSessionLost).toHaveBeenCalled();
    expect(await store.list()).toHaveLength(1);
  });

  it('una reserva conserva su resultado para poder pagarla', async () => {
    const store = await crear(async () => respuesta(202, { sagaId: 'saga-1' }));
    await store.enqueue(operacion({ kind: 'BOOKING', keepResult: true }));
    await store.sync();
    const [item] = await store.list();
    expect(item.status).toBe(DONE);
    expect(item.result.sagaId).toBe('saga-1');
    await store.sync();
    expect((await store.list())[0].status).toBe(DONE);
  });

  it('dos sincronizaciones simultáneas no envían dos veces', async () => {
    const fetchImpl = vi.fn(async () => respuesta(201));
    const store = await crear(fetchImpl);
    await store.enqueue(operacion());
    await Promise.all([store.sync(), store.sync(), store.sync()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('la cola sobrevive a cerrar y volver a abrir la plataforma', async () => {
    counter += 1;
    const userId = `usuario-${counter}`;
    const primera = await createOfflineStore({ userId, getToken: async () => 't', fetchImpl: vi.fn() });
    await primera.enqueue(operacion());
    const segunda = await createOfflineStore({ userId, getToken: async () => 't', fetchImpl: vi.fn() });
    expect(await segunda.list()).toHaveLength(1);
  });

  it('un usuario no ve la cola ni la copia local de otro', async () => {
    const ana = await createOfflineStore({ userId: 'ana', getToken: async () => 't', fetchImpl: vi.fn() });
    const luis = await createOfflineStore({ userId: 'luis', getToken: async () => 't', fetchImpl: vi.fn() });
    await ana.enqueue(operacion());
    await ana.cachePut('closet', ['prenda']);
    expect(await luis.list()).toEqual([]);
    expect(await luis.cacheGet('closet')).toBeUndefined();
    expect(await ana.cacheGet('closet')).toEqual(['prenda']);
  });

  it('avisa a quien escucha cuando cambia la cola', async () => {
    const store = await crear(async () => respuesta(201));
    const escucha = vi.fn();
    const quitar = store.subscribe(escucha);
    await store.enqueue(operacion());
    expect(escucha).toHaveBeenCalledTimes(1);
    quitar();
    await store.sync();
    expect(escucha).toHaveBeenCalledTimes(1);
  });
});
