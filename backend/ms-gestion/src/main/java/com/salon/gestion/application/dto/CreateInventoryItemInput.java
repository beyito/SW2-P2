package com.salon.gestion.application.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateInventoryItemInput {
    private String code;
    private String name;
    private String category;
    private Integer initialStock;
    private Integer minimumStock;
    private Double unitPrice;
}
