<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\Notice;
use App\InterfaceAdapters\Gateways\NoticeRepositoryInterface;
use PDO;

class PostgresNoticeRepository implements NoticeRepositoryInterface
{
    private const MAX_NOTICES = 50;

    public function __construct(private PDO $pdo)
    {
    }

    public function addOnce(Notice $notice): bool
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO notices (id, recipient, type, title, message, source_ref)
             VALUES (:id, :recipient, :type, :title, :message, :source_ref)
             ON CONFLICT (source_ref) DO NOTHING"
        );
        $stmt->execute([
            ':id' => $notice->id,
            ':recipient' => $notice->recipient,
            ':type' => $notice->type,
            ':title' => $notice->title,
            ':message' => $notice->message,
            ':source_ref' => $notice->sourceRef,
        ]);
        return $stmt->rowCount() === 1;
    }

    public function forRecipients(array $recipients): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM notices WHERE recipient IN (' . $this->placeholders($recipients) . ')
             ORDER BY created_at DESC, id LIMIT ' . self::MAX_NOTICES
        );
        $stmt->execute(array_values($recipients));

        return array_map(fn (array $row) => new Notice(
            id: $row['id'],
            recipient: $row['recipient'],
            type: $row['type'],
            title: $row['title'],
            message: $row['message'],
            sourceRef: $row['source_ref'],
            read: $row['read_at'] !== null,
            createdAt: $row['created_at']
        ), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function markRead(string $id, array $recipients): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE notices SET read_at = COALESCE(read_at, NOW())
             WHERE id = ? AND recipient IN (' . $this->placeholders($recipients) . ')'
        );
        $stmt->execute([$id, ...array_values($recipients)]);

        return $stmt->rowCount() > 0;
    }

    private function placeholders(array $values): string
    {
        return implode(',', array_fill(0, count($values), '?'));
    }
}
