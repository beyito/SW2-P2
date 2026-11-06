package com.salon.gestion.infrastructure.adapter.persistence.repository;

import com.salon.gestion.infrastructure.adapter.persistence.entity.StylistScheduleEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalTime;
import java.util.List;

@Repository
public interface StylistScheduleJpaRepository extends JpaRepository<StylistScheduleEntity, String> {

    // Un estilista inactivo deja de ofrecer horarios para reservar
    @Query(value = "SELECT block.* FROM stylist_schedules block "
            + "JOIN stylists s ON s.id = block.stylist_id AND s.active "
            + "WHERE block.stylist_id = :stylistId", nativeQuery = true)
    List<StylistScheduleEntity> findByStylistId(@Param("stylistId") String stylistId);

    @Query("SELECT COUNT(s) > 0 FROM StylistScheduleEntity s " +
           "WHERE s.stylistId = :stylistId " +
           "AND s.dayOfWeek = :dayOfWeek " +
           "AND s.isAvailable = true " +
           "AND (:time >= s.startTime AND :time < s.endTime)")
    boolean isStylistAvailable(
            @Param("stylistId") String stylistId,
            @Param("dayOfWeek") int dayOfWeek,
            @Param("time") LocalTime time
    );
}
