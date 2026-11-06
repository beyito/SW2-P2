<?php

namespace App\FrameworksDrivers\Security;

/**
 * Obtiene el JWKS de Keycloak y lo guarda cinco minutos en un archivo temporal,
 * porque cada petición de PHP arranca sin memoria compartida.
 */
class CachedJwksProvider
{
    private const TTL_SECONDS = 300;

    public function __construct(private readonly string $jwksUri)
    {
    }

    public function __invoke(bool $refresh): array
    {
        $cacheFile = sys_get_temp_dir() . '/salon-jwks-' . md5($this->jwksUri) . '.json';

        if (!$refresh && is_file($cacheFile) && time() - filemtime($cacheFile) < self::TTL_SECONDS) {
            return json_decode((string) file_get_contents($cacheFile), true) ?? [];
        }

        $context = stream_context_create(['http' => ['timeout' => 3]]);
        $body = @file_get_contents($this->jwksUri, false, $context);
        if ($body === false) {
            return [];
        }

        file_put_contents($cacheFile, $body, LOCK_EX);
        return json_decode($body, true) ?? [];
    }
}
