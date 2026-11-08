# Keycloak de producción con el realm del salón incluido.
# Se construye desde la raíz del repositorio: docker build -f deploy/keycloak/Dockerfile .
# El realm usa ${SALON_PORTAL_URL}, ${SALON_AGENT_SECRET} y ${KC_REALM_SSL_REQUIRED}, que se pasan al arrancar.
FROM quay.io/keycloak/keycloak:26.0.7 AS build
# Una sola instancia: caché local, porque Fargate no admite la multidifusión que usa el clúster
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_CACHE=local
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.0.7
COPY --from=build /opt/keycloak/ /opt/keycloak/
COPY docker/keycloak/salon-realm.json /opt/keycloak/data/import/salon-realm.json
# TLS termina en el balanceador: Keycloak escucha HTTP y confía en sus cabeceras X-Forwarded
ENV KC_HTTP_ENABLED=true KC_PROXY_HEADERS=xforwarded KC_CACHE=local
# El realm solo se importa si todavía no existe en la base
ENTRYPOINT ["/opt/keycloak/bin/kc.sh", "start", "--optimized", "--import-realm"]
