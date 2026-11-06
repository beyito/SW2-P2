<?php

namespace App\Core\UseCases;

use App\Core\Entities\Invoice;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

/**
 * Caso de Uso: Emitir Factura Electrónica (CU-11, RF-08)
 */
class GenerateInvoiceUseCase
{
    private InvoiceRepositoryInterface $invoiceRepo;
    private ClientRepositoryInterface $clientRepo;

    public function __construct(
        InvoiceRepositoryInterface $invoiceRepo,
        ClientRepositoryInterface $clientRepo
    ) {
        $this->invoiceRepo = $invoiceRepo;
        $this->clientRepo = $clientRepo;
    }

    public function execute(string $appointmentId, string $clientId, float $totalAmount, string $paymentMethod): Invoice
    {
        $client = $this->clientRepo->findById($clientId);
        $clientName = $client ? $client->getFullName() : 'Cliente General';

        $invoice = new Invoice(
            id: 'inv_' . bin2hex(random_bytes(8)),
            appointmentId: $appointmentId,
            clientId: $clientId,
            clientName: $clientName,
            totalAmount: $totalAmount,
            paymentMethod: $paymentMethod
        );

        return $this->invoiceRepo->save($invoice);
    }
}
