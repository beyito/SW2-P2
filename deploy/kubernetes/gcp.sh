#!/usr/bin/env bash
# ====================================================================
# Kubernetes en Google Cloud (GKE Autopilot): el tablero de inteligencia de negocios en Python.
# Requiere gcloud (sesión iniciada), kubectl y que gcp/desplegar.sh ya haya corrido (imagen y secretos).
#
#   bash deploy/kubernetes/gcp.sh
#
# Crea un clúster Autopilot (Google administra los nodos), reserva una IP global y publica el tablero en
# https://bi.<dominio> con un certificado administrado. Pide crear un registro A en el DNS. Es idempotente.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir GCP_PROYECTO GCP_REGION DOMINIO BI_CLIENT_SECRET BI_COOKIE_SECRET KEYCLOAK_ADMIN_CLAVE
command -v kubectl >/dev/null || { echo "Falta kubectl (viene con Docker Desktop)." >&2; exit 1; }

CLUSTER=salon-gke
REGISTRO="$GCP_REGION-docker.pkg.dev/$GCP_PROYECTO/salon"
OVERLAY="$RAIZ/k8s/overlays/gcp"
BI_DOMINIO="bi.$DOMINIO"
export KUBECONFIG="$SALIDA/kubeconfig-gke"

paso "Clúster GKE Autopilot (unos 10 minutos la primera vez)"
gcloud config set project "$GCP_PROYECTO" >/dev/null
gcloud services enable container.googleapis.com compute.googleapis.com
if ! gcloud container clusters describe "$CLUSTER" --region "$GCP_REGION" >/dev/null 2>&1; then
  gcloud container clusters create-auto "$CLUSTER" --region "$GCP_REGION" --quiet
fi
# kubectl necesita el complemento de autenticación de GKE
command -v gke-gcloud-auth-plugin >/dev/null || gcloud components install gke-gcloud-auth-plugin --quiet
gcloud container clusters get-credentials "$CLUSTER" --region "$GCP_REGION"

paso "IP global fija para bi.$DOMINIO"
gcloud compute addresses describe salon-bi-ip --global >/dev/null 2>&1 || gcloud compute addresses create salon-bi-ip --global
IP_BI=$(gcloud compute addresses describe salon-bi-ip --global --format 'value(address)' | tr -d '\r')
guardar gcp BI_GKE_URL "https://$BI_DOMINIO"

paso "Configuración y secretos del tablero (fuera del repositorio)"
mkdir -p "$OVERLAY/generado"
cat > "$OVERLAY/generado/bi-dashboard.env" <<ENV
BI_URL=$BI_GKE_URL
BI_KEYCLOAK_METADATA_URL=$KEYCLOAK_ISSUER/.well-known/openid-configuration
ENV
cat > "$OVERLAY/generado/bi-dashboard-secretos.env" <<ENV
BI_CLIENT_SECRET=$BI_CLIENT_SECRET
BI_COOKIE_SECRET=$BI_COOKIE_SECRET
ENV

paso "Despliegue en GKE"
kubectl kustomize "$OVERLAY" | sed -e "s#REGISTRO/#$REGISTRO/#" -e "s#BI_DOMINIO#$BI_DOMINIO#" | kubectl apply -f -
kubectl -n salon rollout restart deployment/bi-dashboard
kubectl -n salon rollout status deployment/bi-dashboard --timeout=600s
kubectl -n salon get pods,ingress -o wide

paso "Inicio de sesión: el cliente salon-bi acepta Cloud Run y GKE"
KEYCLOAK_URL="$KEYCLOAK_URL" KEYCLOAK_ADMIN_USER=admin KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_CLAVE" \
  BI_URL="${BI_URL:+$BI_URL,}$BI_GKE_URL" BI_CLIENT_SECRET="$BI_CLIENT_SECRET" python "$RAIZ/docker/keycloak/cliente_bi.py"

echo
echo "Cree este registro en el DNS de $DOMINIO (si no existe):"
echo "  A   bi   $IP_BI"
echo "El certificado se emite cuando el registro responde (de 15 a 60 minutos). Luego: $BI_GKE_URL"
