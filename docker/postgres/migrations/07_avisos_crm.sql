-- ====================================================================
-- DDL para ms-crm: avisos dentro de la aplicación
-- Script idempotente: se puede ejecutar en cada arranque.
-- ====================================================================

-- recipient es el ID del usuario o, para avisos de un rol, 'role:ADMIN'.
-- source_ref impide crear dos veces el aviso de un mismo evento.
CREATE TABLE IF NOT EXISTS notices (
    id VARCHAR(36) PRIMARY KEY,
    recipient VARCHAR(60) NOT NULL,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(120) NOT NULL,
    message VARCHAR(500) NOT NULL,
    source_ref VARCHAR(120) UNIQUE,
    read_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notices_recipient ON notices (recipient, created_at DESC);
