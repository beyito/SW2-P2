<?php

namespace App\Core\UseCases;

use App\Core\Entities\Notice;
use App\InterfaceAdapters\Gateways\NoticeRepositoryInterface;

/**
 * Caso de Uso: convierte los eventos del negocio en avisos dentro de la aplicación.
 * Los eventos pueden llegar repetidos: cada aviso lleva una referencia única.
 */
class RecordNoticesUseCase
{
    public function __construct(private NoticeRepositoryInterface $notices)
    {
    }

    public function paymentConfirmed(string $sagaId, string $clientId, ?string $serviceName): void
    {
        $this->add($clientId, 'PAYMENT', 'Pago confirmado', 'Tu reserva de ' . ($serviceName ?? 'servicio') . ' está confirmada y tu factura ya está disponible.', "saga:{$sagaId}:notice-paid");
    }

    public function refundApplied(string $sagaId, string $clientId, float $amount): void
    {
        $this->add($clientId, 'REFUND', 'Reembolso procesado', sprintf('Se reembolsaron $%.2f y se emitió la nota de crédito.', $amount), "saga:{$sagaId}:notice-refund");
    }

    /** @param string[] $itemCodes Un aviso por insumo y por día, para no saturar a los administradores. */
    public function stockCritical(array $itemCodes, string $date): void
    {
        foreach ($itemCodes as $code) {
            $this->add(Notice::ADMINS, 'STOCK', 'Stock crítico', "El insumo {$code} llegó a su nivel mínimo. Conviene reponerlo.", "stock:{$code}:{$date}");
        }
    }

    public function postHidden(string $postId, string $authorId, string $title, string $reason): void
    {
        $this->add($authorId, 'MODERATION', 'Publicación oculta', "Tu publicación \"{$title}\" se ocultó del muro. Motivo: {$reason}", "post:{$postId}:hidden:" . md5($reason));
    }

    /** Aviso de una automatización. Devuelve falso si ya se había enviado, para no repetir el mensaje externo. */
    public function automation(string $recipient, string $title, string $message, string $sourceRef): bool
    {
        return $this->add($recipient, 'AUTOMATION', $title, $message, "automation:{$sourceRef}");
    }

    private function add(string $recipient, string $type, string $title, string $message, string $sourceRef): bool
    {
        return $this->notices->addOnce(new Notice(
            id: 'ntc_' . bin2hex(random_bytes(8)),
            recipient: $recipient,
            type: $type,
            title: $title,
            message: mb_substr($message, 0, 500),
            sourceRef: $sourceRef
        ));
    }
}
