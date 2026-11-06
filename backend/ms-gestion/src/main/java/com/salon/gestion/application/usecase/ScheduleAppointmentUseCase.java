package com.salon.gestion.application.usecase;

import com.salon.gestion.application.dto.CreateAppointmentInput;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.ServiceCatalogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

/**
 * Caso de Uso de Aplicación: agendamiento directo del personal y administración de citas (CU-06, CU-07).
 * Las reservas pagadas por el cliente pasan por la SAGA (BookingSagaUseCase).
 */
@Service
@RequiredArgsConstructor
public class ScheduleAppointmentUseCase {

    private static final String TURNO_OCUPADO = "El estilista ya cuenta con un turno reservado en el horario solicitado";

    private final AppointmentRepository appointmentRepository;
    private final ServiceCatalogRepository catalogRepository;
    private final AvailabilityUseCase availability;

    public Appointment schedule(CreateAppointmentInput input) {
        SalonService service = catalogRepository.findActiveById(input.getServiceId())
                .orElseThrow(() -> new IllegalArgumentException("Servicio no encontrado: " + input.getServiceId()));

        LocalDateTime date = LocalDateTime.parse(input.getAppointmentDate(), DateTimeFormatter.ISO_DATE_TIME);
        LocalDateTime endDate = date.plusMinutes(service.durationMinutes());

        availability.assertWithinWorkingHours(input.getStylistId(), date, endDate);
        if (appointmentRepository.existsOverlapping(input.getStylistId(), date, endDate)) {
            throw new IllegalStateException(TURNO_OCUPADO);
        }

        Appointment appointment = Appointment.builder()
                .id(UUID.randomUUID().toString())
                .clientId(input.getClientId())
                .stylistId(input.getStylistId())
                .serviceId(service.id())
                .serviceName(service.name())
                .appointmentDate(date)
                .durationMinutes(service.durationMinutes())
                .totalPrice(service.price())
                .status(AppointmentStatus.SCHEDULED)
                .notes(input.getNotes())
                .build();

        return appointmentRepository.save(appointment);
    }

    public Appointment cancel(String appointmentId, String reason) {
        Appointment appointment = find(appointmentId);
        // Estas citas las maneja la SAGA: una en curso se compensa y una pagada requiere reembolso (Fase E)
        if (appointment.getSagaId() != null) {
            throw new IllegalStateException("Esta cita se pagó en línea; su cancelación requiere un reembolso");
        }
        appointment.cancel(reason);
        return appointmentRepository.save(appointment);
    }

    public Appointment reschedule(String appointmentId, String newDateStr) {
        Appointment appointment = find(appointmentId);
        if (appointment.getStatus() == AppointmentStatus.PENDING_PAYMENT) {
            throw new IllegalStateException("No se puede reprogramar una cita pendiente de pago");
        }

        LocalDateTime newDate = LocalDateTime.parse(newDateStr, DateTimeFormatter.ISO_DATE_TIME);
        LocalDateTime newEnd = newDate.plusMinutes(appointment.getDurationMinutes());

        availability.assertWithinWorkingHours(appointment.getStylistId(), newDate, newEnd);
        if (appointmentRepository.existsOverlappingExcluding(appointmentId, appointment.getStylistId(), newDate, newEnd)) {
            throw new IllegalStateException(TURNO_OCUPADO);
        }

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

    private Appointment find(String appointmentId) {
        return appointmentRepository.findById(appointmentId)
                .orElseThrow(() -> new IllegalArgumentException("Cita no encontrada con ID: " + appointmentId));
    }
}
