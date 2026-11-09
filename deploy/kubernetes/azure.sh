#!/usr/bin/env bash
# ====================================================================
# Kubernetes en Azure (AKS): el worker del CRM, que consume los eventos de la SAGA.
# Requiere az (sesión iniciada), kubectl y que azure/desplegar.sh ya haya corrido (registro e imágenes).
#
#   bash deploy/kubernetes/azure.sh
#
# Crea un clúster AKS de un nodo ARM64 (Standard_B2pls_v2: en canadacentral, Azure for Students solo
# permite tamaños con cuota 0 salvo la familia Bpsv2), compila la imagen del CRM para ARM64, le da al
# clúster acceso de lectura al registro de Azure y aplica
# k8s/overlays/azure con la configuración generada aquí. Es idempotente.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir AZURE_UBICACION AZURE_GRUPO AZURE_PG_HOST AZURE_PG_USUARIO AZURE_PG_CLAVE CRM_APP_KEY RABBITMQ_HOST \
  RABBITMQ_USUARIO RABBITMQ_CLAVE RABBITMQ_VHOST DYNAMO_CRM_ID DYNAMO_CRM_SECRETO
command -v kubectl >/dev/null || { echo "Falta kubectl (viene con Docker Desktop)." >&2; exit 1; }

CLUSTER=salon-aks
REGISTRO_NOMBRE="$(echo "${PREFIJO}acr" | tr -cd 'a-z0-9')"
OVERLAY="$RAIZ/k8s/overlays/azure"
export KUBECONFIG="$SALIDA/kubeconfig-aks"

paso "Clúster AKS (unos 8 minutos la primera vez)"
az provider register --namespace Microsoft.ContainerService --wait
if ! az aks show -g "$AZURE_GRUPO" -n "$CLUSTER" --output none 2>/dev/null; then
  az aks create -g "$AZURE_GRUPO" -n "$CLUSTER" --location "$AZURE_UBICACION" --tier free \
    --node-count 1 --node-vm-size Standard_B2pls_v2 --no-ssh-key --attach-acr "$REGISTRO_NOMBRE" --output none
fi
az aks get-credentials -g "$AZURE_GRUPO" -n "$CLUSTER" --file "$KUBECONFIG" --overwrite-existing --output none

paso "Imagen del CRM para ARM64 (el nodo es ARM; se compila emulando la arquitectura)"
az acr login -n "$REGISTRO_NOMBRE"
docker buildx build --platform linux/arm64 --target runtime -t "$REGISTRO_NOMBRE.azurecr.io/salon-ms-crm:arm64"   --push "$RAIZ/backend/ms-crm"

paso "Configuración y secretos del worker (fuera del repositorio)"
mkdir -p "$OVERLAY/generado"
cat > "$OVERLAY/generado/ms-crm-worker.env" <<ENV
APP_ENV=production
APP_DEBUG=false
LOG_CHANNEL=stderr
CACHE_STORE=array
SESSION_DRIVER=array
QUEUE_CONNECTION=sync
DB_CONNECTION=pgsql
DB_HOST=$AZURE_PG_HOST
DB_PORT=5432
DB_DATABASE=salon_crm
DB_USERNAME=$AZURE_PG_USUARIO
RABBITMQ_HOST=$RABBITMQ_HOST
RABBITMQ_PORT=5671
RABBITMQ_SSL=true
RABBITMQ_VHOST=$RABBITMQ_VHOST
RABBITMQ_USER=$RABBITMQ_USUARIO
AWS_ACCESS_KEY_ID=$DYNAMO_CRM_ID
AWS_REGION=$AWS_REGION
DYNAMODB_ENDPOINT=$DYNAMODB_ENDPOINT
KEYCLOAK_ISSUER=$KEYCLOAK_ISSUER
KEYCLOAK_JWKS_URI=$KEYCLOAK_JWKS_URI
KEYCLOAK_AUDIENCE=salon-api
ENV
cat > "$OVERLAY/generado/ms-crm-worker-secretos.env" <<ENV
APP_KEY=$CRM_APP_KEY
DB_PASSWORD=$AZURE_PG_CLAVE
RABBITMQ_PASSWORD=$RABBITMQ_CLAVE
AWS_SECRET_ACCESS_KEY=$DYNAMO_CRM_SECRETO
ENV

paso "Despliegue en AKS"
kubectl kustomize "$OVERLAY" | sed "s#REGISTRO/#$REGISTRO_NOMBRE.azurecr.io/#" | kubectl apply -f -
kubectl -n salon rollout restart deployment/ms-crm-worker
kubectl -n salon rollout status deployment/ms-crm-worker --timeout=300s
kubectl -n salon get pods -o wide
