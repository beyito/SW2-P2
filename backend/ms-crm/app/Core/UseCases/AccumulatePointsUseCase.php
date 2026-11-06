<?php

namespace App\Core\UseCases;

use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

/**
 * Caso de Uso: Acumular y Consultar Puntos de Fidelidad (CU-12, RF-08)
 */
class AccumulatePointsUseCase
{
    private ClientRepositoryInterface $repository;

    public function __construct(ClientRepositoryInterface $repository)
    {
        $this->repository = $repository;
    }

    public function execute(string $clientId, int $points): int
    {
        $client = $this->repository->findById($clientId);
        if (!$client) {
            throw new \InvalidArgumentException("Cliente no encontrado con ID: {$clientId}");
        }

        $client->addPoints($points);
        $this->repository->save($client);

        return $client->getLoyaltyPoints();
    }
}
