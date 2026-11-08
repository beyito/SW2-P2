#!/usr/bin/env bash
# ====================================================================
# Ejecuta los cinco pasos del despliegue con CLI simuladas (aws, az, gcloud, docker, firebase, npm),
# sin cuentas ni costo. Detecta errores de Bash, variables faltantes y JSON inválidos en las tareas
# de Fargate. No prueba que la nube acepte los comandos: eso solo se ve al desplegar de verdad.
#
#   bash deploy/simulacion/correr.sh
#
# No toca deploy/configuracion.env ni deploy/salida: trabaja en una carpeta temporal.
# ====================================================================
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
TEMPORAL="$(mktemp -d)"
trap 'rm -rf "$TEMPORAL"' EXIT

mkdir -p "$TEMPORAL/bin"
for cli in aws az gcloud docker firebase npm curl openssl; do
  cp "$AQUI/simular" "$TEMPORAL/bin/$cli"
  chmod +x "$TEMPORAL/bin/$cli"
done

# Configuración de ejemplo con valores ficticios en todas las claves
sed -e 's/^DOMINIO=$/DOMINIO=salon-ejemplo.com/' \
    -e 's/^\([A-Z0-9_]*\(CLAVE\|SECRET\|KEY\|TOKEN\|URI\|PROYECTO\|HOST\|USUARIO\|VHOST\)\)=$/\1=valor-simulado/' \
    "$RAIZ/deploy/configuracion.example.env" > "$TEMPORAL/configuracion.env"

# firebase.json y .firebaserc se generan en frontend/: se conservan los que hubiera
for archivo in firebase.json .firebaserc; do
  [ -f "$RAIZ/frontend/$archivo" ] && cp "$RAIZ/frontend/$archivo" "$TEMPORAL/$archivo.copia"
done

export PATH="$TEMPORAL/bin:$PATH" SIM_LOG="$TEMPORAL/llamadas.log"
export DEPLOY_CONFIGURACION="$TEMPORAL/configuracion.env" DEPLOY_SALIDA="$TEMPORAL/salida"
fallos=0
for paso in "aws/desplegar.sh datos" "azure/desplegar.sh" "base-de-datos.sh" "aws/desplegar.sh servicios" "gcp/desplegar.sh"; do
  # shellcheck disable=SC2086
  if bash "$RAIZ/deploy/"$paso > "$TEMPORAL/paso.txt" 2>&1; then
    echo "OK     $paso"
  else
    echo "FALLA  $paso"; tail -5 "$TEMPORAL/paso.txt"; fallos=$((fallos + 1))
  fi
done

for archivo in firebase.json .firebaserc; do
  if [ -f "$TEMPORAL/$archivo.copia" ]; then cp "$TEMPORAL/$archivo.copia" "$RAIZ/frontend/$archivo"; else rm -f "$RAIZ/frontend/$archivo"; fi
done
echo "$(wc -l < "$SIM_LOG") llamadas simuladas; $fallos pasos fallidos."
exit $fallos
