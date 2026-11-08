#!/bin/sh
# Aplica al Keycloak en ejecución lo agregado a salon-realm.json en la Fase Q, porque un realm ya
# importado no se vuelve a leer: tema de inicio de sesión del salón, español y sesión del móvil
# que dura hasta cerrarla (token offline renovable durante 10 años sin uso).
# Se puede repetir sin efectos secundarios.
set -e
KC=/opt/keycloak/bin/kcadm.sh
$KC config credentials --server http://localhost:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

$KC update realms/salon \
  -s loginTheme=salon \
  -s internationalizationEnabled=true -s 'supportedLocales=["es"]' -s defaultLocale=es \
  -s offlineSessionIdleTimeout=315360000 -s offlineSessionMaxLifespanEnabled=false
$KC get realms/salon --fields loginTheme,defaultLocale,offlineSessionIdleTimeout,offlineSessionMaxLifespanEnabled

# Las cuentas importadas solo tienen su rol: sin offline_access, Keycloak rechaza el token offline
# de la app móvil. Se da solo ese rol (el rol por defecto incluye CLIENT y cambiaría al personal).
for usuario in admin.salon recepcion.salon valentina.rossi camila.fernandez alejandro.morales; do
  $KC remove-roles -r salon --uusername "$usuario" --rolename default-roles-salon 2>/dev/null || true
  $KC add-roles -r salon --uusername "$usuario" --rolename offline_access
done
echo "offline_access asignado a las cuentas de demostración"
for usuario in admin.salon camila.fernandez; do
  echo "$usuario: $($KC get-roles -r salon --uusername "$usuario" --fields name --format csv --noquotes | tr '
' ' ')"
done
