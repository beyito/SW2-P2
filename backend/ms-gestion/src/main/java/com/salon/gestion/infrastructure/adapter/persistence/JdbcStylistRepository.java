package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.Stylist;
import com.salon.gestion.domain.model.StylistSchedule;
import com.salon.gestion.domain.repository.StylistRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Time;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Repository
@RequiredArgsConstructor
public class JdbcStylistRepository implements StylistRepository {

    private static final RowMapper<StylistSchedule> SCHEDULE_MAPPER = (row, index) -> StylistSchedule.builder()
            .id(row.getString("id"))
            .stylistId(row.getString("stylist_id"))
            .stylistName(row.getString("stylist_name"))
            .dayOfWeek(row.getInt("day_of_week"))
            .startTime(row.getTime("start_time").toLocalTime())
            .endTime(row.getTime("end_time").toLocalTime())
            .isAvailable(row.getBoolean("is_available"))
            .build();

    private static final RowMapper<Stylist> STYLIST_MAPPER = (row, index) -> new Stylist(
            row.getString("id"),
            row.getString("name"),
            row.getString("specialty"),
            row.getString("phone"),
            row.getBoolean("active"));

    private final JdbcClient jdbc;

    @Override
    public List<Stylist> findAll() {
        return jdbc.sql("SELECT id, name, specialty, phone, active FROM stylists ORDER BY active DESC, name")
                .query(STYLIST_MAPPER)
                .list();
    }

    @Override
    public Optional<Stylist> findById(String id) {
        return jdbc.sql("SELECT id, name, specialty, phone, active FROM stylists WHERE id = :id")
                .param("id", id)
                .query(STYLIST_MAPPER)
                .optional();
    }

    @Override
    @Transactional
    public Stylist save(Stylist stylist) {
        jdbc.sql("""
                        INSERT INTO stylists (id, name, specialty, phone, active)
                        VALUES (:id, :name, :specialty, :phone, :active)
                        ON CONFLICT (id) DO UPDATE
                        SET name = EXCLUDED.name, specialty = EXCLUDED.specialty, phone = EXCLUDED.phone,
                            active = EXCLUDED.active, updated_at = CURRENT_TIMESTAMP
                        """)
                .param("id", stylist.id())
                .param("name", stylist.name())
                .param("specialty", stylist.specialty())
                .param("phone", stylist.phone())
                .param("active", stylist.active())
                .update();
        jdbc.sql("UPDATE stylist_schedules SET stylist_name = :name WHERE stylist_id = :id")
                .param("name", stylist.name())
                .param("id", stylist.id())
                .update();
        return stylist;
    }

    @Override
    public StylistSchedule saveSchedule(StylistSchedule schedule) {
        return jdbc.sql("""
                        INSERT INTO stylist_schedules (id, stylist_id, stylist_name, day_of_week, start_time, end_time, is_available)
                        VALUES (:id, :stylist, :name, :day, :start, :end, :available)
                        ON CONFLICT (stylist_id, day_of_week) DO UPDATE
                        SET stylist_name = EXCLUDED.stylist_name, start_time = EXCLUDED.start_time,
                            end_time = EXCLUDED.end_time, is_available = EXCLUDED.is_available
                        RETURNING *
                        """)
                .param("id", schedule.getId())
                .param("stylist", schedule.getStylistId())
                .param("name", schedule.getStylistName())
                .param("day", schedule.getDayOfWeek())
                .param("start", Time.valueOf(schedule.getStartTime()))
                .param("end", Time.valueOf(schedule.getEndTime()))
                .param("available", schedule.getIsAvailable())
                .query(SCHEDULE_MAPPER)
                .single();
    }

    @Override
    public Map<String, List<StylistSchedule>> findSchedulesOf(Collection<String> stylistIds) {
        return jdbc.sql("SELECT * FROM stylist_schedules WHERE stylist_id IN (:ids) ORDER BY day_of_week")
                .param("ids", stylistIds)
                .query(SCHEDULE_MAPPER)
                .list()
                .stream()
                .collect(Collectors.groupingBy(StylistSchedule::getStylistId));
    }

    @Override
    public Map<String, String> findNamesOf(Collection<String> stylistIds) {
        return jdbc.sql("SELECT id, name FROM stylists WHERE id IN (:ids)")
                .param("ids", stylistIds)
                .query((row, index) -> Map.entry(row.getString("id"), row.getString("name")))
                .list()
                .stream()
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }
}
