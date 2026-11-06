<?php

namespace App\Core\UseCases;

use App\Core\Entities\Client;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

/**
 * Caso de Uso: Registrar Cliente en el CRM (CU-03)
 */
class RegisterClientUseCase
{
    private ClientRepositoryInterface $repository;

    public function __construct(ClientRepositoryInterface $repository)
    {
        $this->repository = $repository;
    }

    public function execute(string $fullName, string $email, string $phone): Client
    {
        if ($this->repository->existsEmail($email)) {
            throw new \DomainException("El correo '{$email}' ya se encuentra registrado en el CRM.");
        }

        $client = new Client(
            id: 'cli_' . bin2hex(random_bytes(8)),
            fullName: $fullName,
            email: $email,
            phone: $phone,
            loyaltyPoints: 0
        );

        return $this->repository->save($client);
    }
}
