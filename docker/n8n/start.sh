#!/bin/sh
# Importa los flujos versionados y los activa en cada arranque, sin pasos manuales. Es idempotente.
set -e
sed -e "s|__RABBIT_USER__|$RABBIT_USER|" -e "s|__RABBIT_PASS__|$RABBIT_PASS|" /seed/credentials.template.json > /tmp/credentials.json
n8n import:credentials --input=/tmp/credentials.json
rm -f /tmp/credentials.json
n8n import:workflow --separate --input=/seed/workflows
n8n update:workflow --all --active=true
exec n8n start
