package com.salon.gestion.application.usecase;

import com.salon.gestion.domain.model.PanelAppointment;
import com.salon.gestion.domain.model.PanelSummary;
import com.salon.gestion.domain.repository.PanelReadModel;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Caso de Uso: consultas del panel empresarial sobre el Read Model (CU-17, RNF-01).
 */
@Service
@RequiredArgsConstructor
public class PanelUseCase {

    private static final int MAX_DAYS = 366;

    private final PanelReadModel readModel;

    public List<PanelAppointment> agenda(String from, String to) {
        LocalDate start = parse(from);
        LocalDate end = parse(to);
        validateRange(start, end);
        return readModel.agenda(start, end);
    }

    public PanelSummary summary(String from, String to) {
        LocalDate start = parse(from);
        LocalDate end = parse(to);
        validateRange(start, end);
        return readModel.summary(start, end);
    }

    private void validateRange(LocalDate start, LocalDate end) {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("La fecha final no puede ser anterior a la inicial");
        }
        if (end.isAfter(start.plusDays(MAX_DAYS))) {
            throw new IllegalArgumentException("El periodo no puede superar un año");
        }
    }

    private LocalDate parse(String date) {
        try {
            return LocalDate.parse(date);
        } catch (DateTimeParseException | NullPointerException e) {
            throw new IllegalArgumentException("Fecha inválida: use el formato AAAA-MM-DD");
        }
    }
}
