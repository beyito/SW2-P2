#!/bin/sh
# Aplica de forma idempotente las bases de datos y migraciones en cada arranque.
# Funciona tanto con un volumen nuevo como con uno ya existente.
#
# En local todo vive en el servidor "postgres". En la nube hay dos servidores:
#   - Gestión y Keycloak (RDS en AWS):        GESTION_PGHOST, GESTION_PGUSER, GESTION_PGPASSWORD
#   - CRM y n8n (PostgreSQL en Azure):        CRM_PGHOST, CRM_PGUSER, CRM_PGPASSWORD
# Las que falten toman los valores locales. PGSSLMODE=require exige TLS en ambos.
set -eu

GESTION_HOST="${GESTION_PGHOST:-postgres}"
GESTION_USER="${GESTION_PGUSER:-$POSTGRES_USER}"
GESTION_PASS="${GESTION_PGPASSWORD:-$POSTGRES_PASSWORD}"
CRM_HOST="${CRM_PGHOST:-postgres}"
CRM_USER="${CRM_PGUSER:-$POSTGRES_USER}"
CRM_PASS="${CRM_PGPASSWORD:-$POSTGRES_PASSWORD}"
# Base de administración desde la que se crean las demás; existe en RDS y en Azure
ADMIN_DB="${POSTGRES_DB:-postgres}"

# Ejecuta psql contra el servidor indicado: grupo (gestion o crm), base y argumentos
run_psql() {
  group=$1; db=$2; shift 2
  if [ "$group" = gestion ]; then
    PGPASSWORD="$GESTION_PASS" psql -v ON_ERROR_STOP=1 -q -h "$GESTION_HOST" -U "$GESTION_USER" -d "$db" "$@"
  else
    PGPASSWORD="$CRM_PASS" psql -v ON_ERROR_STOP=1 -q -h "$CRM_HOST" -U "$CRM_USER" -d "$db" "$@"
  fi
}

create_db() {
  echo "SELECT 'CREATE DATABASE $2' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$2')\gexec" \
    | run_psql "$1" "$ADMIN_DB"
}

create_db gestion salon_gestion
create_db gestion salon_keycloak
create_db crm salon_crm
# n8n solo usa PostgreSQL en la nube; en local guarda sus datos en su volumen
if [ -n "${N8N_PGDATABASE:-}" ]; then
  create_db crm "$N8N_PGDATABASE"
fi

run_psql gestion salon_gestion -f /migrations/01_gestion_schema.sql
run_psql crm salon_crm -f /migrations/02_crm_schema.sql
run_psql gestion salon_gestion -f /migrations/03_catalogo_y_saga.sql
run_psql crm salon_crm -f /migrations/04_crm_facturacion.sql
run_psql gestion salon_gestion -f /migrations/05_reembolsos_gestion.sql
run_psql gestion salon_gestion -f /migrations/06_estilistas_resenas_panel.sql
run_psql crm salon_crm -f /migrations/07_avisos_crm.sql
run_psql crm salon_crm -f /migrations/08_perfil_de_estilo.sql
run_psql gestion salon_gestion -f /migrations/09_recepcion.sql

echo "Migraciones de PostgreSQL aplicadas correctamente."
