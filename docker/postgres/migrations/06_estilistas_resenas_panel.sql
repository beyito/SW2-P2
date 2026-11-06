-- ====================================================================
-- DDL para ms-gestion: estilistas, reseñas y Read Model del panel
-- Script idempotente: se puede ejecutar en cada arranque.
-- ====================================================================

-- 1. Estilistas como entidad propia (CU-04); antes solo existían dentro de sus horarios
CREATE TABLE IF NOT EXISTS stylists (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL CHECK (btrim(name) <> ''),
    specialty VARCHAR(100),
    phone VARCHAR(30),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stylists (id, name, specialty)
SELECT DISTINCT ON (stylist_id)
    stylist_id,
    btrim(regexp_replace(stylist_name, '\s*\(.*\)\s*$', '')),
    substring(stylist_name FROM '\((.*)\)')
FROM stylist_schedules
ORDER BY stylist_id, id
ON CONFLICT (id) DO NOTHING;

-- 2. Un bloque de horario por estilista y día de la semana (CU-05)
CREATE UNIQUE INDEX IF NOT EXISTS uq_stylist_schedule_day ON stylist_schedules (stylist_id, day_of_week);

-- 3. Reseñas: solo una por cita atendida
CREATE TABLE IF NOT EXISTS stylist_reviews (
    id VARCHAR(36) PRIMARY KEY,
    appointment_id VARCHAR(36) NOT NULL UNIQUE REFERENCES appointments(id),
    stylist_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stylist_reviews_stylist ON stylist_reviews (stylist_id, created_at DESC);

-- 4. Read Model del panel (RNF-01): la agenda se lee sin armar uniones en cada resolver
CREATE OR REPLACE VIEW panel_appointments_view AS
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
    a.saga_id
FROM appointments a
LEFT JOIN stylists st ON st.id = a.stylist_id;

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments (appointment_date);
