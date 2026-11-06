package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.application.dto.CreateAppointmentInput;
import com.salon.gestion.application.usecase.ScheduleAppointmentUseCase;
import com.salon.gestion.domain.model.Appointment;
import com.salon.gestion.domain.repository.ReviewRepository;
import com.salon.gestion.domain.repository.StylistRepository;
import com.salon.gestion.infrastructure.security.AppointmentAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.BatchMapping;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Adaptador de Entrada GraphQL: Controlador de Citas
 */
@Controller
@RequiredArgsConstructor
public class AppointmentGraphQLController {

    private final ScheduleAppointmentUseCase scheduleAppointmentUseCase;
    private final AppointmentAccess access;
    private final StylistRepository stylists;
    private final ReviewRepository reviews;

    /** Portal del cliente: sus citas, de la más reciente a la más antigua. */
    @QueryMapping
    public List<Appointment> getMyAppointments(Authentication authentication) {
        return scheduleAppointmentUseCase.getByClient(access.salonId(authentication)).stream()
                .sorted(Comparator.comparing(Appointment::getAppointmentDate).reversed())
                .toList();
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @MutationMapping
    public Appointment completeAppointment(@Argument String id) {
        return scheduleAppointmentUseCase.complete(id);
    }

    @BatchMapping(typeName = "Appointment", field = "stylistName")
    public Map<Appointment, String> stylistName(List<Appointment> batch) {
        Map<String, String> names = stylists.findNamesOf(batch.stream().map(Appointment::getStylistId).distinct().toList());
        return batch.stream().collect(Collectors.toMap(a -> a, a -> names.getOrDefault(a.getStylistId(), a.getStylistId())));
    }

    @BatchMapping(typeName = "Appointment", field = "reviewed")
    public Map<Appointment, Boolean> reviewed(List<Appointment> batch) {
        Set<String> reviewed = reviews.reviewedAmong(batch.stream().map(Appointment::getId).toList());
        return batch.stream().collect(Collectors.toMap(a -> a, a -> reviewed.contains(a.getId())));
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST') or @appointmentAccess.isOwner(authentication, #id)")
    @QueryMapping
    public Appointment getAppointmentById(@Argument String id) {
        return scheduleAppointmentUseCase.getById(id);
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @QueryMapping
    public List<Appointment> getAppointmentsByStylist(@Argument String stylistId, @Argument String date) {
        return scheduleAppointmentUseCase.getByStylist(stylistId);
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST') or @appointmentAccess.isSelf(authentication, #clientId)")
    @QueryMapping
    public List<Appointment> getAppointmentsByClient(@Argument String clientId) {
        return scheduleAppointmentUseCase.getByClient(clientId);
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @MutationMapping
    public Appointment scheduleAppointment(@Argument CreateAppointmentInput input) {
        return scheduleAppointmentUseCase.schedule(input);
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST') or @appointmentAccess.isOwner(authentication, #id)")
    @MutationMapping
    public Appointment cancelAppointment(@Argument String id, @Argument String reason) {
        return scheduleAppointmentUseCase.cancel(id, reason);
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST') or @appointmentAccess.isOwner(authentication, #id)")
    @MutationMapping
    public Appointment rescheduleAppointment(@Argument String id, @Argument String newDate) {
        return scheduleAppointmentUseCase.reschedule(id, newDate);
    }
}
