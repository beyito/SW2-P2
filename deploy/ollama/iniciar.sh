#!/bin/sh
# Arranca Ollama (solo en localhost), carga el modelo en memoria y abre el proxy con la clave en $PORT.
set -eu
[ -n "${OLLAMA_API_KEY:-}" ] || { echo "Falta OLLAMA_API_KEY" >&2; exit 1; }

ollama serve &
until ollama list >/dev/null 2>&1; do sleep 1; done
# La primera respuesta no espera a que el modelo se cargue
ollama run "${OLLAMA_MODEL:-qwen2.5:3b}" "" >/dev/null 2>&1 || true

envsubst '${PORT} ${OLLAMA_API_KEY}' < /etc/nginx/salon.conf.template > /etc/nginx/nginx.conf
exec nginx -g 'daemon off;'
