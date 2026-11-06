<?php

namespace App\FrameworksDrivers\Security;

use App\InterfaceAdapters\Security\SessionRegistryInterface;

/**
 * Registro de sesiones sobre la tabla ActiveUserSessions de DynamoDB.
 */
class DynamoSessionRegistry implements SessionRegistryInterface
{
    private const TABLE = 'ActiveUserSessions';
    private const CONDITION_FAILED = 'ConditionalCheckFailedException';
    private const EIGHT_HOURS = 28800;

    public function __construct(private readonly string $endpoint)
    {
    }

    public function isRevoked(string $sessionId): bool
    {
        return isset($this->getItem('revoked#' . $sessionId)['Item']);
    }

    public function findActive(string $userId): ?array
    {
        $item = $this->getItem($userId)['Item'] ?? null;
        if ($item === null) {
            return null;
        }
        return ['sessionId' => $item['sessionId']['S'], 'authTime' => (int) $item['loginTimestamp']['N']];
    }

    public function claimActive(string $userId, string $sessionId, int $authTime): bool
    {
        $result = $this->call('PutItem', [
            'TableName' => self::TABLE,
            'Item' => [
                'userId' => ['S' => $userId],
                'sessionId' => ['S' => $sessionId],
                'loginTimestamp' => ['N' => (string) $authTime],
                'ttl' => ['N' => (string) ($authTime + self::EIGHT_HOURS)],
            ],
            'ConditionExpression' => 'attribute_not_exists(userId) OR loginTimestamp < :t OR sessionId = :s',
            'ExpressionAttributeValues' => [
                ':t' => ['N' => (string) $authTime],
                ':s' => ['S' => $sessionId],
            ],
        ]);
        return !str_contains($result['__type'] ?? '', self::CONDITION_FAILED);
    }

    private function getItem(string $key): array
    {
        return $this->call('GetItem', [
            'TableName' => self::TABLE,
            'ConsistentRead' => true,
            'Key' => ['userId' => ['S' => $key]],
        ]);
    }

    private function call(string $target, array $payload): array
    {
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'timeout' => 3,
            'ignore_errors' => true,
            'header' => implode("\r\n", [
                'Content-Type: application/x-amz-json-1.0',
                'X-Amz-Target: DynamoDB_20120810.' . $target,
                'Authorization: AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, '
                    . 'SignedHeaders=host, Signature=local',
            ]),
            'content' => json_encode($payload),
        ]]);

        $body = @file_get_contents($this->endpoint, false, $context);
        if ($body === false) {
            throw new \RuntimeException('DynamoDB no disponible');
        }

        $result = json_decode($body, true) ?? [];
        $status = (int) substr($http_response_header[0] ?? '', 9, 3);
        if ($status !== 200 && !str_contains($result['__type'] ?? '', self::CONDITION_FAILED)) {
            throw new \RuntimeException('DynamoDB respondió ' . $status);
        }
        return $result;
    }
}
