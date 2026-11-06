<?php

namespace App\InterfaceAdapters\Security;

/**
 * Registro de sesiones activas y revocadas (RF-01, CU-01, CU-02).
 */
interface SessionRegistryInterface
{
    public function isRevoked(string $sessionId): bool;

    /** @return array{sessionId: string, authTime: int}|null */
    public function findActive(string $userId): ?array;

    /** Devuelve false si otra sesión más reciente ya ocupa el registro. */
    public function claimActive(string $userId, string $sessionId, int $authTime): bool;
}
