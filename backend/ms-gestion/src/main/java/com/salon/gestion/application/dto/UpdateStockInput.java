package com.salon.gestion.application.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdateStockInput {
    private String id;
    private Integer quantityChange;
    private String reason;
}
