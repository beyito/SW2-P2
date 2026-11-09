#!/usr/bin/env bash
# ====================================================================
# Notificaciones push (Firebase Cloud Messaging), parte 1: la app Android en Firebase.
# Requiere gcloud y Firebase CLI con sesión iniciada. Se corre una vez, antes de compilar la app.
#
#   bash deploy/firebase/push.sh
#
# Registra la app Android en el proyecto de Firebase, descarga su google-services.json en
# mobile/salon_mobile/android/app (ignorado por Git) y activa la API de FCM. Es idempotente.
# La parte 2, la cuenta que envía los mensajes, está en deploy/firebase/cuenta-envio.sh.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir GCP_PROYECTO

PAQUETE=com.salon.salon_mobile
DESTINO="$RAIZ/mobile/salon_mobile/android/app/google-services.json"

paso "App Android en Firebase"
APP=$(firebase apps:list ANDROID --project "$GCP_PROYECTO" 2>/dev/null | grep -oE '1:[0-9]+:android:[0-9a-f]+' | head -1 || true)
if [ -z "$APP" ]; then
  firebase apps:create ANDROID "Salon e IA Studio" --package-name "$PAQUETE" --project "$GCP_PROYECTO" >/dev/null
  APP=$(firebase apps:list ANDROID --project "$GCP_PROYECTO" | grep -oE '1:[0-9]+:android:[0-9a-f]+' | head -1)
fi
firebase apps:sdkconfig ANDROID "$APP" --project "$GCP_PROYECTO" --out "$DESTINO" >/dev/null
echo "  $APP"

paso "API de Firebase Cloud Messaging"
gcloud config set project "$GCP_PROYECTO" >/dev/null
gcloud services enable fcm.googleapis.com
echo "Listo. Siga con deploy/firebase/cuenta-envio.sh."
