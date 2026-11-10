package com.salon.gestion.infrastructure.adapter.messaging;

import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.repository.InventoryRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Arma el contenido de la alerta de stock crítico: los códigos, que sirven para no repetir el aviso del
 * mismo insumo en el día, y los nombres, que son lo que lee la persona en la app y por WhatsApp.
 */
@Component
@RequiredArgsConstructor
public class StockItemNames {

    private final InventoryRepository inventory;

    public Map<String, Object> alert(List<String> itemCodes) {
        // Si un código ya no existe, se muestra el código antes que no avisar
        List<String> names = itemCodes.stream()
                .map(code -> inventory.findByCode(code).map(InventoryItem::getName).orElse(code))
                .toList();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", itemCodes);
        body.put("names", names);
        return body;
    }
}
