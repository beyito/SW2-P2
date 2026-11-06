<?php

namespace App\InterfaceAdapters\GraphQL;

use App\Core\Entities\Client;
use App\Core\Entities\CreditNote;
use App\Core\Entities\Invoice;
use App\Core\Entities\Notice;

/**
 * Convierte las entidades del dominio al formato del esquema GraphQL.
 */
final class CrmPresenter
{
    public static function client(?Client $client): ?array
    {
        return $client ? [
            'id' => $client->getId(),
            'fullName' => $client->getFullName(),
            'email' => $client->getEmail(),
            'phone' => $client->getPhone(),
            'loyaltyPoints' => $client->getLoyaltyPoints(),
            'createdAt' => $client->getCreatedAt(),
        ] : null;
    }

    public static function invoice(?Invoice $invoice): ?array
    {
        return $invoice ? [
            'id' => $invoice->getId(),
            'invoiceNumber' => $invoice->getInvoiceNumber(),
            'appointmentId' => $invoice->getAppointmentId(),
            'clientId' => $invoice->getClientId(),
            'clientName' => $invoice->getClientName(),
            'serviceName' => $invoice->getServiceName(),
            'subtotalAmount' => $invoice->getSubtotalAmount(),
            'discountAmount' => $invoice->getDiscountAmount(),
            'totalAmount' => $invoice->getTotalAmount(),
            'taxAmount' => $invoice->getTaxAmount(),
            'paymentMethod' => $invoice->getPaymentMethod(),
            'status' => $invoice->getStatus(),
            'issuedAt' => $invoice->getIssuedAt(),
        ] : null;
    }

    public static function notice(Notice $notice): array
    {
        return [
            'id' => $notice->id,
            'type' => $notice->type,
            'title' => $notice->title,
            'message' => $notice->message,
            'read' => $notice->read,
            'createdAt' => $notice->createdAt,
        ];
    }

    public static function creditNote(CreditNote $note): array
    {
        return [
            'id' => $note->id,
            'creditNoteNumber' => $note->number,
            'invoiceId' => $note->invoiceId,
            'clientId' => $note->clientId,
            'amount' => $note->amount,
            'taxAmount' => $note->taxAmount,
            'reason' => $note->reason,
            'issuedAt' => $note->issuedAt,
        ];
    }
}
