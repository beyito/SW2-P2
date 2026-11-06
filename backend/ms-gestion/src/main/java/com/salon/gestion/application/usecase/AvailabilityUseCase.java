package com.salon.gestion.application.usecase;

import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.model.StylistSchedule;
import com.salon.gestion.domain.model.TimeSlot;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.ServiceCatalogRepository;
import com.salon.gestion.domain.repository.StylistScheduleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static java.time.format.DateTimeFormatter.ISO_LOCAL_DATE_TIME;

/**
 * Caso de Uso: horarios y disponibilidad de estilistas (CU-05, RF-02).
 */
@Service
@RequiredArgsConstructor
public class AvailabilityUseCase {

    private static final int SLOT_STEP_MINUTES = 30;

    private final StylistScheduleRepository scheduleRepository;
    private final AppointmentRepository appointmentRepository;
    private final ServiceCatalogRepository catalogRepository;
    private final Clock clock;

    /** Turnos libres del estilista para un servicio en una fecha. */
    public List<TimeSlot> availableSlots(String stylistId, String serviceId, LocalDate date) {
        SalonService service = catalogRepository.findActiveById(serviceId)
                .orElseThrow(() -> new IllegalArgumentException("Servicio no encontrado: " + serviceId));

        LocalDateTime now = LocalDateTime.now(clock);
        List<Appointment> taken = appointmentRepository.findActiveBetween(
                stylistId, date.atStartOfDay(), date.plusDays(1).atStartOfDay());

        List<TimeSlot> slots = new ArrayList<>();
        for (StylistSchedule block : blocksOf(stylistId, date)) {
            LocalDateTime start = date.atTime(block.getStartTime());
            LocalDateTime limit = date.atTime(block.getEndTime());
            while (!start.plusMinutes(service.durationMinutes()).isAfter(limit)) {
                LocalDateTime end = start.plusMinutes(service.durationMinutes());
                if (start.isAfter(now) && isFree(taken, start, end)) {
                    slots.add(new TimeSlot(start.format(ISO_LOCAL_DATE_TIME), end.format(ISO_LOCAL_DATE_TIME)));
                }
                start = start.plusMinutes(SLOT_STEP_MINUTES);
            }
        }
        return slots;
    }

    /** Exige una fecha futura y dentro del horario laboral del estilista. */
    public void assertWithinWorkingHours(String stylistId, LocalDateTime start, LocalDateTime end) {
        if (!start.isAfter(LocalDateTime.now(clock))) {
            throw new IllegalArgumentException("La fecha de la cita debe ser futura");
        }
        boolean fits = start.toLocalDate().equals(end.toLocalDate())
                && blocksOf(stylistId, start.toLocalDate()).stream().anyMatch(block ->
                        !start.toLocalTime().isBefore(block.getStartTime())
                                && !end.toLocalTime().isAfter(block.getEndTime()));
        if (!fits) {
            throw new IllegalArgumentException("El horario está fuera de la jornada del estilista");
        }
    }

    private List<StylistSchedule> blocksOf(String stylistId, LocalDate date) {
        int dayOfWeek = date.getDayOfWeek().getValue();
        return scheduleRepository.findByStylistId(stylistId).stream()
                .filter(block -> block.getDayOfWeek() == dayOfWeek && Boolean.TRUE.equals(block.getIsAvailable()))
                .toList();
    }

    private boolean isFree(List<Appointment> taken, LocalDateTime start, LocalDateTime end) {
        return taken.stream().noneMatch(appointment ->
                start.isBefore(appointment.endDate()) && end.isAfter(appointment.getAppointmentDate()));
    }
}
