<?php

namespace App\Core\Entities;

/**
 * Entidad de Negocio: Factura Electrónica (CU-11, RF-08)
 */
class Invoice
{
    private string $id;
    private string $appointmentId;
    private string $clientId;
    private string $clientName;
    private float $totalAmount;
    private float $taxAmount;
    private string $paymentMethod;
    private string $status;
    private string $issuedAt;

    public function __construct(
        string $id,
        string $appointmentId,
        string $clientId,
        string $clientName,
        float $totalAmount,
        string $paymentMethod,
        float $taxRate = 0.13, // 13% IVA estándar
        ?string $status = 'ISSUED',
        ?string $issuedAt = null
    ) {
        $this->id = $id;
        $this->appointmentId = $appointmentId;
        $this->clientId = $clientId;
        $this->clientName = $clientName;
        $this->totalAmount = $totalAmount;
        $this->taxAmount = round($totalAmount * $taxRate, 2);
        $this->paymentMethod = $paymentMethod;
        $this->status = $status ?? 'ISSUED';
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
}
