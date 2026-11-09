<?php

namespace App\InterfaceAdapters\Gateways;

/**
 * Envío de una notificación push a un teléfono.
 */
interface PushSenderInterface
{
    public const SENT = 'SENT';
    /** El token ya no sirve (la app se desinstaló o renovó su token): hay que olvidarlo. */
    public const INVALID_TOKEN = 'INVALID_TOKEN';
    public const FAILED = 'FAILED';

    /** @param array<string, string> $data Datos para la app, además del título y el texto. */
    public function send(string $token, string $title, string $body, array $data = []): string;
}
