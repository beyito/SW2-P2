#!/usr/bin/env bash
# ====================================================================
# Crea las bases y aplica las migraciones en la nube desde la PC de quien despliega, con Docker:
#   - PostgreSQL de AWS (RDS):    salon_gestion y salon_keycloak
#   - PostgreSQL de Azure:        salon_crm y n8n
#   - MongoDB Atlas:              colecciones e índices de salon_asesoria
# Es idempotente, como en local. Ambos PostgreSQL solo aceptan la IP de quien despliega,
# que los guiones de AWS y Azure ya agregaron. Atlas debe permitir esa IP en "Network Access".
#
#   bash deploy/base-de-datos.sh
# ====================================================================
source "$(dirname "$0")/comun.sh"
requerir RDS_HOST RDS_USUARIO RDS_CLAVE AZURE_PG_HOST AZURE_PG_USUARIO AZURE_PG_CLAVE MONGO_URI

paso "Migraciones de PostgreSQL (RDS y Azure)"
docker run --rm \
  -e PGSSLMODE=require -e POSTGRES_DB=postgres \
  -e GESTION_PGHOST="$RDS_HOST" -e GESTION_PGUSER="$RDS_USUARIO" -e GESTION_PGPASSWORD="$RDS_CLAVE" \
  -e CRM_PGHOST="$AZURE_PG_HOST" -e CRM_PGUSER="$AZURE_PG_USUARIO" -e CRM_PGPASSWORD="$AZURE_PG_CLAVE" \
  -e N8N_PGDATABASE=n8n \
  -v "$RAIZ/docker/postgres/migrate.sh:/migrate.sh:ro" -v "$RAIZ/docker/postgres/migrations:/migrations:ro" \
  postgres:16-alpine sh /migrate.sh

paso "Colecciones e índices en MongoDB Atlas"
docker run --rm -v "$RAIZ/docker/mongodb/init-collections.js:/init/init-collections.js:ro" \
  mongo:7.0 mongosh "$MONGO_URI" --quiet --file /init/init-collections.js

echo "Bases listas. Siga con: bash deploy/aws/desplegar.sh servicios"
