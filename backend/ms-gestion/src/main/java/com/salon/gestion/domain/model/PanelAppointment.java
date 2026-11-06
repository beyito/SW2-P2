package com.salon.gestion.domain.model;

/**
 * Fila del Read Model de la agenda del panel empresarial (RNF-01).
 */
public record PanelAppointment(
        String id,
        String clientId,
        String stylistId,
        String stylistName,
        String serviceName,
        String appointmentDate,
        String appointmentEnd,
        int durationMinutes,
        double totalPrice,
        AppointmentStatus status) {
}
