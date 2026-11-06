package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.Appointment;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Puerto de Dominio (DDD): Repositorio de Citas
 */
public interface AppointmentRepository {
    Appointment save(Appointment appointment);
    Optional<Appointment> findById(String id);
    List<Appointment> findByStylistId(String stylistId);
    List<Appointment> findByClientId(String clientId);
    boolean existsOverlapping(String stylistId, LocalDateTime start, LocalDateTime end);
}
