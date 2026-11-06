package com.salon.gestion.infrastructure.adapter.persistence;

import com.salon.gestion.domain.model.ServiceSupply;
import com.salon.gestion.domain.repository.InventoryReservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Adaptador de reservas de insumos: cada cambio de stock es una sentencia atómica,
 * de modo que dos SAGAs simultáneas nunca aparten más de lo disponible.
 */
@Repository
@RequiredArgsConstructor
public class JdbcInventoryReservationRepository implements InventoryReservationRepository {

    private final JdbcClient jdbc;

    @Override
    public boolean existsForSaga(String sagaId) {
        return jdbc.sql("SELECT COUNT(*) FROM inventory_reservations WHERE saga_id = :saga")
                .param("saga", sagaId)
                .query(Long.class)
                .single() > 0;
    }

    @Override
    public boolean reserve(String sagaId, ServiceSupply supply) {
        int updated = jdbc.sql("""
                        UPDATE inventory_items
                        SET reserved_stock = reserved_stock + :quantity
                        WHERE id = :item AND current_stock - reserved_stock >= :quantity
                        """)
                .param("quantity", supply.quantity())
                .param("item", supply.itemId())
                .update();
        if (updated == 0) {
            return false;
        }
        jdbc.sql("""
                        INSERT INTO inventory_reservations (saga_id, item_id, quantity, status)
                        VALUES (:saga, :item, :quantity, 'RESERVED')
                        """)
                .param("saga", sagaId)
                .param("item", supply.itemId())
                .param("quantity", supply.quantity())
                .update();
        return true;
    }

    @Override
    public void release(String sagaId) {
        for (ServiceSupply supply : reserved(sagaId)) {
            jdbc.sql("UPDATE inventory_items SET reserved_stock = reserved_stock - :quantity WHERE id = :item")
                    .param("quantity", supply.quantity())
                    .param("item", supply.itemId())
                    .update();
        }
        markReserved(sagaId, "RELEASED");
    }

    @Override
    public List<String> commit(String sagaId, String appointmentId) {
        List<String> critical = new ArrayList<>();
        for (ServiceSupply supply : reserved(sagaId)) {
            var stock = jdbc.sql("""
                            UPDATE inventory_items
                            SET current_stock = current_stock - :quantity,
                                reserved_stock = reserved_stock - :quantity,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = :item
                            RETURNING code, current_stock, minimum_stock
                            """)
                    .param("quantity", supply.quantity())
                    .param("item", supply.itemId())
                    .query((row, index) -> new StockAfterCommit(
                            row.getString("code"), row.getInt("current_stock"), row.getInt("minimum_stock")))
                    .single();

            jdbc.sql("""
                            INSERT INTO inventory_logs
                                (id, item_id, quantity_change, previous_stock, new_stock, reason, appointment_id)
                            VALUES (:id, :item, :change, :previous, :new, 'Consumo por cita confirmada', :appointment)
                            """)
                    .param("id", UUID.randomUUID().toString())
                    .param("item", supply.itemId())
                    .param("change", -supply.quantity())
                    .param("previous", stock.currentStock() + supply.quantity())
                    .param("new", stock.currentStock())
                    .param("appointment", appointmentId)
                    .update();

            if (stock.currentStock() <= stock.minimumStock()) {
                critical.add(stock.code());
            }
        }
        markReserved(sagaId, "COMMITTED");
        return critical;
    }

    @Override
    public void restock(String sagaId, String appointmentId) {
        List<ServiceSupply> committed = jdbc.sql("""
                        SELECT item_id, quantity FROM inventory_reservations
                        WHERE saga_id = :saga AND status = 'COMMITTED'
                        ORDER BY item_id
                        """)
                .param("saga", sagaId)
                .query(ServiceSupply.class)
                .list();

        for (ServiceSupply supply : committed) {
            int stock = jdbc.sql("""
                            UPDATE inventory_items
                            SET current_stock = current_stock + :quantity, updated_at = CURRENT_TIMESTAMP
                            WHERE id = :item
                            RETURNING current_stock
                            """)
                    .param("quantity", supply.quantity())
                    .param("item", supply.itemId())
                    .query(Integer.class)
                    .single();

            jdbc.sql("""
                            INSERT INTO inventory_logs
                                (id, item_id, quantity_change, previous_stock, new_stock, reason, appointment_id)
                            VALUES (:id, :item, :change, :previous, :new, 'Devolución por cita cancelada', :appointment)
                            """)
                    .param("id", UUID.randomUUID().toString())
                    .param("item", supply.itemId())
                    .param("change", supply.quantity())
                    .param("previous", stock - supply.quantity())
                    .param("new", stock)
                    .param("appointment", appointmentId)
                    .update();
        }
        jdbc.sql("UPDATE inventory_reservations SET status = 'RESTOCKED' WHERE saga_id = :saga AND status = 'COMMITTED'")
                .param("saga", sagaId)
                .update();
    }

    /** Lo que siga en estado RESERVED; vacío si el comando ya se aplicó antes. */
    private List<ServiceSupply> reserved(String sagaId) {
        return jdbc.sql("""
                        SELECT item_id, quantity FROM inventory_reservations
                        WHERE saga_id = :saga AND status = 'RESERVED'
                        ORDER BY item_id
                        """)
                .param("saga", sagaId)
                .query(ServiceSupply.class)
                .list();
    }

    private void markReserved(String sagaId, String status) {
        jdbc.sql("UPDATE inventory_reservations SET status = :status WHERE saga_id = :saga AND status = 'RESERVED'")
                .param("status", status)
                .param("saga", sagaId)
                .update();
    }

    private record StockAfterCommit(String code, int currentStock, int minimumStock) {
    }
}
