<?php

namespace App\FrameworksDrivers\Persistence;

use App\Core\Entities\Client;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

class InMemoryClientRepository implements ClientRepositoryInterface
{
    /** @var array<string, Client> */
    private array $storage = [];

    public function save(Client $client): Client
    {
        $this->storage[$client->getId()] = $client;
        return $client;
    }

    public function findById(string $id): ?Client
    {
        return $this->storage[$id] ?? null;
    }

    public function findByEmail(string $email): ?Client
    {
        foreach ($this->storage as $client) {
            if (strtolower($client->getEmail()) === strtolower($email)) {
                return $client;
            }
        }
        return null;
    }

    public function existsEmail(string $email): bool
    {
        return $this->findByEmail($email) !== null;
    }
}
