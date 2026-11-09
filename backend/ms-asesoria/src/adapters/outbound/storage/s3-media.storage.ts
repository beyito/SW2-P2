import { Logger } from '@nestjs/common';
import { IMediaStorage, StoredMedia } from '../../../ports/outbound/media-storage.port';
import { AwsCredentials, credentialsFromEnv, sha256, signRequest } from '../dynamo/aws-sigv4';

export interface S3Config {
  bucket: string;
  region: string;
  /** Opcional: otro servicio compatible con S3. Por defecto, el de AWS en la región del bucket. */
  endpoint?: string;
  credentials: AwsCredentials;
  /** Almacén anterior (GridFS): lo que aún no está en S3 se lee de ahí y se copia, una sola vez. */
  fallback?: IMediaStorage;
}

/** Configuración desde el entorno; sin S3_BUCKET el servicio sigue usando GridFS. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<S3Config, 'fallback'> | null {
  if (!env.S3_BUCKET) return null;
  // Credenciales propias del bucket, distintas de las de DynamoDB (mínimo privilegio)
  const credentials = credentialsFromEnv({
    AWS_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    AWS_REGION: env.S3_REGION || env.AWS_REGION,
  });
  return { bucket: env.S3_BUCKET, region: credentials.region, endpoint: env.S3_ENDPOINT || undefined, credentials };
}

/**
 * Imágenes del clóset y la comunidad en Amazon S3 (almacenamiento masivo). Usa la API REST de S3
 * firmada con SigV4, sin SDK, igual que DynamoDB. Implementa el mismo puerto que GridFS.
 */
export class S3MediaStorage implements IMediaStorage {
  private readonly logger = new Logger(S3MediaStorage.name);

  constructor(private readonly config: S3Config, private readonly send: typeof fetch = fetch) {}

  /** Dirección del objeto: estilo virtual en AWS; estilo de ruta en un servicio compatible. */
  url(id: string): string {
    const key = encodeURIComponent(`media/${id}`).replace(/%2F/g, '/');
    return this.config.endpoint
      ? `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/${key}`
      : `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  private request(method: string, id: string, body?: Buffer, contentType?: string): Promise<Response> {
    const url = this.url(id);
    const headers: Record<string, string> = { 'x-amz-content-sha256': sha256(body ?? '') };
    if (contentType) headers['Content-Type'] = contentType;
    const signed = signRequest({ method, url, headers, body: body ?? '', service: 's3', credentials: this.config.credentials });
    return this.send(url, { method, headers: signed, body: body ? new Uint8Array(body) : undefined });
  }

  async save(id: string, contentType: string, data: Buffer): Promise<void> {
    const response = await this.request('PUT', id, data, contentType);
    if (!response.ok) throw new Error(`S3 rechazó la imagen (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }

  async find(id: string): Promise<StoredMedia | null> {
    const response = await this.request('GET', id);
    if (response.ok) {
      return { contentType: response.headers.get('content-type') ?? 'application/octet-stream', data: Buffer.from(await response.arrayBuffer()) };
    }
    if (response.status !== 404) throw new Error(`S3 no entregó la imagen (${response.status}).`);
    // Migración gradual: una imagen anterior a S3 se copia la primera vez que alguien la pide
    const previous = await this.config.fallback?.find(id);
    if (!previous) return null;
    await this.save(id, previous.contentType, previous.data);
    await this.config.fallback!.delete(id);
    this.logger.log(`Imagen ${id} migrada de GridFS a S3`);
    return previous;
  }

  async delete(id: string): Promise<void> {
    const response = await this.request('DELETE', id);
    // S3 responde 204 aunque el objeto no exista
    if (!response.ok) throw new Error(`S3 no borró la imagen (${response.status}).`);
    await this.config.fallback?.delete(id);
  }
}
