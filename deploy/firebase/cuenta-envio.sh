#!/usr/bin/env bash
# ====================================================================
# Notificaciones push, parte 2: la cuenta de servicio con la que el CRM envía los mensajes.
# Otorga un permiso y crea una clave, así que la ejecuta a mano la persona dueña del proyecto.
#
#   bash deploy/firebase/cuenta-envio.sh
#
# Crea la cuenta salon-fcm con el rol roles/firebasecloudmessaging.admin (solo enviar mensajes de FCM)
# y guarda su clave en deploy/salida/fcm-cuenta.json (ignorada por Git). Después, azure/desplegar.sh
# se la entrega al CRM como secreto. Es idempotente: no crea otra clave si ya existe una.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir GCP_PROYECTO

CUENTA="salon-fcm@$GCP_PROYECTO.iam.gserviceaccount.com"
CLAVE="$SALIDA/fcm-cuenta.json"

gcloud config set project "$GCP_PROYECTO" >/dev/null
gcloud services enable iam.googleapis.com
gcloud iam service-accounts describe "$CUENTA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create salon-fcm --display-name "Envio de notificaciones push del salon"
gcloud projects add-iam-policy-binding "$GCP_PROYECTO" --condition=None --quiet \
  --member "serviceAccount:$CUENTA" --role roles/firebasecloudmessaging.admin >/dev/null
[ -f "$CLAVE" ] || gcloud iam service-accounts keys create "$CLAVE" --iam-account "$CUENTA"
echo "Clave en deploy/salida/fcm-cuenta.json. Siga con: bash deploy/azure/desplegar.sh"
