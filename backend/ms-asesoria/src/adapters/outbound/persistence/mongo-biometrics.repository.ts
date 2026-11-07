import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BiometricConsent } from '../../../domain/entities/biometric-consent.entity';
import { BiometricDiagnosis } from '../../../domain/entities/biometric-diagnosis.entity';
import { IBiometricsRepository } from '../../../ports/outbound/biometrics-repository.port';
import {
  BiometricConsentDocument,
  BiometricConsentMongo,
  BiometricDiagnosisDocument,
  BiometricDiagnosisMongo,
  ImageConsentDocument,
  ImageConsentMongo,
} from './schemas/biometrics.schema';

@Injectable()
export class MongoBiometricsRepository implements IBiometricsRepository {
  constructor(
    @InjectModel(BiometricConsentMongo.name)
    private readonly consents: Model<BiometricConsentDocument>,
    @InjectModel(BiometricDiagnosisMongo.name)
    private readonly diagnoses: Model<BiometricDiagnosisDocument>,
    @InjectModel(ImageConsentMongo.name)
    private readonly imageConsents: Model<ImageConsentDocument>,
  ) {}

  findConsent(clientId: string): Promise<BiometricConsent | null> {
    return this.readConsent(this.consents, clientId);
  }

  saveConsent(consent: BiometricConsent): Promise<void> {
    return this.writeConsent(this.consents, consent);
  }

  findImageConsent(clientId: string): Promise<BiometricConsent | null> {
    return this.readConsent(this.imageConsents, clientId);
  }

  saveImageConsent(consent: BiometricConsent): Promise<void> {
    return this.writeConsent(this.imageConsents, consent);
  }

  private async readConsent(collection: Model<any>, clientId: string): Promise<BiometricConsent | null> {
    const doc: any = await collection.findOne({ clientId }).lean().exec();
    return doc
      ? new BiometricConsent({
          clientId: doc.clientId,
          policyVersion: doc.policyVersion,
          grantedAt: doc.grantedAt,
          revokedAt: doc.revokedAt,
        })
      : null;
  }

  private async writeConsent(collection: Model<any>, consent: BiometricConsent): Promise<void> {
    await collection
      .updateOne(
        { clientId: consent.clientId },
        { $set: { policyVersion: consent.policyVersion, grantedAt: consent.grantedAt, revokedAt: consent.revokedAt } },
        { upsert: true },
      )
      .exec();
  }

  async saveDiagnosis(diagnosis: BiometricDiagnosis): Promise<void> {
    await this.diagnoses.create({ ...diagnosis });
  }

  async findDiagnoses(clientId: string): Promise<BiometricDiagnosis[]> {
    const docs = await this.diagnoses.find({ clientId }).sort({ createdAt: -1 }).lean().exec();
    return docs.map(({ _id, __v, ...fields }: any) => new BiometricDiagnosis(fields));
  }

  async deleteDiagnosis(clientId: string, id: string): Promise<boolean> {
    const { deletedCount } = await this.diagnoses.deleteOne({ clientId, id }).exec();
    return deletedCount === 1;
  }

  async deleteDiagnoses(clientId: string): Promise<number> {
    const { deletedCount } = await this.diagnoses.deleteMany({ clientId }).exec();
    return deletedCount;
  }
}
