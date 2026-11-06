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
    private String serviceName;
    private LocalDateTime appointmentDate;
    private Integer durationMinutes;
    private Double totalPrice;
    private AppointmentStatus status;
    private String notes;

    public void cancel(String reason) {
        if (this.status == AppointmentStatus.COMPLETED) {
            throw new IllegalStateException("No se puede cancelar una cita completada");
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
        this.appointmentDate = newDate;
        this.status = AppointmentStatus.RESCHEDULED;
    }
}
