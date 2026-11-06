package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.application.dto.ScheduleInput;
import com.salon.gestion.application.dto.StylistInput;
import com.salon.gestion.application.usecase.ManageStylistsUseCase;
import com.salon.gestion.domain.model.Stylist;
import com.salon.gestion.domain.model.StylistRating;
import com.salon.gestion.domain.model.StylistSchedule;
import com.salon.gestion.domain.repository.ReviewRepository;
import com.salon.gestion.domain.repository.StylistRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.BatchMapping;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Adaptador de Entrada GraphQL: estilistas y horarios (CU-04, CU-05).
 * Los campos anidados usan DataLoader para no consultar una vez por fila (RNF-01).
 */
@Controller
@RequiredArgsConstructor
public class StylistGraphQLController {

    private final ManageStylistsUseCase manageStylists;
    private final StylistRepository stylists;
    private final ReviewRepository reviews;

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @QueryMapping
    public List<Stylist> getAllStylists() {
        return manageStylists.getAll();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @MutationMapping
    public Stylist createStylist(@Argument StylistInput input) {
        return manageStylists.create(input);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @MutationMapping
    public Stylist updateStylist(@Argument String id, @Argument StylistInput input) {
        return manageStylists.update(id, input);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @MutationMapping
    public Stylist setStylistActive(@Argument String id, @Argument boolean active) {
        return manageStylists.setActive(id, active);
    }

    // Un estilista puede administrar su propio horario
    @PreAuthorize("hasRole('ADMIN') or (hasRole('STYLIST') and @appointmentAccess.isSelf(authentication, #input.stylistId()))")
    @MutationMapping
    public StylistSchedule setStylistSchedule(@Argument ScheduleInput input) {
        return manageStylists.setSchedule(input);
    }

    @BatchMapping(typeName = "Stylist", field = "schedules")
    public Map<Stylist, List<StylistSchedule>> schedules(List<Stylist> batch) {
        Map<String, List<StylistSchedule>> byStylist = stylists.findSchedulesOf(batch.stream().map(Stylist::id).toList());
        return batch.stream().collect(Collectors.toMap(s -> s, s -> byStylist.getOrDefault(s.id(), List.of())));
    }

    @BatchMapping(typeName = "Stylist", field = "rating")
    public Map<Stylist, StylistRating> rating(List<Stylist> batch) {
        Map<String, StylistRating> byStylist = reviews.ratingsOf(batch.stream().map(Stylist::id).toList());
        return batch.stream().collect(Collectors.toMap(s -> s, s -> byStylist.getOrDefault(s.id(), StylistRating.EMPTY)));
    }
}
