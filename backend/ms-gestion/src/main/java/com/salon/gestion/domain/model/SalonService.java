package com.salon.gestion.domain.model;

/**
 * Servicio del catálogo del salón. El precio y la duración los define el servidor.
 */
public record SalonService(
        String id,
        String name,
        String description,
        Integer durationMinutes,
        Double price) {
}
