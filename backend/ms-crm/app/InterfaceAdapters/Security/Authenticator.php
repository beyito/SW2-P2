<?php

namespace App\InterfaceAdapters\Security;

/**
 * Exige token válido, sesión vigente y rol suficiente; aplica sesión única a las cuentas administrativas.
 */
class Authenticator
{
    public function __construct(
        private readonly JwtVerifier $verifier,
        private readonly SessionRegistryInterface $sessions
    ) {
    }

    /**
     * @param string[] $requiredRoles Basta con tener uno; vacío admite a cualquier autenticado.
     * @return array Claims del token.
     */
    public function authenticate(string $authorizationHeader, array $requiredRoles = []): array
    {
        if (!str_starts_with($authorizationHeader, 'Bearer ')) {
            throw new AuthException(401, 'TOKEN_MISSING', 'Token de acceso no proporcionado.');
        }

        $claims = $this->verifier->verify(substr($authorizationHeader, strlen('Bearer ')));
        $roles = $claims['realm_access']['roles'] ?? [];
        $this->assertSessionValid($claims, $roles);

        if ($requiredRoles !== [] && array_intersect($requiredRoles, $roles) === []) {
            throw new AuthException(403, 'INSUFFICIENT_ROLE', 'Rol insuficiente para esta operación.');
        }

        return $claims;
    }

    private function assertSessionValid(array $claims, array $roles): void
    {
        $sessionId = $claims['sid'] ?? null;
        // Las cuentas de servicio no tienen sesión de usuario
        if ($sessionId === null) {
            return;
        }

        try {
            if ($this->sessions->isRevoked($sessionId)) {
                throw new AuthException(401, 'SESSION_CLOSED', 'La sesión fue cerrada.');
            }
            // Administración y recepción son cuentas administrativas: una sola sesión a la vez (RF-01)
            $administrative = array_intersect(['ADMIN', 'RECEPTIONIST'], $roles) !== [];
            if ($administrative && !$this->holdsActiveSession($claims, $sessionId)) {
                throw new AuthException(
                    401,
                    'SESSION_SUPERSEDED',
                    'Se inició una sesión más reciente en otro dispositivo.'
                );
            }
        } catch (AuthException $error) {
            throw $error;
        } catch (\Throwable) {
            throw new AuthException(401, 'SESSION_UNAVAILABLE', 'No se pudo verificar la sesión.');
        }
    }

    private function holdsActiveSession(array $claims, string $sessionId): bool
    {
        $userId = (string) $claims['sub'];
        $authTime = (int) ($claims['auth_time'] ?? 0);

        $active = $this->sessions->findActive($userId);
        if ($active !== null && $active['sessionId'] === $sessionId) {
            return true;
        }
        if ($active !== null && $authTime <= $active['authTime']) {
            return false;
        }
        return $this->sessions->claimActive($userId, $sessionId, $authTime);
    }
}
