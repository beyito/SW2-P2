package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.InventoryItem;

import java.util.List;
import java.util.Optional;

/**
 * Puerto de Dominio (DDD): Repositorio de Inventario
 */
public interface InventoryRepository {
    InventoryItem save(InventoryItem item);
    Optional<InventoryItem> findById(String id);
    Optional<InventoryItem> findByCode(String code);
    List<InventoryItem> findAll();
    List<InventoryItem> findCriticalStockItems();
    /**
     * Aplica el cambio de stock en una sola sentencia y registra el movimiento.
     *
     * @return el insumo actualizado, o vacío si dejaría menos stock que lo ya reservado
     */
    Optional<InventoryItem> adjustStock(String id, int quantityChange, String reason);
    /** @return el insumo actualizado, o vacío si no existe */
    Optional<InventoryItem> updateMinimumStock(String id, int minimumStock);
}
