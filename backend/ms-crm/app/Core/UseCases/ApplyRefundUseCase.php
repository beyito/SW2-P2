<?php

namespace App\Core\UseCases;

use App\Core\Entities\CreditNote;
use App\Core\Entities\Invoice;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;

/**
 * Caso de Uso: un reembolso anula la factura con una nota de crédito y revierte los puntos (CU-07, CU-11, CU-12).
 * Quita lo ganado con la compra y devuelve lo canjeado. Se puede repetir sin efectos dobles.
 */
class ApplyRefundUseCase
{
    public function __construct(
        private InvoiceRepositoryInterface $invoices,
        private LoyaltyLedgerInterface $ledger
    ) {
    }

    public function execute(string $sagaId, string $reason): Invoice
    {
        $invoice = $this->invoices->findBySagaId($sagaId);
        if (!$invoice) {
            throw new \RuntimeException("No existe factura para la SAGA {$sagaId}");
        }

        $this->invoices->refund($invoice, new CreditNote(
            id: 'cn_' . bin2hex(random_bytes(8)),
            invoiceId: $invoice->getId(),
            clientId: $invoice->getClientId(),
            amount: $invoice->getTotalAmount(),
            taxAmount: $invoice->getTaxAmount(),
            reason: $reason
        ));

        $clientId = $invoice->getClientId();

        $earned = $this->ledger->pointsOf("saga:{$sagaId}:earn");
        if ($earned !== null) {
            // Si el cliente ya gastó esos puntos, el saldo queda en cero y no en negativo
            $this->ledger->debitUpToBalance(
                $clientId,
                $earned,
                'REVERSAL',
                'Reversión de puntos ganados: reserva reembolsada',
                "saga:{$sagaId}:earn-reversal"
            );
        }

        $redeemed = $this->ledger->pointsOf("saga:{$sagaId}:redeem");
        if ($redeemed !== null) {
            $this->ledger->credit(
                $clientId,
                $redeemed,
                'REVERSAL',
                'Devolución de puntos canjeados: reserva reembolsada',
                "saga:{$sagaId}:redeem-return"
            );
        }

        return $invoice;
    }
}
