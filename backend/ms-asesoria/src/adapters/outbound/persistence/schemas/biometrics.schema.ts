import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BiometricConsentDocument = BiometricConsentMongo & Document;
export type BiometricDiagnosisDocument = BiometricDiagnosisMongo & Document;
export type ImageConsentDocument = ImageConsentMongo & Document;

@Schema({ collection: 'biometric_consents' })
export class BiometricConsentMongo {
  @Prop({ required: true, unique: true })
  clientId: string;

  @Prop({ required: true })
  policyVersion: string;

  @Prop({ required: true })
  grantedAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;
}

/** Autorización de la generación de imágenes: misma forma que el consentimiento, pero con su propia decisión. */
@Schema({ collection: 'image_generation_consents' })
export class ImageConsentMongo {
  @Prop({ required: true, unique: true })
  clientId: string;

  @Prop({ required: true })
  policyVersion: string;

  @Prop({ required: true })
  grantedAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;
}

@Schema({ collection: 'biometric_diagnoses' })
export class BiometricDiagnosisMongo {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  clientId: string;

  @Prop({ required: true })
  source: string;

  @Prop({ required: true })
  faceShape: string;

  @Prop({ required: true })
  faceShapeConfidence: number;

  @Prop({ required: true })
  skinUndertone: string;

  @Prop({ required: true })
  undertoneConfidence: number;

  @Prop({ type: [String], default: [] })
  recommendedPalette: string[];

  @Prop({ type: String, default: null })
  hairType: string | null;

  @Prop({ type: Number, default: null })
  hairTypeConfidence: number | null;

  @Prop({ type: String, default: null })
  hairTone: string | null;

  @Prop({ required: true })
  framesAnalyzed: number;

  @Prop({ required: true })
  method: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop({ required: true })
  expiresAt: Date;
}

export const BiometricConsentSchema = SchemaFactory.createForClass(BiometricConsentMongo);
export const ImageConsentSchema = SchemaFactory.createForClass(ImageConsentMongo);
export const BiometricDiagnosisSchema = SchemaFactory.createForClass(BiometricDiagnosisMongo);

BiometricDiagnosisSchema.index({ clientId: 1, createdAt: -1 });
// MongoDB borra el documento al llegar a expiresAt: es la política de retención
BiometricDiagnosisSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
