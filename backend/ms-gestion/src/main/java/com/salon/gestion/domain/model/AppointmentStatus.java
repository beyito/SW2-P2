package com.salon.gestion.domain.model;

/**
 * Estados del ciclo de vida de una Cita en el Salón.
 */
public enum AppointmentStatus {
    /** Turno bloqueado por una SAGA mientras se espera el pago. */
    PENDING_PAYMENT,
    SCHEDULED,
    CONFIRMED,
    COMPLETED,
    CANCELLED,
    RESCHEDULED,
    /** El cliente no se presentó: el pago no se devuelve y el turno queda libre. */
    NO_SHOW
}
