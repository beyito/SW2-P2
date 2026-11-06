package com.salon.gestion.domain.model;

/**
 * Reseña de un cliente sobre una cita ya atendida.
 */
public record Review(String id, String appointmentId, String stylistId, String clientId, int rating, String comment, String createdAt) {

    public static final int MAX_COMMENT_LENGTH = 500;

    public Review {
        if (rating < 1 || rating > 5) {
            throw new IllegalArgumentException("La calificación debe estar entre 1 y 5");
        }
        if (comment != null && comment.length() > MAX_COMMENT_LENGTH) {
            throw new IllegalArgumentException("El comentario no puede superar los 500 caracteres");
        }
    }
}
