/** Sesión vigente de un usuario con sesión única. */
export interface ActiveSession {
  sessionId: string;
  authTime: number;
}

/**
 * Puerto de salida: registro de sesiones activas y revocadas (RF-01, CU-01, CU-02).
 */
export interface ISessionRegistry {
  isRevoked(sessionId: string): Promise<boolean>;
  revoke(sessionId: string): Promise<void>;
  findActive(userId: string): Promise<ActiveSession | null>;
  /** Devuelve false si otra sesión más reciente ya ocupa el registro. */
  claimActive(userId: string, sessionId: string, authTime: number): Promise<boolean>;
}

export const SESSION_REGISTRY = Symbol('ISessionRegistry');
