<?php

namespace App\InterfaceAdapters\Gateways;

use App\Core\Entities\Client;

interface ClientRepositoryInterface
{
    public function save(Client $client): Client;
    public function findById(string $id): ?Client;
    public function findByEmail(string $email): ?Client;
    public function existsEmail(string $email): bool;
}
