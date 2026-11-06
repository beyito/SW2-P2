import { Injectable } from '@nestjs/common';

export const CONDITION_FAILED = 'ConditionalCheckFailedException';

/**
 * Cliente mínimo de DynamoDB Local por su protocolo JSON.
 * Devuelve el cuerpo de la respuesta, incluidas las fallas de condición.
 */
@Injectable()
export class DynamoHttpClient {
  private readonly endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';

  async call(target: string, payload: Record<string, unknown>): Promise<any> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': `DynamoDB_20120810.${target}`,
        Authorization:
          'AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, SignedHeaders=host, Signature=local',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    const body: any = await response.json();
    if (!response.ok && !String(body.__type).includes(CONDITION_FAILED)) {
      throw new Error(`DynamoDB respondió ${response.status}`);
    }
    return body;
  }
}
