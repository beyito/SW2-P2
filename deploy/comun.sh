#!/usr/bin/env bash
# Funciones y direcciones compartidas por los guiones de las tres nubes.
# Se carga con: source "$(dirname "$0")/../comun.sh"
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$DEPLOY_DIR/.." && pwd)"
# La simulación (deploy/simulacion/correr.sh) usa otra configuración y otra carpeta de salida
CONFIGURACION="${DEPLOY_CONFIGURACION:-$DEPLOY_DIR/configuracion.env}"
SALIDA="${DEPLOY_SALIDA:-$DEPLOY_DIR/salida}"
mkdir -p "$SALIDA"

if [ ! -f "$CONFIGURACION" ]; then
  echo "Falta deploy/configuracion.env: copie configuracion.example.env y complételo." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$CONFIGURACION"
# Lo que generan los guiones de cada nube (direcciones y credenciales de DynamoDB)
for generado in "$SALIDA"/*.env; do
  [ -f "$generado" ] && source "$generado"
done
set +a

paso() { printf '\n==> %s\n' "$*"; }

# Detiene el guion si falta alguna variable
requerir() {
  for nombre in "$@"; do
    if [ -z "${!nombre:-}" ]; then
      echo "Falta $nombre en deploy/configuracion.env o en deploy/salida." >&2
      exit 1
    fi
  done
}

# Guarda NOMBRE=valor en un archivo de deploy/salida, reemplazando el valor anterior
guardar() {
  archivo="$SALIDA/$1.env"; nombre=$2; valor=$3
  touch "$archivo"
  grep -v "^$nombre=" "$archivo" > "$archivo.tmp" || true
  printf '%s=%q\n' "$nombre" "$valor" >> "$archivo.tmp"
  mv "$archivo.tmp" "$archivo"
  export "$nombre=$valor"
}

# Dirección IP pública de quien despliega: solo ella entra a las bases para migrarlas
ip_publica() { curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]'; }

# --- Direcciones públicas que se conocen de antemano ---
requerir DOMINIO PREFIJO
KEYCLOAK_URL="https://auth.$DOMINIO"
KEYCLOAK_ISSUER="$KEYCLOAK_URL/realms/salon"
KEYCLOAK_JWKS_URI="$KEYCLOAK_ISSUER/protocol/openid-connect/certs"
GESTION_URL="https://gestion.$DOMINIO"
MCP_URL="https://mcp.$DOMINIO"
# Firebase Hosting: un sitio por microfrontend, con dirección fija <sitio>.web.app
SITIO_APP="$PREFIJO-app"
SITIO_ESTUDIO="$PREFIJO-estudio"
SITIO_RESERVAS="$PREFIJO-reservas"
SITIO_ERP="$PREFIJO-erp"
PORTAL_URL="https://$SITIO_APP.web.app"
ALLOWED_ORIGINS="$PORTAL_URL,https://$SITIO_ESTUDIO.web.app,https://$SITIO_RESERVAS.web.app,https://$SITIO_ERP.web.app"
DYNAMODB_ENDPOINT="https://dynamodb.${AWS_REGION:-us-east-1}.amazonaws.com"
RABBITMQ_AMQPS_URL="amqps://${RABBITMQ_USUARIO:-}:${RABBITMQ_CLAVE:-}@${RABBITMQ_HOST:-}/${RABBITMQ_VHOST:-}"
