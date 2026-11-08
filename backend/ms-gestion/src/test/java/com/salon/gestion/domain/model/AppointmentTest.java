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

    @org.junit.jupiter.api.Nested
    @org.junit.jupiter.api.DisplayName("Completar una cita atendida")
    class CompleteAppointment {
        private final java.time.LocalDateTime start = java.time.LocalDateTime.of(2026, 11, 9, 10, 0);

        private Appointment withStatus(AppointmentStatus status) {
            return Appointment.builder().id("apt").status(status).appointmentDate(start).durationMinutes(60).build();
        }

        @org.junit.jupiter.api.Test
        @org.junit.jupiter.api.DisplayName("Debe completarse una cita confirmada ya iniciada")
        void shouldComplete() {
            Appointment appointment = withStatus(AppointmentStatus.CONFIRMED);
            appointment.complete(start.plusMinutes(5));
            org.junit.jupiter.api.Assertions.assertEquals(AppointmentStatus.COMPLETED, appointment.getStatus());
        }

        @org.junit.jupiter.api.Test
        @org.junit.jupiter.api.DisplayName("No debe completarse antes de iniciar, ni cancelada ni pendiente de pago")
        void shouldRejectInvalidCompletion() {
            org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                    () -> withStatus(AppointmentStatus.CONFIRMED).complete(start.minusMinutes(1)));
            org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                    () -> withStatus(AppointmentStatus.CANCELLED).complete(start));
            org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                    () -> withStatus(AppointmentStatus.PENDING_PAYMENT).complete(start));
        }

        @org.junit.jupiter.api.Test
        @org.junit.jupiter.api.DisplayName("No debe reprogramarse una cita completada")
        void shouldNotRescheduleCompleted() {
            org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                    () -> withStatus(AppointmentStatus.COMPLETED).reschedule(start.plusDays(1)));
        }
    }

    private static Appointment pagadaA(String fecha) {
        return Appointment.builder()
                .id("apt-30")
                .status(AppointmentStatus.CONFIRMED)
                .appointmentDate(LocalDateTime.parse(fecha))
                .durationMinutes(60)
                .build();
    }

    @Test
    @DisplayName("La recepción registra la llegada el día de la cita, y repetirlo conserva la primera hora")
    void shouldCheckInOnAppointmentDay() {
        Appointment apt = pagadaA("2030-05-10T15:00:00");

        apt.checkIn(LocalDateTime.parse("2030-05-10T14:50:00.123456789"));
        apt.checkIn(LocalDateTime.parse("2030-05-10T15:05:00"));

        assertEquals(LocalDateTime.parse("2030-05-10T14:50:00"), apt.getCheckedInAt());
        assertEquals(AppointmentStatus.CONFIRMED, apt.getStatus());
    }

    @Test
    @DisplayName("No se registra la llegada otro día ni en una cita cancelada")
    void shouldRejectCheckInOutsideDayOrCancelled() {
        Appointment otroDia = pagadaA("2030-05-10T15:00:00");
        assertThrows(IllegalStateException.class, () -> otroDia.checkIn(LocalDateTime.parse("2030-05-09T15:00:00")));

        Appointment cancelada = pagadaA("2030-05-10T15:00:00");
        cancelada.setStatus(AppointmentStatus.CANCELLED);
        assertThrows(IllegalStateException.class, () -> cancelada.checkIn(LocalDateTime.parse("2030-05-10T15:00:00")));
    }

    @Test
    @DisplayName("Ausencia: solo desde la hora de inicio y si el cliente no llegó")
    void shouldMarkNoShowOnlyAfterStartAndWithoutArrival() {
        Appointment temprano = pagadaA("2030-05-10T15:00:00");
        assertThrows(IllegalStateException.class, () -> temprano.markNoShow(LocalDateTime.parse("2030-05-10T14:59:00")));

        Appointment llego = pagadaA("2030-05-10T15:00:00");
        llego.checkIn(LocalDateTime.parse("2030-05-10T14:55:00"));
        assertThrows(IllegalStateException.class, () -> llego.markNoShow(LocalDateTime.parse("2030-05-10T15:20:00")));

        Appointment ausente = pagadaA("2030-05-10T15:00:00");
        ausente.markNoShow(LocalDateTime.parse("2030-05-10T15:20:00"));
        assertEquals(AppointmentStatus.NO_SHOW, ausente.getStatus());
    }

    @Test
    @DisplayName("Una cita con ausencia no se cancela, no se reprograma ni se marca atendida")
    void noShowIsFinal() {
        Appointment ausente = pagadaA("2030-05-10T15:00:00");
        ausente.markNoShow(LocalDateTime.parse("2030-05-10T15:20:00"));

        assertThrows(IllegalStateException.class, () -> ausente.cancel("tarde"));
        assertThrows(IllegalStateException.class, () -> ausente.reschedule(LocalDateTime.parse("2030-05-11T10:00:00")));
        assertThrows(IllegalStateException.class, () -> ausente.complete(LocalDateTime.parse("2030-05-10T16:00:00")));
    }

    @Test
    @DisplayName("Con el cliente en el salón, la cita ya no se reprograma, pero sí se marca atendida")
    void checkedInCannotBeRescheduled() {
        Appointment apt = pagadaA("2030-05-10T15:00:00");
        apt.checkIn(LocalDateTime.parse("2030-05-10T14:55:00"));

        assertThrows(IllegalStateException.class, () -> apt.reschedule(LocalDateTime.parse("2030-05-10T17:00:00")));
        apt.complete(LocalDateTime.parse("2030-05-10T16:00:00"));
        assertEquals(AppointmentStatus.COMPLETED, apt.getStatus());
    }
}
