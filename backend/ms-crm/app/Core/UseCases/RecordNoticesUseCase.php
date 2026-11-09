<?php

namespace App\Core\UseCases;

use App\Core\Entities\Notice;
use App\InterfaceAdapters\Gateways\NoticeRepositoryInterface;
use App\InterfaceAdapters\Gateways\PushDeviceRepositoryInterface;
use App\InterfaceAdapters\Gateways\PushSenderInterface;
use Throwable;

/**
 * Caso de Uso: convierte los eventos del negocio en avisos dentro de la aplicación y, si el
 * destinatario tiene la app móvil, también en una notificación push.
 * Los eventos pueden llegar repetidos: cada aviso lleva una referencia única y solo un aviso
 * nuevo se notifica, así que nadie recibe el mismo push dos veces.
 */
class RecordNoticesUseCase
{
    public function __construct(
        private NoticeRepositoryInterface $notices,
        private ?PushDeviceRepositoryInterface $devices = null,
        private ?PushSenderInterface $push = null
    ) {
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
        $notice = new Notice(
            id: 'ntc_' . bin2hex(random_bytes(8)),
            recipient: $recipient,
            type: $type,
            title: $title,
            message: mb_substr($message, 0, 500),
            sourceRef: $sourceRef
        );
        $isNew = $this->notices->addOnce($notice);
        if ($isNew) {
            $this->notify($notice);
        }
        return $isNew;
    }

    /** El aviso ya quedó guardado: si el push falla, la persona igual lo ve dentro de la app. */
    private function notify(Notice $notice): void
    {
        if ($this->devices === null || $this->push === null) {
            return;
        }
        try {
            foreach ($this->devices->tokensFor($notice->recipient) as $token) {
                $result = $this->push->send($token, $notice->title, $notice->message, ['type' => $notice->type, 'noticeId' => $notice->id]);
                if ($result === PushSenderInterface::INVALID_TOKEN) {
                    $this->devices->remove($token);
                }
            }
        } catch (Throwable $error) {
            error_log('[CRM] No se pudo enviar el push del aviso ' . $notice->id . ': ' . $error->getMessage());
        }
    }
}
