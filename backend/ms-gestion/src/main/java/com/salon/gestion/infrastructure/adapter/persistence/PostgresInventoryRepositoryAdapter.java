package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.repository.InventoryRepository;
import com.salon.gestion.infrastructure.adapter.persistence.entity.InventoryItemEntity;
import com.salon.gestion.infrastructure.adapter.persistence.repository.InventoryJpaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Primary
@Repository
@RequiredArgsConstructor
public class PostgresInventoryRepositoryAdapter implements InventoryRepository {

    private static final String RETURNING_ITEM =
            "id, code, name, category, current_stock, minimum_stock, reserved_stock, unit_price::float8 AS unit_price";

    private static final RowMapper<InventoryItem> ITEM_MAPPER = (row, index) -> InventoryItem.builder()
            .id(row.getString("id"))
            .code(row.getString("code"))
            .name(row.getString("name"))
            .category(row.getString("category"))
            .currentStock(row.getInt("current_stock"))
            .minimumStock(row.getInt("minimum_stock"))
            .reservedStock(row.getInt("reserved_stock"))
            .unitPrice(row.getDouble("unit_price"))
            .build();

    private final InventoryJpaRepository jpaRepository;
    private final JdbcClient jdbc;

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

    @Override
    public Optional<InventoryItem> adjustStock(String id, int quantityChange, String reason) {
        // Una sola sentencia: no puede pisar un descuento simultáneo de la SAGA
        return jdbc.sql("""
                        WITH updated AS (
                            UPDATE inventory_items
                            SET current_stock = current_stock + :change, updated_at = CURRENT_TIMESTAMP
                            WHERE id = :id AND current_stock + :change >= reserved_stock
                            RETURNING %s
                        ), movement AS (
                            INSERT INTO inventory_logs (id, item_id, quantity_change, previous_stock, new_stock, reason)
                            SELECT :log, id, :change, current_stock - :change, current_stock, :reason FROM updated
                        )
                        SELECT * FROM updated
                        """.formatted(RETURNING_ITEM))
                .param("change", quantityChange)
                .param("id", id)
                .param("log", UUID.randomUUID().toString())
                .param("reason", reason)
                .query(ITEM_MAPPER)
                .optional();
    }

    @Override
    public Optional<InventoryItem> updateMinimumStock(String id, int minimumStock) {
        return jdbc.sql("""
                        UPDATE inventory_items
                        SET minimum_stock = :minimum, updated_at = CURRENT_TIMESTAMP
                        WHERE id = :id
                        RETURNING %s
                        """.formatted(RETURNING_ITEM))
                .param("minimum", minimumStock)
                .param("id", id)
                .query(ITEM_MAPPER)
                .optional();
    }

    private InventoryItem toDomain(InventoryItemEntity entity) {
        return InventoryItem.builder()
                .id(entity.getId())
                .code(entity.getCode())
                .name(entity.getName())
                .category(entity.getCategory())
                .currentStock(entity.getCurrentStock())
                .minimumStock(entity.getMinimumStock())
                .reservedStock(entity.getReservedStock())
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
