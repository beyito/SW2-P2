#!/usr/bin/env bash
# ====================================================================
# Historial de operación en la nube (Fase Y): citas, facturas, puntos, reseñas y movimientos de
# inventario en RDS (salon_gestion) y Azure PostgreSQL (salon_crm), y prendas de demostración en
# el clóset de las clientas (por la API real: las fotos quedan en S3).
#
#   bash deploy/historial.sh cargar      carga el historial y las prendas (se niega si ya está cargado)
#   bash deploy/historial.sh verificar   muestra qué hay cargado
#   bash deploy/historial.sh limpiar     borra todo lo del historial (prefijo hist-) y las prendas de demostración
#
# No pasa por la SAGA: no cobra con Stripe ni envía WhatsApp ni push. El stock actual no cambia.
# Las bases solo aceptan la IP de quien despliega (guiones de AWS y Azure).
# ====================================================================
source "$(dirname "$0")/comun.sh"
requerir RDS_HOST RDS_USUARIO RDS_CLAVE AZURE_PG_HOST AZURE_PG_USUARIO AZURE_PG_CLAVE ASESORIA_URL
CUENTAS="$SALIDA/cuentas-demo.env"
[ -f "$CUENTAS" ] && source "$CUENTAS"
PORTAL="https://${PREFIJO}-app.web.app"
HISTORIAL="$RAIZ/docker/historial"

psql_en() {  # psql_en <gestion|crm> <archivo.sql>
  local host usuario clave base
  if [ "$1" = gestion ]; then host=$RDS_HOST usuario=$RDS_USUARIO clave=$RDS_CLAVE base=salon_gestion
  else host=$AZURE_PG_HOST usuario=$AZURE_PG_USUARIO clave=$AZURE_PG_CLAVE base=salon_crm; fi
  docker run --rm -i -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=15 -e PGPASSWORD="$clave" \
    postgres:16-alpine psql -q -h "$host" -U "$usuario" -d "$base" < "$2"
}

prendas() {  # prendas [--borrar]: el clóset de Camila, la clienta de demostración
  requerir CLAVE_CAMILA_FERNANDEZ
  CLAVE="$CLAVE_CAMILA_FERNANDEZ" node "$HISTORIAL/cargar_prendas.mjs" "$PORTAL" "$ASESORIA_URL" camila.fernandez "$@"
}

case "${1:-}" in
  cargar)
    paso "Historial de ms-gestion en RDS"
    psql_en gestion "$HISTORIAL/historial_gestion.sql"
    paso "Historial de ms-crm en Azure PostgreSQL"
    psql_en crm "$HISTORIAL/historial_crm.sql"
    paso "Prendas de demostración en el clóset (fotos en S3)"
    prendas
    ;;
  limpiar)
    paso "Borrando el historial de RDS y Azure PostgreSQL"
    psql_en gestion "$HISTORIAL/limpiar_gestion.sql"
    psql_en crm "$HISTORIAL/limpiar_crm.sql"
    paso "Borrando las prendas de demostración"
    prendas --borrar
    ;;
  verificar)
    psql_en gestion "$HISTORIAL/verificar_gestion.sql"
    psql_en crm "$HISTORIAL/verificar_crm.sql"
    ;;
  *)
    echo "Uso: bash deploy/historial.sh cargar|verificar|limpiar" >&2
    exit 2
    ;;
esac
