<?php

namespace App\Core\Entities;

/**
 * Entidad de Negocio: Nota de crédito que anula una factura reembolsada (CU-11).
 */
class CreditNote
{
    public function __construct(
        public readonly string $id,
        public readonly string $invoiceId,
        public readonly string $clientId,
        public readonly float $amount,
        public readonly float $taxAmount,
        public readonly string $reason,
        public readonly ?int $number = null,
        public readonly ?string $issuedAt = null
    ) {
    }
}
