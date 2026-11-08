-- ====================================================================
-- DDL para ms-gestion: catálogo de servicios, receta de insumos y SAGA
-- Script idempotente: se puede ejecutar en cada arranque.
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Catálogo: el precio y la duración los define el servidor, no el cliente
CREATE TABLE IF NOT EXISTS services (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 2. Receta: insumos que consume cada servicio (RF-03)
CREATE TABLE IF NOT EXISTS service_supplies (
    service_id VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    item_id VARCHAR(36) NOT NULL REFERENCES inventory_items(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (service_id, item_id)
);

-- 3. Stock reservado: comprometido por una SAGA en curso, aún sin descontar
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reserved_stock INT NOT NULL DEFAULT 0;
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS chk_reserved_stock;
ALTER TABLE inventory_items ADD CONSTRAINT chk_reserved_stock
    CHECK (reserved_stock >= 0 AND reserved_stock <= current_stock);

-- 4. Reservas de insumos por SAGA: hacen idempotentes los comandos repetidos
CREATE TABLE IF NOT EXISTS inventory_reservations (
    saga_id VARCHAR(36) NOT NULL,
    item_id VARCHAR(36) NOT NULL REFERENCES inventory_items(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (saga_id, item_id)
);

-- 5. Citas vinculadas al catálogo y a la SAGA
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id VARCHAR(36) REFERENCES services(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS saga_id VARCHAR(36);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_saga ON appointments (saga_id) WHERE saga_id IS NOT NULL;

-- Este script se ejecuta en cada arranque: la lista incluye NO_SHOW (Fase M, 09_recepcion.sql)
-- para no rechazar las citas con ausencia que ya existan
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('PENDING_PAYMENT', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'));

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_end TIMESTAMP
    GENERATED ALWAYS AS (appointment_date + make_interval(mins => duration_minutes)) STORED;

-- 6. Doble reserva imposible: la base de datos rechaza turnos solapados del mismo
--    estilista, incluso si dos solicitudes llegan exactamente al mismo tiempo (RF-02).
--    Una cita cancelada o con ausencia (NO_SHOW, Fase M) libera el turno.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
    EXCLUDE USING gist (stylist_id WITH =, tsrange(appointment_date, appointment_end) WITH &&)
    WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));

-- Datos semilla
INSERT INTO services (id, name, description, duration_minutes, price)
VALUES
    ('srv-01', 'Balayage Deluxe & Matizado', 'Aclarado a mano alzada con tonalizado y nutrición.', 150, 120.00),
    ('srv-02', 'Tratamiento Keratina Brasileña', 'Alisado termoactivo y sellado de cutícula sin formol.', 120, 95.00),
    ('srv-03', 'Corte Visagista & Styling', 'Corte adaptado a la forma del rostro.', 60, 45.00)
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_supplies (service_id, item_id, quantity)
VALUES
    ('srv-01', 'inv-001', 2),
    ('srv-01', 'inv-003', 1),
    ('srv-02', 'inv-002', 1)
ON CONFLICT (service_id, item_id) DO NOTHING;

-- Horarios de lunes a sábado para los tres estilistas
INSERT INTO stylist_schedules (id, stylist_id, stylist_name, day_of_week, start_time, end_time, is_available)
SELECT 'sch-' || stylist.id || '-' || day, stylist.id, stylist.name, day, stylist.start_time, stylist.end_time, TRUE
FROM (VALUES
        ('sty-101', 'Valentina Rossi (Master Stylist)', TIME '09:00', TIME '18:00'),
        ('sty-102', 'Carlos Mendoza (Colorista Experto)', TIME '10:00', TIME '19:00'),
        ('sty-103', 'Sofía Morales (Tratamientos)', TIME '09:00', TIME '17:00')
     ) AS stylist(id, name, start_time, end_time)
CROSS JOIN generate_series(1, 6) AS day
WHERE NOT EXISTS (
    SELECT 1 FROM stylist_schedules existing
    WHERE existing.stylist_id = stylist.id AND existing.day_of_week = day
);
