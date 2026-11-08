/**
 * Firma de peticiones a AWS con Signature Version 4.
 * DynamoDB real la exige; DynamoDB Local acepta cualquier firma, así que el mismo código sirve en ambos.
 * Sin credenciales en el entorno se usan unas de relleno, válidas solo para DynamoDB Local.
 */
const crypto = require('crypto');

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256 = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
// Codificación de la especificación de AWS: RFC 3986, más estricta que encodeURIComponent
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function credentialsFromEnv(env = process.env) {
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || 'local',
    sessionToken: env.AWS_SESSION_TOKEN || undefined,
    region: env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1',
  };
}

/** Fecha en el formato de AWS: AAAAMMDDTHHMMSSZ. */
const amzDateOf = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * Devuelve las cabeceras firmadas para la petición. Las cabeceras recibidas deben ser todas las que se enviarán.
 * @param {{method: string, url: string, headers: object, body?: string, service: string, credentials: object, now?: Date}} request
 */
function signRequest({ method, url, headers, body = '', service, credentials, now = new Date() }) {
  const address = new URL(url);
  const amzDate = amzDateOf(now);
  const day = amzDate.slice(0, 8);
  const extra = { 'X-Amz-Date': amzDate };
  if (credentials.sessionToken) extra['X-Amz-Security-Token'] = credentials.sessionToken;

  const signed = { ...headers, ...extra, Host: address.host };
  const normalized = Object.fromEntries(
    Object.entries(signed).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')]),
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
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    ...extra,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** Petición firmada a la API JSON de DynamoDB. */
function dynamoRequest(endpoint, target, payload, credentials = credentialsFromEnv()) {
  const body = JSON.stringify(payload);
  const headers = signRequest({
    method: 'POST',
    url: endpoint,
    headers: { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': `DynamoDB_20120810.${target}` },
    body,
    service: 'dynamodb',
    credentials,
  });
  return { method: 'POST', headers, body };
}

module.exports = { signRequest, dynamoRequest, credentialsFromEnv };
