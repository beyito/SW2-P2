<?php

namespace App\InterfaceAdapters\Messaging;

use App\Core\Entities\LoyaltyPolicy;
use App\Core\UseCases\ApplyRefundUseCase;
use App\Core\UseCases\ProcessCompletedBookingUseCase;
use App\Core\UseCases\ReleasePointsUseCase;
use App\Core\UseCases\ReservePointsUseCase;

/**
 * Traduce los mensajes de la SAGA a casos de uso y devuelve los eventos de respuesta.
 * No conoce RabbitMQ, así que se prueba sin infraestructura.
 */
class SagaMessageHandler
{
    public function __construct(
        private ProcessCompletedBookingUseCase $completedBooking,
        private ReservePointsUseCase $reservePoints,
        private ReleasePointsUseCase $releasePoints,
        private ApplyRefundUseCase $applyRefund
    ) {
    }

    /** @return array<int, array{routingKey: string, body: array}> Eventos a publicar. */
    public function handle(string $routingKey, array $message): array
    {
        $sagaId = $message['sagaId'];

        switch ($routingKey) {
            case 'saga.completed':
                $this->completedBooking->execute($message);
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
                $this->applyRefund->execute($sagaId, $message['reason'] ?? 'Cancelación de la reserva');
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
