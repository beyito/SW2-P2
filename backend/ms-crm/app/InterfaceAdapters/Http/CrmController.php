<?php

namespace App\InterfaceAdapters\Http;

use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class CrmController
{
    public function health(): JsonResponse
    {
        return response()->json(['service' => 'ms-crm', 'status' => 'UP', 'framework' => 'Laravel / Clean Architecture']);
    }

    public function clients(ClientRepositoryInterface $clients): JsonResponse
    {
        return response()->json(array_map(fn ($client) => [
            'id' => $client->getId(),
            'fullName' => $client->getFullName(),
            'email' => $client->getEmail(),
            'loyaltyPoints' => $client->getLoyaltyPoints(),
        ], $clients->findAll()));
    }

    /** Comprobante imprimible de una factura (CU-11). */
    public function receipt(Request $request, string $id, InvoiceRepositoryInterface $invoices): Response|JsonResponse
    {
        $invoice = $invoices->findById($id);
        if (!$invoice) {
            return response()->json(['code' => 'NOT_FOUND', 'message' => 'La factura no existe.'], 404);
        }

        $claims = $request->attributes->get('claims');
        $isStaff = array_intersect(['ADMIN', 'STYLIST'], $claims['realm_access']['roles'] ?? []) !== [];
        if (!$isStaff && ($claims['salon_id'] ?? $claims['sub']) !== $invoice->getClientId()) {
            return response()->json(['code' => 'NOT_OWNER', 'message' => 'No puede ver la factura de otro cliente.'], 403);
        }

        $money = fn (float $value) => number_format($value, 2);
        $text = fn (?string $value) => htmlspecialchars((string) $value, ENT_QUOTES);
        $refunded = $invoice->getStatus() === 'REFUNDED'
            ? '<p><strong>ANULADA: reembolsada con nota de crédito.</strong></p>'
            : '';

        return response(<<<HTML
            <!doctype html>
            <html lang="es">
            <head><meta charset="utf-8"><title>Comprobante {$invoice->getInvoiceNumber()}</title></head>
            <body style="font-family: sans-serif; max-width: 480px; margin: 24px auto;">
              <h1>Salón &amp; IA Studio</h1>
              <h2>Comprobante N.º {$invoice->getInvoiceNumber()}</h2>
              {$refunded}
              <p>Cliente: {$text($invoice->getClientName())}</p>
              <p>Fecha: {$text($invoice->getIssuedAt())}</p>
              <p>Servicio: {$text($invoice->getServiceName())}</p>
              <p>Subtotal: \${$money($invoice->getSubtotalAmount())} USD</p>
              <p>Descuento por puntos: \${$money($invoice->getDiscountAmount())} USD</p>
              <p><strong>Total pagado: \${$money($invoice->getTotalAmount())} USD</strong></p>
              <p>IVA 13% incluido: \${$money($invoice->getTaxAmount())} USD</p>
              <p>Referencia de pago: {$text($invoice->getPaymentReference())}</p>
              <p><small>Documento de demostración, sin validez fiscal.</small></p>
            </body>
            </html>
            HTML, 200, ['Content-Type' => 'text/html; charset=utf-8']);
    }
}
