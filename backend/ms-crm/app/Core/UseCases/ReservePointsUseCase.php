<?php

namespace App\Core\UseCases;

use App\Core\Entities\LoyaltyPolicy;
use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;

/**
 * Caso de Uso: Apartar puntos para pagar parte de una reserva (CU-12, RF-08).
 * Es un paso compensable de la SAGA: si el pago falla, ReleasePointsUseCase los devuelve.
 */
class ReservePointsUseCase
{
    public function __construct(private LoyaltyLedgerInterface $ledger)
    {
    }

    /** @return string|null Motivo del rechazo, o null si los puntos quedaron apartados. */
    public function execute(string $sagaId, string $clientId, int $points, int $amountCents): ?string
    {
        if (!LoyaltyPolicy::canRedeem($points, $amountCents)) {
            return 'POINTS_EXCEED_LIMIT';
        }

        $reserved = $this->ledger->debit(
            $clientId,
            $points,
            'REDEMPTION',
            'Canje de puntos en una reserva',
            "saga:{$sagaId}:redeem"
        );

        return $reserved ? null : 'POINTS_INSUFFICIENT';
    }
}
