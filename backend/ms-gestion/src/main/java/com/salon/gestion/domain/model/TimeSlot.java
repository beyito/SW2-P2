package com.salon.gestion.domain.model;

/**
 * Turno disponible, con fechas en formato ISO local del salón.
 */
public record TimeSlot(String start, String end) {
}
