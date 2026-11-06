-- ====================================================================
-- DDL para ms-gestion: devolver insumos al cancelar una cita pagada
-- Script idempotente: se puede ejecutar en cada arranque.
-- ====================================================================

ALTER TABLE inventory_reservations DROP CONSTRAINT IF EXISTS inventory_reservations_status_check;
ALTER TABLE inventory_reservations ADD CONSTRAINT inventory_reservations_status_check
    CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED', 'RESTOCKED'));
