import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCatalog, localDate, queueBooking, startBooking } from './api';
import { setPlatform } from './auth';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const CATALOGO = { getServices: [{ id: 'srv-1', name: 'Corte', price: 45 }], getStylists: [{ id: 'sty-1', name: 'Ana' }] };

describe('fecha local', () => {
  it('de noche en Bolivia sigue siendo el mismo día, aunque en UTC ya sea mañana', () => {
    const noche = { getTime: () => Date.UTC(2026, 10, 7, 2, 10), getTimezoneOffset: () => 240 };
    expect(localDate(noche)).toBe('2026-11-06');
  });
});

describe('acceso a los servicios', () => {
  let store;

  beforeEach(() => {
    const cache = new Map();
    store = {
      enqueue: vi.fn(async () => {}),
      cachePut: vi.fn(async (key, value) => cache.set(key, value)),
      cacheGet: vi.fn(async (key) => cache.get(key)),
    };
    setPlatform({ getToken: async () => 'token', onSessionLost: vi.fn(), offline: store, params: {} });
  });

  it('el catálogo se guarda y sin conexión se muestra el último', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: CATALOGO })));
    await loadCatalog();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    const catalogo = await loadCatalog();
    expect(catalogo.services[0].id).toBe('srv-1');
    expect(catalogo.stylists[0].name).toBe('Ana');
  });

  it('sin conexión ni catálogo guardado informa el error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    await expect(loadCatalog()).rejects.toMatchObject({ offline: true });
  });

  it('un error de GraphQL no se sustituye por el catálogo guardado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: CATALOGO })));
    await loadCatalog();
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'Error real' }] })));
    await expect(loadCatalog()).rejects.toThrow('Error real');
  });

  it('una reserva sin conexión guarda su llave y conserva el resultado para pagarla', async () => {
    await queueBooking({ serviceId: 'srv-1' }, 'Reserva', 'llave-1');
    expect(store.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'BOOKING', method: 'POST', body: { serviceId: 'srv-1' }, idempotencyKey: 'llave-1', keepResult: true,
    }));
    expect(store.enqueue.mock.calls[0][0].url).toMatch(/\/bookings$/);
  });

  it('iniciar una reserva envía la llave de idempotencia', async () => {
    const fetchMock = vi.fn(async () => json({ sagaId: 's1' }, 202));
    vi.stubGlobal('fetch', fetchMock);
    expect((await startBooking({ serviceId: 'srv-1' }, 'llave-2')).sagaId).toBe('s1');
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('llave-2');
  });

  it('un turno ocupado se informa con el mensaje del servicio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'El turno ya no está disponible.' }, 409)));
    await expect(startBooking({}, 'k')).rejects.toThrow('El turno ya no está disponible.');
  });
});
