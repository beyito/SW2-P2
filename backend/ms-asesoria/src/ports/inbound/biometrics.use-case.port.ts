import { BiometricConsent } from '../../domain/entities/biometric-consent.entity';
import { BiometricDiagnosis } from '../../domain/entities/biometric-diagnosis.entity';

export type SaveDiagnosisDto = Pick<
  BiometricDiagnosis,
  | 'source'
  | 'faceShape'
  | 'faceShapeConfidence'
  | 'skinUndertone'
  | 'undertoneConfidence'
  | 'recommendedPalette'
  | 'hairType'
  | 'hairTypeConfidence'
  | 'hairTone'
  | 'framesAnalyzed'
  | 'method'
>;

export interface ConsentStatus {
  granted: boolean;
  policyVersion: string;
  policyText: string;
  retentionDays: number;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

export interface IBiometricsUseCase {
  getConsent(clientId: string): Promise<ConsentStatus>;
  grantConsent(clientId: string, policyVersion: string): Promise<BiometricConsent>;
  /** Retira el consentimiento y borra todos los resultados del cliente. */
  revokeConsent(clientId: string): Promise<{ deletedDiagnoses: number }>;
  saveDiagnosis(clientId: string, dto: SaveDiagnosisDto): Promise<BiometricDiagnosis>;
  listDiagnoses(clientId: string): Promise<BiometricDiagnosis[]>;
  deleteDiagnosis(clientId: string, id: string): Promise<boolean>;
  deleteAllDiagnoses(clientId: string): Promise<number>;
}

export const BIOMETRICS_USE_CASE = Symbol('IBiometricsUseCase');
