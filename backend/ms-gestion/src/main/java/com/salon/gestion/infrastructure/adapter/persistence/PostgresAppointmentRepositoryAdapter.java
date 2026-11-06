package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.repository.AppointmentRepository;
import com.salon.gestion.infrastructure.adapter.persistence.entity.AppointmentEntity;
import com.salon.gestion.infrastructure.adapter.persistence.repository.AppointmentJpaRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Primary
@Repository
@RequiredArgsConstructor
public class PostgresAppointmentRepositoryAdapter implements AppointmentRepository {

    private final AppointmentJpaRepository jpaRepository;

    @Override
    public Appointment save(Appointment appointment) {
        AppointmentEntity entity = toEntity(appointment);
        // saveAndFlush: la restricción anti-solape debe fallar aquí y no al confirmar más tarde
        AppointmentEntity saved = jpaRepository.saveAndFlush(entity);
        return toDomain(saved);
    }

    @Override
    public Optional<Appointment> findById(String id) {
        return jpaRepository.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<Appointment> findBySagaId(String sagaId) {
        return jpaRepository.findBySagaId(sagaId).map(this::toDomain);
    }

    @Override
    public List<Appointment> findByStylistId(String stylistId) {
        return jpaRepository.findByStylistId(stylistId).stream()
                .map(this::toDomain)
                .toList();
    }

    @Override
    public List<Appointment> findByClientId(String clientId) {
        return jpaRepository.findByClientId(clientId).stream()
                .map(this::toDomain)
                .toList();
    }

    @Override
    public boolean existsOverlapping(String stylistId, LocalDateTime start, LocalDateTime end) {
        return jpaRepository.existsOverlapping(stylistId, start, end);
    }

    @Override
    public boolean existsOverlappingExcluding(String appointmentId, String stylistId, LocalDateTime start, LocalDateTime end) {
        return jpaRepository.existsOverlappingExcluding(appointmentId, stylistId, start, end);
    }

    @Override
    public List<Appointment> findActiveBetween(String stylistId, LocalDateTime start, LocalDateTime end) {
        return jpaRepository.findActiveBetween(stylistId, start, end).stream()
                .map(this::toDomain)
                .toList();
    }

    private Appointment toDomain(AppointmentEntity entity) {
        return Appointment.builder()
                .id(entity.getId())
                .clientId(entity.getClientId())
                .stylistId(entity.getStylistId())
                .serviceId(entity.getServiceId())
                .sagaId(entity.getSagaId())
                .serviceName(entity.getServiceName())
                .appointmentDate(entity.getAppointmentDate())
                .durationMinutes(entity.getDurationMinutes())
                .totalPrice(entity.getTotalPrice())
                .status(entity.getStatus())
                .notes(entity.getNotes())
                .build();
    }

    private AppointmentEntity toEntity(Appointment domain) {
        return AppointmentEntity.builder()
                .id(domain.getId())
                .clientId(domain.getClientId())
                .stylistId(domain.getStylistId())
                .serviceId(domain.getServiceId())
                .sagaId(domain.getSagaId())
                .serviceName(domain.getServiceName())
                .appointmentDate(domain.getAppointmentDate())
                .durationMinutes(domain.getDurationMinutes())
                .totalPrice(domain.getTotalPrice())
                .status(domain.getStatus())
                .notes(domain.getNotes())
                .build();
    }
}
