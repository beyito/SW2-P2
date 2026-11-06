import { computed, Injectable, signal } from '@angular/core';
import { CONFIG } from './config';

interface Claims {
  salon_id?: string;
  sub?: string;
  name?: string;
  realm_access?: { roles?: string[] };
}

/**
 * Puente de autenticación con el Shell: el token solo vive en memoria y se acepta únicamente
 * del Shell. Decodificarlo aquí solo decide qué se muestra; quien autoriza es cada servicio.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly token = signal<string | null>(null);
  private readonly claims = computed<Claims>(() => {
    const token = this.token();
    return token ? decodeClaims(token) : {};
  });
  readonly roles = computed(() => this.claims().realm_access?.roles ?? []);
  readonly isAdmin = computed(() => this.roles().includes('ADMIN'));
  readonly userId = computed(() => this.claims().salon_id ?? this.claims().sub ?? '');

  constructor() {
    window.addEventListener('message', (event) => {
      if (event.origin !== CONFIG.shellOrigin || event.source !== window.parent) return;
      if (event.data?.type === 'SALON_AUTH' && event.data.token) {
        this.token.set(event.data.token);
      }
    });
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'SALON_READY' }, CONFIG.shellOrigin);
    }
  }

  /** Avisa al Shell de que la sesión terminó. */
  sessionLost(): void {
    window.parent.postMessage({ type: 'SALON_UNAUTHORIZED' }, CONFIG.shellOrigin);
  }
}

function decodeClaims(token: string): Claims {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}
