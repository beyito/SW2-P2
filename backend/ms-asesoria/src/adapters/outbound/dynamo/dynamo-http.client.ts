import { Injectable } from '@nestjs/common';
import { credentialsFromEnv, signRequest } from './aws-sigv4';

export const CONDITION_FAILED = 'ConditionalCheckFailedException';

/**
 * Cliente mínimo de DynamoDB por su protocolo JSON, con firma SigV4.
 * Sirve con DynamoDB real y con DynamoDB Local. Devuelve el cuerpo de la respuesta, incluidas las fallas de condición.
 */
@Injectable()
export class DynamoHttpClient {
  private readonly endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
  private readonly credentials = credentialsFromEnv();

  async call(target: string, payload: Record<string, unknown>): Promise<any> {
    const body = JSON.stringify(payload);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: signRequest({
        method: 'POST',
        url: this.endpoint,
        headers: { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': `DynamoDB_20120810.${target}` },
        body,
        service: 'dynamodb',
        credentials: this.credentials,
      }),
      body,
      signal: AbortSignal.timeout(3000),
    });
    const result: any = await response.json();
    if (!response.ok && !String(result.__type).includes(CONDITION_FAILED)) {
      throw new Error(`DynamoDB respondió ${response.status}`);
    }
    return result;
  }
}
