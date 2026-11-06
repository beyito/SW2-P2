package com.salon.gestion.application;

import com.salon.gestion.application.dto.ScheduleInput;
import com.salon.gestion.application.dto.StylistInput;
import com.salon.gestion.application.usecase.ManageStylistsUseCase;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.Stylist;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.StylistRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@DisplayName("Pruebas Unitarias de Aplicación: ManageStylistsUseCase (CU-04, CU-05)")
class ManageStylistsUseCaseTest {

    // Viernes 6 de noviembre de 2026 a las 12:00
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-06T12:00:00Z"), ZoneOffset.UTC);
    // Lunes de 10:00 a 11:00
    private static final LocalDateTime MONDAY_10 = LocalDateTime.of(2026, 11, 9, 10, 0);
    private static final int MONDAY = 1;
    private static final int TUESDAY = 2;

    private StylistRepository stylists;
    private AppointmentRepository appointments;
    private ManageStylistsUseCase useCase;

    @BeforeEach
    void setUp() {
        stylists = mock(StylistRepository.class);
        appointments = mock(AppointmentRepository.class);
        useCase = new ManageStylistsUseCase(stylists, appointments, CLOCK);
        when(stylists.save(any())).thenAnswer(call -> call.getArgument(0));
        when(stylists.saveSchedule(any())).thenAnswer(call -> call.getArgument(0));
        when(stylists.findById("sty-1")).thenReturn(Optional.of(new Stylist("sty-1", "Ana", "Color", null, true)));
    }

    private void givenFutureAppointment() {
        when(appointments.findActiveBetween(eqStylist(), any(), any())).thenReturn(List.of(Appointment.builder()
                .id("apt-1").stylistId("sty-1").appointmentDate(MONDAY_10).durationMinutes(60)
                .status(AppointmentStatus.CONFIRMED).build()));
    }

    private String eqStylist() {
        return org.mockito.ArgumentMatchers.eq("sty-1");
    }

    @Test
    @DisplayName("Debe registrar un estilista activo con nombre sin espacios sobrantes")
    void shouldCreateStylist() {
        Stylist created = useCase.create(new StylistInput("  Marta Paz ", "Corte", "700"));

        assertEquals("Marta Paz", created.name());
        assertTrue(created.active());
        assertNotNull(created.id());
    }

    @Test
    @DisplayName("Debe rechazar un estilista sin nombre")
    void shouldRejectBlankName() {
        assertThrows(IllegalArgumentException.class, () -> useCase.create(new StylistInput("  ", null, null)));
        verify(stylists, never()).save(any());
    }

    @Test
    @DisplayName("Modificar datos no debe cambiar si el estilista está activo")
    void shouldKeepActiveFlagOnUpdate() {
        when(stylists.findById("sty-2")).thenReturn(Optional.of(new Stylist("sty-2", "Luz", null, null, false)));

        assertFalse(useCase.update("sty-2", new StylistInput("Luz Mar", null, null)).active());
    }

    @Test
    @DisplayName("Debe informar un estilista inexistente")
    void shouldRejectUnknownStylist() {
        when(stylists.findById("nadie")).thenReturn(Optional.empty());

        assertThrows(IllegalArgumentException.class, () -> useCase.update("nadie", new StylistInput("X", null, null)));
    }

    @Test
    @DisplayName("No debe desactivar a un estilista con citas futuras")
    void shouldNotDeactivateWithFutureAppointments() {
        givenFutureAppointment();

        assertThrows(IllegalStateException.class, () -> useCase.setActive("sty-1", false));
        verify(stylists, never()).save(any());
    }

    @Test
    @DisplayName("Debe desactivar a un estilista sin citas futuras")
    void shouldDeactivateWithoutAppointments() {
        when(appointments.findActiveBetween(eqStylist(), any(), any())).thenReturn(List.of());

        assertFalse(useCase.setActive("sty-1", false).active());
    }

    @Test
    @DisplayName("Debe rechazar un horario con día u horas inválidas")
    void shouldRejectInvalidSchedule() {
        assertThrows(IllegalArgumentException.class,
                () -> useCase.setSchedule(new ScheduleInput("sty-1", 8, "09:00", "18:00", true)));
        assertThrows(IllegalArgumentException.class,
                () -> useCase.setSchedule(new ScheduleInput("sty-1", MONDAY, "18:00", "09:00", true)));
        assertThrows(IllegalArgumentException.class,
                () -> useCase.setSchedule(new ScheduleInput("sty-1", MONDAY, "nueve", "18:00", true)));
    }

    @Test
    @DisplayName("No debe aceptar un horario que deje fuera una cita ya reservada")
    void shouldRejectScheduleLeavingAppointmentOut() {
        givenFutureAppointment();

        assertThrows(IllegalStateException.class,
                () -> useCase.setSchedule(new ScheduleInput("sty-1", MONDAY, "10:30", "18:00", true)));
        assertThrows(IllegalStateException.class,
                () -> useCase.setSchedule(new ScheduleInput("sty-1", MONDAY, "09:00", "18:00", false)));
        verify(stylists, never()).saveSchedule(any());
    }

    @Test
    @DisplayName("Debe aceptar un horario que respeta las citas, o de otro día")
    void shouldAcceptCompatibleSchedule() {
        givenFutureAppointment();

        assertEquals("Ana", useCase.setSchedule(new ScheduleInput("sty-1", MONDAY, "10:00", "11:00", true)).getStylistName());
        assertNotNull(useCase.setSchedule(new ScheduleInput("sty-1", TUESDAY, "09:00", "10:00", false)));
    }
}
