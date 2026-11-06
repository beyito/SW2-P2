package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.application.dto.CreateAppointmentInput;
import com.salon.gestion.application.usecase.ScheduleAppointmentUseCase;
import com.salon.gestion.domain.model.Appointment;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.util.List;

/**
 * Adaptador de Entrada GraphQL: Controlador de Citas
 */
@Controller
@RequiredArgsConstructor
public class AppointmentGraphQLController {

    private final ScheduleAppointmentUseCase scheduleAppointmentUseCase;

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
