package com.salon.gestion.application;

import com.salon.gestion.application.dto.CreateReviewInput;
import com.salon.gestion.application.usecase.ReviewUseCase;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.Review;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.ReviewRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@DisplayName("Pruebas Unitarias de Aplicación: reseñas de estilistas")
class ReviewUseCaseTest {

    private ReviewRepository reviews;
    private AppointmentRepository appointments;
    private ReviewUseCase useCase;

    @BeforeEach
    void setUp() {
        reviews = mock(ReviewRepository.class);
        appointments = mock(AppointmentRepository.class);
        useCase = new ReviewUseCase(reviews, appointments);
    }

    private void givenAppointment(AppointmentStatus status) {
        when(appointments.findById("apt-1")).thenReturn(Optional.of(Appointment.builder()
                .id("apt-1").clientId("cli-1").stylistId("sty-1").status(status).build()));
    }

    @Test
    @DisplayName("Debe guardar la reseña de una cita propia ya atendida")
    void shouldCreateReview() {
        givenAppointment(AppointmentStatus.COMPLETED);
        when(reviews.saveIfAbsent(any())).thenReturn(true);

        Review review = useCase.create("cli-1", new CreateReviewInput("apt-1", 5, " Excelente "));

        assertEquals("sty-1", review.stylistId());
        assertEquals("Excelente", review.comment());
    }

    @Test
    @DisplayName("Una cita ajena se responde igual que una inexistente")
    void shouldHideOtherClientsAppointments() {
        givenAppointment(AppointmentStatus.COMPLETED);

        assertThrows(IllegalArgumentException.class, () -> useCase.create("cli-2", new CreateReviewInput("apt-1", 5, null)));
        verify(reviews, never()).saveIfAbsent(any());
    }

    @Test
    @DisplayName("No debe reseñar una cita que aún no se atiende")
    void shouldRejectPendingAppointment() {
        givenAppointment(AppointmentStatus.CONFIRMED);

        assertThrows(IllegalStateException.class, () -> useCase.create("cli-1", new CreateReviewInput("apt-1", 5, null)));
    }

    @Test
    @DisplayName("Debe rechazar una calificación fuera de rango")
    void shouldRejectInvalidRating() {
        givenAppointment(AppointmentStatus.COMPLETED);

        assertThrows(IllegalArgumentException.class, () -> useCase.create("cli-1", new CreateReviewInput("apt-1", 6, null)));
        assertThrows(IllegalArgumentException.class, () -> useCase.create("cli-1", new CreateReviewInput("apt-1", 0, null)));
    }

    @Test
    @DisplayName("Debe rechazar una segunda reseña de la misma cita")
    void shouldRejectDuplicateReview() {
        givenAppointment(AppointmentStatus.COMPLETED);
        when(reviews.saveIfAbsent(any())).thenReturn(false);

        assertThrows(IllegalStateException.class, () -> useCase.create("cli-1", new CreateReviewInput("apt-1", 4, null)));
    }
}
