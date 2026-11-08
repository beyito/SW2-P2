package com.salon.gestion.infrastructure.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Rechaza tokens de sesiones cerradas (CU-02) y aplica la sesión única a las cuentas administrativas,
 * ADMIN y RECEPTIONIST (RF-01).
 * Gana siempre el inicio de sesión más reciente. Ante un fallo del registro se rechaza el acceso.
 */
public class ActiveSessionValidator implements OAuth2TokenValidator<Jwt> {

    private final SessionRegistry registry;

    public ActiveSessionValidator(SessionRegistry registry) {
        this.registry = registry;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        String sessionId = token.getClaimAsString("sid");
        // Las cuentas de servicio no tienen sesión de usuario
        if (sessionId == null) {
            return OAuth2TokenValidatorResult.success();
        }
        try {
            if (registry.isRevoked(sessionId)) {
                return failure("SESSION_CLOSED", "La sesión fue cerrada");
            }
            if (isAdmin(token) && !holdsActiveSession(token, sessionId)) {
                return failure("SESSION_SUPERSEDED", "Se inició una sesión más reciente en otro dispositivo");
            }
            return OAuth2TokenValidatorResult.success();
        } catch (IllegalStateException e) {
            return failure("SESSION_UNAVAILABLE", "No se pudo verificar la sesión");
        }
    }

    private boolean holdsActiveSession(Jwt token, String sessionId) {
        String userId = token.getSubject();
        Number authClaim = token.getClaim("auth_time");
        long authTime = authClaim == null ? 0L : authClaim.longValue();

        Optional<SessionRegistry.ActiveSession> active = registry.findActive(userId);
        if (active.isPresent() && active.get().sessionId().equals(sessionId)) {
            return true;
        }
        if (active.isPresent() && authTime <= active.get().authTime()) {
            return false;
        }
        return registry.claimActive(userId, sessionId, authTime);
    }

    @SuppressWarnings("unchecked")
    private boolean isAdmin(Jwt token) {
        Map<String, Object> realmAccess = token.getClaimAsMap("realm_access");
        if (realmAccess == null) {
            return false;
        }
        List<String> roles = (List<String>) realmAccess.getOrDefault("roles", List.of());
        return roles.contains("ADMIN") || roles.contains("RECEPTIONIST");
    }

    private OAuth2TokenValidatorResult failure(String code, String description) {
        return OAuth2TokenValidatorResult.failure(new OAuth2Error(code, description, null));
    }
}
