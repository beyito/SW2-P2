<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\Invoice;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;

class InMemoryInvoiceRepository implements InvoiceRepositoryInterface
{
    /** @var array<string, Invoice> */
    private array $storage = [];

    public function save(Invoice $invoice): Invoice
    {
        $this->storage[$invoice->getId()] = $invoice;
        return $invoice;
    }

    public function findById(string $id): ?Invoice
    {
        return $this->storage[$id] ?? null;
    }

    public function findByClientId(string $clientId): array
    {
        return array_values(array_filter($this->storage, fn($inv) => $inv->getClientId() === $clientId));
    }

    public function findByAppointmentId(string $appointmentId): ?Invoice
    {
        foreach ($this->storage as $invoice) {
            if ($invoice->getAppointmentId() === $appointmentId) {
                return $invoice;
            }
        }
        return null;
    }
}
