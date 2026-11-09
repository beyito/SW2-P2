-- Usuario de solo lectura para los reportes dinámicos del Servidor MCP (CU-18, RF-11, RNF-02).
-- Solo puede leer las tablas del catálogo de reportes; nunca escribir.
-- Se ejecuta con: psql -v clave=... (migrate.sh lo hace si existe REPORTES_PGPASSWORD).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_reportes') THEN
        CREATE ROLE salon_reportes LOGIN;
    END IF;
END
$$;

ALTER ROLE salon_reportes WITH LOGIN PASSWORD :'clave';
-- Aunque alguien obtuviera la clave, sus transacciones no pueden escribir
ALTER ROLE salon_reportes SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE salon_gestion TO salon_reportes;
GRANT USAGE ON SCHEMA public TO salon_reportes;
GRANT SELECT ON appointments, stylists, inventory_items, inventory_logs TO salon_reportes;
