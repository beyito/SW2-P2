import { inject, Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { CONFIG } from './config';
import { CommunityPost, CounterBooking, CounterBookingInput } from './models';

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
    if (body.errors?.length) {
      // Un servicio detrás de la puerta GraphQL también puede decir que la sesión terminó
      if (body.errors[0].extensions?.classification === 'UNAUTHORIZED') this.auth.sessionLost();
      throw new Error(body.errors[0].message);
    }
    if (!response.ok) throw new Error(`El servicio respondió ${response.status}.`);
    return body.data;
  }

  gestion<T>(query: string, variables: object = {}): Promise<T> {
    return this.graphql<T>(CONFIG.gestionUrl, query, variables);
  }

  crm<T>(query: string, variables: object = {}): Promise<T> {
    return this.graphql<T>(CONFIG.crmUrl, query, variables);
  }

  // --- Puerta GraphQL del ERP (ms-gestion): moderación, mostrador, comprobante, voz y agentes ---
  // Todo el módulo de gestión empresarial habla GraphQL; ms-gestion reenvía estas operaciones
  // a la asesoría, al orquestador, al CRM, a ms-ia y al Servidor MCP con el mismo token.

  moderationQueue(): Promise<CommunityPost[]> {
    return this.gestion<{ moderationQueue: CommunityPost[] }>(
      '{ moderationQueue { id authorName title description imageUrl status moderationReason reports { reason } } }',
    ).then((data) => data.moderationQueue);
  }

  hidePost(id: string, reason: string): Promise<unknown> {
    return this.gestion('mutation ($id: ID!, $reason: String!) { hidePost(id: $id, reason: $reason) }', { id, reason });
  }

  restorePost(id: string): Promise<unknown> {
    return this.gestion('mutation ($id: ID!) { restorePost(id: $id) }', { id });
  }

  deletePost(id: string): Promise<unknown> {
    return this.gestion('mutation ($id: ID!) { deletePost(id: $id) }', { id });
  }

  /** Mostrador: la llave evita apartar el mismo turno dos veces (RNF-04). */
  startCounterBooking(input: CounterBookingInput, idempotencyKey: string): Promise<CounterBooking> {
    return this.gestion<{ startCounterBooking: CounterBooking }>(
      'mutation ($input: CounterBookingInput!, $key: String!) { startCounterBooking(input: $input, idempotencyKey: $key) { sagaId status appointmentId serviceName amountToPayCents failureReason clientId paymentMethod } }',
      { input, key: idempotencyKey },
    ).then((data) => data.startCounterBooking);
  }

  payCounterBooking(sagaId: string): Promise<unknown> {
    return this.gestion('mutation ($id: ID!) { payCounterBooking(sagaId: $id) }', { id: sagaId });
  }

  voidCounterBooking(sagaId: string): Promise<unknown> {
    return this.gestion('mutation ($id: ID!) { voidCounterBooking(sagaId: $id) }', { id: sagaId });
  }

  counterBooking(sagaId: string): Promise<CounterBooking> {
    return this.gestion<{ counterBooking: CounterBooking }>(
      'query ($id: ID!) { counterBooking(sagaId: $id) { sagaId status appointmentId serviceName amountToPayCents failureReason clientId paymentMethod } }',
      { id: sagaId },
    ).then((data) => data.counterBooking);
  }

  /** Abre el comprobante en una pestaña nueva; el HTML llega por GraphQL. */
  async openReceipt(invoiceId: string): Promise<void> {
    const { invoiceReceipt } = await this.gestion<{ invoiceReceipt: string }>(
      'query ($id: ID!) { invoiceReceipt(invoiceId: $id) }',
      { id: invoiceId },
    );
    const url = URL.createObjectURL(new Blob([invoiceReceipt], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Convierte en texto una pregunta hablada, con Whisper en ms-ia. El audio viaja en base64. */
  async transcribe(audio: Blob): Promise<string> {
    const { transcribeAudio } = await this.gestion<{ transcribeAudio: string }>(
      'mutation ($audio: String!, $type: String) { transcribeAudio(audioBase64: $audio, mimeType: $type) }',
      { audio: await toBase64(audio), type: audio.type || null },
    );
    return transcribeAudio;
  }

  /**
   * Herramientas del Servidor MCP a través de la puerta GraphQL. Devuelve lo mismo que el protocolo
   * (tools/list y tools/call), así que las pantallas de agentes y reportes no cambian.
   */
  async mcp<T>(method: 'tools/list' | 'tools/call', params: { name?: string; arguments?: object } = {}): Promise<T> {
    if (method === 'tools/list') {
      const { mcpTools } = await this.gestion<{ mcpTools: { name: string; description: string }[] }>('{ mcpTools { name description } }');
      return { tools: mcpTools } as T;
    }
    const { callMcpTool } = await this.gestion<{ callMcpTool: { isError: boolean; text: string | null; structuredContentJson: string | null } }>(
      'mutation ($name: String!, $args: String) { callMcpTool(name: $name, argumentsJson: $args) { isError text structuredContentJson } }',
      { name: params.name, args: JSON.stringify(params.arguments ?? {}) },
    );
    return {
      isError: callMcpTool.isError,
      content: [{ type: 'text', text: callMcpTool.text ?? '' }],
      structuredContent: callMcpTool.structuredContentJson ? JSON.parse(callMcpTool.structuredContentJson) : undefined,
    } as T;
  }
}

/** Un Blob en base64, sin el prefijo data:. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('No se pudo leer el audio.'));
    reader.readAsDataURL(blob);
  });
}

