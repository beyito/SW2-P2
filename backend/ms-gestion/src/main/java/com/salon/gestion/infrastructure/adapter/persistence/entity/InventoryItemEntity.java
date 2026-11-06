package com.salon.gestion.infrastructure.adapter.persistence.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "inventory_items")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InventoryItemEntity {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "code", nullable = false, unique = true, length = 50)
    private String code;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "category", nullable = false, length = 50)
    private String category;

    @Column(name = "current_stock", nullable = false)
    private Integer currentStock;

    @Column(name = "minimum_stock", nullable = false)
    private Integer minimumStock;

    @Column(name = "unit_price", nullable = false)
    private Double unitPrice;

    @Column(name = "is_critical_stock", insertable = false, updatable = false)
    private Boolean isCriticalStock;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
