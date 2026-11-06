package com.salon.gestion.application.usecase;

import com.salon.gestion.application.dto.CreateAppointmentInput;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.repository.AppointmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

/**
 * Caso de Uso de Aplicación: Agendar y Administrar Citas (CU-06, CU-07)
 */
@Service
@RequiredArgsConstructor
public class ScheduleAppointmentUseCase {

    private final AppointmentRepository appointmentRepository;

    public Appointment schedule(CreateAppointmentInput input) {
        LocalDateTime date = LocalDateTime.parse(input.getAppointmentDate(), DateTimeFormatter.ISO_DATE_TIME);
        LocalDateTime endDate = date.plusMinutes(input.getDurationMinutes());

        if (appointmentRepository.existsOverlapping(input.getStylistId(), date, endDate)) {
            throw new IllegalStateException("El estilista ya cuenta con un turno reservado en el horario solicitado");
        }

        Appointment appointment = Appointment.builder()
                .id(UUID.randomUUID().toString())
                .clientId(input.getClientId())
                .stylistId(input.getStylistId())
                .serviceName(input.getServiceName())
                .appointmentDate(date)
                .durationMinutes(input.getDurationMinutes())
                .totalPrice(input.getTotalPrice())
                .status(AppointmentStatus.SCHEDULED)
                .notes(input.getNotes())
                .build();

        return appointmentRepository.save(appointment);
    }

    public Appointment cancel(String appointmentId, String reason) {
        Appointment appointment = appointmentRepository.findById(appointmentId)
                .orElseThrow(() -> new IllegalArgumentException("Cita no encontrada con ID: " + appointmentId));
        appointment.cancel(reason);
        return appointmentRepository.save(appointment);
    }

    public Appointment reschedule(String appointmentId, String newDateStr) {
        Appointment appointment = appointmentRepository.findById(appointmentId)
                .orElseThrow(() -> new IllegalArgumentException("Cita no encontrada con ID: " + appointmentId));
        LocalDateTime newDate = LocalDateTime.parse(newDateStr, DateTimeFormatter.ISO_DATE_TIME);
        appointment.reschedule(newDate);
        return appointmentRepository.save(appointment);
    }

    public List<Appointment> getByStylist(String stylistId) {
        return appointmentRepository.findByStylistId(stylistId);
    }

    public List<Appointment> getByClient(String clientId) {
        return appointmentRepository.findByClientId(clientId);
    }

    public Appointment getById(String id) {
        return appointmentRepository.findById(id).orElse(null);
    }
}
