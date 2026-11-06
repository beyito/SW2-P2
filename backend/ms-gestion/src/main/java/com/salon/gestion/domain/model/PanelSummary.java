package com.salon.gestion.domain.model;

/**
 * Indicadores operativos de un periodo, calculados sobre el Read Model.
 * El valor agendado no equivale a ingresos: los ingresos cobrados los informa el CRM.
 */
public record PanelSummary(
        int totalAppointments,
        int pendingPayment,
        int active,
        int completed,
        int cancelled,
        double bookedValue,
        double occupancyRate) {
}
