-- Teléfonos registrados para recibir notificaciones push (Firebase Cloud Messaging).
-- Un token pertenece a una sola cuenta; is_admin indica si recibe los avisos de la administración.
CREATE TABLE IF NOT EXISTS push_devices (
    token VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(60) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices (user_id);
