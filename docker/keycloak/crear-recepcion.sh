#!/bin/sh
# Crea en el Keycloak en ejecución el rol RECEPTIONIST y su usuario de prueba, igual que en salon-realm.json.
# Se puede repetir: lo que ya existe no se duplica.
set -e
KC=/opt/keycloak/bin/kcadm.sh
$KC config credentials --server http://localhost:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

if $KC get roles/RECEPTIONIST -r salon >/dev/null 2>&1; then
  echo "rol: ya existía"
else
  $KC create roles -r salon -s name=RECEPTIONIST \
    -s 'description=Recepcionista del salón: agenda, llegadas, cobro en mostrador y horarios; sesión única concurrente'
  echo "rol: creado"
fi

if [ -n "$($KC get users -r salon -q username=recepcion.salon -q exact=true --fields id --format csv --noquotes)" ]; then
  echo "usuario: ya existía"
else
  $KC create users -r salon -s username=recepcion.salon -s enabled=true -s email=recepcion@salon.local \
    -s emailVerified=true -s firstName=Lucía -s 'lastName=Recepción' -s 'attributes.salon_id=["rec-001"]'
  $KC set-password -r salon --username recepcion.salon --new-password 'Recepcion#2026'
  echo "usuario: creado"
fi
$KC add-roles -r salon --uusername recepcion.salon --rolename RECEPTIONIST
$KC get users -r salon -q username=recepcion.salon -q exact=true --fields username,attributes
$KC get-roles -r salon --uusername recepcion.salon --fields name --format csv --noquotes
