package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.StylistSchedule;
import com.salon.gestion.domain.repository.StylistScheduleRepository;
import com.salon.gestion.infrastructure.adapter.persistence.entity.StylistScheduleEntity;
import com.salon.gestion.infrastructure.adapter.persistence.repository.StylistScheduleJpaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Repository;

import java.time.LocalTime;
import java.util.List;

@Primary
@Repository
@RequiredArgsConstructor
public class PostgresStylistScheduleRepositoryAdapter implements StylistScheduleRepository {

    private final StylistScheduleJpaRepository jpaRepository;

    @Override
    public List<StylistSchedule> findByStylistId(String stylistId) {
        return jpaRepository.findByStylistId(stylistId).stream()
                .map(this::toDomain)
                .toList();
    }

    @Override
    public boolean isStylistAvailable(String stylistId, int dayOfWeek, LocalTime time) {
        return jpaRepository.isStylistAvailable(stylistId, dayOfWeek, time);
    }

    private StylistSchedule toDomain(StylistScheduleEntity entity) {
        return StylistSchedule.builder()
                .id(entity.getId())
                .stylistId(entity.getStylistId())
                .stylistName(entity.getStylistName())
                .dayOfWeek(entity.getDayOfWeek())
                .startTime(entity.getStartTime())
                .endTime(entity.getEndTime())
                .isAvailable(entity.getIsAvailable())
                .build();
    }
}
