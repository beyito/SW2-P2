package com.salon.gestion.domain.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalTime;

/**
 * Entidad de Dominio: Horario y Disponibilidad de Estilista (CU-05)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StylistSchedule {

    private String id;
    private String stylistId;
    private String stylistName;
    private Integer dayOfWeek; // 1 = Lunes, 7 = Domingo
    private LocalTime startTime;
    private LocalTime endTime;
    private Boolean isAvailable;
}
