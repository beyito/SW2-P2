<?php

namespace App\Core\UseCases;

use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;

/**
 * Compensación de la SAGA: devuelve los puntos apartados si la reserva no se completó.
 */
class ReleasePointsUseCase
{
    public function __construct(private LoyaltyLedgerInterface $ledger)
    {
    }

    public function execute(string $sagaId, string $clientId): void
    {
        $points = $this->ledger->pointsOf("saga:{$sagaId}:redeem");
        if ($points !== null) {
            $this->ledger->credit(
                $clientId,
                $points,
                'REVERSAL',
                'Devolución de puntos: la reserva no se completó',
                "saga:{$sagaId}:redeem-return"
            );
        }
    }
}
