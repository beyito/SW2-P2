<?php

namespace Tests;

use App\InterfaceAdapters\Security\AuthException;
use App\InterfaceAdapters\Security\Authenticator;
use App\InterfaceAdapters\Security\JwtVerifier;
use App\InterfaceAdapters\Security\SessionRegistryInterface;
use PHPUnit\Framework\TestCase;

/**
 * Pruebas de autenticación, roles y sesiones (RF-01, CU-01, CU-02).
 */
class AuthenticatorTest extends TestCase
{
    private const ISSUER = 'http://keycloak/realms/salon';
    private const AUDIENCE = 'salon-api';

    private static \OpenSSLAsymmetricKey $key;
    private static string $certificate;
    private FakeSessionRegistry $sessions;
    private Authenticator $authenticator;

    public static function setUpBeforeClass(): void
    {
        self::$key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $request = openssl_csr_new(['commonName' => 'salon'], self::$key);
        openssl_x509_export(openssl_csr_sign($request, null, self::$key, 1), $pem);
        self::$certificate = preg_replace('/-----[^-]+-----|\s/', '', $pem);
    }

    protected function setUp(): void
    {
        $this->sessions = new FakeSessionRegistry();
        $jwks = fn (bool $refresh) => ['keys' => [['kid' => 'k1', 'x5c' => [self::$certificate]]]];
        $this->authenticator = new Authenticator(new JwtVerifier(self::ISSUER, self::AUDIENCE, $jwks), $this->sessions);
    }

    private function b64(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function token(array $overrides = [], ?\OpenSSLAsymmetricKey $key = null, string $alg = 'RS256'): string
    {
        $claims = array_merge([
            'sub' => 'usuario-1',
            'iss' => self::ISSUER,
            'aud' => [self::AUDIENCE],
            'exp' => time() + 300,
            'sid' => 's1',
            'auth_time' => 100,
            'realm_access' => ['roles' => ['CLIENT']],
        ], $overrides);
        $signed = $this->b64(json_encode(['alg' => $alg, 'kid' => 'k1'])) . '.' . $this->b64(json_encode($claims));
        openssl_sign($signed, $signature, $key ?? self::$key, OPENSSL_ALGO_SHA256);
        return $signed . '.' . $this->b64($signature);
    }

    private function assertRejected(string $header, int $status, string $code, array $roles = []): void
    {
        try {
            $this->authenticator->authenticate($header, $roles);
            $this->fail('Se esperaba un rechazo');
        } catch (AuthException $e) {
            $this->assertSame($status, $e->status);
            $this->assertSame($code, $e->errorCode);
        }
    }

    public function testAceptaTokenValido(): void
    {
        $claims = $this->authenticator->authenticate('Bearer ' . $this->token());
        $this->assertSame('usuario-1', $claims['sub']);
    }

    public function testRechazaSinToken(): void
    {
        $this->assertRejected('', 401, 'TOKEN_MISSING');
    }

    public function testRechazaFirmaDeOtraLlave(): void
    {
        $otra = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $this->assertRejected('Bearer ' . $this->token([], $otra), 401, 'TOKEN_INVALID');
    }

    public function testRechazaAlgoritmoNone(): void
    {
        $token = $this->b64(json_encode(['alg' => 'none', 'kid' => 'k1'])) . '.'
            . $this->b64(json_encode(['sub' => 'x', 'iss' => self::ISSUER, 'aud' => [self::AUDIENCE], 'exp' => time() + 300]))
            . '.';
        $this->assertRejected('Bearer ' . $token, 401, 'TOKEN_INVALID');
    }

    public function testRechazaEmisorAudienciaYVencimientoIncorrectos(): void
    {
        $this->assertRejected('Bearer ' . $this->token(['iss' => 'http://atacante']), 401, 'TOKEN_INVALID');
        $this->assertRejected('Bearer ' . $this->token(['aud' => ['otra-api']]), 401, 'TOKEN_INVALID');
        $this->assertRejected('Bearer ' . $this->token(['exp' => 1000]), 401, 'TOKEN_INVALID');
    }

    public function testRolInsuficienteResponde403(): void
    {
        $this->assertRejected('Bearer ' . $this->token(), 403, 'INSUFFICIENT_ROLE', ['ADMIN', 'STYLIST']);
    }

    public function testSesionCerradaResponde401(): void
    {
        $this->sessions->revoked[] = 's1';
        $this->assertRejected('Bearer ' . $this->token(), 401, 'SESSION_CLOSED');
    }

    public function testLoginAdminMasRecienteReclamaLaSesion(): void
    {
        $this->sessions->active = ['sessionId' => 's1', 'authTime' => 100];
        $this->authenticator->authenticate('Bearer ' . $this->token([
            'sid' => 's2', 'auth_time' => 200, 'realm_access' => ['roles' => ['ADMIN']],
        ]));
        $this->assertSame(['s2'], $this->sessions->claims);
    }

    public function testSesionAdminDesplazadaResponde401(): void
    {
        $this->sessions->active = ['sessionId' => 's2', 'authTime' => 200];
        $this->assertRejected(
            'Bearer ' . $this->token(['realm_access' => ['roles' => ['ADMIN']]]),
            401,
            'SESSION_SUPERSEDED'
        );
    }

    public function testFalloDelRegistroRechazaElAcceso(): void
    {
        $this->sessions->failing = true;
        $this->assertRejected('Bearer ' . $this->token(), 401, 'SESSION_UNAVAILABLE');
    }
}

class FakeSessionRegistry implements SessionRegistryInterface
{
    public array $revoked = [];
    public ?array $active = null;
    public array $claims = [];
    public bool $failing = false;

    public function isRevoked(string $sessionId): bool
    {
        if ($this->failing) {
            throw new \RuntimeException('caído');
        }
        return in_array($sessionId, $this->revoked, true);
    }

    public function findActive(string $userId): ?array
    {
        return $this->active;
    }

    public function claimActive(string $userId, string $sessionId, int $authTime): bool
    {
        $this->claims[] = $sessionId;
        return true;
    }
}
