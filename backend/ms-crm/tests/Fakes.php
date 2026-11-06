<?php

namespace Tests;

use App\Core\Entities\Client;
use App\Core\Entities\CreditNote;
use App\Core\Entities\Invoice;
use App\Core\Entities\Notice;
use App\Core\Entities\StyleProfile;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;
use App\InterfaceAdapters\Gateways\NoticeRepositoryInterface;

/** Dobles en memoria con el mismo contrato que los repositorios de PostgreSQL. */
class FakeClients implements ClientRepositoryInterface
{
    /** @var array<string, Client> */
    public array $items = [];

    public function save(Client $client): Client
    {
        return $this->items[$client->getId()] = $client;
    }

    public function findById(string $id): ?Client
    {
        return $this->items[$id] ?? null;
    }

    public function findByEmail(string $email): ?Client
    {
        foreach ($this->items as $client) {
            if (strcasecmp($client->getEmail(), $email) === 0) {
                return $client;
            }
        }
        return null;
    }

    public function existsEmail(string $email): bool
    {
        return $this->findByEmail($email) !== null;
    }

    public function findAll(): array
    {
        return array_values($this->items);
    }

    public function createIfAbsent(Client $client): void
    {
        $this->items[$client->getId()] ??= $client;
    }

    public function updatePhone(string $id, string $phone): void
    {
    }

    public function updateWhatsappOptIn(string $id, bool $enabled): void
    {
    }

    public function updateStyleProfile(string $id, StyleProfile $profile): void
    {
        $client = $this->items[$id];
        $this->items[$id] = new Client(
            $client->getId(),
            $client->getFullName(),
            $client->getEmail(),
            $client->getPhone(),
            $client->getLoyaltyPoints(),
            $client->getCreatedAt(),
            $profile
        );
    }
}

class FakeInvoices implements InvoiceRepositoryInterface
{
    /** @var array<string, Invoice> */
    public array $items = [];
    /** @var array<string, CreditNote> */
    public array $notes = [];

    public function save(Invoice $invoice): Invoice
    {
        return $this->items[$invoice->getId()] = $invoice;
    }

    public function findById(string $id): ?Invoice
    {
        return $this->items[$id] ?? null;
    }

    public function findBySagaId(string $sagaId): ?Invoice
    {
        foreach ($this->items as $invoice) {
            if ($invoice->getSagaId() === $sagaId) {
                return $invoice;
            }
        }
        return null;
    }

    public function findByClientId(string $clientId): array
    {
        return array_values(array_filter($this->items, fn (Invoice $i) => $i->getClientId() === $clientId));
    }

    public function refund(Invoice $invoice, CreditNote $creditNote): void
    {
        $this->notes[$creditNote->invoiceId] ??= $creditNote;
        $invoice->markRefunded();
    }

    public function creditNotesOf(string $clientId): array
    {
        return array_values($this->notes);
    }
}

class FakeLedger implements LoyaltyLedgerInterface
{
    /** @var array<string, int> */
    public array $balances = [];
    /** @var array<string, int> */
    public array $movements = [];

    public function credit(string $clientId, int $points, string $type, string $description, string $sourceRef): void
    {
        if (!isset($this->movements[$sourceRef])) {
            $this->movements[$sourceRef] = $points;
            $this->balances[$clientId] = ($this->balances[$clientId] ?? 0) + $points;
        }
    }

    public function debit(string $clientId, int $points, string $type, string $description, string $sourceRef): bool
    {
        if (isset($this->movements[$sourceRef])) {
            return true;
        }
        if (($this->balances[$clientId] ?? 0) < $points) {
            return false;
        }
        $this->movements[$sourceRef] = $points;
        $this->balances[$clientId] -= $points;
        return true;
    }

    public function debitUpToBalance(string $clientId, int $points, string $type, string $description, string $sourceRef): void
    {
        if (!isset($this->movements[$sourceRef])) {
            $debited = min($points, $this->balances[$clientId] ?? 0);
            $this->movements[$sourceRef] = $debited;
            $this->balances[$clientId] = ($this->balances[$clientId] ?? 0) - $debited;
        }
    }

    public function pointsOf(string $sourceRef): ?int
    {
        return $this->movements[$sourceRef] ?? null;
    }

    public function balanceOf(string $clientId): int
    {
        return $this->balances[$clientId] ?? 0;
    }

    public function historyOf(string $clientId): array
    {
        return [];
    }
}

class FakeNotices implements NoticeRepositoryInterface
{
    /** @var array<string, Notice> */
    public array $items = [];

    public function addOnce(Notice $notice): bool
    {
        if (isset($this->items[$notice->sourceRef])) {
            return false;
        }
        $this->items[$notice->sourceRef] = $notice;
        return true;
    }

    public function forRecipients(array $recipients): array
    {
        return array_values(array_filter($this->items, fn (Notice $n) => in_array($n->recipient, $recipients, true)));
    }

    public function markRead(string $id, array $recipients): bool
    {
        return false;
    }
}
