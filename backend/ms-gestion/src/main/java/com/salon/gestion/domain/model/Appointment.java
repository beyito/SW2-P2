package com.salon.gestion.domain.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Entidad Agregada Raíz de Dominio (DDD): Cita en el Salón
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Appointment {

    private String id;
    private String clientId;
    private String stylistId;
    private String serviceId;
    private String serviceName;
    private LocalDateTime appointmentDate;
    private Integer durationMinutes;
    private Double totalPrice;
    private AppointmentStatus status;
    private String notes;
    private String sagaId;
    /** Momento en que la recepción registró la llegada del cliente; null si todavía no llegó. */
    private LocalDateTime checkedInAt;

    public void cancel(String reason) {
        if (this.status == AppointmentStatus.COMPLETED) {
            throw new IllegalStateException("No se puede cancelar una cita completada");
        }
        if (this.status == AppointmentStatus.NO_SHOW) {
            throw new IllegalStateException("No se puede cancelar una cita en la que el cliente no se presentó");
        }
        this.status = AppointmentStatus.CANCELLED;
        if (reason != null && !reason.isBlank()) {
            this.notes = (this.notes == null ? "" : this.notes + " | ") + "Cancelación: " + reason;
        }
    }

    public void reschedule(LocalDateTime newDate) {
        if (this.status == AppointmentStatus.CANCELLED) {
            throw new IllegalStateException("No se puede reprogramar una cita cancelada");
        }
        if (this.status == AppointmentStatus.COMPLETED) {
            throw new IllegalStateException("No se puede reprogramar una cita completada");
        }
        if (this.status == AppointmentStatus.NO_SHOW) {
            throw new IllegalStateException("No se puede reprogramar una cita en la que el cliente no se presentó");
        }
        if (this.checkedInAt != null) {
            throw new IllegalStateException("El cliente ya está en el salón: la cita no se puede reprogramar");
        }
        this.appointmentDate = newDate;
        this.status = AppointmentStatus.RESCHEDULED;
    }

    /** Pago recibido: el turno queda confirmado definitivamente. */
    public void confirm() {
        if (this.status == AppointmentStatus.CANCELLED) {
            throw new IllegalStateException("No se puede confirmar una cita cancelada");
        }
        this.status = AppointmentStatus.CONFIRMED;
    }

    /** Registra que el servicio se prestó; solo es posible una vez iniciada la cita. */
    public void complete(LocalDateTime now) {
        if (!isAttendable()) {
            throw new IllegalStateException("La cita no se puede completar en su estado actual");
        }
        if (now.isBefore(this.appointmentDate)) {
            throw new IllegalStateException("La cita todavía no ha comenzado");
        }
        this.status = AppointmentStatus.COMPLETED;
    }

    /**
     * La recepción registra que el cliente llegó. Solo el día de la cita y antes de atenderla.
     * Repetirlo no cambia la hora registrada.
     */
    public void checkIn(LocalDateTime now) {
        if (!isAttendable()) {
            throw new IllegalStateException("Solo se registra la llegada de una cita pendiente de atención");
        }
        if (!now.toLocalDate().equals(this.appointmentDate.toLocalDate())) {
            throw new IllegalStateException("La llegada solo se registra el día de la cita");
        }
        if (this.checkedInAt == null) {
            // Al segundo: es lo que interesa en el mostrador y se lee igual desde la base y desde la respuesta
            this.checkedInAt = now.withNano(0);
        }
    }

    /** El cliente no se presentó: solo después de la hora de inicio y si no se registró su llegada. */
    public void markNoShow(LocalDateTime now) {
        if (!isAttendable()) {
            throw new IllegalStateException("Solo se marca como ausente una cita pendiente de atención");
        }
        if (this.checkedInAt != null) {
            throw new IllegalStateException("El cliente ya llegó: no se puede marcar como ausente");
        }
        if (now.isBefore(this.appointmentDate)) {
            throw new IllegalStateException("La cita todavía no ha comenzado");
        }
        this.status = AppointmentStatus.NO_SHOW;
    }

    /** Pendiente de atención: con turno firme y sin cerrar. */
    private boolean isAttendable() {
        return this.status == AppointmentStatus.SCHEDULED
                || this.status == AppointmentStatus.CONFIRMED
                || this.status == AppointmentStatus.RESCHEDULED;
    }

    public LocalDateTime endDate() {
        return this.appointmentDate.plusMinutes(this.durationMinutes);
    }
}
