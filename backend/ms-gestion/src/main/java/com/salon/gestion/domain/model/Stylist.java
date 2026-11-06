package com.salon.gestion.domain.model;

/**
 * Estilista del salón (CU-04). Si está inactivo no recibe nuevas reservas.
 */
public record Stylist(String id, String name, String specialty, String phone, boolean active) {

    public Stylist {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("El nombre del estilista es obligatorio");
        }
        if (name.length() > 100) {
            throw new IllegalArgumentException("El nombre del estilista no puede superar los 100 caracteres");
        }
        name = name.strip();
    }
}
