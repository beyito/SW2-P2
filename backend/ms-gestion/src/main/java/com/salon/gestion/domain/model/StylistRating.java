package com.salon.gestion.domain.model;

/**
 * Calificación acumulada de un estilista a partir de sus reseñas.
 */
public record StylistRating(double average, int count) {

    public static final StylistRating EMPTY = new StylistRating(0, 0);
}
