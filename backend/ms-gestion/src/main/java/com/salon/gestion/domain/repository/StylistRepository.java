package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.Stylist;
import com.salon.gestion.domain.model.StylistSchedule;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Puerto de Dominio (DDD): estilistas y sus horarios (CU-04, CU-05).
 */
public interface StylistRepository {
    List<Stylist> findAll();
    Optional<Stylist> findById(String id);
    /** Crea o actualiza al estilista y mantiene su nombre en los horarios. */
    Stylist save(Stylist stylist);
    /** Crea o reemplaza el bloque del día indicado. */
    StylistSchedule saveSchedule(StylistSchedule schedule);
    /** Horarios de varios estilistas en una sola consulta (DataLoader). */
    Map<String, List<StylistSchedule>> findSchedulesOf(Collection<String> stylistIds);
    /** Nombres de varios estilistas en una sola consulta (DataLoader). */
    Map<String, String> findNamesOf(Collection<String> stylistIds);
}
