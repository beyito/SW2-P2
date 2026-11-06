<?php

namespace App\InterfaceAdapters\Security;

/**
 * Verifica firma RS256, emisor, audiencia y vigencia de los tokens de Keycloak.
 */
class JwtVerifier
{
    /** @var callable(bool): array  Devuelve el JWKS; el argumento fuerza a renovarlo. */
    private $jwksProvider;

    public function __construct(
        private readonly string $issuer,
        private readonly string $audience,
        callable $jwksProvider
    ) {
        $this->jwksProvider = $jwksProvider;
    }

    public function verify(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw $this->invalid();
        }

        [$headerPart, $payloadPart, $signaturePart] = $parts;
        $header = json_decode($this->decode($headerPart), true);
        $claims = json_decode($this->decode($payloadPart), true);

        // Solo se acepta RS256: impide tokens sin firma (alg=none)
        if (!is_array($header) || !is_array($claims) || ($header['alg'] ?? '') !== 'RS256') {
            throw $this->invalid();
        }

        $publicKey = $this->findKey((string) ($header['kid'] ?? ''));
        $signedData = $headerPart . '.' . $payloadPart;
        if ($publicKey === null
            || openssl_verify($signedData, $this->decode($signaturePart), $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
            throw $this->invalid();
        }

        $audiences = (array) ($claims['aud'] ?? []);
        if (($claims['iss'] ?? '') !== $this->issuer
            || !in_array($this->audience, $audiences, true)
            || ($claims['exp'] ?? 0) <= time()) {
            throw $this->invalid();
        }

        return $claims;
    }

    private function findKey(string $kid): ?\OpenSSLAsymmetricKey
    {
        // Si la llave no aparece, Keycloak pudo haberla rotado: se renueva una vez
        foreach ([false, true] as $refresh) {
            foreach ((($this->jwksProvider)($refresh))['keys'] ?? [] as $jwk) {
                if (($jwk['kid'] ?? '') === $kid && !empty($jwk['x5c'][0])) {
                    $certificate = "-----BEGIN CERTIFICATE-----\n"
                        . chunk_split($jwk['x5c'][0], 64, "\n")
                        . "-----END CERTIFICATE-----\n";
                    return openssl_pkey_get_public($certificate) ?: null;
                }
            }
        }
        return null;
    }

    private function decode(string $value): string
    {
        return (string) base64_decode(strtr($value, '-_', '+/'));
    }

    private function invalid(): AuthException
    {
        return new AuthException(401, 'TOKEN_INVALID', 'Token de acceso inválido o vencido.');
    }
}
