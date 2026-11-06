import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../auth';
import Scanner from './Scanner';

const POLICY = { granted: false, policyVersion: 'v2', policyText: 'Texto de la política', retentionDays: 365 };
const DIAGNOSIS = {
  id: 'd1', faceShape: 'OVAL', faceShapeConfidence: 0.7, skinUndertone: 'WARM', undertoneConfidence: 0.5,
  hairType: 'WAVY', hairTypeConfidence: 0.8, hairTone: 'DARK', recommendedPalette: ['Miel'], source: 'IMAGE',
  framesAnalyzed: 1, expiresAt: '2030-01-01T00:00:00Z',
};
const STYLE = { style_id: 'cut-1', style_name: 'Corte uno', category: 'HAIRCUT', match_score: 0.6, reason: 'Motivo', matched_factors: ['tu forma de rostro'], service: { id: 'srv-03', name: 'Corte', price: 45 } };

let backend;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function installBackend() {
  backend = { consent: POLICY, diagnoses: [], profile: {}, styles: [STYLE], requests: [] };
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
    backend.requests.push({ url, method: options.method ?? 'GET', body });
    if (url.includes('/graphql')) return json({ data: { getMyProfile: { styleProfile: backend.profile } } });
    if (url.endsWith('/biometrics/consent')) {
      if (options.method === 'POST') {
        backend.consent = { ...POLICY, granted: true };
        return json({}, 201);
      }
      if (options.method === 'DELETE') {
        backend.consent = POLICY;
        backend.diagnoses = [];
        return json({ deletedDiagnoses: 1 });
      }
      return json(backend.consent);
    }
    if (url.endsWith('/biometrics/diagnoses')) return json(backend.diagnoses);
    if (url.includes('/recommendations/styles')) return json(backend.styles);
    return json({});
  }));
}

describe('Scanner', () => {
  let onBook;

  beforeEach(() => {
    installBackend();
    onBook = vi.fn();
    setPlatform({ getToken: async () => 'token', onSessionLost: vi.fn(), onBook, offline: null });
  });

  afterEach(cleanup);

  it('sin consentimiento muestra la política y no ofrece la cámara', async () => {
    render(<Scanner />);
    expect(await screen.findByText('Texto de la política')).toBeTruthy();
    expect(screen.queryByText('Abrir cámara')).toBeNull();
  });

  it('no se puede aceptar sin declarar la mayoría de edad', async () => {
    render(<Scanner />);
    const accept = await screen.findByRole('button', { name: /Acepto/ });
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Soy mayor de 18 años'));
    expect(accept.disabled).toBe(false);
  });

  it('al aceptar envía la versión de la política y la declaración', async () => {
    render(<Scanner />);
    fireEvent.click(await screen.findByLabelText('Soy mayor de 18 años'));
    fireEvent.click(screen.getByRole('button', { name: /Acepto/ }));
    expect(await screen.findByText('Abrir cámara')).toBeTruthy();
    const post = backend.requests.find((request) => request.method === 'POST' && request.url.endsWith('/consent'));
    expect(post.body).toEqual({ policyVersion: 'v2', declaresAdult: true });
  });

  it('a un menor de edad no se le ofrece aceptar', async () => {
    backend.profile = { ageRange: 'UNDER_18' };
    render(<Scanner />);
    expect(await screen.findByText(/solo para mayores de 18/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Acepto/ })).toBeNull();
    expect(screen.getByRole('button', { name: /a mano/ })).toBeTruthy();
  });

  it('aplica el perfil declarado a las recomendaciones', async () => {
    backend.profile = { gender: 'MALE', ageRange: '30_44', maintenance: 'LOW' };
    render(<Scanner />);
    await screen.findByText('Corte uno');
    const request = backend.requests.find((item) => item.url.includes('/recommendations/styles'));
    expect(request.body).toMatchObject({ gender: 'MALE', age_range: '30_44', maintenance: 'LOW' });
  });

  it('no binario o sin responder no filtra por público', async () => {
    backend.profile = { gender: 'NON_BINARY', maintenance: 'LOW' };
    render(<Scanner />);
    await screen.findByText('Corte uno');
    const request = backend.requests.find((item) => item.url.includes('/recommendations/styles'));
    expect(request.body.gender).toBeUndefined();
  });

  it('muestra el diagnóstico guardado y lo usa para recomendar', async () => {
    backend.consent = { ...POLICY, granted: true };
    backend.diagnoses = [DIAGNOSIS];
    render(<Scanner />);
    await waitFor(() => expect(document.querySelector('#result-shape')?.textContent).toContain('Ovalado'));
    expect(document.querySelector('#result-shape').textContent).toContain('70%');
    await waitFor(() => {
      const request = backend.requests.find((item) => item.url.includes('/recommendations/styles') && item.body.face_shape);
      expect(request.body).toMatchObject({ face_shape: 'OVAL', hair_type: 'WAVY', skin_undertone: 'WARM' });
    });
  });

  it('el botón de reservar pide al Shell abrir ese servicio', async () => {
    backend.profile = { gender: 'FEMALE' };
    render(<Scanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reservar' }));
    expect(onBook).toHaveBeenCalledWith('srv-03');
  });

  it('un estilo sin servicio no ofrece reservar', async () => {
    backend.profile = { gender: 'MALE' };
    backend.styles = [{ ...STYLE, service: null }];
    render(<Scanner />);
    expect(await screen.findByText(/Consulta este servicio/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reservar' })).toBeNull();
  });

  it('retirar el consentimiento pide confirmación y borra lo que se muestra', async () => {
    backend.consent = { ...POLICY, granted: true };
    backend.diagnoses = [DIAGNOSIS];
    render(<Scanner />);
    await waitFor(() => expect(document.querySelector('#result-shape')).toBeTruthy());
    fireEvent.click(screen.getByText(/Retirar mi consentimiento/));
    expect(backend.requests.some((request) => request.method === 'DELETE')).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sí, retirar/ }));
    });
    expect(await screen.findByText('Texto de la política')).toBeTruthy();
    expect(document.querySelector('#diagnosis')).toBeNull();
  });

  it('si el servicio falla muestra el error real', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Fallo real' }, 500)));
    render(<Scanner />);
    expect(await screen.findByText('Fallo real')).toBeTruthy();
  });
});
