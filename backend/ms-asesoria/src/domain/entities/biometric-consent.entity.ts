/**
 * Entidad de Dominio: Consentimiento biométrico de un cliente (CU-13).
 * Guarda solo la decisión y su versión; ningún dato biométrico. Se conserva al revocarlo como constancia.
 */
export class BiometricConsent {
  clientId: string;
  policyVersion: string;
  grantedAt: Date;
  revokedAt: Date | null;

  constructor(partial: Partial<BiometricConsent>) {
    Object.assign(this, partial);
    this.revokedAt = partial.revokedAt ?? null;
  }

  /** Solo vale si sigue vigente y aceptó la versión actual de la política. */
  isActive(currentPolicyVersion: string): boolean {
    return this.revokedAt === null && this.policyVersion === currentPolicyVersion;
  }
}
