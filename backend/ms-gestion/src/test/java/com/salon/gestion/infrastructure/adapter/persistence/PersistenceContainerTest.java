package com.salon.gestion.infrastructure.adapter.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.salon.gestion.domain.model.InventoryItem;
import com.salon.gestion.domain.model.PanelAppointment;
import com.salon.gestion.domain.repository.InventoryRepository;
import com.salon.gestion.domain.repository.PanelReadModel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Persistencia sobre un PostgreSQL real en un contenedor propio, con las migraciones reales.
 * Comprueba lo que un doble en memoria no puede: restricciones, sentencias atómicas y el Read Model.
 */
@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({PostgresInventoryRepositoryAdapter.class, JdbcPanelReadModel.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class PersistenceContainerTest {

    private static final Path MIGRATIONS = Path.of("../../docker/postgres/migrations");
    private static final List<String> GESTION = List.of(
            "01_gestion_schema.sql", "03_catalogo_y_saga.sql", "05_reembolsos_gestion.sql", "06_estilistas_resenas_panel.sql");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
    }

    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private InventoryRepository inventory;
    @Autowired
    private PanelReadModel panel;

    @BeforeAll
    static void migrar() throws Exception {
        try (var connection = POSTGRES.createConnection(""); var statement = connection.createStatement()) {
            for (String script : GESTION) {
                statement.execute(Files.readString(MIGRATIONS.resolve(script)));
            }
        }
    }

    private String nuevoInsumo(int stock) {
        String id = UUID.randomUUID().toString();
        jdbc.sql("""
                        INSERT INTO inventory_items (id, code, name, category, current_stock, minimum_stock, unit_price, created_at, updated_at)
                        VALUES (:id, :code, 'Insumo de prueba', 'PRUEBA', :stock, 2, 10, NOW(), NOW())
                        """)
                .param("id", id).param("code", id).param("stock", stock).update();
        return id;
    }

    private void cita(String id, String estilista, String fecha, int minutos, String estado) {
        jdbc.sql("""
                        INSERT INTO appointments (id, client_id, stylist_id, service_name, appointment_date, duration_minutes,
                                                  total_price, status, created_at, updated_at)
                        VALUES (:id, 'cli-tc', :stylist, 'Corte', :date::timestamp, :minutes, 45, :status, NOW(), NOW())
                        """)
                .param("id", id).param("stylist", estilista).param("date", fecha).param("minutes", minutos).param("status", estado)
                .update();
    }

    private String estilista() {
        return jdbc.sql("SELECT id FROM stylists ORDER BY id LIMIT 1").query(String.class).single();
    }

    @Test
    void lasMigracionesSonIdempotentes() throws Exception {
        try (var connection = POSTGRES.createConnection(""); var statement = connection.createStatement()) {
            for (String script : GESTION) {
                statement.execute(Files.readString(MIGRATIONS.resolve(script)));
            }
        }
        assertThat(jdbc.sql("SELECT count(*) FROM panel_appointments_view").query(Long.class).single()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void diezMovimientosSimultaneosNoSePierden() throws Exception {
        String id = nuevoInsumo(100);
        try (ExecutorService pool = Executors.newFixedThreadPool(10)) {
            List<Callable<Object>> tareas = IntStream.range(0, 10)
                    .mapToObj(n -> (Callable<Object>) () -> inventory.adjustStock(id, -3, "prueba concurrente"))
                    .toList();
            pool.invokeAll(tareas);
        }
        InventoryItem item = inventory.findById(id).orElseThrow();
        assertThat(item.getCurrentStock()).isEqualTo(70);
        assertThat(jdbc.sql("SELECT count(*) FROM inventory_logs WHERE item_id = :id").param("id", id).query(Long.class).single()).isEqualTo(10);
    }

    @Test
    void elStockNoPuedeQuedarNegativo() {
        String id = nuevoInsumo(2);
        assertThat(inventory.adjustStock(id, -3, "excede")).isEmpty();
        assertThat(inventory.findById(id).orElseThrow().getCurrentStock()).isEqualTo(2);
        assertThat(jdbc.sql("SELECT count(*) FROM inventory_logs WHERE item_id = :id").param("id", id).query(Long.class).single()).isZero();
    }

    @Test
    void elStockNoBajaDeLoReservadoPorUnaSaga() {
        String id = nuevoInsumo(5);
        jdbc.sql("UPDATE inventory_items SET reserved_stock = 4 WHERE id = :id").param("id", id).update();
        assertThat(inventory.adjustStock(id, -2, "pisaría una reserva")).isEmpty();
        assertThat(inventory.adjustStock(id, -1, "permitido")).isPresent();
    }

    @Test
    void laBaseImpideCitasSolapadasDelMismoEstilista() {
        String estilista = estilista();
        cita("tc-a", estilista, "2050-01-03T10:00:00", 60, "CONFIRMED");
        assertThatThrownBy(() -> cita("tc-b", estilista, "2050-01-03T10:30:00", 60, "CONFIRMED")).isInstanceOf(DataAccessException.class);
        cita("tc-c", estilista, "2050-01-03T11:00:00", 60, "CONFIRMED");
    }

    @Test
    void unaCitaCanceladaLiberaElTurno() {
        String estilista = estilista();
        cita("tc-d", estilista, "2050-01-04T10:00:00", 60, "CANCELLED");
        cita("tc-e", estilista, "2050-01-04T10:00:00", 60, "CONFIRMED");
    }

    @Test
    void elReadModelEntregaLaAgendaConElNombreDelEstilista() {
        String estilista = estilista();
        String nombre = jdbc.sql("SELECT name FROM stylists WHERE id = :id").param("id", estilista).query(String.class).single();
        cita("tc-f", estilista, "2050-02-01T09:00:00", 45, "CONFIRMED");

        List<PanelAppointment> agenda = panel.agenda(LocalDate.of(2050, 2, 1), LocalDate.of(2050, 2, 1));

        assertThat(agenda).hasSize(1);
        assertThat(agenda.get(0).stylistName()).isEqualTo(nombre);
        assertThat(agenda.get(0).durationMinutes()).isEqualTo(45);
        assertThat(panel.summary(LocalDate.of(2050, 2, 1), LocalDate.of(2050, 2, 1)).totalAppointments()).isEqualTo(1);
    }
}
