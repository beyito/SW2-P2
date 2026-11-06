import { Injectable } from '@nestjs/common';
import { ActiveSession, ISessionRegistry } from '../../../ports/outbound/session-registry.port';
import { CONDITION_FAILED, DynamoHttpClient } from './dynamo-http.client';

const TABLE = 'ActiveUserSessions';
const EIGHT_HOURS = 28800;

/**
 * Adaptador del registro de sesiones sobre DynamoDB (tabla ActiveUserSessions).
 */
@Injectable()
export class DynamoSessionRegistry implements ISessionRegistry {
  constructor(private readonly dynamo: DynamoHttpClient) {}

  async isRevoked(sessionId: string): Promise<boolean> {
    const result = await this.get(`revoked#${sessionId}`);
    return Boolean(result.Item);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.dynamo.call('PutItem', {
      TableName: TABLE,
      Item: {
        userId: { S: `revoked#${sessionId}` },
        ttl: { N: String(Math.floor(Date.now() / 1000) + EIGHT_HOURS) },
      },
    });
  }

  async findActive(userId: string): Promise<ActiveSession | null> {
    const { Item } = await this.get(userId);
    if (!Item) return null;
    return { sessionId: Item.sessionId.S, authTime: Number(Item.loginTimestamp.N) };
  }

  async claimActive(userId: string, sessionId: string, authTime: number): Promise<boolean> {
    const result = await this.dynamo.call('PutItem', {
      TableName: TABLE,
      Item: {
        userId: { S: userId },
        sessionId: { S: sessionId },
        loginTimestamp: { N: String(authTime) },
        ttl: { N: String(authTime + EIGHT_HOURS) },
      },
      ConditionExpression: 'attribute_not_exists(userId) OR loginTimestamp < :t OR sessionId = :s',
      ExpressionAttributeValues: { ':t': { N: String(authTime) }, ':s': { S: sessionId } },
    });
    return !String(result.__type).includes(CONDITION_FAILED);
  }

  private get(key: string): Promise<any> {
    return this.dynamo.call('GetItem', {
      TableName: TABLE,
      ConsistentRead: true,
      Key: { userId: { S: key } },
    });
  }
}
