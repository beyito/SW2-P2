package com.salon.gestion.application.dto;

/** Bloque de horario de un estilista para un día de la semana (CU-05). */
public record ScheduleInput(String stylistId, int dayOfWeek, String startTime, String endTime, boolean isAvailable) {
}
