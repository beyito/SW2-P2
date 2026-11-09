import { createHash, createHmac } from 'crypto';

/**
 * Firma de peticiones a AWS con Signature Version 4, para DynamoDB y S3.
 * DynamoDB real la exige; DynamoDB Local acepta cualquier firma, así que el mismo código sirve en ambos.
 */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();
// Un texto se resume en UTF-8; un Buffer (una imagen para S3), tal cual
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
// Codificación de la especificación de AWS: RFC 3986, más estricta que encodeURIComponent
const encode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Sin credenciales en el entorno se usan unas de relleno, válidas solo para DynamoDB Local. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AwsCredentials {
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || 'local',
    sessionToken: env.AWS_SESSION_TOKEN || undefined,
    region: env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1',
  };
}

export interface SignableRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  service: string;
  credentials: AwsCredentials;
  now?: Date;
}

/** Devuelve las cabeceras firmadas. Las cabeceras recibidas deben ser todas las que se enviarán. */
export function signRequest({ method, url, headers, body = '', service, credentials, now = new Date() }: SignableRequest): Record<string, string> {
  const address = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const extra: Record<string, string> = { 'X-Amz-Date': amzDate };
  if (credentials.sessionToken) extra['X-Amz-Security-Token'] = credentials.sessionToken;

  const normalized = Object.fromEntries(
    Object.entries({ ...headers, ...extra, Host: address.host }).map(([name, value]) => [
      name.toLowerCase(),
      String(value).trim().replace(/\s+/g, ' '),
    ]),
  );
  const names = Object.keys(normalized).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((name) => `${name}:${normalized[name]}\n`).join('');
  const query = [...address.searchParams]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonical = [method, address.pathname || '/', query, canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${day}/${credentials.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    ...extra,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
