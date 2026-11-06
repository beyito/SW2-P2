<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\Client;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use PDO;

class PostgresClientRepository implements ClientRepositoryInterface
{
    public function __construct(private PDO $pdo)
    {
    }

    public function save(Client $client): Client
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO crm_clients (id, full_name, email, phone, loyalty_points, created_at, updated_at)
             VALUES (:id, :full_name, :email, :phone, :loyalty_points, :created_at, NOW())
             ON CONFLICT (id) DO UPDATE
             SET full_name = EXCLUDED.full_name,
                 phone = EXCLUDED.phone,
                 updated_at = NOW()"
        );
        $stmt->execute($this->params($client));

        return $client;
    }

    public function createIfAbsent(Client $client): void
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO crm_clients (id, full_name, email, phone, loyalty_points, created_at, updated_at)
             VALUES (:id, :full_name, :email, :phone, :loyalty_points, :created_at, NOW())
             ON CONFLICT DO NOTHING"
        );
        $stmt->execute($this->params($client));
    }

    public function updatePhone(string $id, string $phone): void
    {
        $stmt = $this->pdo->prepare("UPDATE crm_clients SET phone = :phone, updated_at = NOW() WHERE id = :id");
        $stmt->execute([':id' => $id, ':phone' => $phone]);
    }

    public function findById(string $id): ?Client
    {
        $stmt = $this->pdo->prepare("SELECT * FROM crm_clients WHERE id = :id");
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? $this->toEntity($row) : null;
    }

    public function findByEmail(string $email): ?Client
    {
        $stmt = $this->pdo->prepare("SELECT * FROM crm_clients WHERE LOWER(email) = LOWER(:email)");
        $stmt->execute([':email' => $email]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? $this->toEntity($row) : null;
    }

    public function existsEmail(string $email): bool
    {
        return $this->findByEmail($email) !== null;
    }

    public function findAll(): array
    {
        $rows = $this->pdo->query("SELECT * FROM crm_clients ORDER BY created_at DESC")->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn (array $row) => $this->toEntity($row), $rows);
    }

    private function params(Client $client): array
    {
        return [
            ':id' => $client->getId(),
            ':full_name' => $client->getFullName(),
            ':email' => $client->getEmail(),
            ':phone' => $client->getPhone(),
            ':loyalty_points' => $client->getLoyaltyPoints(),
            ':created_at' => $client->getCreatedAt(),
        ];
    }

    private function toEntity(array $row): Client
    {
        return new Client(
            id: $row['id'],
            fullName: $row['full_name'],
            email: $row['email'],
            phone: $row['phone'],
            loyaltyPoints: (int) $row['loyalty_points'],
            createdAt: $row['created_at']
        );
    }
}
