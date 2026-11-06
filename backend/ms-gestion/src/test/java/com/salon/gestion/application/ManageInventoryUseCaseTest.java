package com.salon.gestion.application;

import com.salon.gestion.application.dto.CreateInventoryItemInput;
import com.salon.gestion.application.dto.UpdateStockInput;
import com.salon.gestion.application.usecase.ManageInventoryUseCase;
import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.repository.InventoryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Pruebas Unitarias de Aplicación: ManageInventoryUseCase (CU-08, CU-09)")
class ManageInventoryUseCaseTest {

    @Mock
    private InventoryRepository inventoryRepository;

    @InjectMocks
    private ManageInventoryUseCase manageInventoryUseCase;

    private InventoryItem sampleItem;

    @BeforeEach
    void setUp() {
        sampleItem = InventoryItem.builder()
                .id("inv-uuid-1")
                .code("TIN-001")
                .name("Tinte Rubio Cenizo 8.1")
                .category("COLORACION")
                .currentStock(10)
                .minimumStock(3)
                .unitPrice(18.5)
                .build();
    }

    @Test
    @DisplayName("Debe registrar un nuevo insumo cosmético y persistirlo")
    void shouldCreateInventoryItem() {
        CreateInventoryItemInput input = CreateInventoryItemInput.builder()
                .code("TIN-001")
                .name("Tinte Rubio Cenizo 8.1")
                .category("COLORACION")
                .initialStock(10)
                .minimumStock(3)
                .unitPrice(18.5)
                .build();

        when(inventoryRepository.save(any(InventoryItem.class))).thenAnswer(inv -> inv.getArgument(0));

        InventoryItem result = manageInventoryUseCase.createItem(input);

        assertNotNull(result);
        assertEquals("Tinte Rubio Cenizo 8.1", result.getName());
        assertEquals(10, result.getCurrentStock());
        verify(inventoryRepository, times(1)).save(any(InventoryItem.class));
    }

    @Test
    @DisplayName("Debe actualizar el stock mediante reposición positiva")
    void shouldRestockItemSuccessfully() {
        when(inventoryRepository.findById("inv-uuid-1")).thenReturn(Optional.of(sampleItem));
        when(inventoryRepository.save(any(InventoryItem.class))).thenAnswer(inv -> inv.getArgument(0));

        UpdateStockInput input = UpdateStockInput.builder()
                .id("inv-uuid-1")
                .quantityChange(5)
                .build();

        InventoryItem updated = manageInventoryUseCase.updateStock(input);

        assertEquals(15, updated.getCurrentStock());
        verify(inventoryRepository).save(sampleItem);
    }

    @Test
    @DisplayName("Debe listar insumos en estado de stock crítico")
    void shouldReturnCriticalStockItems() {
        InventoryItem criticalItem = InventoryItem.builder()
                .id("inv-uuid-2")
                .name("Polvo Decolorante Plex")
                .currentStock(1)
                .minimumStock(3)
                .build();

        when(inventoryRepository.findCriticalStockItems()).thenReturn(List.of(criticalItem));

        List<InventoryItem> criticalList = manageInventoryUseCase.getCriticalItems();

        assertEquals(1, criticalList.size());
        assertEquals("Polvo Decolorante Plex", criticalList.get(0).getName());
        verify(inventoryRepository).findCriticalStockItems();
    }
}
