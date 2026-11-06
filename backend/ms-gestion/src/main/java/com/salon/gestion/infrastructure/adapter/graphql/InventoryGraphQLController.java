package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.application.dto.CreateInventoryItemInput;
import com.salon.gestion.application.dto.UpdateStockInput;
import com.salon.gestion.application.usecase.ManageInventoryUseCase;
import com.salon.gestion.domain.model.InventoryItem;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.util.List;

/**
 * Adaptador de Entrada GraphQL: Controlador de Inventario
 */
@Controller
@RequiredArgsConstructor
public class InventoryGraphQLController {

    private final ManageInventoryUseCase manageInventoryUseCase;

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @QueryMapping
    public List<InventoryItem> getAllInventory() {
        return manageInventoryUseCase.getAll();
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @QueryMapping
    public List<InventoryItem> getCriticalStockItems() {
        return manageInventoryUseCase.getCriticalItems();
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @QueryMapping
    public InventoryItem getInventoryItem(@Argument String id) {
        return manageInventoryUseCase.getById(id);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @MutationMapping
    public InventoryItem createInventoryItem(@Argument CreateInventoryItemInput input) {
        return manageInventoryUseCase.createItem(input);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @MutationMapping
    public InventoryItem updateMinimumStock(@Argument String id, @Argument int minimumStock) {
        return manageInventoryUseCase.updateMinimumStock(id, minimumStock);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @MutationMapping
    public InventoryItem updateStock(@Argument UpdateStockInput input) {
        return manageInventoryUseCase.updateStock(input);
    }
}
