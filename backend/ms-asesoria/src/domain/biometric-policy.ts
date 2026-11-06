/** Política de datos biométricos vigente. Cambiar su versión obliga a pedir el consentimiento de nuevo. */
export const BIOMETRIC_POLICY_VERSION = '2026-11-v1';

export const biometricPolicyText = (retentionDays: number): string =>
  'Autorizo el análisis de mi foto o video para estimar la forma de mi rostro, el subtono de mi piel y mi tipo de ' +
  'cabello, con el único fin de recomendarme estilos. La foto o el video se procesan en memoria y se descartan al ' +
  `terminar: solo se guarda el resultado, durante ${retentionDays} días como máximo. Puedo borrar mis resultados o ` +
  'retirar este consentimiento en cualquier momento. Es voluntario: sin él puedo indicar mis rasgos a mano y ' +
  'recibir recomendaciones igualmente.';
