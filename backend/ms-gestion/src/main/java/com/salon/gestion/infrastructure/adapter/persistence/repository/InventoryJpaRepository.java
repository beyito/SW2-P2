package com.salon.gestion.infrastructure.adapter.persistence.repository;

import com.salon.gestion.infrastructure.adapter.persistence.entity.InventoryItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface InventoryJpaRepository extends JpaRepository<InventoryItemEntity, String> {

    Optional<InventoryItemEntity> findByCode(String code);

    @Query("SELECT i FROM InventoryItemEntity i WHERE i.currentStock <= i.minimumStock")
    List<InventoryItemEntity> findCriticalStockItems();
}
