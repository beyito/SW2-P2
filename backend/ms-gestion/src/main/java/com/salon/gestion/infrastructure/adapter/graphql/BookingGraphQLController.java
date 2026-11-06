package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.application.usecase.AvailabilityUseCase;
import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.model.Stylist;
import com.salon.gestion.domain.model.StylistSchedule;
import com.salon.gestion.domain.model.TimeSlot;
import com.salon.gestion.domain.repository.ServiceCatalogRepository;
import com.salon.gestion.domain.repository.StylistScheduleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.stereotype.Controller;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Adaptador de Entrada GraphQL: catálogo y disponibilidad para cualquier usuario autenticado.
 */
@Controller
@RequiredArgsConstructor
public class BookingGraphQLController {

    private final ServiceCatalogRepository catalogRepository;
    private final StylistScheduleRepository scheduleRepository;
    private final AvailabilityUseCase availability;

    @QueryMapping
    public List<SalonService> getServices() {
        return catalogRepository.findActiveServices();
    }

    @QueryMapping
    public List<Stylist> getStylists() {
        return catalogRepository.findStylists();
    }

    @QueryMapping
    public List<StylistSchedule> getStylistSchedules(@Argument String stylistId) {
        return scheduleRepository.findByStylistId(stylistId);
    }

    @QueryMapping
    public List<TimeSlot> getAvailableSlots(@Argument String stylistId, @Argument String serviceId, @Argument String date) {
        try {
            return availability.availableSlots(stylistId, serviceId, LocalDate.parse(date));
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("Fecha inválida: use el formato AAAA-MM-DD");
        }
    }
}
