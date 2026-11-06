<?php

namespace App\Core\Entities;

/**
 * Entidad de Negocio: Factura Electrónica (CU-11, RF-08).
 * El total es lo pagado; el IVA va incluido en él.
 */
class Invoice
{
    public const TAX_RATE = 0.13;

    private float $taxAmount;
    private string $issuedAt;

    public function __construct(
        private string $id,
        private string $appointmentId,
        private string $clientId,
        private string $clientName,
        private float $totalAmount,
        private string $paymentMethod,
        private string $status = 'ISSUED',
        ?string $issuedAt = null,
        private ?string $sagaId = null,
        private ?string $serviceName = null,
        private ?float $subtotalAmount = null,
        private float $discountAmount = 0.0,
        private ?string $paymentReference = null,
        private ?int $invoiceNumber = null
    ) {
        $this->taxAmount = round($totalAmount * self::TAX_RATE, 2);
        $this->issuedAt = $issuedAt ?? date('Y-m-d H:i:s');
    }

    public function getId(): string { return $this->id; }
    public function getAppointmentId(): string { return $this->appointmentId; }
    public function getClientId(): string { return $this->clientId; }
    public function getClientName(): string { return $this->clientName; }
    public function getTotalAmount(): float { return $this->totalAmount; }
    public function getTaxAmount(): float { return $this->taxAmount; }
    public function getPaymentMethod(): string { return $this->paymentMethod; }
    public function getStatus(): string { return $this->status; }
    public function getIssuedAt(): string { return $this->issuedAt; }
    public function getSagaId(): ?string { return $this->sagaId; }
    public function getServiceName(): ?string { return $this->serviceName; }
    public function getSubtotalAmount(): float { return $this->subtotalAmount ?? $this->totalAmount; }
    public function getDiscountAmount(): float { return $this->discountAmount; }
    public function getPaymentReference(): ?string { return $this->paymentReference; }
    public function getInvoiceNumber(): ?int { return $this->invoiceNumber; }

    public function markRefunded(): void
    {
        $this->status = 'REFUNDED';
    }
}
