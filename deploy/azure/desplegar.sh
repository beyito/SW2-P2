#!/usr/bin/env bash
# ====================================================================
# Despliegue en Azure (región de AZURE_UBICACION; canadacentral en el despliegue real). Requiere Azure CLI con sesión iniciada (az login) y Docker.
#
#   bash deploy/azure/desplegar.sh
#
# Crea PostgreSQL Flexible, un registro de imágenes y Container Apps para ms-crm, su worker,
# el orquestador SAGA y n8n. Container Apps da HTTPS con su propia dirección, sin dominio.
# Antes debe correr "aws/desplegar.sh datos" (credenciales de DynamoDB).
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir AZURE_UBICACION AZURE_GRUPO AZURE_PG_USUARIO AZURE_PG_CLAVE RABBITMQ_HOST RABBITMQ_USUARIO \
  RABBITMQ_CLAVE RABBITMQ_VHOST STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY SALON_AGENT_SECRET \
  N8N_ENCRYPTION_KEY N8N_AUTOMATION_KEY DYNAMO_CRM_ID DYNAMO_CRM_SECRETO DYNAMO_SAGA_ID DYNAMO_SAGA_SECRETO

# Nombres globales: solo minúsculas y números en el registro
PG_SERVIDOR="$PREFIJO-pg"
REGISTRO_NOMBRE="$(echo "${PREFIJO}acr" | tr -cd 'a-z0-9')"
ENTORNO=salon-entorno

paso "Grupo de recursos y extensión de Container Apps"
az extension add --name containerapp --upgrade --only-show-errors
# Una suscripción nueva no tiene registrado ningún servicio: se registran todos los que se usan
for proveedor in Microsoft.App Microsoft.OperationalInsights Microsoft.DBforPostgreSQL Microsoft.ContainerRegistry; do
  az provider register --namespace "$proveedor" --wait
done
az group create --name "$AZURE_GRUPO" --location "$AZURE_UBICACION" --output none

paso "PostgreSQL Flexible (unos 10 minutos la primera vez)"
if ! az postgres flexible-server show -g "$AZURE_GRUPO" -n "$PG_SERVIDOR" --output none 2>/dev/null; then
  # 0.0.0.0 permite solo los servicios de Azure; quien despliega se agrega aparte
  az postgres flexible-server create -g "$AZURE_GRUPO" -n "$PG_SERVIDOR" --location "$AZURE_UBICACION" \
    --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
    --admin-user "$AZURE_PG_USUARIO" --admin-password "$AZURE_PG_CLAVE" --public-access 0.0.0.0 --yes --output none
fi
IP=$(ip_publica)
az postgres flexible-server firewall-rule create -g "$AZURE_GRUPO" --server-name "$PG_SERVIDOR" --name despliegue \
  --start-ip-address "$IP" --end-ip-address "$IP" --output none
guardar azure AZURE_PG_HOST "$PG_SERVIDOR.postgres.database.azure.com"

paso "Registro de imágenes (ACR) e imágenes"
az acr show -n "$REGISTRO_NOMBRE" --output none 2>/dev/null \
  || az acr create -g "$AZURE_GRUPO" -n "$REGISTRO_NOMBRE" --sku Basic --admin-enabled true --output none
REGISTRO="$REGISTRO_NOMBRE.azurecr.io"
az acr login -n "$REGISTRO_NOMBRE"
docker build --platform linux/amd64 --target runtime -t "$REGISTRO/salon-ms-crm:latest" "$RAIZ/backend/ms-crm"
docker build --platform linux/amd64 -t "$REGISTRO/salon-saga:latest" "$RAIZ/backend/saga-orchestrator"
docker build --platform linux/amd64 -f "$RAIZ/deploy/n8n/Dockerfile" -t "$REGISTRO/salon-n8n:latest" "$RAIZ"
for imagen in salon-ms-crm salon-saga salon-n8n; do docker push "$REGISTRO/$imagen:latest"; done
ACR_USUARIO=$(az acr credential show -n "$REGISTRO_NOMBRE" --query username -o tsv)
ACR_CLAVE=$(az acr credential show -n "$REGISTRO_NOMBRE" --query 'passwords[0].value' -o tsv)

paso "Entorno de Container Apps"
az containerapp env show -g "$AZURE_GRUPO" -n "$ENTORNO" --output none 2>/dev/null \
  || az containerapp env create -g "$AZURE_GRUPO" -n "$ENTORNO" --location "$AZURE_UBICACION" --output none
DOMINIO_AZURE=$(az containerapp env show -g "$AZURE_GRUPO" -n "$ENTORNO" --query properties.defaultDomain -o tsv)
guardar azure CRM_URL "https://salon-crm.$DOMINIO_AZURE"
guardar azure SAGA_URL "https://salon-saga.$DOMINIO_AZURE"
guardar azure N8N_URL "https://salon-n8n.$DOMINIO_AZURE"

# Crea o actualiza una aplicación con una sola réplica siempre encendida.
# Uso: aplicacion nombre imagen puerto|"" secretos(a=b ...) -- variables(A=b ...)
# COMANDO (opcional) reemplaza el comando de la imagen; sus partes van separadas por espacios.
aplicacion() {
  nombre=$1; imagen=$2; puerto=$3; shift 3
  secretos=(); variables=(); destino=secretos
  for arg in "$@"; do
    if [ "$arg" = -- ]; then destino=variables; continue; fi
    if [ $destino = secretos ]; then secretos+=("$arg"); else variables+=("$arg"); fi
  done
  # Un secreto nuevo no llega a los contenedores en marcha, y los entornos Express no permiten
  # reiniciar revisiones. Esta huella (un resumen que no revela los valores) cambia con los
  # secretos y obliga a crear una revisión nueva.
  variables+=("SECRETOS_HUELLA=$(printf '%s\n' "${secretos[@]}" | sha256sum | cut -c1-16)")
  comando=()
  if [ -n "${COMANDO:-}" ]; then
    read -r -a partes <<< "$COMANDO"
    comando=(--command "${partes[0]}" --args "${partes[@]:1}")
  fi
  if az containerapp show -g "$AZURE_GRUPO" -n "$nombre" --output none 2>/dev/null; then
    az containerapp secret set -g "$AZURE_GRUPO" -n "$nombre" --secrets "${secretos[@]}" --output none
    az containerapp update -g "$AZURE_GRUPO" -n "$nombre" --image "$imagen" "${comando[@]}" \
      --set-env-vars "${variables[@]}" --output none
  else
    entrada=(); [ -n "$puerto" ] && entrada=(--ingress external --target-port "$puerto")
    az containerapp create -g "$AZURE_GRUPO" -n "$nombre" --environment "$ENTORNO" --image "$imagen" \
      --registry-server "$REGISTRO" --registry-username "$ACR_USUARIO" --registry-password "$ACR_CLAVE" \
      "${entrada[@]}" "${comando[@]}" --min-replicas 1 --max-replicas 1 \
      --secrets "${secretos[@]}" --env-vars "${variables[@]}" --output none
  fi
}

AUTENTICACION=(KEYCLOAK_ISSUER="$KEYCLOAK_ISSUER" KEYCLOAK_JWKS_URI="$KEYCLOAK_JWKS_URI" KEYCLOAK_AUDIENCE=salon-api
  DYNAMODB_ENDPOINT="$DYNAMODB_ENDPOINT" AWS_REGION="${AWS_REGION:-us-east-1}" ALLOWED_ORIGINS="$ALLOWED_ORIGINS")
CRM=(APP_ENV=production APP_DEBUG=false APP_KEY=secretref:app-key LOG_CHANNEL=stderr CACHE_STORE=array SESSION_DRIVER=array
  QUEUE_CONNECTION=sync DB_CONNECTION=pgsql DB_HOST="$AZURE_PG_HOST" DB_PORT=5432 DB_DATABASE=salon_crm
  DB_USERNAME="$AZURE_PG_USUARIO" DB_PASSWORD=secretref:pg-clave
  RABBITMQ_HOST="$RABBITMQ_HOST" RABBITMQ_PORT=5671 RABBITMQ_SSL=true RABBITMQ_VHOST="$RABBITMQ_VHOST"
  RABBITMQ_USER="$RABBITMQ_USUARIO" RABBITMQ_PASSWORD=secretref:rabbit-clave
  AWS_ACCESS_KEY_ID="$DYNAMO_CRM_ID" AWS_SECRET_ACCESS_KEY=secretref:dynamo-secreto)
# La clave de Laravel se genera una vez y se conserva
grep -q '^CRM_APP_KEY=' "$SALIDA/azure.env" 2>/dev/null || guardar azure CRM_APP_KEY "base64:$(openssl rand -base64 32)"
SECRETOS_CRM=(app-key="$CRM_APP_KEY" pg-clave="$AZURE_PG_CLAVE" rabbit-clave="$RABBITMQ_CLAVE" dynamo-secreto="$DYNAMO_CRM_SECRETO")

paso "ms-crm"
aplicacion salon-crm "$REGISTRO/salon-ms-crm:latest" 8000 "${SECRETOS_CRM[@]}" -- "${CRM[@]}" "${AUTENTICACION[@]}"

paso "Worker del CRM (sin entrada pública)"
COMANDO="php artisan crm:consume-saga-messages" \
  aplicacion salon-crm-worker "$REGISTRO/salon-ms-crm:latest" "" "${SECRETOS_CRM[@]}" -- "${CRM[@]}" "${AUTENTICACION[@]}"

paso "Orquestador SAGA"
aplicacion salon-saga "$REGISTRO/salon-saga:latest" 4100 \
  rabbit-url="$RABBITMQ_AMQPS_URL" stripe-secreta="$STRIPE_SECRET_KEY" stripe-webhook="${STRIPE_WEBHOOK_SECRET:-pendiente}" \
  dynamo-secreto="$DYNAMO_SAGA_SECRETO" -- \
  RABBITMQ_URL=secretref:rabbit-url STRIPE_SECRET_KEY=secretref:stripe-secreta STRIPE_PUBLISHABLE_KEY="$STRIPE_PUBLISHABLE_KEY" \
  STRIPE_WEBHOOK_SECRET=secretref:stripe-webhook AWS_ACCESS_KEY_ID="$DYNAMO_SAGA_ID" AWS_SECRET_ACCESS_KEY=secretref:dynamo-secreto \
  "${AUTENTICACION[@]}"

paso "n8n con su base en PostgreSQL"
aplicacion salon-n8n "$REGISTRO/salon-n8n:latest" 5678 \
  pg-clave="$AZURE_PG_CLAVE" rabbit-clave="$RABBITMQ_CLAVE" cifrado="$N8N_ENCRYPTION_KEY" agente="$SALON_AGENT_SECRET" \
  automatizacion="$N8N_AUTOMATION_KEY" whatsapp-token="${WHATSAPP_TOKEN:-ninguno}" whatsapp-app="${WHATSAPP_APP_SECRET:-ninguno}" -- \
  DB_TYPE=postgresdb DB_POSTGRESDB_HOST="$AZURE_PG_HOST" DB_POSTGRESDB_PORT=5432 DB_POSTGRESDB_DATABASE=n8n \
  DB_POSTGRESDB_USER="$AZURE_PG_USUARIO" DB_POSTGRESDB_PASSWORD=secretref:pg-clave DB_POSTGRESDB_SSL_ENABLED=true \
  N8N_ENCRYPTION_KEY=secretref:cifrado WEBHOOK_URL="$N8N_URL/" N8N_PROXY_HOPS=1 GENERIC_TIMEZONE=America/La_Paz \
  RABBIT_HOST="$RABBITMQ_HOST" RABBIT_PORT=5671 RABBIT_SSL=true RABBIT_VHOST="$RABBITMQ_VHOST" \
  RABBIT_USER="$RABBITMQ_USUARIO" RABBIT_PASS=secretref:rabbit-clave \
  KEYCLOAK_TOKEN_URL="$KEYCLOAK_ISSUER/protocol/openid-connect/token" SALON_AGENT_SECRET=secretref:agente \
  GESTION_GRAPHQL_URL="$GESTION_URL/graphql" CRM_GRAPHQL_URL="$CRM_URL/graphql" PORTAL_URL="$PORTAL_URL" \
  N8N_AUTOMATION_KEY=secretref:automatizacion NODE_FUNCTION_ALLOW_BUILTIN=crypto \
  WHATSAPP_API_URL=https://graph.facebook.com/v21.0 WHATSAPP_TOKEN="$( [ -n "${WHATSAPP_TOKEN:-}" ] && echo secretref:whatsapp-token )" \
  WHATSAPP_APP_SECRET="$( [ -n "${WHATSAPP_APP_SECRET:-}" ] && echo secretref:whatsapp-app )" \
  WHATSAPP_PHONE_NUMBER_ID="${WHATSAPP_PHONE_NUMBER_ID:-}" WHATSAPP_VERIFY_TOKEN="${WHATSAPP_VERIFY_TOKEN:-}" \
  WHATSAPP_ADMIN_PHONE="${WHATSAPP_ADMIN_PHONE:-}" WHATSAPP_TEMPLATE_CONFIRMACION="${WHATSAPP_TEMPLATE_CONFIRMACION:-}" \
  WHATSAPP_TEMPLATE_RECORDATORIO="${WHATSAPP_TEMPLATE_RECORDATORIO:-}" WHATSAPP_TEMPLATE_STOCK="${WHATSAPP_TEMPLATE_STOCK:-}"

echo
echo "Direcciones:"
echo "  CRM:          $CRM_URL/graphql"
echo "  Orquestador:  $SAGA_URL"
echo "  n8n:          $N8N_URL"
echo
echo "Pendiente a mano:"
echo "  1. Stripe (modo prueba) > Desarrolladores > Webhooks: agregue $SAGA_URL/webhooks/stripe,"
echo "     copie su secreto en STRIPE_WEBHOOK_SECRET de configuracion.env y vuelva a correr este guion."
echo "  2. WhatsApp (Meta): cambie la URL de devolución de llamada a $N8N_URL/webhook/whatsapp/entrante. Ya no hace falta el túnel."
echo "Siga con: bash deploy/base-de-datos.sh"
