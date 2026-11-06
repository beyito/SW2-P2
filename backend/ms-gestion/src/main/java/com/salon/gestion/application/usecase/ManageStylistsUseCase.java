package com.salon.gestion.application.usecase;

import com.salon.gestion.application.dto.ScheduleInput;
import com.salon.gestion.application.dto.StylistInput;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.Stylist;
import com.salon.gestion.domain.model.StylistSchedule;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.StylistRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;

/**
 * Casos de Uso: registrar y modificar estilistas (CU-04) y gestionar sus horarios (CU-05).
 * Ningún cambio puede dejar sin atención una cita futura ya reservada.
 */
@Service
@RequiredArgsConstructor
public class ManageStylistsUseCase {

    private static final int FUTURE_YEARS = 100;

    private final StylistRepository stylists;
    private final AppointmentRepository appointments;
    private final Clock clock;

    public List<Stylist> getAll() {
        return stylists.findAll();
    }

    public Stylist create(StylistInput input) {
        return stylists.save(new Stylist(UUID.randomUUID().toString(), input.name(), input.specialty(), input.phone(), true));
    }

    public Stylist update(String id, StylistInput input) {
        Stylist current = find(id);
        return stylists.save(new Stylist(id, input.name(), input.specialty(), input.phone(), current.active()));
    }

    public Stylist setActive(String id, boolean active) {
        Stylist current = find(id);
        if (!active && !futureAppointmentsOf(id).isEmpty()) {
            throw new IllegalStateException("El estilista tiene citas futuras; reprográmelas o cancélelas antes de desactivarlo");
        }
        return stylists.save(new Stylist(id, current.name(), current.specialty(), current.phone(), active));
    }

    public StylistSchedule setSchedule(ScheduleInput input) {
        Stylist stylist = find(input.stylistId());
        if (input.dayOfWeek() < 1 || input.dayOfWeek() > 7) {
            throw new IllegalArgumentException("El día debe estar entre 1 (lunes) y 7 (domingo)");
        }
        LocalTime start = parseTime(input.startTime());
        LocalTime end = parseTime(input.endTime());
        if (!end.isAfter(start)) {
            throw new IllegalArgumentException("La hora de salida debe ser posterior a la de entrada");
        }

        boolean leavesOutAppointment = futureAppointmentsOf(stylist.id()).stream()
                .filter(appointment -> appointment.getAppointmentDate().getDayOfWeek().getValue() == input.dayOfWeek())
                .anyMatch(appointment -> !input.isAvailable()
                        || appointment.getAppointmentDate().toLocalTime().isBefore(start)
                        || appointment.endDate().toLocalTime().isAfter(end));
        if (leavesOutAppointment) {
            throw new IllegalStateException("El nuevo horario deja fuera citas ya reservadas; reprográmelas primero");
        }

        return stylists.saveSchedule(StylistSchedule.builder()
                .id(UUID.randomUUID().toString())
                .stylistId(stylist.id())
                .stylistName(stylist.name())
                .dayOfWeek(input.dayOfWeek())
                .startTime(start)
                .endTime(end)
                .isAvailable(input.isAvailable())
                .build());
    }

    private List<Appointment> futureAppointmentsOf(String stylistId) {
        LocalDateTime now = LocalDateTime.now(clock);
        return appointments.findActiveBetween(stylistId, now, now.plusYears(FUTURE_YEARS));
    }

    private Stylist find(String id) {
        return stylists.findById(id).orElseThrow(() -> new IllegalArgumentException("Estilista no encontrado: " + id));
    }

    private LocalTime parseTime(String value) {
        try {
            return LocalTime.parse(value);
        } catch (DateTimeParseException | NullPointerException e) {
            throw new IllegalArgumentException("Hora inválida: use el formato HH:mm");
        }
    }
}
