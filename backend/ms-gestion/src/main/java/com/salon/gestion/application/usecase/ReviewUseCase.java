package com.salon.gestion.application.usecase;

import com.salon.gestion.application.dto.CreateReviewInput;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.Review;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.domain.repository.ReviewRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * Caso de Uso: reseñas de estilistas. Solo se reseña una cita propia ya atendida, y una sola vez.
 */
@Service
@RequiredArgsConstructor
public class ReviewUseCase {

    private final ReviewRepository reviews;
    private final AppointmentRepository appointments;

    public Review create(String clientId, CreateReviewInput input) {
        // Una cita ajena se responde igual que una inexistente, para no revelar que existe
        Appointment appointment = appointments.findById(input.appointmentId())
                .filter(found -> found.getClientId().equals(clientId))
                .orElseThrow(() -> new IllegalArgumentException("Cita no encontrada: " + input.appointmentId()));
        if (appointment.getStatus() != AppointmentStatus.COMPLETED) {
            throw new IllegalStateException("Solo se puede reseñar una cita ya atendida");
        }

        String comment = input.comment() == null || input.comment().isBlank() ? null : input.comment().strip();
        Review review = new Review(
                UUID.randomUUID().toString(), appointment.getId(), appointment.getStylistId(), clientId, input.rating(), comment, null);
        if (!reviews.saveIfAbsent(review)) {
            throw new IllegalStateException("Esta cita ya tiene una reseña");
        }
        return review;
    }

    public List<Review> ofStylist(String stylistId) {
        return reviews.findByStylist(stylistId);
    }
}
