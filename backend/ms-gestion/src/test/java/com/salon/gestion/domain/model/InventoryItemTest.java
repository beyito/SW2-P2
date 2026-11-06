package com.salon.gestion.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("Pruebas Unitarias de Dominio: InventoryItem (CU-08, CU-09, RF-03)")
class InventoryItemTest {

    @Test
    @DisplayName("Debe detectar alerta de stock crítico cuando stock actual <= stock mínimo")
    void shouldDetectCriticalStock() {
        InventoryItem item = InventoryItem.builder()
                .id("inv-01")
                .name("Tinte Rubio Cenizo 8.1")
                .currentStock(3)
                .minimumStock(5)
                .build();

        assertTrue(item.isCriticalStock());

        item.addStock(3); // 3 + 3 = 6 > 5
        assertFalse(item.isCriticalStock());
    }

    @Test
    @DisplayName("Debe descontar stock correctamente ante consumo de insumo")
    void shouldDeductStockSuccessfully() {
        InventoryItem item = InventoryItem.builder()
                .id("inv-02")
                .name("Keratina Hidrolizada")
                .currentStock(10)
                .minimumStock(3)
                .build();

        item.deductStock(4);
        assertEquals(6, item.getCurrentStock());
    }

    @Test
    @DisplayName("Debe lanzar excepción si se intenta descontar más stock del disponible")
    void shouldThrowExceptionWhenInsufficientStock() {
        InventoryItem item = InventoryItem.builder()
                .id("inv-03")
                .name("Polvo Decolorante")
                .currentStock(2)
                .minimumStock(3)
                .build();

        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> item.deductStock(5));
        assertTrue(ex.getMessage().contains("Stock insuficiente"));
    }

    @Test
    @DisplayName("Debe lanzar excepción si la cantidad a descontar es menor o igual a cero")
    void shouldThrowExceptionWhenDeductZeroOrNegative() {
        InventoryItem item = InventoryItem.builder()
                .id("inv-04")
                .currentStock(10)
                .minimumStock(2)
                .build();

        assertThrows(IllegalArgumentException.class, () -> item.deductStock(0));
        assertThrows(IllegalArgumentException.class, () -> item.deductStock(-2));
    }
}
