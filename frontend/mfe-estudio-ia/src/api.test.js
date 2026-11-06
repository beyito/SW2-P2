import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closetApi, communityApi, iaApi, loadStyleProfile, uploadImage } from './api';
import { setPlatform } from './auth';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakeStore() {
  const cache = new Map();
  return {
    enqueue: vi.fn(async () => {}),
    cachePut: vi.fn(async (key, value) => cache.set(key, value)),
    cacheGet: vi.fn(async (key) => cache.get(key)),
  };
}

describe('acceso a los servicios', () => {
  let store;
  let onSessionLost;

  beforeEach(() => {
    store = fakeStore();
    onSessionLost = vi.fn();
    setPlatform({ getToken: async () => 'token', onSessionLost, offline: store });
  });

  it('envía el token de la sesión', async () => {
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);
    await closetApi.list('cli-1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
  });

  it('una lectura guarda su copia y sin conexión la devuelve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ id: 'p1' }])));
    await closetApi.list('cli-1');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    expect(await closetApi.list('cli-1')).toEqual([{ id: 'p1' }]);
  });

  it('sin conexión ni copia informa el error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    await expect(closetApi.list('otro')).rejects.toThrow('Sin conexión');
  });

  it('un error del servicio no se tapa con la copia local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ id: 'p1' }])));
    await closetApi.list('cli-1');
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Prohibido' }, 403)));
    await expect(closetApi.list('cli-1')).rejects.toThrow('Prohibido');
  });

  it('una escritura sin conexión va a la cola con la misma llave del intento', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('sin red'); });
    vi.stubGlobal('fetch', fetchMock);
    const result = await closetApi.create({ name: 'Blazer' });
    expect(result.queued).toBe(true);
    const encolada = store.enqueue.mock.calls[0][0];
    expect(encolada.method).toBe('POST');
    expect(encolada.body).toEqual({ name: 'Blazer' });
    expect(encolada.label).toContain('Blazer');
    expect(encolada.idempotencyKey).toBe(fetchMock.mock.calls[0][1].headers['Idempotency-Key']);
  });

  it('un rechazo del servicio no se encola', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Datos inválidos' }, 400)));
    await expect(communityApi.comment('p', 'hola')).rejects.toThrow('Datos inválidos');
    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it('sin almacenamiento local la escritura informa el fallo', async () => {
    setPlatform({ getToken: async () => 't', onSessionLost, offline: null });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    await expect(closetApi.create({ name: 'x' })).rejects.toThrow('Sin conexión');
  });

  it('una sesión vencida avisa al Shell', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(closetApi.list('cli-1')).rejects.toThrow();
    expect(onSessionLost).toHaveBeenCalled();
  });

  it('subir una imagen requiere conexión y lo explica', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    await expect(uploadImage(new File(['x'], 'a.png'))).rejects.toThrow('requiere conexión');
    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it('un error de ms-ia conserva su código y su mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: { code: 'NO_FACE', message: 'No se detectó ningún rostro.' } }, 422)));
    await expect(iaApi.scan(new File(['x'], 'a.png'))).rejects.toMatchObject({ code: 'NO_FACE', message: 'No se detectó ningún rostro.' });
  });

  it('sin el CRM se recomienda sin el perfil', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    expect(await loadStyleProfile()).toEqual({});
  });
});
