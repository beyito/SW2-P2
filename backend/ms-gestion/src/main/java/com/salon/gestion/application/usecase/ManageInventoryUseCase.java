package com.salon.gestion.application.usecase;

import com.salon.gestion.application.dto.CreateInventoryItemInput;
import com.salon.gestion.application.dto.UpdateStockInput;
import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.repository.InventoryRepository;
import com.salon.gestion.domain.repository.StockAlertPublisher;
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
    private final StockAlertPublisher stockAlerts;

    public InventoryItem createItem(CreateInventoryItemInput input) {
        if (input.getInitialStock() < 0 || input.getMinimumStock() < 0 || input.getUnitPrice() < 0) {
            throw new IllegalArgumentException("El stock y el precio no pueden ser negativos");
        }
        InventoryItem item = InventoryItem.builder()
                .id(UUID.randomUUID().toString())
                .code(input.getCode())
                .name(input.getName())
                .category(input.getCategory())
                .currentStock(input.getInitialStock())
                .minimumStock(input.getMinimumStock())
                .unitPrice(input.getUnitPrice())
                .build();
        return alertIfCritical(inventoryRepository.save(item));
    }

    /** Repone o descuenta stock dejando el movimiento en inventory_logs (CU-08). */
    public InventoryItem updateStock(UpdateStockInput input) {
        if (input.getQuantityChange() == 0) {
            throw new IllegalArgumentException("La cantidad debe ser distinta de cero");
        }
        if (input.getReason() == null || input.getReason().isBlank()) {
            throw new IllegalArgumentException("El motivo del movimiento es obligatorio");
        }
        requireExisting(input.getId());
        InventoryItem updated = inventoryRepository.adjustStock(input.getId(), input.getQuantityChange(), input.getReason().strip())
                .orElseThrow(() -> new IllegalStateException("El stock no puede quedar por debajo de lo reservado"));
        return alertIfCritical(updated);
    }

    /** Cambia el umbral de alerta del insumo (CU-09). */
    public InventoryItem updateMinimumStock(String id, int minimumStock) {
        if (minimumStock < 0) {
            throw new IllegalArgumentException("El stock mínimo no puede ser negativo");
        }
        InventoryItem updated = inventoryRepository.updateMinimumStock(id, minimumStock)
                .orElseThrow(() -> new IllegalArgumentException("Insumo no encontrado: " + id));
        return alertIfCritical(updated);
    }

    private void requireExisting(String id) {
        if (inventoryRepository.findById(id).isEmpty()) {
            throw new IllegalArgumentException("Insumo no encontrado: " + id);
        }
    }

    /** RF-03: el aviso nunca debe impedir el cambio de stock, que ya quedó guardado. */
    private InventoryItem alertIfCritical(InventoryItem item) {
        if (item.isCriticalStock()) {
            stockAlerts.publishCritical(List.of(item.getCode()));
        }
        return item;
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
