#!/usr/bin/env bash
# ====================================================================
# Cambia las contraseñas de las cuentas de demostración en el Keycloak de la nube.
# Las del realm (Admin#2026, Cliente#2026...) están publicadas en el manual del
# repositorio, que es público: en la nube no pueden quedar así.
#
#   bash deploy/keycloak/cambiar-claves-demo.sh
#
# Genera una contraseña por cuenta la primera vez y la guarda en
# deploy/salida/cuentas-demo.env (ignorado por Git). Si se vuelve a correr,
# aplica las mismas. Compártalas con el equipo por un canal privado.
# Requiere que aws/desplegar.sh servicios ya haya levantado Keycloak.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir KEYCLOAK_URL KEYCLOAK_ADMIN_CLAVE

CUENTAS=(admin.salon recepcion.salon valentina.rossi camila.fernandez alejandro.morales)
ARCHIVO="$SALIDA/cuentas-demo.env"
[ -f "$ARCHIVO" ] && source "$ARCHIVO"

# Extrae un campo de un JSON leído por la entrada estándar
campo() { python -c "import json,sys; d=json.load(sys.stdin); d=d[0] if isinstance(d,list) else d; print(d.get('$1',''))"; }

paso "Token de administración de Keycloak"
TOKEN=$(curl -fsS "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin \
  --data-urlencode "password=$KEYCLOAK_ADMIN_CLAVE" | campo access_token)
[ -n "$TOKEN" ] || { echo "No se obtuvo el token de administración." >&2; exit 1; }

paso "Contraseñas nuevas"
for cuenta in "${CUENTAS[@]}"; do
  variable="CLAVE_$(echo "$cuenta" | tr 'a-z.' 'A-Z_')"
  # Sin "#" ni símbolos: adb shell input text no escribe "#" al probar en el emulador
  if [ -z "${!variable:-}" ]; then
    guardar cuentas-demo "$variable" "Salon$(openssl rand -base64 18 | tr -d '/+=\r\n' | cut -c1-14)9"
  fi
  id=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
    "$KEYCLOAK_URL/admin/realms/salon/users?username=$cuenta&exact=true" | campo id)
  [ -n "$id" ] || { echo "  $cuenta: no existe en el realm" >&2; exit 1; }
  curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    "$KEYCLOAK_URL/admin/realms/salon/users/$id/reset-password" \
    -d "{\"type\":\"password\",\"value\":\"${!variable}\",\"temporary\":false}"
  echo "  $cuenta"
done
echo "Listo. Las contraseñas están en deploy/salida/cuentas-demo.env."
