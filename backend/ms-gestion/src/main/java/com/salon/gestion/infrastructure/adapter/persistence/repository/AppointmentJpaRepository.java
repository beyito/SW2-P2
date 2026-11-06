package com.salon.gestion.infrastructure.adapter.persistence.repository;

import com.salon.gestion.infrastructure.adapter.persistence.entity.AppointmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface AppointmentJpaRepository extends JpaRepository<AppointmentEntity, String> {

    List<AppointmentEntity> findByStylistId(String stylistId);

    List<AppointmentEntity> findByClientId(String clientId);

    @Query("SELECT COUNT(a) > 0 FROM AppointmentEntity a " +
           "WHERE a.stylistId = :stylistId " +
           "AND a.status <> 'CANCELLED' " +
           "AND (:startDate < FUNCTION('TIMESTAMPADD', MINUTE, a.durationMinutes, a.appointmentDate) " +
           "     AND :endDate > a.appointmentDate)")
    boolean existsOverlapping(
            @Param("stylistId") String stylistId,
            @Param("startDate") LocalDateTime startDate,
            @Param("endDate") LocalDateTime endDate
    );
}
