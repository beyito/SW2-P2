package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.model.ServiceSupply;
import com.salon.gestion.domain.model.Stylist;
import com.salon.gestion.domain.repository.ServiceCatalogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class JdbcServiceCatalogRepository implements ServiceCatalogRepository {

    private static final String SELECT_SERVICE =
            "SELECT id, name, description, duration_minutes, price::float8 AS price FROM services WHERE active";

    private final JdbcClient jdbc;

    @Override
    public List<SalonService> findActiveServices() {
        return jdbc.sql(SELECT_SERVICE + " ORDER BY name").query(SalonService.class).list();
    }

    @Override
    public Optional<SalonService> findActiveById(String id) {
        return jdbc.sql(SELECT_SERVICE + " AND id = :id").param("id", id).query(SalonService.class).optional();
    }

    @Override
    public List<ServiceSupply> findSupplies(String serviceId) {
        // El orden fijo evita interbloqueos entre reservas simultáneas
        return jdbc.sql("SELECT item_id, quantity FROM service_supplies WHERE service_id = :id ORDER BY item_id")
                .param("id", serviceId)
                .query(ServiceSupply.class)
                .list();
    }

    @Override
    public List<Stylist> findStylists() {
        // Solo quienes pueden recibir reservas: activos y con al menos un bloque disponible
        return jdbc.sql("""
                        SELECT s.id, s.name, s.specialty, s.phone, s.active
                        FROM stylists s
                        WHERE s.active AND EXISTS (
                            SELECT 1 FROM stylist_schedules block
                            WHERE block.stylist_id = s.id AND block.is_available
                        )
                        ORDER BY s.name
                        """)
                .query(Stylist.class)
                .list();
    }
}
