import { describe, expect, it, vi } from 'vitest';
import { mount } from './mount';

describe('contrato con el Shell', () => {
  it('monta, aísla sus estilos y al retirarse no deja rastros', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const element = document.createElement('div');
    document.body.append(element);
    const antes = document.head.querySelectorAll('style').length;

    const unmount = mount(element, { getToken: async () => 't', onSessionLost: () => {}, onBook: () => {}, params: {}, offline: null });
    await vi.waitFor(() => expect(element.textContent).toContain('Diagnóstico y estilos'));
    expect(element.classList.contains('mfe-estudio')).toBe(true);
    expect(document.head.querySelectorAll('style').length).toBe(antes + 1);
    expect(document.head.lastElementChild.textContent).toContain('.mfe-estudio');

    unmount();
    await vi.waitFor(() => expect(element.textContent).toBe(''));
    expect(document.head.querySelectorAll('style').length).toBe(antes);
    expect(element.classList.contains('mfe-estudio')).toBe(false);
  });
});
