import { credentialsFromEnv, signRequest } from './aws-sigv4';

// Firmas de referencia calculadas con botocore, el SDK oficial de AWS; la primera es el ejemplo de su documentación
const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const credentials = (extra = {}) => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET, region: 'us-east-1', ...extra });
const signatureOf = (headers: Record<string, string>) => headers.Authorization.split('Signature=')[1];
const BODY = '{"TableName":"IdempotencyKeys","Key":{"idempotencyKey":{"S":"k1"}}}';
const DYNAMO_HEADERS = { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': 'DynamoDB_20120810.GetItem' };

describe('Firma SigV4', () => {
  it('coincide con el ejemplo oficial de AWS', () => {
    const headers = signRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      service: 'iam',
      credentials: credentials(),
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(signatureOf(headers)).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  });

  it('firma una petición a DynamoDB igual que botocore', () => {
    const headers = signRequest({
      method: 'POST', url: 'https://dynamodb.us-east-1.amazonaws.com/', headers: DYNAMO_HEADERS, body: BODY,
      service: 'dynamodb', credentials: credentials(), now: new Date('2026-11-08T12:00:00Z'),
    });
    expect(signatureOf(headers)).toBe('0060c4fedcd6b015779df0310009d61d2a0292ab4a73876a4658dbcfd865302b');
  });

  it('incluye el token de sesión y el puerto, como con DynamoDB Local', () => {
    const headers = signRequest({
      method: 'POST', url: 'http://dynamodb-local:8000', headers: DYNAMO_HEADERS, body: BODY,
      service: 'dynamodb', credentials: credentials({ sessionToken: 'TOKENDEPRUEBA' }), now: new Date('2026-11-08T12:00:00Z'),
    });
    expect(signatureOf(headers)).toBe('1cf0677b1ea0123acd9eb58375af484969150eac21329afdc760541e51275ba3');
    expect(headers['X-Amz-Security-Token']).toBe('TOKENDEPRUEBA');
  });

  it('sin credenciales usa las de relleno de DynamoDB Local', () => {
    expect(credentialsFromEnv({})).toEqual({ accessKeyId: 'local', secretAccessKey: 'local', sessionToken: undefined, region: 'us-east-1' });
  });
});
