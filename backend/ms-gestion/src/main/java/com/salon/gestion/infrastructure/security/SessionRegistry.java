package com.salon.gestion.infrastructure.security;

import java.util.Optional;

/**
 * Puerto de acceso al registro de sesiones activas y revocadas (RF-01, CU-01, CU-02).
 */
public interface SessionRegistry {

    /** Indica si la sesión fue cerrada explícitamente por el usuario. */
    boolean isRevoked(String sessionId);

    /** Devuelve la sesión vigente registrada para el usuario, si existe. */
    Optional<ActiveSession> findActive(String userId);

    /**
     * Registra la sesión como la vigente solo si es más reciente que la registrada.
     *
     * @return {@code false} si otra sesión más reciente ya ocupa el registro
     */
    boolean claimActive(String userId, String sessionId, long authTime);

    /** Sesión vigente de un usuario con sesión única. */
    record ActiveSession(String sessionId, long authTime) {
    }
}
