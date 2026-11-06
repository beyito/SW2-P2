package com.salon.gestion.infrastructure.security;

import com.salon.gestion.domain.repository.AppointmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * Reglas de propiedad: un cliente solo puede operar sobre sus propias citas.
 */
@Component("appointmentAccess")
@RequiredArgsConstructor
public class AppointmentAccess {

    private final AppointmentRepository appointmentRepository;

    public boolean isSelf(Authentication authentication, String clientId) {
        String salonId = salonId(authentication);
        return salonId != null && salonId.equals(clientId);
    }

    public boolean isOwner(Authentication authentication, String appointmentId) {
        return appointmentRepository.findById(appointmentId)
                .map(appointment -> isSelf(authentication, appointment.getClientId()))
                .orElse(false);
    }

    /** Identificador de negocio del usuario autenticado. */
    public String salonId(Authentication authentication) {
        if (authentication instanceof JwtAuthenticationToken token) {
            String salonId = token.getToken().getClaimAsString("salon_id");
            return salonId != null ? salonId : token.getToken().getSubject();
        }
        return null;
    }
}
