<?php

namespace App\Core\UseCases;

use App\Core\Entities\Client;
use App\Core\Entities\Invoice;
use App\Core\Entities\LoyaltyPolicy;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;

/**
 * Caso de Uso: una reserva pagada genera su factura y sus puntos (CU-11, CU-12, RF-08).
 * El evento puede llegar repetido: nunca emite dos facturas ni suma dos veces.
 */
class ProcessCompletedBookingUseCase
{
    public function __construct(
        private ClientRepositoryInterface $clients,
        private InvoiceRepositoryInterface $invoices,
        private LoyaltyLedgerInterface $ledger
    ) {
    }

    public function execute(array $event): Invoice
    {
        $sagaId = $event['sagaId'];
        $clientId = $event['clientId'];
        $subtotalCents = (int) $event['amountCents'];
        $discountCents = (int) ($event['discountCents'] ?? 0);
        $paidCents = $subtotalCents - $discountCents;

        // Las cuentas creadas en Keycloak aún pueden no tener ficha en el CRM
        $this->clients->createIfAbsent(new Client(
            id: $clientId,
            fullName: $event['clientName'] ?? 'Cliente',
            email: $event['clientEmail'] ?? "{$clientId}@sin-correo.local",
            phone: ''
        ));

        $invoice = $this->invoices->findBySagaId($sagaId) ?? $this->invoices->save(new Invoice(
            id: 'inv_' . bin2hex(random_bytes(8)),
            appointmentId: $event['appointmentId'],
            clientId: $clientId,
            clientName: $this->clients->findById($clientId)?->getFullName() ?? 'Cliente',
            totalAmount: $paidCents / 100,
            paymentMethod: Invoice::normalizePaymentMethod($event['paymentMethod'] ?? null),
            sagaId: $sagaId,
            serviceName: $event['serviceName'] ?? null,
            subtotalAmount: $subtotalCents / 100,
            discountAmount: $discountCents / 100,
            paymentReference: $event['paymentIntentId'] ?? null
        ));

        $earned = LoyaltyPolicy::pointsEarnedFor($paidCents);
        if ($earned > 0) {
            $this->ledger->credit(
                $clientId,
                $earned,
                'ACCUMULATION',
                'Puntos por ' . ($event['serviceName'] ?? 'servicio'),
                "saga:{$sagaId}:earn"
            );
        }

        return $invoice;
    }
}
