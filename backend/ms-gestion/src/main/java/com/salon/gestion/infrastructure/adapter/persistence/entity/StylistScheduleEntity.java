package com.salon.gestion.infrastructure.adapter.persistence.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.time.LocalTime;

@Entity
@Table(name = "stylist_schedules")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StylistScheduleEntity {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "stylist_id", nullable = false, length = 36)
    private String stylistId;

    @Column(name = "stylist_name", nullable = false, length = 100)
    private String stylistName;

    @Column(name = "day_of_week", nullable = false)
    private Integer dayOfWeek;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalTime endTime;

    @Column(name = "is_available", nullable = false)
    private Boolean isAvailable;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.isAvailable == null) {
            this.isAvailable = true;
        }
    }
}
