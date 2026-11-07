/**
 * Propuestas de los agentes a la espera de una persona. El modelo puede crearlas, pero solo quien
 * preguntó puede confirmarlas, una sola vez y antes de que venzan.
 */
const crypto = require('node:crypto');

const TABLE = 'AgentPendingActions';
const CONDITION_FAILED = 'ConditionalCheckFailedException';
const VALID_SECONDS = 30 * 60;

/** Almacén sobre DynamoDB. Borrar y leer es una sola operación: dos confirmaciones a la vez no ejecutan dos veces. */
function createDynamoActions({ call, now = () => Date.now() }) {
  return {
    async create(ownerId, action) {
      const actionId = crypto.randomUUID();
      const expiresAt = Math.floor(now() / 1000) + VALID_SECONDS;
      await call('PutItem', {
        TableName: TABLE,
        Item: {
          actionId: { S: actionId },
          ownerId: { S: ownerId },
          action: { S: JSON.stringify(action) },
          expiresAt: { N: String(expiresAt) },
          ttl: { N: String(expiresAt) },
        },
      });
      return actionId;
    },

    /** Entrega la propuesta y la retira; null si ya se respondió, venció o es de otra persona. */
    async take(ownerId, actionId) {
      const result = await call('DeleteItem', {
        TableName: TABLE,
        Key: { actionId: { S: actionId } },
        ConditionExpression: 'ownerId = :owner AND expiresAt > :now',
        ExpressionAttributeValues: { ':owner': { S: ownerId }, ':now': { N: String(Math.floor(now() / 1000)) } },
        ReturnValues: 'ALL_OLD',
      });
      if (String(result.__type).includes(CONDITION_FAILED) || !result.Attributes) return null;
      return JSON.parse(result.Attributes.action.S);
    },
  };
}

module.exports = { createDynamoActions, VALID_SECONDS };
