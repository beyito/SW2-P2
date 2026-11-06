<?php

namespace App\FrameworksDrivers\Persistence;

use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;
use PDO;

/**
 * Libro de puntos: el movimiento y el saldo cambian en la misma transacción.
 * El índice único de source_ref garantiza que nada se aplique dos veces.
 */
class PostgresLoyaltyLedger implements LoyaltyLedgerInterface
{
    public function __construct(private PDO $pdo)
    {
    }

    public function credit(string $clientId, int $points, string $type, string $description, string $sourceRef): void
    {
        $this->transaction(function () use ($clientId, $points, $type, $description, $sourceRef) {
            if ($this->recordMovement($clientId, $points, $type, $description, $sourceRef)) {
                $this->changeBalance($clientId, $points);
            }
        });
    }

    public function debit(string $clientId, int $points, string $type, string $description, string $sourceRef): bool
    {
        return $this->transaction(function () use ($clientId, $points, $type, $description, $sourceRef) {
            if ($this->pointsOf($sourceRef) !== null) {
                return true;
            }
            // Actualización condicional: dos canjes simultáneos no pueden gastar el mismo saldo
            $update = $this->pdo->prepare(
                "UPDATE crm_clients SET loyalty_points = loyalty_points - :points, updated_at = NOW()
                 WHERE id = :id AND loyalty_points >= :required"
            );
            $update->execute([':points' => $points, ':required' => $points, ':id' => $clientId]);
            if ($update->rowCount() === 0) {
                return false;
            }
            $this->recordMovement($clientId, $points, $type, $description, $sourceRef);
            return true;
        });
    }

    public function debitUpToBalance(string $clientId, int $points, string $type, string $description, string $sourceRef): void
    {
        $this->transaction(function () use ($clientId, $points, $type, $description, $sourceRef) {
            if ($this->pointsOf($sourceRef) !== null) {
                return;
            }
            $stmt = $this->pdo->prepare("SELECT loyalty_points FROM crm_clients WHERE id = :id FOR UPDATE");
            $stmt->execute([':id' => $clientId]);
            $debited = min($points, (int) $stmt->fetchColumn());

            $this->recordMovement($clientId, $debited, $type, $description, $sourceRef);
            $this->changeBalance($clientId, -$debited);
        });
    }

    public function pointsOf(string $sourceRef): ?int
    {
        $stmt = $this->pdo->prepare("SELECT points FROM loyalty_transactions WHERE source_ref = :ref");
        $stmt->execute([':ref' => $sourceRef]);
        $points = $stmt->fetchColumn();

        return $points === false ? null : (int) $points;
    }

    public function balanceOf(string $clientId): int
    {
        $stmt = $this->pdo->prepare("SELECT loyalty_points FROM crm_clients WHERE id = :id");
        $stmt->execute([':id' => $clientId]);

        return (int) $stmt->fetchColumn();
    }

    public function historyOf(string $clientId): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT id, points, type, description, created_at FROM loyalty_transactions
             WHERE client_id = :id ORDER BY created_at DESC"
        );
        $stmt->execute([':id' => $clientId]);

        return array_map(fn (array $row) => [
            'id' => $row['id'],
            'points' => (int) $row['points'],
            'type' => $row['type'],
            'description' => $row['description'],
            'createdAt' => $row['created_at'],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    /** @return bool true si el movimiento es nuevo. */
    private function recordMovement(string $clientId, int $points, string $type, string $description, string $sourceRef): bool
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO loyalty_transactions (id, client_id, points, type, description, source_ref)
             VALUES (:id, :client_id, :points, :type, :description, :source_ref)
             ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING"
        );
        $stmt->execute([
            ':id' => 'loy_' . bin2hex(random_bytes(8)),
            ':client_id' => $clientId,
            ':points' => $points,
            ':type' => $type,
            ':description' => $description,
            ':source_ref' => $sourceRef,
        ]);

        return $stmt->rowCount() > 0;
    }

    private function changeBalance(string $clientId, int $delta): void
    {
        $stmt = $this->pdo->prepare(
            "UPDATE crm_clients SET loyalty_points = loyalty_points + :delta, updated_at = NOW() WHERE id = :id"
        );
        $stmt->execute([':delta' => $delta, ':id' => $clientId]);
    }

    private function transaction(callable $work): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $result = $work();
            $this->pdo->commit();
            return $result;
        } catch (\Throwable $error) {
            $this->pdo->rollBack();
            throw $error;
        }
    }
}
