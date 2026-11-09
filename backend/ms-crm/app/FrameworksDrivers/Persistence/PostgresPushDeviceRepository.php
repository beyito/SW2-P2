<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\Notice;
use App\InterfaceAdapters\Gateways\PushDeviceRepositoryInterface;
use PDO;

/**
 * Teléfonos para notificaciones push, en la tabla push_devices (12_push_crm.sql).
 */
class PostgresPushDeviceRepository implements PushDeviceRepositoryInterface
{
    public function __construct(private PDO $pdo)
    {
    }

    public function register(string $token, string $userId, bool $isAdmin): void
    {
        // Si el teléfono cambia de cuenta, el token pasa a la nueva
        $this->pdo->prepare(
            "INSERT INTO push_devices (token, user_id, is_admin) VALUES (?, ?, ?)
             ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, is_admin = EXCLUDED.is_admin, updated_at = NOW()"
        )->execute([$token, $userId, $isAdmin ? 'true' : 'false']);
    }

    public function remove(string $token): void
    {
        $this->pdo->prepare('DELETE FROM push_devices WHERE token = ?')->execute([$token]);
    }

    public function tokensFor(string $recipient): array
    {
        $stmt = $recipient === Notice::ADMINS
            ? $this->pdo->prepare('SELECT token FROM push_devices WHERE is_admin')
            : $this->pdo->prepare('SELECT token FROM push_devices WHERE user_id = ?');
        $stmt->execute($recipient === Notice::ADMINS ? [] : [$recipient]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }
}
