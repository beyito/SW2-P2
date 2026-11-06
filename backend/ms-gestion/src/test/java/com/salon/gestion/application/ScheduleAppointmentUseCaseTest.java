package com.salon.gestion.application;

import com.salon.gestion.application.dto.CreateAppointmentInput;
import com.salon.gestion.application.usecase.AvailabilityUseCase;
import com.salon.gestion.application.usecase.ScheduleAppointmentUseCase;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.ServiceCatalogRepository;
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

    @Mock
    private ServiceCatalogRepository catalogRepository;

    @Mock
    private AvailabilityUseCase availability;

    @InjectMocks
    private ScheduleAppointmentUseCase scheduleAppointmentUseCase;

    private CreateAppointmentInput input;

    @BeforeEach
    void setUp() {
        input = CreateAppointmentInput.builder()
                .clientId("cli-100")
                .stylistId("sty-valen")
                .serviceId("srv-01")
                .appointmentDate("2030-11-15T10:00:00")
                .notes("Cliente nuevo")
                .build();
    }

    private void catalogHasService() {
        when(catalogRepository.findActiveById("srv-01"))
                .thenReturn(Optional.of(new SalonService("srv-01", "Balayage", "Desc", 90, 120.0)));
    }

    @Test
    @DisplayName("Debe tomar el precio y la duración del catálogo, no de la petición")
    void shouldScheduleAppointmentWithCatalogPrice() {
        catalogHasService();
        when(appointmentRepository.existsOverlapping(eq("sty-valen"), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(false);
        when(appointmentRepository.save(any(Appointment.class))).thenAnswer(inv -> inv.getArgument(0));

        Appointment scheduled = scheduleAppointmentUseCase.schedule(input);

        assertEquals(AppointmentStatus.SCHEDULED, scheduled.getStatus());
        assertEquals(120.0, scheduled.getTotalPrice());
        assertEquals(90, scheduled.getDurationMinutes());
        assertEquals("Balayage", scheduled.getServiceName());
    }

    @Test
    @DisplayName("Debe rechazar un servicio inexistente")
    void shouldRejectUnknownService() {
        when(catalogRepository.findActiveById("srv-01")).thenReturn(Optional.empty());
        assertThrows(IllegalArgumentException.class, () -> scheduleAppointmentUseCase.schedule(input));
    }

    @Test
    @DisplayName("Debe rechazar la cita si existe solapamiento con otro turno del estilista")
    void shouldRejectWhenOverlappingSchedule() {
        catalogHasService();
        when(appointmentRepository.existsOverlapping(eq("sty-valen"), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(true);

        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> scheduleAppointmentUseCase.schedule(input));
        assertTrue(ex.getMessage().contains("ya cuenta con un turno reservado"));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    @DisplayName("Debe rechazar la cita fuera de la jornada del estilista")
    void shouldRejectOutsideWorkingHours() {
        catalogHasService();
        doThrow(new IllegalArgumentException("fuera de la jornada"))
                .when(availability).assertWithinWorkingHours(any(), any(), any());

        assertThrows(IllegalArgumentException.class, () -> scheduleAppointmentUseCase.schedule(input));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    @DisplayName("Debe cancelar una cita agendada directamente")
    void shouldCancelAppointment() {
        Appointment existing = Appointment.builder().id("apt-50").status(AppointmentStatus.SCHEDULED).build();
        when(appointmentRepository.findById("apt-50")).thenReturn(Optional.of(existing));
        when(appointmentRepository.save(any(Appointment.class))).thenAnswer(inv -> inv.getArgument(0));

        Appointment cancelled = scheduleAppointmentUseCase.cancel("apt-50", "Cancelación por cliente");

        assertEquals(AppointmentStatus.CANCELLED, cancelled.getStatus());
    }

    @Test
    @DisplayName("No debe cancelar directamente una cita pagada por SAGA")
    void shouldNotCancelPaidAppointment() {
        Appointment existing = Appointment.builder()
                .id("apt-50").status(AppointmentStatus.CONFIRMED).sagaId("saga-1").build();
        when(appointmentRepository.findById("apt-50")).thenReturn(Optional.of(existing));

        assertThrows(IllegalStateException.class, () -> scheduleAppointmentUseCase.cancel("apt-50", "x"));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    @DisplayName("Reprogramar debe rechazar un solape, sin contar la propia cita")
    void shouldRejectRescheduleOverlap() {
        Appointment existing = Appointment.builder()
                .id("apt-50").stylistId("sty-valen").status(AppointmentStatus.SCHEDULED)
                .appointmentDate(LocalDateTime.parse("2030-11-15T10:00:00")).durationMinutes(60).build();
        when(appointmentRepository.findById("apt-50")).thenReturn(Optional.of(existing));
        when(appointmentRepository.existsOverlappingExcluding(eq("apt-50"), eq("sty-valen"), any(), any())).thenReturn(true);

        assertThrows(IllegalStateException.class,
                () -> scheduleAppointmentUseCase.reschedule("apt-50", "2030-11-15T11:00:00"));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }
}
