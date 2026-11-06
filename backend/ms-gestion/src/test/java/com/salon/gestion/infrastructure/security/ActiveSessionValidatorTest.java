package com.salon.gestion.infrastructure.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pruebas del control de sesión única y de sesiones cerradas (RF-01, CU-01, CU-02).
 */
class ActiveSessionValidatorTest {

    private final SessionRegistry registry = mock(SessionRegistry.class);
    private final ActiveSessionValidator validator = new ActiveSessionValidator(registry);

    private Jwt token(String role, String sid, long authTime) {
        Jwt.Builder builder = Jwt.withTokenValue("t")
                .header("alg", "RS256")
                .subject("usuario-1")
                .claim("auth_time", authTime)
                .claim("realm_access", Map.of("roles", List.of(role)));
        if (sid != null) {
            builder.claim("sid", sid);
        }
        return builder.build();
    }

    @Test
    void aceptaCuentaDeServicioSinSesion() {
        assertFalse(validator.validate(token("ADMIN", null, 0)).hasErrors());
        verify(registry, never()).isRevoked(any());
    }

    @Test
    void rechazaSesionCerrada() {
        when(registry.isRevoked("s1")).thenReturn(true);
        var result = validator.validate(token("CLIENT", "s1", 100));
        assertEquals("SESSION_CLOSED", result.getErrors().iterator().next().getErrorCode());
    }

    @Test
    void clienteNoEstaSujetoASesionUnica() {
        assertFalse(validator.validate(token("CLIENT", "s1", 100)).hasErrors());
        verify(registry, never()).findActive(anyString());
    }

    @Test
    void adminSinRegistroPrevioReclamaLaSesion() {
        when(registry.findActive("usuario-1")).thenReturn(Optional.empty());
        when(registry.claimActive("usuario-1", "s1", 100)).thenReturn(true);
        assertFalse(validator.validate(token("ADMIN", "s1", 100)).hasErrors());
    }

    @Test
    void adminConLaSesionVigenteEsAceptado() {
        when(registry.findActive("usuario-1"))
                .thenReturn(Optional.of(new SessionRegistry.ActiveSession("s1", 100)));
        assertFalse(validator.validate(token("ADMIN", "s1", 100)).hasErrors());
        verify(registry, never()).claimActive(anyString(), anyString(), anyLong());
    }

    @Test
    void loginMasRecienteDesplazaAlAnterior() {
        when(registry.findActive("usuario-1"))
                .thenReturn(Optional.of(new SessionRegistry.ActiveSession("s1", 100)));
        when(registry.claimActive("usuario-1", "s2", 200)).thenReturn(true);
        assertFalse(validator.validate(token("ADMIN", "s2", 200)).hasErrors());
    }

    @Test
    void sesionAntiguaEsRechazada() {
        when(registry.findActive("usuario-1"))
                .thenReturn(Optional.of(new SessionRegistry.ActiveSession("s2", 200)));
        var result = validator.validate(token("ADMIN", "s1", 100));
        assertEquals("SESSION_SUPERSEDED", result.getErrors().iterator().next().getErrorCode());
    }

    @Test
    void falloDelRegistroRechazaElAcceso() {
        when(registry.isRevoked("s1")).thenThrow(new IllegalStateException("caído"));
        var result = validator.validate(token("CLIENT", "s1", 100));
        assertEquals("SESSION_UNAVAILABLE", result.getErrors().iterator().next().getErrorCode());
    }
}
