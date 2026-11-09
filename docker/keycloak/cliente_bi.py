"""
Crea o actualiza el cliente "salon-bi" (tablero de inteligencia de negocios) en un Keycloak ya instalado,
porque un realm importado no vuelve a leer salon-realm.json. Se puede repetir sin efectos secundarios.

Variables: KEYCLOAK_URL, KEYCLOAK_ADMIN_USER, KEYCLOAK_ADMIN_PASSWORD, BI_URL y BI_CLIENT_SECRET.
BI_URL admite varias direcciones separadas por comas (por ejemplo, Cloud Run y GKE).
Ejemplo local: python docker/keycloak/cliente_bi.py   (usa los valores de Docker Compose por defecto)
"""
import json
import os
import urllib.parse
import urllib.request

BASE = os.environ.get("KEYCLOAK_URL", "http://localhost:8080")
BI_URLS = [u.strip().rstrip("/") for u in os.environ.get("BI_URL", "http://localhost:8501").split(",") if u.strip()]


def pedir(metodo, ruta, token=None, cuerpo=None, formulario=None):
    datos = urllib.parse.urlencode(formulario).encode() if formulario else (json.dumps(cuerpo).encode() if cuerpo is not None else None)
    cabeceras = {"Content-Type": "application/x-www-form-urlencoded" if formulario else "application/json"}
    if token:
        cabeceras["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(f"{BASE}{ruta}", data=datos, headers=cabeceras, method=metodo)) as respuesta:
        contenido = respuesta.read()
        return json.loads(contenido) if contenido else None


def main():
    token = pedir("POST", "/realms/master/protocol/openid-connect/token", formulario={
        "grant_type": "password", "client_id": "admin-cli",
        "username": os.environ.get("KEYCLOAK_ADMIN_USER", "admin"),
        "password": os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "admin_secret_pass"),
    })["access_token"]

    cliente = {
        "clientId": "salon-bi",
        "name": "Tablero de inteligencia de negocios (Python)",
        "enabled": True,
        "publicClient": False,
        "secret": os.environ.get("BI_CLIENT_SECRET", "salon-bi-secret-local"),
        "standardFlowEnabled": True,
        "directAccessGrantsEnabled": False,
        "redirectUris": [f"{url}/oauth2callback" for url in BI_URLS],
        "webOrigins": BI_URLS,
        "attributes": {"post.logout.redirect.uris": "##".join(f"{url}/*" for url in BI_URLS)},
    }
    existentes = pedir("GET", "/admin/realms/salon/clients?clientId=salon-bi", token)
    if existentes:
        identificador = existentes[0]["id"]
        pedir("PUT", f"/admin/realms/salon/clients/{identificador}", token, {**existentes[0], **cliente})
    else:
        pedir("POST", "/admin/realms/salon/clients", token, cliente)
        identificador = pedir("GET", "/admin/realms/salon/clients?clientId=salon-bi", token)[0]["id"]

    # Los roles del realm van en el ID token: el tablero exige ADMIN
    mapeos = pedir("GET", f"/admin/realms/salon/clients/{identificador}/protocol-mappers/models", token)
    if not any(m["name"] == "roles-en-id-token" for m in mapeos):
        pedir("POST", f"/admin/realms/salon/clients/{identificador}/protocol-mappers/models", token, {
            "name": "roles-en-id-token", "protocol": "openid-connect", "protocolMapper": "oidc-usermodel-realm-role-mapper",
            "config": {"claim.name": "roles", "multivalued": "true", "jsonType.label": "String",
                       "id.token.claim": "true", "access.token.claim": "false", "userinfo.token.claim": "true"},
        })
    print(f"Cliente salon-bi listo en {BASE}, con redirección a {', '.join(BI_URLS)}")


if __name__ == "__main__":
    main()
