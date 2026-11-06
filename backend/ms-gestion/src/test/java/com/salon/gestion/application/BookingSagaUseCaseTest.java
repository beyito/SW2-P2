package com.salon.gestion.application;

import com.salon.gestion.application.usecase.AvailabilityUseCase;
import com.salon.gestion.application.usecase.BookingRejectedException;
import com.salon.gestion.application.usecase.BookingSagaUseCase;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.model.ServiceSupply;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.InventoryReservationRepository;
import com.salon.gestion.domain.repository.ServiceCatalogRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Pruebas Unitarias: pasos locales de la SAGA de reserva (CU-10, RF-03, RNF-03)")
class BookingSagaUseCaseTest {

    private static final String DATE = "2030-11-15T10:00:00";

    @Mock
    private AppointmentRepository appointments;
    @Mock
    private InventoryReservationRepository reservations;
    @Mock
    private ServiceCatalogRepository catalog;
    @Mock
    private AvailabilityUseCase availability;
    @Spy
    private Clock clock = Clock.fixed(Instant.parse("2030-01-01T12:00:00Z"), ZoneOffset.UTC);
    @InjectMocks
    private BookingSagaUseCase useCase;

    private Appointment appointment(AppointmentStatus status) {
        return Appointment.builder().id("apt-1").serviceId("srv-01").sagaId("s1").status(status).build();
    }

    private String rejectionOf(Runnable action) {
        return assertThrows(BookingRejectedException.class, action::run).getReason();
    }

    @Test
    @DisplayName("Bloquea el turno con el precio del catálogo y queda pendiente de pago")
    void reservesWithCatalogPrice() {
        when(appointments.findBySagaId("s1")).thenReturn(Optional.empty());
        when(catalog.findActiveById("srv-01")).thenReturn(Optional.of(new SalonService("srv-01", "Corte", "d", 60, 45.0)));
        when(appointments.save(any())).thenAnswer(inv -> inv.getArgument(0));

        Appointment saved = useCase.reserveAppointment("s1", "cli-1", "sty-1", "srv-01", DATE);

        assertEquals(45.0, saved.getTotalPrice());
        assertEquals(AppointmentStatus.PENDING_PAYMENT, saved.getStatus());
        assertEquals("s1", saved.getSagaId());
    }

    @Test
    @DisplayName("Un comando repetido devuelve la misma cita sin crear otra")
    void reserveIsIdempotent() {
        Appointment existing = appointment(AppointmentStatus.PENDING_PAYMENT);
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(existing));

        assertSame(existing, useCase.reserveAppointment("s1", "cli-1", "sty-1", "srv-01", DATE));
        verify(appointments, never()).save(any());
    }

    @Test
    @DisplayName("Rechaza servicio inexistente, fecha inválida, fuera de horario y turno ocupado")
    void rejectsInvalidReservations() {
        when(appointments.findBySagaId("s1")).thenReturn(Optional.empty());
        when(catalog.findActiveById("nada")).thenReturn(Optional.empty());
        assertEquals("SERVICE_NOT_FOUND", rejectionOf(() -> useCase.reserveAppointment("s1", "c", "e", "nada", DATE)));

        when(catalog.findActiveById("srv-01")).thenReturn(Optional.of(new SalonService("srv-01", "Corte", "d", 60, 45.0)));
        assertEquals("INVALID_DATE", rejectionOf(() -> useCase.reserveAppointment("s1", "c", "e", "srv-01", "mañana")));

        doThrow(new IllegalArgumentException("fuera")).when(availability).assertWithinWorkingHours(any(), any(), any());
        assertEquals("OUTSIDE_WORKING_HOURS", rejectionOf(() -> useCase.reserveAppointment("s1", "c", "e", "srv-01", DATE)));

        doNothing().when(availability).assertWithinWorkingHours(any(), any(), any());
        when(appointments.existsOverlapping(any(), any(), any())).thenReturn(true);
        assertEquals("SLOT_TAKEN", rejectionOf(() -> useCase.reserveAppointment("s1", "c", "e", "srv-01", DATE)));
        verify(appointments, never()).save(any());
    }

    @Test
    @DisplayName("Si falta un insumo de la receta, la reserva se rechaza")
    void rejectsWhenStockIsInsufficient() {
        when(reservations.existsForSaga("s1")).thenReturn(false);
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(appointment(AppointmentStatus.PENDING_PAYMENT)));
        ServiceSupply supply = new ServiceSupply("inv-1", 2);
        when(catalog.findSupplies("srv-01")).thenReturn(List.of(supply));
        when(reservations.reserve("s1", supply)).thenReturn(false);

        assertEquals("STOCK_INSUFFICIENT", rejectionOf(() -> useCase.reserveInventory("s1")));
    }

    @Test
    @DisplayName("Reservar insumos dos veces no aparta el doble")
    void reserveInventoryIsIdempotent() {
        when(reservations.existsForSaga("s1")).thenReturn(true);
        useCase.reserveInventory("s1");
        verify(reservations, never()).reserve(any(), any());
    }

    @Test
    @DisplayName("La compensación libera el turno pendiente de pago")
    void cancelReleasesPendingAppointment() {
        Appointment pending = appointment(AppointmentStatus.PENDING_PAYMENT);
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(pending));

        useCase.cancelAppointment("s1", "Pago rechazado");

        assertEquals(AppointmentStatus.CANCELLED, pending.getStatus());
        verify(appointments).save(pending);
    }

    @Test
    @DisplayName("La compensación nunca revierte una cita ya pagada")
    void cancelDoesNotTouchPaidAppointment() {
        Appointment confirmed = appointment(AppointmentStatus.CONFIRMED);
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(confirmed));

        useCase.cancelAppointment("s1", "tarde");

        assertEquals(AppointmentStatus.CONFIRMED, confirmed.getStatus());
        verify(appointments, never()).save(any());
    }

    private Appointment paidAt(String date) {
        Appointment appointment = appointment(AppointmentStatus.CONFIRMED);
        appointment.setAppointmentDate(LocalDateTime.parse(date));
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(appointment));
        return appointment;
    }

    @Test
    @DisplayName("Cancelar una cita pagada libera el turno y devuelve los insumos")
    void cancelPaidReleasesSlotAndRestocks() {
        Appointment paid = paidAt("2030-06-01T10:00:00");

        useCase.cancelPaidAppointment("s1");

        assertEquals(AppointmentStatus.CANCELLED, paid.getStatus());
        verify(appointments).save(paid);
        verify(reservations).restock("s1", "apt-1");
    }

    @Test
    @DisplayName("No se puede cancelar una cita que ya comenzó")
    void cancelPaidRejectsPastAppointment() {
        Appointment paid = paidAt("2029-12-31T10:00:00");

        assertEquals("TOO_LATE", rejectionOf(() -> useCase.cancelPaidAppointment("s1")));
        assertEquals(AppointmentStatus.CONFIRMED, paid.getStatus());
        verify(reservations, never()).restock(any(), any());
    }

    @Test
    @DisplayName("Cancelar dos veces no devuelve los insumos dos veces")
    void cancelPaidIsIdempotent() {
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(appointment(AppointmentStatus.CANCELLED)));

        useCase.cancelPaidAppointment("s1");

        verify(appointments, never()).save(any());
        verify(reservations, never()).restock(any(), any());
    }

    @Test
    @DisplayName("Una cita sin pagar no se cancela por este flujo")
    void cancelPaidRejectsUnpaid() {
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(appointment(AppointmentStatus.PENDING_PAYMENT)));
        assertEquals("NOT_CANCELLABLE", rejectionOf(() -> useCase.cancelPaidAppointment("s1")));
    }

    @Test
    @DisplayName("Confirmar dos veces no vuelve a guardar")
    void confirmIsIdempotent() {
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(appointment(AppointmentStatus.CONFIRMED)));
        useCase.confirmAppointment("s1");
        verify(appointments, never()).save(any());
    }

    @Test
    @DisplayName("Descontar stock devuelve los insumos que quedaron críticos")
    void commitReturnsCriticalItems() {
        when(appointments.findBySagaId("s1")).thenReturn(Optional.of(appointment(AppointmentStatus.CONFIRMED)));
        when(reservations.commit("s1", "apt-1")).thenReturn(List.of("KERAT-BIO-1L"));

        assertEquals(List.of("KERAT-BIO-1L"), useCase.commitInventory("s1"));
    }
}
