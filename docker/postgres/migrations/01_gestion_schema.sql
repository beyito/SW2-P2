-- ====================================================================
-- DDL para ms-gestion (Base de Datos: salon_gestion)
-- Arquitectura DDD - Citas, Horarios de Estilistas e Insumos
-- ====================================================================

-- 1. Tabla de Horarios y Disponibilidad de Estilistas (CU-05)
CREATE TABLE IF NOT EXISTS stylist_schedules (
    id VARCHAR(36) PRIMARY KEY,
    stylist_id VARCHAR(36) NOT NULL,
    stylist_name VARCHAR(100) NOT NULL,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1 = Lunes, 7 = Domingo
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_schedule_time CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_stylist_schedules_stylist_day 
    ON stylist_schedules (stylist_id, day_of_week);

-- 2. Tabla de Citas de Servicio (CU-06, CU-07, RF-02)
CREATE TABLE IF NOT EXISTS appointments (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    stylist_id VARCHAR(36) NOT NULL,
    service_name VARCHAR(100) NOT NULL,
    appointment_date TIMESTAMP NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    total_price NUMERIC(10, 2) NOT NULL CHECK (total_price >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED' 
        CHECK (status IN ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED')),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_stylist_date 
    ON appointments (stylist_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_client 
    ON appointments (client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status 
    ON appointments (status);

-- 3. Tabla de Insumos Cosméticos (CU-08, CU-09, RF-03)
CREATE TABLE IF NOT EXISTS inventory_items (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    current_stock INT NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    minimum_stock INT NOT NULL DEFAULT 5 CHECK (minimum_stock >= 0),
    unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
    is_critical_stock BOOLEAN GENERATED ALWAYS AS (current_stock <= minimum_stock) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_critical 
    ON inventory_items (is_critical_stock);
CREATE INDEX IF NOT EXISTS idx_inventory_category 
    ON inventory_items (category);

-- 4. Tabla de Auditoría / Movimientos de Inventario (RF-03)
CREATE TABLE IF NOT EXISTS inventory_logs (
    id VARCHAR(36) PRIMARY KEY,
    item_id VARCHAR(36) NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    quantity_change INT NOT NULL,
    previous_stock INT NOT NULL,
    new_stock INT NOT NULL,
    reason VARCHAR(255) NOT NULL,
    appointment_id VARCHAR(36),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_logs_item 
    ON inventory_logs (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_appointment 
    ON inventory_logs (appointment_id);

-- Datos Semilla Iniciales para Validación
INSERT INTO stylist_schedules (id, stylist_id, stylist_name, day_of_week, start_time, end_time, is_available)
VALUES 
    ('sch-001', 'sty-101', 'Valentina Rossi (Master Stylist)', 1, '09:00:00', '18:00:00', true),
    ('sch-002', 'sty-101', 'Valentina Rossi (Master Stylist)', 2, '09:00:00', '18:00:00', true),
    ('sch-003', 'sty-102', 'Carlos Mendoza (Colorista Experto)', 1, '10:00:00', '19:00:00', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_items (id, code, name, category, current_stock, minimum_stock, unit_price)
VALUES 
    ('inv-001', 'TINT-RUBIO-8.1', 'Tinte Rubio Cenizo 8.1 60ml', 'COLORACION', 12, 5, 14.50),
    ('inv-002', 'KERAT-BIO-1L', 'Tratamiento Keratina Hidronutritiva 1000ml', 'TRATAMIENTOS', 3, 4, 65.00), -- Alerta crítica
    ('inv-003', 'OXID-20VOL-1L', 'Oxidante en Crema 20 Volúmenes 1L', 'DECOLORACION', 8, 3, 9.80)
ON CONFLICT (id) DO NOTHING;
