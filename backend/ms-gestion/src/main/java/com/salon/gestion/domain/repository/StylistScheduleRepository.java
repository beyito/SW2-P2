package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.StylistSchedule;

import java.time.LocalTime;
import java.util.List;

/**
 * Puerto de Dominio (DDD): Repositorio de Disponibilidad de Estilistas
 */
public interface StylistScheduleRepository {
    List<StylistSchedule> findByStylistId(String stylistId);
    boolean isStylistAvailable(String stylistId, int dayOfWeek, LocalTime time);
}
