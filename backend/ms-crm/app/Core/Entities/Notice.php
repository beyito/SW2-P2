<?php

namespace App\Core\Entities;

/**
 * Aviso dentro de la aplicación para un usuario o para todos los de un rol.
 */
final class Notice
{
    public const ADMINS = 'role:ADMIN';

    public function __construct(
        public readonly string $id,
        public readonly string $recipient,
        public readonly string $type,
        public readonly string $title,
        public readonly string $message,
        public readonly ?string $sourceRef = null,
        public readonly bool $read = false,
        public readonly ?string $createdAt = null
    ) {
    }
}
