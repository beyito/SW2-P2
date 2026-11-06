<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\CreditNote;
use App\Core\Entities\Invoice;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use PDO;

class PostgresInvoiceRepository implements InvoiceRepositoryInterface
{
    public function __construct(private PDO $pdo)
    {
    }

    public function save(Invoice $invoice): Invoice
    {
        // Si otra entrega del mismo evento ya la creó, se conserva la factura existente
        $stmt = $this->pdo->prepare(
            "INSERT INTO invoices (id, appointment_id, client_id, client_name, total_amount, tax_amount, payment_method,
                                   status, issued_at, saga_id, service_name, subtotal_amount, discount_amount, payment_reference)
             VALUES (:id, :appointment_id, :client_id, :client_name, :total_amount, :tax_amount, :payment_method,
                     :status, :issued_at, :saga_id, :service_name, :subtotal_amount, :discount_amount, :payment_reference)
             ON CONFLICT DO NOTHING"
        );
        $stmt->execute([
            ':id' => $invoice->getId(),
            ':appointment_id' => $invoice->getAppointmentId(),
            ':client_id' => $invoice->getClientId(),
            ':client_name' => $invoice->getClientName(),
            ':total_amount' => $invoice->getTotalAmount(),
            ':tax_amount' => $invoice->getTaxAmount(),
            ':payment_method' => $invoice->getPaymentMethod(),
            ':status' => $invoice->getStatus(),
            ':issued_at' => $invoice->getIssuedAt(),
            ':saga_id' => $invoice->getSagaId(),
            ':service_name' => $invoice->getServiceName(),
            ':subtotal_amount' => $invoice->getSubtotalAmount(),
            ':discount_amount' => $invoice->getDiscountAmount(),
            ':payment_reference' => $invoice->getPaymentReference(),
        ]);

        return $invoice->getSagaId()
            ? $this->findBySagaId($invoice->getSagaId())
            : $this->findById($invoice->getId());
    }

    public function findById(string $id): ?Invoice
    {
        return $this->findOne("SELECT * FROM invoices WHERE id = :value", $id);
    }

    public function findBySagaId(string $sagaId): ?Invoice
    {
        return $this->findOne("SELECT * FROM invoices WHERE saga_id = :value", $sagaId);
    }

    public function findByClientId(string $clientId): array
    {
        $stmt = $this->pdo->prepare("SELECT * FROM invoices WHERE client_id = :client_id ORDER BY issued_at DESC");
        $stmt->execute([':client_id' => $clientId]);

        return array_map(fn (array $row) => $this->toEntity($row), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function refund(Invoice $invoice, CreditNote $creditNote): void
    {
        $this->pdo->beginTransaction();
        try {
            $note = $this->pdo->prepare(
                "INSERT INTO credit_notes (id, invoice_id, client_id, amount, tax_amount, reason)
                 VALUES (:id, :invoice_id, :client_id, :amount, :tax_amount, :reason)
                 ON CONFLICT (invoice_id) DO NOTHING"
            );
            $note->execute([
                ':id' => $creditNote->id,
                ':invoice_id' => $creditNote->invoiceId,
                ':client_id' => $creditNote->clientId,
                ':amount' => $creditNote->amount,
                ':tax_amount' => $creditNote->taxAmount,
                ':reason' => $creditNote->reason,
            ]);

            $status = $this->pdo->prepare("UPDATE invoices SET status = 'REFUNDED' WHERE id = :id");
            $status->execute([':id' => $creditNote->invoiceId]);

            $this->pdo->commit();
        } catch (\Throwable $error) {
            $this->pdo->rollBack();
            throw $error;
        }
    }

    public function creditNotesOf(string $clientId): array
    {
        $stmt = $this->pdo->prepare("SELECT * FROM credit_notes WHERE client_id = :client_id ORDER BY issued_at DESC");
        $stmt->execute([':client_id' => $clientId]);

        return array_map(fn (array $row) => new CreditNote(
            id: $row['id'],
            invoiceId: $row['invoice_id'],
            clientId: $row['client_id'],
            amount: (float) $row['amount'],
            taxAmount: (float) $row['tax_amount'],
            reason: $row['reason'],
            number: (int) $row['credit_note_number'],
            issuedAt: $row['issued_at']
        ), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function findOne(string $sql, string $value): ?Invoice
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':value' => $value]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? $this->toEntity($row) : null;
    }

    private function toEntity(array $row): Invoice
    {
        return new Invoice(
            id: $row['id'],
            appointmentId: $row['appointment_id'],
            clientId: $row['client_id'],
            clientName: $row['client_name'],
            totalAmount: (float) $row['total_amount'],
            paymentMethod: $row['payment_method'],
            status: $row['status'],
            issuedAt: $row['issued_at'],
            sagaId: $row['saga_id'],
            serviceName: $row['service_name'],
            subtotalAmount: $row['subtotal_amount'] !== null ? (float) $row['subtotal_amount'] : null,
            discountAmount: (float) $row['discount_amount'],
            paymentReference: $row['payment_reference'],
            invoiceNumber: (int) $row['invoice_number']
        );
    }
}
