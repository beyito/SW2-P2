<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\Client;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use PDO;

class PostgresClientRepository implements ClientRepositoryInterface
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        if ($pdo) {
            $this->pdo = $pdo;
        } else {
            $host = getenv('DB_HOST') ?: 'salon-postgres';
            $port = getenv('DB_PORT') ?: '5432';
            $db   = getenv('DB_DATABASE') ?: 'salon_crm';
            $user = getenv('DB_USERNAME') ?: 'salon_admin';
            $pass = getenv('DB_PASSWORD') ?: 'salon_secret_pass';
            $dsn  = "pgsql:host={$host};port={$port};dbname={$db}";
            $this->pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
        }
    }

    public function save(Client $client): Client
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO crm_clients (id, full_name, email, phone, loyalty_points, created_at, updated_at)
             VALUES (:id, :full_name, :email, :phone, :loyalty_points, :created_at, NOW())
             ON CONFLICT (id) DO UPDATE 
             SET full_name = EXCLUDED.full_name,
                 phone = EXCLUDED.phone,
                 loyalty_points = EXCLUDED.loyalty_points,
                 updated_at = NOW()"
        );

        $stmt->execute([
            ':id' => $client->getId(),
            ':full_name' => $client->getFullName(),
            ':email' => $client->getEmail(),
            ':phone' => $client->getPhone(),
            ':loyalty_points' => $client->getLoyaltyPoints(),
            ':created_at' => $client->getCreatedAt(),
        ]);

        return $client;
    }

    public function findById(string $id): ?Client
    {
        $stmt = $this->pdo->prepare("SELECT * FROM crm_clients WHERE id = :id");
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();

        if (!$row) return null;

        return new Client(
            id: $row['id'],
            fullName: $row['full_name'],
            email: $row['email'],
            phone: $row['phone'],
            loyaltyPoints: (int)$row['loyalty_points'],
            createdAt: $row['created_at']
        );
    }

    public function findByEmail(string $email): ?Client
    {
        $stmt = $this->pdo->prepare("SELECT * FROM crm_clients WHERE LOWER(email) = LOWER(:email)");
        $stmt->execute([':email' => $email]);
        $row = $stmt->fetch();

        if (!$row) return null;

        return new Client(
            id: $row['id'],
            fullName: $row['full_name'],
            email: $row['email'],
            phone: $row['phone'],
            loyaltyPoints: (int)$row['loyalty_points'],
            createdAt: $row['created_at']
        );
    }

    public function existsEmail(string $email): bool
    {
        $stmt = $this->pdo->prepare("SELECT COUNT(*) FROM crm_clients WHERE LOWER(email) = LOWER(:email)");
        $stmt->execute([':email' => $email]);
        return (int)$stmt->fetchColumn() > 0;
    }

    public function findAll(): array
    {
        $stmt = $this->pdo->query("SELECT * FROM crm_clients ORDER BY created_at DESC");
        $rows = $stmt->fetchAll();
        $clients = [];
        foreach ($rows as $row) {
            $clients[] = new Client(
                id: $row['id'],
                fullName: $row['full_name'],
                email: $row['email'],
                phone: $row['phone'],
                loyaltyPoints: (int)$row['loyalty_points'],
                createdAt: $row['created_at']
            );
        }
        return $clients;
    }
}
