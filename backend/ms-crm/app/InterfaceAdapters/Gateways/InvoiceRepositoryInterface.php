<?php

namespace App\InterfaceAdapters\Gateways;

use App\Core\Entities\Invoice;

interface InvoiceRepositoryInterface
{
    public function save(Invoice $invoice): Invoice;
    public function findById(string $id): ?Invoice;
    public function findByClientId(string $clientId): array;
    public function findByAppointmentId(string $appointmentId): ?Invoice;
}
