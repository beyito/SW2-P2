-- Usuario de solo lectura para los reportes dinámicos del Servidor MCP (CU-18, RF-11, RNF-02).
-- En la nube el CRM vive en otro servidor (Azure), así que el usuario se crea también aquí.
-- Se ejecuta con: psql -v clave=... (migrate.sh lo hace si existe REPORTES_PGPASSWORD).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_reportes') THEN
        CREATE ROLE salon_reportes LOGIN;
    END IF;
END
$$;

ALTER ROLE salon_reportes WITH LOGIN PASSWORD :'clave';
ALTER ROLE salon_reportes SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE salon_crm TO salon_reportes;
GRANT USAGE ON SCHEMA public TO salon_reportes;
GRANT SELECT ON invoices, loyalty_transactions, crm_clients TO salon_reportes;
