<?php

namespace App\InterfaceAdapters\Gateways;

use App\Core\Entities\CreditNote;
use App\Core\Entities\Invoice;

interface InvoiceRepositoryInterface
{
    public function save(Invoice $invoice): Invoice;
    public function findById(string $id): ?Invoice;
    public function findBySagaId(string $sagaId): ?Invoice;
    /** @return Invoice[] */
    public function findByClientId(string $clientId): array;
    /** Registra la nota de crédito y marca la factura como reembolsada, de forma atómica e idempotente. */
    public function refund(Invoice $invoice, CreditNote $creditNote): void;
    /** @return CreditNote[] */
    public function creditNotesOf(string $clientId): array;
}
