<?php

namespace App\InterfaceAdapters\GraphQL;

use GraphQL\Error\ClientAware;
use GraphQL\Error\ProvidesExtensions;

/**
 * Error de negocio visible para el cliente, con la misma clasificación que usa ms-gestion.
 */
class CrmForbidden extends \RuntimeException implements ClientAware, ProvidesExtensions
{
    public function __construct(string $message, private string $classification = 'FORBIDDEN')
    {
        parent::__construct($message);
    }

    public function isClientSafe(): bool
    {
        return true;
    }

    public function getExtensions(): array
    {
        return ['classification' => $this->classification];
    }
}
