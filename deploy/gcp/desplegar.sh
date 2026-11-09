#!/usr/bin/env bash
# ====================================================================
# Despliegue en Google Cloud (us-east4). Requiere gcloud con sesión iniciada (gcloud auth login),
# Firebase CLI (npm i -g firebase-tools; firebase login), Node.js 22 y Docker.
#
#   bash deploy/gcp/desplegar.sh
#
# Cloud Run aloja ms-asesoria y ms-ia con HTTPS y su propia dirección (*.run.app).
# Firebase Hosting sirve los cuatro frontends compilados con las direcciones de la nube.
# Antes deben correr los guiones de AWS (datos y servicios) y de Azure.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir GCP_PROYECTO GCP_REGION MONGO_URI GEMINI_API_KEY RABBITMQ_HOST RABBITMQ_USUARIO RABBITMQ_CLAVE RABBITMQ_VHOST \
  DYNAMO_ASESORIA_ID DYNAMO_ASESORIA_SECRETO DYNAMO_IA_ID DYNAMO_IA_SECRETO CRM_URL SAGA_URL

gcloud config set project "$GCP_PROYECTO" >/dev/null
REGISTRO="$GCP_REGION-docker.pkg.dev/$GCP_PROYECTO/salon"

paso "Servicios de Google Cloud"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  firebasehosting.googleapis.com firebase.googleapis.com

paso "Registro de imágenes (Artifact Registry) e imágenes"
gcloud artifacts repositories describe salon --location "$GCP_REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create salon --repository-format docker --location "$GCP_REGION"
gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
docker build --platform linux/amd64 -t "$REGISTRO/ms-asesoria:latest" "$RAIZ/backend/ms-asesoria"
docker build --platform linux/amd64 -t "$REGISTRO/ms-ia:latest" "$RAIZ/backend/ms-ia"
docker push "$REGISTRO/ms-asesoria:latest"
docker push "$REGISTRO/ms-ia:latest"

paso "Secretos (Secret Manager)"
secreto() { # nombre valor: crea el secreto o le agrega una versión
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy automatic >/dev/null
  fi
}
secreto salon-mongo-uri "$MONGO_URI"
secreto salon-rabbitmq-url "$RABBITMQ_AMQPS_URL"
secreto salon-dynamo-asesoria "$DYNAMO_ASESORIA_SECRETO"
secreto salon-dynamo-ia "$DYNAMO_IA_SECRETO"
secreto salon-gemini "$GEMINI_API_KEY"
secreto salon-replicate "${REPLICATE_API_KEY:-ninguna}"
# Cloud Run usa la cuenta de servicio predeterminada de Compute Engine
NUMERO=$(gcloud projects describe "$GCP_PROYECTO" --format 'value(projectNumber)')
gcloud projects add-iam-policy-binding "$GCP_PROYECTO" --condition=None --quiet \
  --member "serviceAccount:$NUMERO-compute@developer.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor >/dev/null

# Variables separadas por "@" (prefijo ^@^ de gcloud), porque ALLOWED_ORIGINS lleva comas
AUTENTICACION="^@^KEYCLOAK_ISSUER=$KEYCLOAK_ISSUER@KEYCLOAK_JWKS_URI=$KEYCLOAK_JWKS_URI@KEYCLOAK_AUDIENCE=salon-api"
AUTENTICACION+="@DYNAMODB_ENDPOINT=$DYNAMODB_ENDPOINT@AWS_REGION=${AWS_REGION:-us-east-1}@ALLOWED_ORIGINS=$ALLOWED_ORIGINS"

paso "ms-asesoria en Cloud Run"
gcloud run deploy salon-asesoria --image "$REGISTRO/ms-asesoria:latest" --region "$GCP_REGION" \
  --port 3100 --cpu 1 --memory 1Gi --min-instances 1 --max-instances 3 --allow-unauthenticated \
  --set-env-vars "$AUTENTICACION@AWS_ACCESS_KEY_ID=$DYNAMO_ASESORIA_ID@BIOMETRIC_RETENTION_DAYS=365" \
  --set-secrets "MONGO_URI=salon-mongo-uri:latest,RABBITMQ_URL=salon-rabbitmq-url:latest,AWS_SECRET_ACCESS_KEY=salon-dynamo-asesoria:latest"
guardar gcp ASESORIA_URL "$(gcloud run services describe salon-asesoria --region "$GCP_REGION" --format 'value(status.url)')"

paso "ms-ia en Cloud Run (siempre encendido: la imagen pesa unos 4 GB)"
REPLICATE_SECRETO=""
[ -n "${REPLICATE_API_KEY:-}" ] && REPLICATE_SECRETO=",REPLICATE_API_KEY=salon-replicate:latest"
gcloud run deploy salon-ia --image "$REGISTRO/ms-ia:latest" --region "$GCP_REGION" \
  --port 8002 --cpu 2 --memory 4Gi --min-instances 1 --max-instances 2 --no-cpu-throttling --timeout 300 \
  --allow-unauthenticated \
  --set-env-vars "$AUTENTICACION@AWS_ACCESS_KEY_ID=$DYNAMO_IA_ID@ASESORIA_URL=$ASESORIA_URL@GESTION_GRAPHQL_URL=$GESTION_URL/graphql@GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.5-flash}" \
  --set-secrets "AWS_SECRET_ACCESS_KEY=salon-dynamo-ia:latest,GEMINI_API_KEY=salon-gemini:latest$REPLICATE_SECRETO"
guardar gcp IA_URL "$(gcloud run services describe salon-ia --region "$GCP_REGION" --format 'value(status.url)')"

paso "Frontends compilados con las direcciones de la nube"
export VITE_KEYCLOAK_URL="$KEYCLOAK_URL" VITE_GESTION_URL="$GESTION_URL/graphql" VITE_CRM_URL="$CRM_URL/graphql" \
  VITE_CRM_BASE_URL="$CRM_URL" VITE_ASESORIA_URL="$ASESORIA_URL" VITE_IA_URL="$IA_URL/api/v1" VITE_SAGA_URL="$SAGA_URL" \
  VITE_MCP_URL="$MCP_URL/mcp" VITE_MFE_ESTUDIO_URL="https://$SITIO_ESTUDIO.web.app" \
  VITE_MFE_RESERVAS_URL="https://$SITIO_RESERVAS.web.app" VITE_MFE_GESTION_URL="https://$SITIO_ERP.web.app"
for app in shell mfe-estudio-ia mfe-reservas mfe-gestion; do
  (cd "$RAIZ/frontend/$app" && npm ci --no-audit --no-fund && npm run build)
done

paso "Firebase Hosting: un sitio por microfrontend"
firebase projects:addfirebase "$GCP_PROYECTO" >/dev/null 2>&1 || true # ya tenía Firebase
for sitio in "$SITIO_APP" "$SITIO_ESTUDIO" "$SITIO_RESERVAS" "$SITIO_ERP"; do
  firebase hosting:sites:create "$sitio" --project "$GCP_PROYECTO" >/dev/null 2>&1 || true # ya existía
done
# Mismo comportamiento que el nginx local: CORS para Module Federation, remoteEntry.js sin caché
# y rutas desconocidas hacia index.html
sitio_json() { # objetivo carpeta
  cat <<JSON
    {
      "target": "$1",
      "public": "$2",
      "headers": [
        {"source": "**", "headers": [{"key": "Access-Control-Allow-Origin", "value": "*"}]},
        {"source": "/remoteEntry.js", "headers": [{"key": "Cache-Control", "value": "no-cache"}]}
      ],
      "rewrites": [{"source": "**", "destination": "/index.html"}]
    }
JSON
}
cat > "$RAIZ/frontend/firebase.json" <<JSON
{
  "hosting": [
$(sitio_json app shell/dist),
$(sitio_json estudio mfe-estudio-ia/dist),
$(sitio_json reservas mfe-reservas/dist),
$(sitio_json erp mfe-gestion/dist/browser)
  ]
}
JSON
cat > "$RAIZ/frontend/.firebaserc" <<JSON
{
  "projects": {"default": "$GCP_PROYECTO"},
  "targets": {"$GCP_PROYECTO": {"hosting": {
    "app": ["$SITIO_APP"], "estudio": ["$SITIO_ESTUDIO"], "reservas": ["$SITIO_RESERVAS"], "erp": ["$SITIO_ERP"]
  }}}
}
JSON
(cd "$RAIZ/frontend" && firebase deploy --only hosting --project "$GCP_PROYECTO")

echo
echo "Plataforma web: $PORTAL_URL"
echo "App móvil (Android), compilada contra la nube:"
echo "  cd mobile/salon_mobile && flutter build apk --debug --dart-define=KEYCLOAK_ISSUER=$KEYCLOAK_ISSUER \\"
echo "    --dart-define=GESTION_URL=$GESTION_URL/graphql --dart-define=CRM_URL=$CRM_URL/graphql \\"
echo "    --dart-define=ASESORIA_URL=$ASESORIA_URL --dart-define=IA_URL=$IA_URL/api/v1 --dart-define=SAGA_URL=$SAGA_URL"
