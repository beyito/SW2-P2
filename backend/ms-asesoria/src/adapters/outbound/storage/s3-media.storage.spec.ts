import { createHash } from 'crypto';
import { IMediaStorage, StoredMedia } from '../../../ports/outbound/media-storage.port';
import { S3MediaStorage, s3ConfigFromEnv } from './s3-media.storage';

const CREDENCIALES = { accessKeyId: 'AKIDPRUEBA', secretAccessKey: 'secreto', region: 'us-east-2' };
const IMAGEN = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** fetch simulado: responde según el método y guarda cada petición. */
function falso(respuestas: Record<string, () => Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return respuestas[init.method as string]();
  }) as unknown as typeof fetch;
  return { send, llamadas };
}

function gridFsFalso(guardado?: StoredMedia): IMediaStorage & { borradas: string[] } {
  const borradas: string[] = [];
  return {
    borradas,
    save: jest.fn(),
    find: jest.fn(async () => guardado ?? null),
    delete: jest.fn(async (id: string) => { borradas.push(id); }),
  };
}

describe('S3MediaStorage', () => {
  it('usa la dirección virtual de AWS y una ruta compatible con otros servicios S3', () => {
    const aws = new S3MediaStorage({ bucket: 'salon-media', region: 'us-east-2', credentials: CREDENCIALES });
    expect(aws.url('abc-123')).toBe('https://salon-media.s3.us-east-2.amazonaws.com/media/abc-123');
    const otro = new S3MediaStorage({ bucket: 'salon-media', region: 'us-east-2', endpoint: 'http://minio:9000/', credentials: CREDENCIALES });
    expect(otro.url('abc-123')).toBe('http://minio:9000/salon-media/media/abc-123');
  });

  it('sube la imagen firmada con SigV4 para S3 y el resumen del contenido binario', async () => {
    const { send, llamadas } = falso({ PUT: () => new Response(null, { status: 200 }) });
    await new S3MediaStorage({ bucket: 'b', region: 'us-east-2', credentials: CREDENCIALES }, send).save('id-1', 'image/jpeg', IMAGEN);

    const cabeceras = llamadas[0].init.headers as Record<string, string>;
    expect(llamadas[0].init.method).toBe('PUT');
    expect(cabeceras['x-amz-content-sha256']).toBe(createHash('sha256').update(IMAGEN).digest('hex'));
    expect(cabeceras['Content-Type']).toBe('image/jpeg');
    expect(cabeceras.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDPRUEBA\/\d{8}\/us-east-2\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });

  it('entrega la imagen con su tipo', async () => {
    const { send } = falso({ GET: () => new Response(IMAGEN, { status: 200, headers: { 'content-type': 'image/jpeg' } }) });
    const imagen = await new S3MediaStorage({ bucket: 'b', region: 'us-east-2', credentials: CREDENCIALES }, send).find('id-1');
    expect(imagen).toEqual({ contentType: 'image/jpeg', data: IMAGEN });
  });

  it('una imagen anterior a S3 se copia desde GridFS la primera vez y se borra de ahí', async () => {
    const { send, llamadas } = falso({ GET: () => new Response(null, { status: 404 }), PUT: () => new Response(null, { status: 200 }) });
    const gridFs = gridFsFalso({ contentType: 'image/png', data: IMAGEN });
    const imagen = await new S3MediaStorage({ bucket: 'b', region: 'us-east-2', credentials: CREDENCIALES, fallback: gridFs }, send).find('vieja');

    expect(imagen?.contentType).toBe('image/png');
    expect(llamadas.map((l) => l.init.method)).toEqual(['GET', 'PUT']);
    expect(gridFs.borradas).toEqual(['vieja']);
  });

  it('una imagen que no está en ningún lado no existe', async () => {
    const { send } = falso({ GET: () => new Response(null, { status: 404 }) });
    const imagen = await new S3MediaStorage({ bucket: 'b', region: 'us-east-2', credentials: CREDENCIALES, fallback: gridFsFalso() }, send).find('nada');
    expect(imagen).toBeNull();
  });

  it('un error de S3 no se confunde con una imagen inexistente', async () => {
    const { send } = falso({ GET: () => new Response('AccessDenied', { status: 403 }), PUT: () => new Response('AccessDenied', { status: 403 }) });
    const s3 = new S3MediaStorage({ bucket: 'b', region: 'us-east-2', credentials: CREDENCIALES }, send);
    await expect(s3.find('x')).rejects.toThrow('403');
    await expect(s3.save('x', 'image/jpeg', IMAGEN)).rejects.toThrow('403');
  });

  it('borrar quita la imagen de S3 y de GridFS', async () => {
    const { send, llamadas } = falso({ DELETE: () => new Response(null, { status: 204 }) });
    const gridFs = gridFsFalso();
    await new S3MediaStorage({ bucket: 'b', region: 'us-east-2', credentials: CREDENCIALES, fallback: gridFs }, send).delete('x');
    expect(llamadas[0].init.method).toBe('DELETE');
    expect(gridFs.borradas).toEqual(['x']);
  });

  it('sin S3_BUCKET no hay configuración y el servicio sigue con GridFS', () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    const config = s3ConfigFromEnv({ S3_BUCKET: 'salon-media', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's', AWS_REGION: 'us-east-2' });
    expect(config).toMatchObject({ bucket: 'salon-media', region: 'us-east-2', credentials: { accessKeyId: 'a', secretAccessKey: 's' } });
  });
});
