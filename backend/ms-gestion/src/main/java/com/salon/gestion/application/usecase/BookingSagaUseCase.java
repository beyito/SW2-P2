package com.salon.gestion.application.usecase;

import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.model.ServiceSupply;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.InventoryReservationRepository;
import com.salon.gestion.domain.repository.ServiceCatalogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;

/**
 * Pasos locales de la SAGA de reserva (CU-06, CU-10, RF-03, RNF-03).
 * Los mensajes pueden llegar repetidos, así que cada paso es idempotente por SAGA.
 */
@Service
@RequiredArgsConstructor
public class BookingSagaUseCase {

    private final AppointmentRepository appointmentRepository;
    private final InventoryReservationRepository reservationRepository;
    private final ServiceCatalogRepository catalogRepository;
    private final AvailabilityUseCase availability;
    private final Clock clock;

    /** Bloquea el turno con el precio del catálogo mientras se espera el pago. */
    @Transactional
    public Appointment reserveAppointment(String sagaId, String clientId, String stylistId, String serviceId, String date) {
        var existing = appointmentRepository.findBySagaId(sagaId);
        if (existing.isPresent()) {
            return existing.get();
        }

        SalonService service = catalogRepository.findActiveById(serviceId)
                .orElseThrow(() -> new BookingRejectedException("SERVICE_NOT_FOUND", "El servicio no existe"));

        LocalDateTime start = parseDate(date);
        LocalDateTime end = start.plusMinutes(service.durationMinutes());
        try {
            availability.assertWithinWorkingHours(stylistId, start, end);
        } catch (IllegalArgumentException e) {
            throw new BookingRejectedException("OUTSIDE_WORKING_HOURS", e.getMessage());
        }
        if (appointmentRepository.existsOverlapping(stylistId, start, end)) {
            throw new BookingRejectedException("SLOT_TAKEN", "El turno ya no está disponible");
        }

        return appointmentRepository.save(Appointment.builder()
                .id(UUID.randomUUID().toString())
                .clientId(clientId)
                .stylistId(stylistId)
                .serviceId(service.id())
                .serviceName(service.name())
                .appointmentDate(start)
                .durationMinutes(service.durationMinutes())
                .totalPrice(service.price())
                .status(AppointmentStatus.PENDING_PAYMENT)
                .sagaId(sagaId)
                .build());
    }

    /** Aparta toda la receta del servicio; si falta un insumo no aparta ninguno. */
    @Transactional
    public void reserveInventory(String sagaId) {
        if (reservationRepository.existsForSaga(sagaId)) {
            return;
        }
        Appointment appointment = appointmentOf(sagaId);
        for (ServiceSupply supply : catalogRepository.findSupplies(appointment.getServiceId())) {
            if (!reservationRepository.reserve(sagaId, supply)) {
                throw new BookingRejectedException("STOCK_INSUFFICIENT", "Stock insuficiente del insumo " + supply.itemId());
            }
        }
    }

    @Transactional
    public void confirmAppointment(String sagaId) {
        Appointment appointment = appointmentOf(sagaId);
        if (appointment.getStatus() != AppointmentStatus.CONFIRMED) {
            appointment.confirm();
            appointmentRepository.save(appointment);
        }
    }

    /** Descuenta lo reservado y devuelve los insumos que quedaron en nivel crítico (RF-03). */
    @Transactional
    public List<String> commitInventory(String sagaId) {
        return reservationRepository.commit(sagaId, appointmentOf(sagaId).getId());
    }

    /** Compensación: devuelve el stock reservado. */
    @Transactional
    public void releaseInventory(String sagaId) {
        reservationRepository.release(sagaId);
    }

    /** Compensación: libera el turno bloqueado. Una cita ya pagada nunca se revierte aquí. */
    @Transactional
    public void cancelAppointment(String sagaId, String reason) {
        appointmentRepository.findBySagaId(sagaId)
                .filter(appointment -> appointment.getStatus() == AppointmentStatus.PENDING_PAYMENT)
                .ifPresent(appointment -> {
                    appointment.cancel(reason);
                    appointmentRepository.save(appointment);
                });
    }

    /**
     * Cancela una cita pagada antes del servicio: libera el turno y devuelve los insumos (CU-07).
     * Repetir el comando no tiene efecto.
     *
     * @throws BookingRejectedException si la cita ya no se puede cancelar
     */
    @Transactional
    public void cancelPaidAppointment(String sagaId) {
        Appointment appointment = appointmentOf(sagaId);
        if (appointment.getStatus() == AppointmentStatus.CANCELLED) {
            return;
        }
        boolean paid = appointment.getStatus() == AppointmentStatus.CONFIRMED
                || appointment.getStatus() == AppointmentStatus.RESCHEDULED;
        if (!paid) {
            throw new BookingRejectedException("NOT_CANCELLABLE", "La cita no se puede cancelar en su estado actual");
        }
        if (!appointment.getAppointmentDate().isAfter(LocalDateTime.now(clock))) {
            throw new BookingRejectedException("TOO_LATE", "La cita ya comenzó o ya pasó");
        }
        appointment.cancel("Cancelada por el cliente con reembolso");
        appointmentRepository.save(appointment);
        reservationRepository.restock(sagaId, appointment.getId());
    }

    private Appointment appointmentOf(String sagaId) {
        return appointmentRepository.findBySagaId(sagaId)
                .orElseThrow(() -> new IllegalStateException("No existe cita para la SAGA " + sagaId));
    }

    private LocalDateTime parseDate(String date) {
        try {
            return LocalDateTime.parse(date);
        } catch (DateTimeParseException | NullPointerException e) {
            throw new BookingRejectedException("INVALID_DATE", "Fecha de cita inválida");
        }
    }
}
