/**
 * Política de la generación de imágenes. Es aparte del diagnóstico porque aquí la foto sale de la plataforma:
 * cambiar su versión obliga a pedir la autorización de nuevo.
 */
export const IMAGE_GENERATION_POLICY_VERSION = '2026-11-img-v1';

export const IMAGE_GENERATION_POLICY_TEXT =
  'Declaro ser mayor de 18 años y ser la persona de la foto. Autorizo que mi foto, junto con la de la prenda cuando ' +
  'corresponda, se envíe a Replicate, un servicio externo, y al creador del modelo de IA que allí se ejecuta, para ' +
  'generar una imagen simulada con el corte, el color o la prenda que yo elija. Puede procesarse fuera de mi país. ' +
  'La plataforma no guarda la foto ni el resultado; Replicate informa que borra los datos de cada solicitud ' +
  'automáticamente en una hora. Es voluntario y puedo retirar esta autorización en cualquier momento: el resto de ' +
  'la plataforma sigue funcionando sin ella.';
