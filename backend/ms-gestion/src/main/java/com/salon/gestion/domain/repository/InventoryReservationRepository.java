package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.ServiceSupply;

import java.util.List;

/**
 * Puerto de Dominio (DDD): reservas de insumos asociadas a una SAGA (RF-03).
 * Todas las operaciones son atómicas e idempotentes por SAGA.
 */
public interface InventoryReservationRepository {

    /** Indica si la SAGA ya tiene reservas registradas, en cualquier estado. */
    boolean existsForSaga(String sagaId);

    /**
     * Aparta el insumo solo si queda stock disponible.
     *
     * @return {@code false} si no alcanza el stock
     */
    boolean reserve(String sagaId, ServiceSupply supply);

    /** Devuelve al stock disponible lo que siga reservado. */
    void release(String sagaId);

    /**
     * Descuenta definitivamente lo reservado y registra el movimiento en inventory_logs.
     *
     * @return códigos de los insumos que quedaron en nivel crítico
     */
    List<String> commit(String sagaId, String appointmentId);
}
