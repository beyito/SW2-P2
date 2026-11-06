import { BiometricConsent } from '../../domain/entities/biometric-consent.entity';
import { BiometricDiagnosis } from '../../domain/entities/biometric-diagnosis.entity';

export interface IBiometricsRepository {
  findConsent(clientId: string): Promise<BiometricConsent | null>;
  saveConsent(consent: BiometricConsent): Promise<void>;
  saveDiagnosis(diagnosis: BiometricDiagnosis): Promise<void>;
  /** Del más reciente al más antiguo. */
  findDiagnoses(clientId: string): Promise<BiometricDiagnosis[]>;
  deleteDiagnosis(clientId: string, id: string): Promise<boolean>;
  deleteDiagnoses(clientId: string): Promise<number>;
}

export const BIOMETRICS_REPOSITORY = Symbol('IBiometricsRepository');
