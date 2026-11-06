package com.salon.gestion.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("Pruebas Unitarias de Dominio: Appointment (CU-06, CU-07)")
class AppointmentTest {

    @Test
    @DisplayName("Debe cancelar una cita agendada registrando el motivo")
    void shouldCancelScheduledAppointment() {
        Appointment apt = Appointment.builder()
                .id("apt-10")
                .status(AppointmentStatus.SCHEDULED)
                .notes("Cliente VIP")
                .build();

        apt.cancel("Imprevisto familiar");

        assertEquals(AppointmentStatus.CANCELLED, apt.getStatus());
        assertTrue(apt.getNotes().contains("Cancelación: Imprevisto familiar"));
    }

    @Test
    @DisplayName("No debe permitir cancelar una cita ya completada")
    void shouldNotCancelCompletedAppointment() {
        Appointment apt = Appointment.builder()
                .id("apt-11")
                .status(AppointmentStatus.COMPLETED)
                .build();

        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> apt.cancel("Ya atendido"));
        assertTrue(ex.getMessage().contains("No se puede cancelar una cita completada"));
    }

    @Test
    @DisplayName("Debe reprogramar la fecha de una cita y actualizar su estado")
    void shouldRescheduleAppointment() {
        LocalDateTime initialDate = LocalDateTime.of(2026, 11, 10, 10, 0);
        LocalDateTime newDate = LocalDateTime.of(2026, 11, 12, 15, 0);

        Appointment apt = Appointment.builder()
                .id("apt-12")
                .appointmentDate(initialDate)
                .status(AppointmentStatus.SCHEDULED)
                .build();

        apt.reschedule(newDate);

        assertEquals(AppointmentStatus.RESCHEDULED, apt.getStatus());
        assertEquals(newDate, apt.getAppointmentDate());
    }

    @Test
    @DisplayName("No debe permitir reprogramar una cita cancelada")
    void shouldNotRescheduleCancelledAppointment() {
        Appointment apt = Appointment.builder()
                .id("apt-13")
                .status(AppointmentStatus.CANCELLED)
                .build();

        assertThrows(IllegalStateException.class, () -> apt.reschedule(LocalDateTime.now()));
    }
}
