package com.salon.gestion.application.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Datos para agendar una cita. El precio y la duración salen del catálogo.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateAppointmentInput {
    private String clientId;
    private String stylistId;
    private String serviceId;
    private String appointmentDate;
    private String notes;
}
