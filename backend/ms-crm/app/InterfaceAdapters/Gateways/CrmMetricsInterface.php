<?php

namespace App\InterfaceAdapters\Gateways;

interface CrmMetricsInterface
{
    /**
     * Indicadores de facturación y fidelización entre dos fechas, ambas incluidas (CU-17).
     *
     * @return array{revenue: float, refunded: float, invoicesIssued: int, payingClients: int, totalClients: int, pointsEarned: int, pointsRedeemed: int}
     */
    public function between(string $from, string $to): array;
}
