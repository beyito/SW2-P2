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
}
