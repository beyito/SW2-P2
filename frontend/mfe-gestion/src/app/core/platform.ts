import { signal } from '@angular/core';

/** Lo que el Shell entrega al montar este microfrontend. */
export interface PlatformContext {
  getToken(): Promise<string>;
  onSessionLost(): void;
}

let platform: PlatformContext | null = null;

/** Último token entregado por el Shell: solo vive en memoria. */
export const currentToken = signal<string | null>(null);

export async function setPlatform(context: PlatformContext): Promise<void> {
  platform = context;
  currentToken.set(await context.getToken());
}

/** Pide un token vigente para cada petición. */
export async function freshToken(): Promise<string> {
  const token = await platform!.getToken();
  currentToken.set(token);
  return token;
}

export function sessionLost(): void {
  platform?.onSessionLost();
}
