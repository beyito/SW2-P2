-- ====================================================================
-- DDL para ms-gestion: actor Recepcionista (Fase M)
-- Llegada del cliente y ausencia (no-show). Script idempotente: se ejecuta en cada arranque.
-- ====================================================================

-- 1. Hora en que la recepción registró la llegada del cliente
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMP;

-- 2. El estado NO_SHOW y la liberación de su turno se definen en 03_catalogo_y_saga.sql,
--    que se ejecuta antes en cada arranque y, si no, los revertiría

-- 3. El Read Model del panel muestra la llegada (RNF-01); la columna nueva va al final de la vista
DROP VIEW IF EXISTS panel_appointments_view;
CREATE VIEW panel_appointments_view AS
SELECT
    a.id,
    a.client_id,
    a.stylist_id,
    COALESCE(st.name, a.stylist_id) AS stylist_name,
    a.service_id,
    a.service_name,
    a.appointment_date,
    a.appointment_end,
    a.duration_minutes,
    a.total_price,
    a.status,
    a.saga_id,
    a.checked_in_at
FROM appointments a
LEFT JOIN stylists st ON st.id = a.stylist_id;
