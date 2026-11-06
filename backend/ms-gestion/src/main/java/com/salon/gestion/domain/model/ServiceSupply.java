package com.salon.gestion.domain.model;

/**
 * Línea de la receta de un servicio: insumo y cantidad que consume (RF-03).
 */
public record ServiceSupply(String itemId, int quantity) {
}
