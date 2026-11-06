<?php

namespace App\Core\UseCases;

use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;

/**
 * Caso de Uso: Ajuste manual de puntos de fidelidad por un administrador (CU-12).
 */
class AccumulatePointsUseCase
{
    public function __construct(
        private ClientRepositoryInterface $clients,
        private LoyaltyLedgerInterface $ledger
    ) {
    }

    public function execute(string $clientId, int $points, string $description): int
    {
        if ($points <= 0) {
            throw new \InvalidArgumentException('Los puntos a sumar deben ser mayores a cero.');
        }
        if (!$this->clients->findById($clientId)) {
            throw new \InvalidArgumentException("Cliente no encontrado con ID: {$clientId}");
        }

        $this->ledger->credit($clientId, $points, 'ADJUSTMENT', $description, 'manual:' . bin2hex(random_bytes(8)));

        return $this->ledger->balanceOf($clientId);
    }
}
