package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.Review;
import com.salon.gestion.domain.model.StylistRating;
import com.salon.gestion.domain.repository.ReviewRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Repository
@RequiredArgsConstructor
public class JdbcReviewRepository implements ReviewRepository {

    private final JdbcClient jdbc;

    @Override
    public boolean saveIfAbsent(Review review) {
        return jdbc.sql("""
                        INSERT INTO stylist_reviews (id, appointment_id, stylist_id, client_id, rating, comment)
                        VALUES (:id, :appointment, :stylist, :client, :rating, :comment)
                        ON CONFLICT (appointment_id) DO NOTHING
                        """)
                .param("id", review.id())
                .param("appointment", review.appointmentId())
                .param("stylist", review.stylistId())
                .param("client", review.clientId())
                .param("rating", review.rating())
                .param("comment", review.comment())
                .update() > 0;
    }

    @Override
    public List<Review> findByStylist(String stylistId) {
        return jdbc.sql("""
                        SELECT id, appointment_id, stylist_id, client_id, rating, comment, created_at::text AS created_at
                        FROM stylist_reviews
                        WHERE stylist_id = :stylist
                        ORDER BY stylist_reviews.created_at DESC
                        """)
                .param("stylist", stylistId)
                .query((row, index) -> new Review(
                        row.getString("id"),
                        row.getString("appointment_id"),
                        row.getString("stylist_id"),
                        row.getString("client_id"),
                        row.getInt("rating"),
                        row.getString("comment"),
                        row.getString("created_at")))
                .list();
    }

    @Override
    public Map<String, StylistRating> ratingsOf(Collection<String> stylistIds) {
        return jdbc.sql("""
                        SELECT stylist_id, ROUND(AVG(rating), 2)::float8 AS average, COUNT(*)::int AS total
                        FROM stylist_reviews
                        WHERE stylist_id IN (:ids)
                        GROUP BY stylist_id
                        """)
                .param("ids", stylistIds)
                .query((row, index) -> Map.entry(
                        row.getString("stylist_id"), new StylistRating(row.getDouble("average"), row.getInt("total"))))
                .list()
                .stream()
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    @Override
    public Set<String> reviewedAmong(Collection<String> appointmentIds) {
        return new HashSet<>(jdbc.sql("SELECT appointment_id FROM stylist_reviews WHERE appointment_id IN (:ids)")
                .param("ids", appointmentIds)
                .query(String.class)
                .list());
    }
}
