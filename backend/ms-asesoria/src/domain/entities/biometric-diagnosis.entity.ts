export type FaceShape = 'OVAL' | 'ROUND' | 'SQUARE' | 'HEART' | 'OBLONG';
export type SkinUndertone = 'WARM' | 'COOL' | 'NEUTRAL';
export type HairType = 'STRAIGHT' | 'WAVY' | 'CURLY';
export type HairTone = 'DARK' | 'MEDIUM' | 'LIGHT';
export type DiagnosisSource = 'IMAGE' | 'VIDEO' | 'OFFLINE';

/**
 * Entidad de Dominio: Resultado de un diagnóstico (CU-13). Son atributos derivados:
 * nunca incluye la imagen, el video ni los puntos del rostro.
 */
export class BiometricDiagnosis {
  id: string;
  clientId: string;
  source: DiagnosisSource;
  faceShape: FaceShape;
  faceShapeConfidence: number;
  skinUndertone: SkinUndertone;
  undertoneConfidence: number;
  recommendedPalette: string[];
  /** Nulo cuando el cabello no se ve lo suficiente para estimarlo. */
  hairType: HairType | null;
  hairTypeConfidence: number | null;
  hairTone: HairTone | null;
  framesAnalyzed: number;
  method: string;
  createdAt: Date;
  /** Fecha en que MongoDB lo borra por política de retención. */
  expiresAt: Date;

  constructor(partial: Partial<BiometricDiagnosis>) {
    Object.assign(this, partial);
  }
}
