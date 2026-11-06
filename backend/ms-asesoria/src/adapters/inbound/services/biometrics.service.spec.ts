import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { BIOMETRIC_POLICY_VERSION } from '../../../domain/biometric-policy';
import { BiometricConsent } from '../../../domain/entities/biometric-consent.entity';
import { BiometricDiagnosis } from '../../../domain/entities/biometric-diagnosis.entity';
import { SaveDiagnosisDto } from '../../../ports/inbound/biometrics.use-case.port';
import { IBiometricsRepository } from '../../../ports/outbound/biometrics-repository.port';
import { BiometricsService } from './biometrics.service';

class MemoryRepository implements IBiometricsRepository {
  consents = new Map<string, BiometricConsent>();
  diagnoses: BiometricDiagnosis[] = [];
  /** Permite simular lo que pasa justo después de escribir un diagnóstico. */
  afterSave?: () => void;

  async findConsent(clientId: string) {
    return this.consents.get(clientId) ?? null;
  }
  async saveConsent(consent: BiometricConsent) {
    this.consents.set(consent.clientId, consent);
  }
  async saveDiagnosis(diagnosis: BiometricDiagnosis) {
    this.diagnoses.push(diagnosis);
    this.afterSave?.();
  }
  async findDiagnoses(clientId: string) {
    return this.diagnoses.filter((d) => d.clientId === clientId);
  }
  async deleteDiagnosis(clientId: string, id: string) {
    const before = this.diagnoses.length;
    this.diagnoses = this.diagnoses.filter((d) => !(d.clientId === clientId && d.id === id));
    return this.diagnoses.length < before;
  }
  async deleteDiagnoses(clientId: string) {
    const before = this.diagnoses.length;
    this.diagnoses = this.diagnoses.filter((d) => d.clientId !== clientId);
    return before - this.diagnoses.length;
  }
}

const VALID: SaveDiagnosisDto = {
  source: 'IMAGE',
  faceShape: 'OVAL',
  faceShapeConfidence: 0.7,
  skinUndertone: 'WARM',
  undertoneConfidence: 0.6,
  recommendedPalette: ['Miel', 'Cobre'],
  hairType: 'WAVY',
  hairTypeConfidence: 0.5,
  hairTone: 'MEDIUM',
  framesAnalyzed: 1,
  method: 'MEDIAPIPE_FACE_LANDMARKER',
};

describe('BiometricsService', () => {
  let repository: MemoryRepository;
  let service: BiometricsService;

  beforeEach(() => {
    repository = new MemoryRepository();
    service = new BiometricsService(repository);
  });

  const grant = () => service.grantConsent('cli-1', BIOMETRIC_POLICY_VERSION);

  it('empieza sin consentimiento y muestra el texto de la política', async () => {
    const status = await service.getConsent('cli-1');
    expect(status.granted).toBe(false);
    expect(status.policyVersion).toBe(BIOMETRIC_POLICY_VERSION);
    expect(status.policyText).toContain(`${status.retentionDays} días`);
  });

  it('rechaza aceptar una versión de política que no es la vigente', async () => {
    await expect(service.grantConsent('cli-1', 'antigua')).rejects.toThrow(UnprocessableEntityException);
    expect((await service.getConsent('cli-1')).granted).toBe(false);
  });

  it('un consentimiento de una política anterior ya no vale', async () => {
    repository.consents.set('cli-1', new BiometricConsent({ clientId: 'cli-1', policyVersion: 'antigua', grantedAt: new Date() }));
    expect((await service.getConsent('cli-1')).granted).toBe(false);
    await expect(service.saveDiagnosis('cli-1', VALID)).rejects.toThrow(ForbiddenException);
  });

  it('sin consentimiento no guarda ningún diagnóstico', async () => {
    await expect(service.saveDiagnosis('cli-1', VALID)).rejects.toThrow(ForbiddenException);
    expect(repository.diagnoses).toHaveLength(0);
  });

  it('el consentimiento de un cliente no sirve para otro', async () => {
    await grant();
    await expect(service.saveDiagnosis('cli-2', VALID)).rejects.toThrow(ForbiddenException);
  });

  it('guarda el resultado con fecha de expiración según la retención', async () => {
    await grant();
    const saved = await service.saveDiagnosis('cli-1', VALID);
    const days = (saved.expiresAt.getTime() - saved.createdAt.getTime()) / 86_400_000;
    expect(days).toBe((await service.getConsent('cli-1')).retentionDays);
    expect(saved.clientId).toBe('cli-1');
  });

  it('acepta un diagnóstico sin cabello visible', async () => {
    await grant();
    const saved = await service.saveDiagnosis('cli-1', { ...VALID, hairType: null, hairTypeConfidence: null, hairTone: null });
    expect(saved.hairType).toBeNull();
  });

  it.each([
    ['forma desconocida', { faceShape: 'TRIANGLE' }],
    ['confianza mayor que 1', { faceShapeConfidence: 1.5 }],
    ['subtono desconocido', { skinUndertone: 'X' }],
    ['origen desconocido', { source: 'CAMARA' }],
    ['cabello sin confianza', { hairType: 'WAVY', hairTypeConfidence: null }],
    ['confianza sin tipo de cabello', { hairType: null, hairTypeConfidence: 0.5 }],
    ['paleta enorme', { recommendedPalette: Array(13).fill('x') }],
    ['paleta con otro tipo', { recommendedPalette: [1] }],
    ['cero fotogramas', { framesAnalyzed: 0 }],
    ['método vacío', { method: ' ' }],
  ])('rechaza %s con 422', async (_, change) => {
    await grant();
    await expect(service.saveDiagnosis('cli-1', { ...VALID, ...change } as SaveDiagnosisDto)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repository.diagnoses).toHaveLength(0);
  });

  it('revocar borra todos los resultados del cliente y solo los suyos', async () => {
    await grant();
    await service.grantConsent('cli-2', BIOMETRIC_POLICY_VERSION);
    await service.saveDiagnosis('cli-1', VALID);
    await service.saveDiagnosis('cli-1', VALID);
    await service.saveDiagnosis('cli-2', VALID);

    expect(await service.revokeConsent('cli-1')).toEqual({ deletedDiagnoses: 2 });
    expect(await service.listDiagnoses('cli-1')).toHaveLength(0);
    expect(await service.listDiagnoses('cli-2')).toHaveLength(1);
    const status = await service.getConsent('cli-1');
    expect(status.granted).toBe(false);
    expect(status.revokedAt).toBeInstanceOf(Date);
  });

  it('no guarda el resultado si revocó mientras se analizaba', async () => {
    await grant();
    repository.afterSave = () => {
      repository.consents.get('cli-1')!.revokedAt = new Date();
    };
    await expect(service.saveDiagnosis('cli-1', VALID)).rejects.toThrow(ForbiddenException);
    expect(repository.diagnoses).toHaveLength(0);
  });

  it('volver a aceptar después de revocar lo reactiva', async () => {
    await grant();
    await service.revokeConsent('cli-1');
    await grant();
    expect((await service.getConsent('cli-1')).granted).toBe(true);
  });

  it('un cliente no puede borrar el diagnóstico de otro', async () => {
    await grant();
    const saved = await service.saveDiagnosis('cli-1', VALID);
    expect(await service.deleteDiagnosis('cli-2', saved.id)).toBe(false);
    expect(await service.deleteDiagnosis('cli-1', saved.id)).toBe(true);
  });
});
