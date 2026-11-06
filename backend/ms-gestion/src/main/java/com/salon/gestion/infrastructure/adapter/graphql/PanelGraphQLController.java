package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.application.usecase.PanelUseCase;
import com.salon.gestion.domain.model.PanelAppointment;
import com.salon.gestion.domain.model.PanelSummary;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.util.List;

/**
 * Adaptador de Entrada GraphQL: panel empresarial sobre el Read Model (RNF-01).
 */
@Controller
@RequiredArgsConstructor
public class PanelGraphQLController {

    private final PanelUseCase panel;

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @QueryMapping
    public List<PanelAppointment> getPanelAgenda(@Argument String from, @Argument String to) {
        return panel.agenda(from, to);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @QueryMapping
    public PanelSummary getPanelSummary(@Argument String from, @Argument String to) {
        return panel.summary(from, to);
    }
}
