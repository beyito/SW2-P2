/**
 * Persistencia en DynamoDB: estado de las SAGAs e idempotencia atómica (RF-07, RNF-04).
 */
const { dynamoRequest } = require('./aws-sigv4');
const CONDITION_FAILED = 'ConditionalCheckFailedException';
const ONE_DAY = 86400;

class DynamoClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async call(target, payload) {
    const response = await fetch(this.endpoint, {
      // Firma SigV4: la exige DynamoDB real y DynamoDB Local la acepta
      ...dynamoRequest(this.endpoint, target, payload),
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.json();
    if (!response.ok && !String(body.__type).includes(CONDITION_FAILED)) {
      throw new Error(`DynamoDB respondió ${response.status}: ${body.message || body.__type}`);
    }
    return body;
  }
}

const conditionFailed = (result) => String(result.__type).includes(CONDITION_FAILED);

/** Estado de cada SAGA, con control de concurrencia optimista por versión. */
class SagaRepository {
  constructor(dynamo, table = 'SagaInstances') {
    this.dynamo = dynamo;
    this.table = table;
  }

  async createIfAbsent(saga) {
    await this.dynamo.call('PutItem', {
      TableName: this.table,
      Item: this.toItem(saga),
      ConditionExpression: 'attribute_not_exists(sagaId)',
    });
  }

  async get(sagaId) {
    const { Item } = await this.dynamo.call('GetItem', {
      TableName: this.table,
      ConsistentRead: true,
      Key: { sagaId: { S: sagaId } },
    });
    return Item ? JSON.parse(Item.data.S) : null;
  }

  async transition(saga, state, patch = {}) {
    return this.save(saga, {
      ...saga,
      ...patch,
      state,
      version: saga.version + 1,
      history: [...saga.history, { state, at: new Date().toISOString() }],
    });
  }

  async patch(saga, patch) {
    return this.save(saga, { ...saga, ...patch, version: saga.version + 1 });
  }

  async save(previous, next) {
    const result = await this.dynamo.call('PutItem', {
      TableName: this.table,
      Item: this.toItem(next),
      ConditionExpression: '#version = :expected',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':expected': { N: String(previous.version) } },
    });
    if (conditionFailed(result)) {
      throw new Error(`La SAGA ${previous.sagaId} cambió durante la transición`);
    }
    return next;
  }

  toItem(saga) {
    return {
      sagaId: { S: saga.sagaId },
      version: { N: String(saga.version) },
      data: { S: JSON.stringify(saga) },
    };
  }
}

/** Llaves de idempotencia: la escritura condicional garantiza un único ganador. */
class IdempotencyStore {
  constructor(dynamo, table = 'IdempotencyKeys') {
    this.dynamo = dynamo;
    this.table = table;
  }

  /**
   * Reclama la llave o devuelve lo registrado por una solicitud anterior.
   * @returns {{claimed: boolean, sagaId: string, requestHash: string}}
   */
  async claim(key, sagaId, requestHash) {
    const result = await this.dynamo.call('PutItem', {
      TableName: this.table,
      Item: {
        idempotencyKey: { S: key },
        status: { S: 'COMPLETED' },
        sagaId: { S: sagaId },
        requestPayloadHash: { S: requestHash },
        ttl: { N: String(Math.floor(Date.now() / 1000) + ONE_DAY) },
      },
      ConditionExpression: 'attribute_not_exists(idempotencyKey)',
    });
    if (!conditionFailed(result)) {
      return { claimed: true, sagaId, requestHash };
    }

    const { Item } = await this.dynamo.call('GetItem', {
      TableName: this.table,
      ConsistentRead: true,
      Key: { idempotencyKey: { S: key } },
    });
    return { claimed: false, sagaId: Item.sagaId.S, requestHash: Item.requestPayloadHash.S };
  }
}

module.exports = { DynamoClient, SagaRepository, IdempotencyStore, conditionFailed };
