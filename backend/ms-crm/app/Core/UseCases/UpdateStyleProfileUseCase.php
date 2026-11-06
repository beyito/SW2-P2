<?php

namespace App\Core\UseCases;

use App\Core\Entities\Client;
use App\Core\Entities\StyleProfile;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

/**
 * Caso de Uso: el cliente responde u omite el cuestionario de estilo.
 * Omitirlo también queda registrado, para no volver a preguntarle en cada inicio de sesión.
 */
class UpdateStyleProfileUseCase
{
    public function __construct(private ClientRepositoryInterface $repository)
    {
    }

    public function execute(Client $accountData, array $answers): Client
    {
        $profile = new StyleProfile(
            $answers['gender'] ?? null,
            $answers['ageRange'] ?? null,
            $answers['preferredLength'] ?? null,
            $answers['maintenance'] ?? null,
            $answers['vibe'] ?? null,
            date('Y-m-d H:i:s')
        );
        $this->repository->createIfAbsent($accountData);
        $this->repository->updateStyleProfile($accountData->getId(), $profile);
        return $this->repository->findById($accountData->getId());
    }
}
