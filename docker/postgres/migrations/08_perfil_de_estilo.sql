-- ====================================================================
-- DDL para ms-crm: perfil de estilo del cliente, para orientar las recomendaciones
-- Script idempotente: se puede ejecutar en cada arranque.
-- ====================================================================

ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS gender VARCHAR(20)
    CHECK (gender IN ('FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED'));
-- Se guarda un rango y no la fecha de nacimiento: no se necesita más precisión
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS age_range VARCHAR(10)
    CHECK (age_range IN ('UNDER_18', '18_29', '30_44', '45_59', '60_PLUS'));
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS preferred_length VARCHAR(10)
    CHECK (preferred_length IN ('SHORT', 'MEDIUM', 'LONG'));
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS maintenance VARCHAR(10)
    CHECK (maintenance IN ('LOW', 'MEDIUM', 'HIGH'));
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS style_vibe VARCHAR(15)
    CHECK (style_vibe IN ('NATURAL', 'PROFESSIONAL', 'TRENDY', 'BOLD'));
-- Fecha en que respondió u omitió el cuestionario inicial: no se le vuelve a preguntar
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMP;
-- Autorización expresa para recibir mensajes por WhatsApp (RF-12); sin ella solo hay avisos en la aplicación
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
