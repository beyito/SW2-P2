<?php

namespace App\InterfaceAdapters\Messaging;

use App\Core\Entities\LoyaltyPolicy;
use App\Core\UseCases\ApplyRefundUseCase;
use App\Core\UseCases\ProcessCompletedBookingUseCase;
use App\Core\UseCases\RecordNoticesUseCase;
use App\Core\UseCases\ReleasePointsUseCase;
use App\Core\UseCases\ReservePointsUseCase;

/**
 * Traduce los mensajes de la SAGA y los eventos que generan avisos a casos de uso,
 * y devuelve los eventos de respuesta.
 * No conoce RabbitMQ, así que se prueba sin infraestructura.
 */
class SagaMessageHandler
{
    public function __construct(
        private ProcessCompletedBookingUseCase $completedBooking,
        private ReservePointsUseCase $reservePoints,
        private ReleasePointsUseCase $releasePoints,
        private ApplyRefundUseCase $applyRefund,
        private RecordNoticesUseCase $notices
    ) {
    }

    /** @return array<int, array{routingKey: string, body: array}> Eventos a publicar. */
    public function handle(string $routingKey, array $message): array
    {
        $sagaId = $message['sagaId'] ?? null;

        switch ($routingKey) {
            case 'saga.completed':
                $invoice = $this->completedBooking->execute($message);
                $this->notices->paymentConfirmed($sagaId, $invoice->getClientId(), $message['serviceName'] ?? null);
                return [];

            case 'inventory.stock.critical':
                $this->notices->stockCritical($message['items'] ?? [], date('Y-m-d'), $message['names'] ?? []);
                return [];

            case 'community.post.hidden':
                $this->notices->postHidden($message['postId'], $message['authorId'], $message['title'], $message['reason']);
                return [];

            case 'crm.command.points.reserve':
                $points = (int) $message['points'];
                $rejection = $this->reservePoints->execute($sagaId, $message['clientId'], $points, (int) $message['amountCents']);
                return $rejection
                    ? [$this->event('points.reserve_failed', ['sagaId' => $sagaId, 'reason' => $rejection])]
                    : [$this->event('points.reserved', [
                        'sagaId' => $sagaId,
                        'pointsRedeemed' => $points,
                        'discountCents' => LoyaltyPolicy::discountCentsFor($points),
                    ])];

            case 'crm.command.points.release':
                $this->releasePoints->execute($sagaId, $message['clientId']);
                return [$this->event('points.released', ['sagaId' => $sagaId])];

            case 'crm.command.refund.apply':
                $invoice = $this->applyRefund->execute($sagaId, $message['reason'] ?? 'Cancelación de la reserva');
                $this->notices->refundApplied($sagaId, $invoice->getClientId(), $invoice->getTotalAmount());
                return [$this->event('refund.applied', ['sagaId' => $sagaId])];

            default:
                return [];
        }
    }

    private function event(string $name, array $body): array
    {
        return ['routingKey' => "saga.event.{$name}", 'body' => $body];
    }
}
