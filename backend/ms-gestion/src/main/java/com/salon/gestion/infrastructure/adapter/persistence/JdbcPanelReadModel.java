package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.AppointmentStatus;
import com.salon.gestion.domain.model.PanelAppointment;
import com.salon.gestion.domain.model.PanelSummary;
import com.salon.gestion.domain.repository.PanelReadModel;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

/**
 * Lecturas del panel sobre la vista desnormalizada panel_appointments_view (RNF-01).
 */
@Repository
@RequiredArgsConstructor
public class JdbcPanelReadModel implements PanelReadModel {

    private final JdbcClient jdbc;

    @Override
    public List<PanelAppointment> agenda(LocalDate from, LocalDate to) {
        return jdbc.sql("""
                        SELECT id, client_id, stylist_id, stylist_name, service_name,
                               to_char(appointment_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_text,
                               to_char(appointment_end, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_text,
                               duration_minutes, total_price::float8 AS total_price, status
                        FROM panel_appointments_view
                        WHERE appointment_date >= :from AND appointment_date < :to
                        ORDER BY appointment_date, stylist_name
                        """)
                .param("from", from.atStartOfDay())
                .param("to", to.plusDays(1).atStartOfDay())
                .query((row, index) -> new PanelAppointment(
                        row.getString("id"),
                        row.getString("client_id"),
                        row.getString("stylist_id"),
                        row.getString("stylist_name"),
                        row.getString("service_name"),
                        row.getString("start_text"),
                        row.getString("end_text"),
                        row.getInt("duration_minutes"),
                        row.getDouble("total_price"),
                        AppointmentStatus.valueOf(row.getString("status"))))
                .list();
    }

    @Override
    public PanelSummary summary(LocalDate from, LocalDate to) {
        // La ocupación compara los minutos reservados con los minutos laborables de estilistas activos
        return jdbc.sql("""
                        WITH booked AS (
                            SELECT
                                COUNT(*)::int AS total,
                                COUNT(*) FILTER (WHERE status = 'PENDING_PAYMENT')::int AS pending,
                                COUNT(*) FILTER (WHERE status IN ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED'))::int AS active,
                                COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
                                COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
                                COALESCE(SUM(total_price) FILTER (WHERE status IN ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED')), 0)::float8 AS booked_value,
                                COALESCE(SUM(duration_minutes) FILTER (WHERE status IN ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED')), 0)::float8 AS booked_minutes
                            FROM panel_appointments_view
                            WHERE appointment_date >= :from AND appointment_date < :to
                        ), workable AS (
                            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM block.end_time - block.start_time) / 60), 0)::float8 AS minutes
                            FROM generate_series(CAST(:from AS timestamp), CAST(:to AS timestamp) - INTERVAL '1 day', INTERVAL '1 day') AS day
                            JOIN stylist_schedules block
                                ON block.day_of_week = EXTRACT(ISODOW FROM day) AND block.is_available
                            JOIN stylists s ON s.id = block.stylist_id AND s.active
                        )
                        SELECT booked.*, workable.minutes AS workable_minutes FROM booked, workable
                        """)
                .param("from", from.atStartOfDay())
                .param("to", to.plusDays(1).atStartOfDay())
                .query((row, index) -> {
                    double workable = row.getDouble("workable_minutes");
                    double occupancy = workable == 0 ? 0 : row.getDouble("booked_minutes") / workable;
                    return new PanelSummary(
                            row.getInt("total"),
                            row.getInt("pending"),
                            row.getInt("active"),
                            row.getInt("completed"),
                            row.getInt("cancelled"),
                            row.getDouble("booked_value"),
                            Math.round(occupancy * 10000) / 10000.0);
                })
                .single();
    }
}
