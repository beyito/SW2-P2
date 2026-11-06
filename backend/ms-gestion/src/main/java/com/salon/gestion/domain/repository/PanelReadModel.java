package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.PanelAppointment;
import com.salon.gestion.domain.model.PanelSummary;

import java.time.LocalDate;
import java.util.List;

/**
 * Puerto de lectura del panel empresarial: consulta vistas desnormalizadas (RNF-01).
 */
public interface PanelReadModel {
    List<PanelAppointment> agenda(LocalDate from, LocalDate to);
    PanelSummary summary(LocalDate from, LocalDate to);
}
