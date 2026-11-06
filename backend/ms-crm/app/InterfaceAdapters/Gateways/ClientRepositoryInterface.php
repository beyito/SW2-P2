<?php

namespace App\InterfaceAdapters\Gateways;

use App\Core\Entities\Client;
use App\Core\Entities\StyleProfile;

interface ClientRepositoryInterface
{
    public function save(Client $client): Client;
    public function findById(string $id): ?Client;
    public function findByEmail(string $email): ?Client;
    public function existsEmail(string $email): bool;
    /** @return Client[] */
    public function findAll(): array;
    /** Crea el cliente si no existe; nunca modifica sus puntos ni sus datos. */
    public function createIfAbsent(Client $client): void;
    public function updatePhone(string $id, string $phone): void;
    public function updateStyleProfile(string $id, StyleProfile $profile): void;
    public function updateWhatsappOptIn(string $id, bool $enabled): void;
}
