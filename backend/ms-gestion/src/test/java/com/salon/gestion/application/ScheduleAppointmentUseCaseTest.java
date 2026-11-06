package com.salon.gestion.application;

import com.salon.gestion.application.dto.CreateAppointmentInput;
import com.salon.gestion.application.usecase.ScheduleAppointmentUseCase;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.repository.AppointmentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Pruebas Unitarias de Aplicación: ScheduleAppointmentUseCase (CU-06, CU-07, RF-02)")
class ScheduleAppointmentUseCaseTest {

    @Mock
    private AppointmentRepository appointmentRepository;

    @InjectMocks
    private ScheduleAppointmentUseCase scheduleAppointmentUseCase;

    private CreateAppointmentInput input;

    @BeforeEach
    void setUp() {
        input = CreateAppointmentInput.builder()
                .clientId("cli-100")
                .stylistId("sty-valen")
                .serviceName("Balayage Deluxe & Peinado")
                .appointmentDate("2026-11-15T10:00:00")
                .durationMinutes(90)
                .totalPrice(120.0)
                .notes("Cliente nuevo")
                .build();
    }

    @Test
    @DisplayName("Debe agendar cita si el estilista está disponible en el horario")
    void shouldScheduleAppointmentSuccessfully() {
        when(appointmentRepository.existsOverlapping(eq("sty-valen"), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(false);
        when(appointmentRepository.save(any(Appointment.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        Appointment scheduled = scheduleAppointmentUseCase.schedule(input);

        assertNotNull(scheduled);
        assertEquals("cli-100", scheduled.getClientId());
        assertEquals("sty-valen", scheduled.getStylistId());
        assertEquals(AppointmentStatus.SCHEDULED, scheduled.getStatus());
        assertEquals(120.0, scheduled.getTotalPrice());
        verify(appointmentRepository).save(any(Appointment.class));
    }

    @Test
    @DisplayName("Debe rechazar la cita si existe solapamiento con otro turno del estilista")
    void shouldRejectWhenOverlappingSchedule() {
        when(appointmentRepository.existsOverlapping(eq("sty-valen"), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(true);

        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> scheduleAppointmentUseCase.schedule(input));
        assertTrue(ex.getMessage().contains("ya cuenta con un turno reservado"));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    @DisplayName("Debe cancelar una cita existente cambiando su estado y guardando")
    void shouldCancelAppointment() {
        Appointment existing = Appointment.builder()
                .id("apt-50")
                .status(AppointmentStatus.SCHEDULED)
                .build();

        when(appointmentRepository.findById("apt-50")).thenReturn(Optional.of(existing));
        when(appointmentRepository.save(any(Appointment.class))).thenAnswer(inv -> inv.getArgument(0));

        Appointment cancelled = scheduleAppointmentUseCase.cancel("apt-50", "Cancelación por cliente");

        assertEquals(AppointmentStatus.CANCELLED, cancelled.getStatus());
        verify(appointmentRepository).save(existing);
    }
}
