import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../auth';
import Closet from './Closet';

vi.mock('../auth', async (importOriginal) => ({
  ...(await importOriginal()),
  currentUser: async () => ({ id: 'cli-1' }),
}));

const prenda = (id, name, category, imageUrl = `/media/${id.repeat(32)}`) => ({ id, name, category, color: 'Azul', season: 'ALL_SEASON', imageUrl });
const ROPA = [
  prenda('a', 'Polera', 'TOP'),
  prenda('b', 'Otra polera', 'TOP'),
  prenda('c', 'Pantalon', 'BOTTOM'),
  prenda('d', 'Sin foto', 'BOTTOM', ''),
  prenda('e', 'Con enlace', 'OUTERWEAR', 'https://ejemplo.com/a.jpg'),
  prenda('f', 'Botas', 'SHOES'),
];
const RESULTADO = { image_base64: 'AAAA', media_type: 'image/jpeg', label: 'Simulación generada con IA', remaining_today: 4 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

let enviados;

function tarjeta(nombre) {
  return document.querySelector(`.closet-item[data-name="${nombre}"]`);
}

const marcar = (nombre) => fireEvent.click(tarjeta(nombre).querySelector('.outfit-toggle'));

async function mostrar() {
  render(<Closet />);
  await waitFor(() => expect(tarjeta('Polera')).not.toBeNull());
}

describe('Closet: conjuntos', () => {
  beforeEach(() => {
    enviados = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('/closet/client/')) return json(ROPA);
      if (url.includes('/graphql')) return json({ data: { getMyProfile: { styleProfile: {} } } });
      if (url.endsWith('/biometrics/image-consent')) return json({ granted: true, policyVersion: 'img', policyText: 'Política' });
      if (url.includes('/image-generation/')) {
        enviados.push({ url, itemIds: options.body.get('item_ids') });
        return json(RESULTADO, 201);
      }
      return json({});
    }));
    setPlatform({ getToken: async () => 'token', onSessionLost: vi.fn(), onBook: vi.fn(), offline: null });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('solo se pueden marcar prendas con foto propia y de un tipo admitido', async () => {
    await mostrar();
    expect(tarjeta('Polera').querySelector('.outfit-toggle')).not.toBeNull();
    for (const nombre of ['Sin foto', 'Con enlace', 'Botas']) {
      expect(tarjeta(nombre).querySelector('.outfit-toggle')).toBeNull();
    }
  });

  it('exige dos prendas para probar el conjunto', async () => {
    await mostrar();
    expect(document.querySelector('#btn-try-outfit')).toBeNull();
    marcar('Polera');
    expect(document.querySelector('#btn-try-outfit').disabled).toBe(true);
    marcar('Pantalon');
    expect(document.querySelector('#btn-try-outfit').disabled).toBe(false);
    expect(document.querySelector('#outfit-names').textContent).toBe('Polera + Pantalon');
  });

  it('otra prenda del mismo tipo reemplaza a la anterior', async () => {
    await mostrar();
    marcar('Polera');
    marcar('Otra polera');
    expect(document.querySelector('#outfit-names').textContent).toBe('Otra polera');
    expect(tarjeta('Polera').querySelector('.outfit-toggle').checked).toBe(false);
  });

  it('desmarcar quita la prenda', async () => {
    await mostrar();
    marcar('Polera');
    marcar('Polera');
    expect(document.querySelector('#outfit-bar')).toBeNull();
  });

  it('prueba el conjunto con todas las prendas en una sola petición', async () => {
    await mostrar();
    marcar('Polera');
    marcar('Pantalon');
    fireEvent.click(document.querySelector('#btn-try-outfit'));
    await waitFor(() => expect(document.querySelector('#preview-file')).not.toBeNull());
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Conjunto: Polera + Pantalon');
    fireEvent.change(document.querySelector('#preview-file'), { target: { files: [new File(['x'], 'foto.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(document.querySelector('#preview-image')).not.toBeNull());
    expect(enviados).toHaveLength(1);
    expect(enviados[0].url).toContain('/image-generation/try-on-outfit');
    expect(enviados[0].itemIds).toBe('a,c');
  });

  it('"Probármela" sigue probando una sola prenda', async () => {
    await mostrar();
    fireEvent.click(tarjeta('Polera').querySelector('.btn-try-on'));
    await waitFor(() => expect(document.querySelector('#preview-file')).not.toBeNull());
    fireEvent.change(document.querySelector('#preview-file'), { target: { files: [new File(['x'], 'foto.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(document.querySelector('#preview-image')).not.toBeNull());
    expect(enviados[0].url).toMatch(/\/image-generation\/try-on$/);
  });
});
