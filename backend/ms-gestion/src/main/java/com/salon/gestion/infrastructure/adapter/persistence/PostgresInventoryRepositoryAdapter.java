package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.repository.InventoryRepository;
import com.salon.gestion.infrastructure.adapter.persistence.entity.InventoryItemEntity;
import com.salon.gestion.infrastructure.adapter.persistence.repository.InventoryJpaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Primary
@Repository
@RequiredArgsConstructor
public class PostgresInventoryRepositoryAdapter implements InventoryRepository {

    private final InventoryJpaRepository jpaRepository;

    @Override
    public InventoryItem save(InventoryItem item) {
        InventoryItemEntity entity = toEntity(item);
        InventoryItemEntity saved = jpaRepository.save(entity);
        return toDomain(saved);
    }

    @Override
    public Optional<InventoryItem> findById(String id) {
        return jpaRepository.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<InventoryItem> findByCode(String code) {
        return jpaRepository.findByCode(code).map(this::toDomain);
    }

    @Override
    public List<InventoryItem> findAll() {
        return jpaRepository.findAll().stream()
                .map(this::toDomain)
                .toList();
    }

    @Override
    public List<InventoryItem> findCriticalStockItems() {
        return jpaRepository.findCriticalStockItems().stream()
                .map(this::toDomain)
                .toList();
    }

    private InventoryItem toDomain(InventoryItemEntity entity) {
        return InventoryItem.builder()
                .id(entity.getId())
                .code(entity.getCode())
                .name(entity.getName())
                .category(entity.getCategory())
                .currentStock(entity.getCurrentStock())
                .minimumStock(entity.getMinimumStock())
                .unitPrice(entity.getUnitPrice())
                .build();
    }

    private InventoryItemEntity toEntity(InventoryItem domain) {
        return InventoryItemEntity.builder()
                .id(domain.getId())
                .code(domain.getCode())
                .name(domain.getName())
                .category(domain.getCategory())
                .currentStock(domain.getCurrentStock())
                .minimumStock(domain.getMinimumStock())
                .unitPrice(domain.getUnitPrice())
                .build();
    }
}
