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

  /** Cuerpo GraphQL de la llamada número n. */
  const cuerpo = (fetchMock: Mock, n = 0) => {
    const [url, options] = fetchMock.mock.calls[n] as unknown as [string, RequestInit];
    return { url, ...JSON.parse(options.body as string) };
  };

  it('el ERP habla solo GraphQL: las herramientas MCP pasan por la puerta de gestión', async () => {
    const fetchMock = vi.fn(async () => json({ data: { mcpTools: [{ name: 'generar_reporte', description: 'x' }] } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.mcp('tools/list')).toEqual({ tools: [{ name: 'generar_reporte', description: 'x' }] });
    const llamada = cuerpo(fetchMock);
    expect(llamada.url).toContain('/graphql');
    expect(llamada.query).toContain('mcpTools');
  });

  it('una herramienta MCP devuelve lo mismo que el protocolo, con su contenido estructurado', async () => {
    const fetchMock = vi.fn(async () =>
      json({ data: { callMcpTool: { isError: false, text: 'ok', structuredContentJson: '{"totalFilas":2}' } } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await api.mcp<{ isError: boolean; content: { text: string }[]; structuredContent: { totalFilas: number } }>(
      'tools/call', { name: 'generar_reporte', arguments: { entidad: 'citas' } });
    expect(result.structuredContent.totalFilas).toBe(2);
    expect(result.content[0].text).toBe('ok');
    expect(JSON.parse(cuerpo(fetchMock).variables.args)).toEqual({ entidad: 'citas' });
  });

  it('un error de la herramienta llega con su mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'Sin permiso' }] })));
    await expect(api.mcp('tools/list')).rejects.toThrow('Sin permiso');
  });

  it('la voz viaja en base64 a la puerta y una transcripción fallida muestra el mensaje de ms-ia', async () => {
    const fetchMock = vi.fn(async () => json({ errors: [{ message: 'No se entendió ninguna frase.' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.transcribe(new Blob(['hola'], { type: 'audio/webm' }))).rejects.toThrow('No se entendió ninguna frase.');
    const llamada = cuerpo(fetchMock);
    expect(llamada.query).toContain('transcribeAudio');
    expect(atob(llamada.variables.audio)).toBe('hola');
    expect(llamada.variables.type).toBe('audio/webm');
  });

  it('la moderación usa la puerta GraphQL con el identificador como variable', async () => {
    const fetchMock = vi.fn(async () => json({ data: { hidePost: true } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.hidePost('p-1', 'Spam');
    expect(cuerpo(fetchMock).variables).toEqual({ id: 'p-1', reason: 'Spam' });
  });

  it('si un servicio detrás de la puerta dice que la sesión terminó, avisa al Shell', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'Su sesión terminó.', extensions: { classification: 'UNAUTHORIZED' } }] })));
    await expect(api.moderationQueue()).rejects.toThrow('Su sesión terminó.');
    expect(onSessionLost).toHaveBeenCalled();
  });
});
