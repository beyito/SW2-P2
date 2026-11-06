package com.salon.gestion.application.dto;

/** Reseña que un cliente deja sobre su cita atendida. */
public record CreateReviewInput(String appointmentId, int rating, String comment) {
}
