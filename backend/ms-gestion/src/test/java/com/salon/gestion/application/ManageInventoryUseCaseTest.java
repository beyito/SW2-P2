package com.salon.gestion.application;

import com.salon.gestion.application.dto.CreateInventoryItemInput;
import com.salon.gestion.application.dto.UpdateStockInput;
import com.salon.gestion.application.usecase.ManageInventoryUseCase;
import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.repository.InventoryRepository;
import com.salon.gestion.domain.repository.StockAlertPublisher;
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

    @Mock
    private StockAlertPublisher stockAlerts;

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
    @DisplayName("Debe reponer stock con una operación atómica que registra el motivo")
    void shouldRestockItemSuccessfully() {
        InventoryItem restocked = sampleItem.toBuilder().currentStock(15).build();
        when(inventoryRepository.findById("inv-uuid-1")).thenReturn(Optional.of(sampleItem));
        when(inventoryRepository.adjustStock("inv-uuid-1", 5, "Compra")).thenReturn(Optional.of(restocked));

        InventoryItem updated = manageInventoryUseCase.updateStock(stockChange(5, " Compra "));

        assertEquals(15, updated.getCurrentStock());
        verify(inventoryRepository, never()).save(any());
        verifyNoInteractions(stockAlerts);
    }

    @Test
    @DisplayName("Debe rechazar un movimiento sin motivo o con cantidad cero")
    void shouldRejectInvalidStockChange() {
        assertThrows(IllegalArgumentException.class, () -> manageInventoryUseCase.updateStock(stockChange(5, "  ")));
        assertThrows(IllegalArgumentException.class, () -> manageInventoryUseCase.updateStock(stockChange(0, "Compra")));
        verifyNoInteractions(inventoryRepository);
    }

    @Test
    @DisplayName("Debe informar conflicto si el stock quedaría por debajo de lo reservado")
    void shouldRejectStockBelowReserved() {
        when(inventoryRepository.findById("inv-uuid-1")).thenReturn(Optional.of(sampleItem));
        when(inventoryRepository.adjustStock("inv-uuid-1", -10, "Merma")).thenReturn(Optional.empty());

        assertThrows(IllegalStateException.class, () -> manageInventoryUseCase.updateStock(stockChange(-10, "Merma")));
    }

    @Test
    @DisplayName("Debe avisar cuando un movimiento deja el insumo en nivel crítico")
    void shouldAlertWhenStockBecomesCritical() {
        InventoryItem low = sampleItem.toBuilder().currentStock(3).build();
        when(inventoryRepository.findById("inv-uuid-1")).thenReturn(Optional.of(sampleItem));
        when(inventoryRepository.adjustStock("inv-uuid-1", -7, "Merma")).thenReturn(Optional.of(low));

        manageInventoryUseCase.updateStock(stockChange(-7, "Merma"));

        verify(stockAlerts).publishCritical(List.of("TIN-001"));
    }

    @Test
    @DisplayName("CU-09: debe cambiar el stock mínimo y alertar si el insumo pasa a nivel crítico")
    void shouldUpdateMinimumStock() {
        InventoryItem critical = sampleItem.toBuilder().minimumStock(10).build();
        when(inventoryRepository.updateMinimumStock("inv-uuid-1", 10)).thenReturn(Optional.of(critical));

        InventoryItem updated = manageInventoryUseCase.updateMinimumStock("inv-uuid-1", 10);

        assertEquals(10, updated.getMinimumStock());
        verify(stockAlerts).publishCritical(List.of("TIN-001"));
    }

    @Test
    @DisplayName("CU-09: debe rechazar un stock mínimo negativo o un insumo inexistente")
    void shouldRejectInvalidMinimumStock() {
        when(inventoryRepository.updateMinimumStock("no-existe", 2)).thenReturn(Optional.empty());

        assertThrows(IllegalArgumentException.class, () -> manageInventoryUseCase.updateMinimumStock("inv-uuid-1", -1));
        assertThrows(IllegalArgumentException.class, () -> manageInventoryUseCase.updateMinimumStock("no-existe", 2));
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

    private UpdateStockInput stockChange(int quantity, String reason) {
        return UpdateStockInput.builder().id("inv-uuid-1").quantityChange(quantity).reason(reason).build();
    }
}
