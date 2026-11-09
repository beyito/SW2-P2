<?php

namespace App\InterfaceAdapters\Gateways;

/**
 * Teléfonos registrados para recibir notificaciones push (Firebase Cloud Messaging).
 */
interface PushDeviceRepositoryInterface
{
    /** Registra o actualiza el token de un teléfono; un token pertenece a un solo usuario. */
    public function register(string $token, string $userId, bool $isAdmin): void;

    public function remove(string $token): void;

    /**
     * Tokens del destinatario de un aviso: un usuario, o todos los administradores (Notice::ADMINS).
     * @return string[]
     */
    public function tokensFor(string $recipient): array;
}
