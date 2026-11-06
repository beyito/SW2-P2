package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.Review;
import com.salon.gestion.domain.model.StylistRating;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Puerto de Dominio (DDD): reseñas de estilistas.
 */
public interface ReviewRepository {
    /** @return {@code false} si la cita ya tenía una reseña */
    boolean saveIfAbsent(Review review);
    List<Review> findByStylist(String stylistId);
    /** Calificaciones de varios estilistas en una sola consulta (DataLoader). */
    Map<String, StylistRating> ratingsOf(Collection<String> stylistIds);
    /** De las citas indicadas, las que ya tienen reseña (DataLoader). */
    Set<String> reviewedAmong(Collection<String> appointmentIds);
}
