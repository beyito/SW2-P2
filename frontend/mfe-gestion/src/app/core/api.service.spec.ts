import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { ApiService } from './api.service';
import { setPlatform } from './platform';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

describe('ApiService', () => {
  let api: ApiService;
  let onSessionLost: Mock<() => void>;

  beforeEach(async () => {
    onSessionLost = vi.fn<() => void>();
    await setPlatform({ getToken: async () => 'a.e30.c', onSessionLost });
    api = TestBed.inject(ApiService);
  });

  it('envía el token en cada petición', async () => {
    const fetchMock = vi.fn(async () => json({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.gestion('{ ok }');
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer a.e30.c');
  });

  it('un error de GraphQL llega con su mensaje real', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'Sin stock' }] })));
    await expect(api.gestion('{ ok }')).rejects.toThrow('Sin stock');
  });

  it('un 401 avisa al Shell', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(api.crm('{ ok }')).rejects.toThrow('Su sesión terminó');
    expect(onSessionLost).toHaveBeenCalled();
  });

  it('sin red no inventa datos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sin red'); }));
    await expect(api.gestion('{ ok }')).rejects.toThrow('no está disponible');
  });

  it('el agente usa JSON-RPC sobre el Servidor MCP', async () => {
    const fetchMock = vi.fn(async () => json({ result: { tools: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.mcp('tools/list')).toEqual({ tools: [] });
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/mcp');
    expect(JSON.parse(options.body as string).method).toBe('tools/list');
  });

  it('un error del protocolo MCP llega con su mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'Sin permiso' } })));
    await expect(api.mcp('tools/list')).rejects.toThrow('Sin permiso');
  });

  it('una transcripción fallida muestra el mensaje de ms-ia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: { message: 'No se entendió ninguna frase.' } }, 422)));
    await expect(api.transcribe(new Blob(['x']))).rejects.toThrow('No se entendió ninguna frase.');
  });
});
