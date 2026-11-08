import { computed, Injectable } from '@angular/core';
import { currentToken, freshToken, sessionLost } from './platform';

interface Claims {
  salon_id?: string;
  sub?: string;
  name?: string;
  realm_access?: { roles?: string[] };
}

/**
 * Sesión entregada por el Shell. Decodificar el token aquí solo decide qué se muestra;
 * quien autoriza es cada servicio.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly token = currentToken;
  private readonly claims = computed<Claims>(() => {
    const token = this.token();
    return token ? decodeClaims(token) : {};
  });
  readonly roles = computed(() => this.claims().realm_access?.roles ?? []);
  readonly isAdmin = computed(() => this.roles().includes('ADMIN'));
  readonly isReceptionist = computed(() => this.roles().includes('RECEPTIONIST'));
  /** Atiende el mostrador: agenda llegadas, cobra y configura horarios. */
  readonly isDesk = computed(() => this.isAdmin() || this.isReceptionist());
  readonly userId = computed(() => this.claims().salon_id ?? this.claims().sub ?? '');

  freshToken(): Promise<string> {
    return freshToken();
  }

  /** Avisa al Shell de que la sesión terminó. */
  sessionLost(): void {
    sessionLost();
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
