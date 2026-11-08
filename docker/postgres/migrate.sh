#!/bin/sh
# Aplica de forma idempotente las bases de datos y migraciones en cada arranque.
# Funciona tanto con un volumen nuevo como con uno ya existente.
set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL="psql -v ON_ERROR_STOP=1 -q -h postgres -U $POSTGRES_USER"

for db in salon_gestion salon_crm salon_keycloak; do
  echo "SELECT 'CREATE DATABASE $db' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$db')\gexec" \
    | $PSQL -d "$POSTGRES_DB"
done

$PSQL -d salon_gestion -f /migrations/01_gestion_schema.sql
$PSQL -d salon_crm -f /migrations/02_crm_schema.sql
$PSQL -d salon_gestion -f /migrations/03_catalogo_y_saga.sql
$PSQL -d salon_crm -f /migrations/04_crm_facturacion.sql
$PSQL -d salon_gestion -f /migrations/05_reembolsos_gestion.sql
$PSQL -d salon_gestion -f /migrations/06_estilistas_resenas_panel.sql
$PSQL -d salon_crm -f /migrations/07_avisos_crm.sql
$PSQL -d salon_crm -f /migrations/08_perfil_de_estilo.sql
$PSQL -d salon_gestion -f /migrations/09_recepcion.sql

echo "Migraciones de PostgreSQL aplicadas correctamente."
