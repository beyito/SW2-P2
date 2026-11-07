import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageGenApi } from '../api';
import { setPlatform } from '../auth';
import ImagePreview from './ImagePreview';

const POLICY = { granted: false, policyVersion: 'img-v1', policyText: 'Mi foto se envía a Replicate' };
const RESULT = { image_base64: 'AAAA', media_type: 'image/jpeg', label: 'Simulación generada con IA', remaining_today: 4 };
const FOTO = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });

let backend;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function installBackend() {
  backend = { consent: POLICY, profile: {}, grants: [] };
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (url.includes('/graphql')) return json({ data: { getMyProfile: { styleProfile: backend.profile } } });
    if (url.endsWith('/biometrics/image-consent')) {
      if (options.method === 'POST') {
        backend.grants.push(JSON.parse(options.body));
        backend.consent = { ...POLICY, granted: true };
        return json({}, 201);
      }
      if (options.method === 'DELETE') {
        backend.consent = POLICY;
        return json({ success: true });
      }
      return json(backend.consent);
    }
    return json({});
  }));
}

function mostrar(generate = vi.fn(async () => RESULT), props = {}) {
  const onClose = vi.fn();
  render(<ImagePreview title="Undercut" photoHint="Usa una foto de frente" generate={generate} onClose={onClose} {...props} />);
  return { generate, onClose };
}

const elegirFoto = () => fireEvent.change(document.querySelector('#preview-file'), { target: { files: [FOTO] } });

describe('ImagePreview', () => {
  beforeEach(() => {
    installBackend();
    setPlatform({ getToken: async () => 'token', onSessionLost: vi.fn(), onBook: vi.fn(), offline: null });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sin autorización muestra quién recibe la foto y no permite elegirla', async () => {
    mostrar();
    await screen.findByText(/Replicate/);
    expect(document.querySelector('#preview-file')).toBeNull();
  });

  it('exige declarar la mayoría de edad antes de aceptar', async () => {
    mostrar();
    const aceptar = await screen.findByRole('button', { name: 'Acepto' });
    expect(aceptar.disabled).toBe(true);
    fireEvent.click(document.querySelector('#preview-adult'));
    expect(aceptar.disabled).toBe(false);
    fireEvent.click(aceptar);
    await waitFor(() => expect(document.querySelector('#preview-file')).not.toBeNull());
    expect(backend.grants).toEqual([{ policyVersion: 'img-v1', declaresAdult: true }]);
  });

  it('un menor no puede autorizar el envío', async () => {
    backend.profile = { ageRange: 'UNDER_18' };
    mostrar();
    await waitFor(() => expect(document.querySelector('#preview-minor')).not.toBeNull());
    expect(document.querySelector('#btn-preview-accept')).toBeNull();
  });

  it('muestra el resultado con su etiqueta de simulación', async () => {
    backend.consent = { ...POLICY, granted: true };
    const { generate } = mostrar();
    await waitFor(() => expect(document.querySelector('#preview-file')).not.toBeNull());
    elegirFoto();
    await waitFor(() => expect(document.querySelector('#preview-image')).not.toBeNull());
    expect(generate).toHaveBeenCalledWith(FOTO);
    expect(document.querySelector('#preview-image').src).toContain('data:image/jpeg;base64,AAAA');
    expect(document.querySelector('#preview-label').textContent).toContain('Simulación');
    expect(screen.getByText(/Te quedan 4 imágenes/)).toBeTruthy();
  });

  it('avisa cuando el estilo es aproximado', async () => {
    backend.consent = { ...POLICY, granted: true };
    mostrar(undefined, { approximate: true });
    await waitFor(() => expect(document.querySelector('#preview-approximate')).not.toBeNull());
  });

  it('muestra el error del servicio', async () => {
    backend.consent = { ...POLICY, granted: true };
    mostrar(vi.fn(async () => {
      throw new Error('Alcanzaste el límite de 5 imágenes por día.');
    }));
    await waitFor(() => expect(document.querySelector('#preview-file')).not.toBeNull());
    elegirFoto();
    await screen.findByRole('alert');
    expect(document.querySelector('#preview-error').textContent).toContain('límite');
    expect(document.querySelector('#preview-image')).toBeNull();
  });

  it('si la autorización ya no vale, vuelve a pedirla', async () => {
    backend.consent = { ...POLICY, granted: true };
    mostrar(vi.fn(async () => {
      backend.consent = POLICY;
      const error = new Error('Se necesita tu autorización.');
      error.code = 'IMAGE_CONSENT_REQUIRED';
      throw error;
    }));
    await waitFor(() => expect(document.querySelector('#preview-file')).not.toBeNull());
    elegirFoto();
    await waitFor(() => expect(document.querySelector('#preview-consent')).not.toBeNull());
  });

  it('retirar la autorización borra la imagen de la pantalla', async () => {
    backend.consent = { ...POLICY, granted: true };
    mostrar();
    await waitFor(() => expect(document.querySelector('#preview-file')).not.toBeNull());
    elegirFoto();
    await waitFor(() => expect(document.querySelector('#preview-image')).not.toBeNull());
    fireEvent.click(document.querySelector('#btn-preview-revoke'));
    await waitFor(() => expect(document.querySelector('#preview-consent')).not.toBeNull());
    expect(document.querySelector('#preview-image')).toBeNull();
  });

  it('nunca usa la cola ni la copia local', async () => {
    const store = { cachePut: vi.fn(), cacheGet: vi.fn(), enqueue: vi.fn(), subscribe: vi.fn() };
    setPlatform({ getToken: async () => 'token', onSessionLost: vi.fn(), onBook: vi.fn(), offline: store });
    await imageGenApi.consent();
    await imageGenApi.grant('img-v1');
    expect(store.cachePut).not.toHaveBeenCalled();
    expect(store.enqueue).not.toHaveBeenCalled();
  });
});
