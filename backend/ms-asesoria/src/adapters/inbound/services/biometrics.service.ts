import {
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BIOMETRIC_POLICY_VERSION, biometricPolicyText } from '../../../domain/biometric-policy';
import { BiometricConsent } from '../../../domain/entities/biometric-consent.entity';
import { BiometricDiagnosis } from '../../../domain/entities/biometric-diagnosis.entity';
import {
  ConsentStatus,
  IBiometricsUseCase,
  SaveDiagnosisDto,
} from '../../../ports/inbound/biometrics.use-case.port';
import { BIOMETRICS_REPOSITORY, IBiometricsRepository } from '../../../ports/outbound/biometrics-repository.port';

const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 365;
const MAX_PALETTE = 12;
const MAX_TEXT = 60;
const MAX_FRAMES = 100;

const SOURCES = ['IMAGE', 'VIDEO', 'OFFLINE'];
const FACE_SHAPES = ['OVAL', 'ROUND', 'SQUARE', 'HEART', 'OBLONG'];
const UNDERTONES = ['WARM', 'COOL', 'NEUTRAL'];
const HAIR_TYPES = ['STRAIGHT', 'WAVY', 'CURLY'];
const HAIR_TONES = ['DARK', 'MEDIUM', 'LIGHT'];

const isConfidence = (value: unknown): boolean => typeof value === 'number' && value >= 0 && value <= 1;
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT;

/** Consentimiento biométrico y resultados de diagnóstico; cada cliente solo accede a los suyos (CU-13). */
@Injectable()
export class BiometricsService implements IBiometricsUseCase {
  private readonly retentionDays = Number(process.env.BIOMETRIC_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;

  constructor(
    @Inject(BIOMETRICS_REPOSITORY)
    private readonly repository: IBiometricsRepository,
  ) {}

  async getConsent(clientId: string): Promise<ConsentStatus> {
    const consent = await this.repository.findConsent(clientId);
    return {
      granted: consent?.isActive(BIOMETRIC_POLICY_VERSION) ?? false,
      policyVersion: BIOMETRIC_POLICY_VERSION,
      policyText: biometricPolicyText(this.retentionDays),
      retentionDays: this.retentionDays,
      grantedAt: consent?.grantedAt ?? null,
      revokedAt: consent?.revokedAt ?? null,
    };
  }

  async grantConsent(clientId: string, policyVersion: string): Promise<BiometricConsent> {
    // Debe aceptar exactamente el texto que se le mostró
    if (policyVersion !== BIOMETRIC_POLICY_VERSION) {
      throw new UnprocessableEntityException({
        code: 'POLICY_OUTDATED',
        message: 'La política de datos cambió. Léala de nuevo antes de aceptarla.',
      });
    }
    const consent = new BiometricConsent({ clientId, policyVersion, grantedAt: new Date() });
    await this.repository.saveConsent(consent);
    return consent;
  }

  async revokeConsent(clientId: string): Promise<{ deletedDiagnoses: number }> {
    const consent = await this.repository.findConsent(clientId);
    if (consent && consent.revokedAt === null) {
      consent.revokedAt = new Date();
      await this.repository.saveConsent(consent);
    }
    return { deletedDiagnoses: await this.repository.deleteDiagnoses(clientId) };
  }

  async saveDiagnosis(clientId: string, dto: SaveDiagnosisDto): Promise<BiometricDiagnosis> {
    await this.assertConsent(clientId);
    this.validate(dto);

    const now = new Date();
    const diagnosis = new BiometricDiagnosis({
      id: randomUUID(),
      clientId,
      source: dto.source,
      faceShape: dto.faceShape,
      faceShapeConfidence: dto.faceShapeConfidence,
      skinUndertone: dto.skinUndertone,
      undertoneConfidence: dto.undertoneConfidence,
      recommendedPalette: dto.recommendedPalette,
      hairType: dto.hairType ?? null,
      hairTypeConfidence: dto.hairTypeConfidence ?? null,
      hairTone: dto.hairTone ?? null,
      framesAnalyzed: dto.framesAnalyzed,
      method: dto.method,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.retentionDays * DAY_MS),
    });
    await this.repository.saveDiagnosis(diagnosis);

    // Si revocó mientras se analizaba, el borrado pudo ocurrir antes de esta escritura: no debe quedar nada
    const stillActive = (await this.repository.findConsent(clientId))?.isActive(BIOMETRIC_POLICY_VERSION);
    if (!stillActive) {
      await this.repository.deleteDiagnosis(clientId, diagnosis.id);
      this.throwConsentRequired();
    }
    return diagnosis;
  }

  listDiagnoses(clientId: string): Promise<BiometricDiagnosis[]> {
    return this.repository.findDiagnoses(clientId);
  }

  deleteDiagnosis(clientId: string, id: string): Promise<boolean> {
    return this.repository.deleteDiagnosis(clientId, id);
  }

  deleteAllDiagnoses(clientId: string): Promise<number> {
    return this.repository.deleteDiagnoses(clientId);
  }

  private async assertConsent(clientId: string): Promise<void> {
    const consent = await this.repository.findConsent(clientId);
    if (!consent?.isActive(BIOMETRIC_POLICY_VERSION)) this.throwConsentRequired();
  }

  private throwConsentRequired(): never {
    throw new ForbiddenException({
      code: 'CONSENT_REQUIRED',
      message: 'Se necesita su consentimiento biométrico vigente para este diagnóstico.',
    });
  }

  private validate(dto: SaveDiagnosisDto): void {
    const hairOk =
      dto.hairType === null || dto.hairType === undefined
        ? dto.hairTypeConfidence === null || dto.hairTypeConfidence === undefined
        : HAIR_TYPES.includes(dto.hairType) && isConfidence(dto.hairTypeConfidence);
    const valid =
      SOURCES.includes(dto.source) &&
      FACE_SHAPES.includes(dto.faceShape) &&
      isConfidence(dto.faceShapeConfidence) &&
      UNDERTONES.includes(dto.skinUndertone) &&
      isConfidence(dto.undertoneConfidence) &&
      Array.isArray(dto.recommendedPalette) &&
      dto.recommendedPalette.length <= MAX_PALETTE &&
      dto.recommendedPalette.every(isText) &&
      hairOk &&
      (dto.hairTone === null || dto.hairTone === undefined || HAIR_TONES.includes(dto.hairTone)) &&
      Number.isInteger(dto.framesAnalyzed) &&
      dto.framesAnalyzed >= 1 &&
      dto.framesAnalyzed <= MAX_FRAMES &&
      isText(dto.method);
    if (!valid) {
      throw new UnprocessableEntityException({ code: 'INVALID_DIAGNOSIS', message: 'El diagnóstico no es válido.' });
    }
  }
}
