<?php

namespace App\InterfaceAdapters\Security;

/**
 * Error de autenticación o autorización con su código HTTP semántico.
 */
class AuthException extends \RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message
    ) {
        parent::__construct($message);
    }
}
