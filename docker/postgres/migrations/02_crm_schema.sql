-- ====================================================================
-- DDL para ms-crm (Base de Datos: salon_crm)
-- Clean Architecture - Clientes, Fidelización y Facturación
-- ====================================================================

-- 1. Tabla de Clientes CRM (CU-03)
CREATE TABLE IF NOT EXISTS crm_clients (
    id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(30) NOT NULL,
    loyalty_points INT NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_clients_email 
    ON crm_clients (email);
CREATE INDEX IF NOT EXISTS idx_crm_clients_phone 
    ON crm_clients (phone);

-- 2. Tabla de Transacciones de Puntos de Fidelidad (CU-12, RF-08)
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
    points INT NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('ACCUMULATION', 'REDEMPTION')),
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_client 
    ON loyalty_transactions (client_id);

-- 3. Tabla de Facturación Electrónica (CU-11, RF-08)
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(36) PRIMARY KEY,
    appointment_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) NOT NULL REFERENCES crm_clients(id),
    client_name VARCHAR(150) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    tax_amount NUMERIC(10, 2) NOT NULL CHECK (tax_amount >= 0),
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'CANCELLED', 'PAID')),
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_appointment 
    ON invoices (appointment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client 
    ON invoices (client_id);

-- Datos Semilla Iniciales
INSERT INTO crm_clients (id, full_name, email, phone, loyalty_points)
VALUES 
    ('cli-001', 'Camila Fernandez', 'camila.f@example.com', '+591-70012345', 150),
    ('cli-002', 'Alejandro Morales', 'alejandro.m@example.com', '+591-71198765', 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO loyalty_transactions (id, client_id, points, type, description)
VALUES 
    ('loy-001', 'cli-001', 100, 'ACCUMULATION', 'Puntos de bienvenida por registro'),
    ('loy-002', 'cli-001', 50, 'ACCUMULATION', 'Puntos por servicio Balayage')
ON CONFLICT (id) DO NOTHING;
