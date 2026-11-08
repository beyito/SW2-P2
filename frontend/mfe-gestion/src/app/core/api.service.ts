import { inject, Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { CONFIG } from './config';

/**
 * Acceso a los servicios de la plataforma. Un error se lanza con su mensaje real:
 * ninguna pantalla sustituye un fallo por datos de ejemplo.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly auth = inject(AuthService);

  private async send(url: string, init: RequestInit): Promise<Response> {
    const headers = { ...init.headers, Authorization: `Bearer ${await this.auth.freshToken()}` };
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch {
      throw new Error('El servicio no está disponible. Revise que esté en ejecución.');
    }
    if (response.status === 401) {
      this.auth.sessionLost();
      throw new Error('Su sesión terminó.');
    }
    return response;
  }

  private async graphql<T>(url: string, query: string, variables: object): Promise<T> {
    const response = await this.send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    if (body.errors?.length) throw new Error(body.errors[0].message);
    if (!response.ok) throw new Error(`El servicio respondió ${response.status}.`);
    return body.data;
  }

  gestion<T>(query: string, variables: object = {}): Promise<T> {
    return this.graphql<T>(CONFIG.gestionUrl, query, variables);
  }

  crm<T>(query: string, variables: object = {}): Promise<T> {
    return this.graphql<T>(CONFIG.crmUrl, query, variables);
  }

  async asesoria<T>(path: string, method = 'GET', body?: object): Promise<T> {
    const response = await this.send(`${CONFIG.asesoriaUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message ?? `El servicio respondió ${response.status}.`);
    return payload;
  }

  /** Orquestador SAGA: reservas y cobro en el mostrador. La llave evita apartar o cobrar dos veces (RNF-04). */
  async saga<T>(path: string, method = 'GET', body?: object, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await this.send(`${CONFIG.sagaUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message ?? `El servicio respondió ${response.status}.`);
    return payload;
  }

  /** Abre el comprobante en una pestaña nueva; la petición lleva el token, un enlace normal no podría. */
  async openReceipt(invoiceId: string): Promise<void> {
    const response = await this.send(`${CONFIG.crmBaseUrl}/api/invoices/${encodeURIComponent(invoiceId)}/comprobante`, {});
    if (!response.ok) throw new Error(`No se pudo obtener el comprobante (${response.status}).`);
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Convierte en texto una pregunta hablada, con Whisper en ms-ia. */
  async transcribe(audio: Blob): Promise<string> {
    const form = new FormData();
    form.append('file', audio, 'pregunta');
    const response = await this.send(`${CONFIG.iaUrl}/speech/transcribe`, { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail?.message ?? `El servicio respondió ${response.status}.`);
    return payload.text;
  }

  /** Llamada JSON-RPC al Servidor MCP. */
  async mcp<T>(method: string, params: object = {}): Promise<T> {
    const response = await this.send(CONFIG.mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }
}
