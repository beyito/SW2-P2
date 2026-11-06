package com.salon.gestion.domain.model;

/**
 * Estados del ciclo de vida de una Cita en el Salón.
 */
public enum AppointmentStatus {
    SCHEDULED,
    CONFIRMED,
    COMPLETED,
    CANCELLED,
    RESCHEDULED
}
