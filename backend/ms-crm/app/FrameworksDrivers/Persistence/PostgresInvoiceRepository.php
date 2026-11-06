<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\Invoice;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use PDO;

class PostgresInvoiceRepository implements InvoiceRepositoryInterface
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        if ($pdo) {
            $this->pdo = $pdo;
        } else {
            $host = getenv('DB_HOST') ?: 'salon-postgres';
            $port = getenv('DB_PORT') ?: '5432';
            $db   = getenv('DB_DATABASE') ?: 'salon_crm';
            $user = getenv('DB_USERNAME') ?: 'salon_admin';
            $pass = getenv('DB_PASSWORD') ?: 'salon_secret_pass';
            $dsn  = "pgsql:host={$host};port={$port};dbname={$db}";
            $this->pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
        }
    }

    public function save(Invoice $invoice): Invoice
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO invoices (id, appointment_id, client_id, client_name, total_amount, tax_amount, payment_method, status, issued_at)
             VALUES (:id, :appointment_id, :client_id, :client_name, :total_amount, :tax_amount, :payment_method, :status, :issued_at)
             ON CONFLICT (id) DO UPDATE 
             SET status = EXCLUDED.status"
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
        ]);

        return $invoice;
    }

    public function findById(string $id): ?Invoice
    {
        $stmt = $this->pdo->prepare("SELECT * FROM invoices WHERE id = :id");
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();

        if (!$row) return null;

        return $this->toEntity($row);
    }

    public function findByClientId(string $clientId): array
    {
        $stmt = $this->pdo->prepare("SELECT * FROM invoices WHERE client_id = :client_id ORDER BY issued_at DESC");
        $stmt->execute([':client_id' => $clientId]);
        $rows = $stmt->fetchAll();

        return array_map([$this, 'toEntity'], $rows);
    }

    public function findByAppointmentId(string $appointmentId): ?Invoice
    {
        $stmt = $this->pdo->prepare("SELECT * FROM invoices WHERE appointment_id = :appointment_id");
        $stmt->execute([':appointment_id' => $appointmentId]);
        $row = $stmt->fetch();

        if (!$row) return null;

        return $this->toEntity($row);
    }

    private function toEntity(array $row): Invoice
    {
        return new Invoice(
            id: $row['id'],
            appointmentId: $row['appointment_id'],
            clientId: $row['client_id'],
            clientName: $row['client_name'],
            totalAmount: (float)$row['total_amount'],
            paymentMethod: $row['payment_method'],
            taxRate: 0.13,
            status: $row['status'],
            issuedAt: $row['issued_at']
        );
    }
}
