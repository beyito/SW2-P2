package com.salon.gestion.domain.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Entidad de Dominio (DDD): Insumo Cosmético
 * Control de stock y alerta de stock crítico (RF-03, CU-08, CU-09)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InventoryItem {

    private String id;
    private String code;
    private String name;
    private String category;
    private Integer currentStock;
    private Integer minimumStock;
    private Double unitPrice;

    public boolean isCriticalStock() {
        return this.currentStock <= this.minimumStock;
    }

    public void deductStock(int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("La cantidad a descontar debe ser mayor a cero");
        }
        if (this.currentStock < quantity) {
            throw new IllegalStateException("Stock insuficiente para el insumo: " + this.name);
        }
        this.currentStock -= quantity;
    }

    public void addStock(int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("La cantidad a reponer debe ser mayor a cero");
        }
        this.currentStock += quantity;
    }
}
