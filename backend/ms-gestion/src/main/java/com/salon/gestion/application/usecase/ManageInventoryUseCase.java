package com.salon.gestion.application.usecase;

import com.salon.gestion.application.dto.CreateInventoryItemInput;
import com.salon.gestion.application.dto.UpdateStockInput;
import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.repository.InventoryRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * Caso de Uso de Aplicación: Gestión de Insumos Cosméticos (CU-08, CU-09, RF-03)
 */
@Service
@RequiredArgsConstructor
public class ManageInventoryUseCase {

    private final InventoryRepository inventoryRepository;

    public InventoryItem createItem(CreateInventoryItemInput input) {
        InventoryItem item = InventoryItem.builder()
                .id(UUID.randomUUID().toString())
                .code(input.getCode())
                .name(input.getName())
                .category(input.getCategory())
                .currentStock(input.getInitialStock())
                .minimumStock(input.getMinimumStock())
                .unitPrice(input.getUnitPrice())
                .build();
        return inventoryRepository.save(item);
    }

    public InventoryItem updateStock(UpdateStockInput input) {
        InventoryItem item = inventoryRepository.findById(input.getId())
                .orElseThrow(() -> new IllegalArgumentException("Insumo no encontrado: " + input.getId()));

        if (input.getQuantityChange() < 0) {
            item.deductStock(Math.abs(input.getQuantityChange()));
        } else {
            item.addStock(input.getQuantityChange());
        }

        return inventoryRepository.save(item);
    }

    public List<InventoryItem> getAll() {
        return inventoryRepository.findAll();
    }

    public List<InventoryItem> getCriticalItems() {
        return inventoryRepository.findCriticalStockItems();
    }

    public InventoryItem getById(String id) {
        return inventoryRepository.findById(id).orElse(null);
    }
}
