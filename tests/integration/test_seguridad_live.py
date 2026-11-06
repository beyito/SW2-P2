"""
Pruebas en vivo de la Fase B contra Keycloak y los cinco servicios (CU-01, CU-02, RF-01, RNF-02).
Requiere el entorno levantado: docker compose up -d --wait
Ejecución: backend/ms-ia/.venv/Scripts/python.exe -m pytest tests/integration/test_seguridad_live.py -v
"""
import base64
import hashlib
import html
import json
import re
import secrets
import time
import uuid
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

KEYCLOAK = "http://localhost:8080/realms/salon/protocol/openid-connect"
ISSUER = "http://localhost:8080/realms/salon"
GESTION = "http://localhost:8081/graphql"
ASESORIA = "http://localhost:3100"
CRM = "http://localhost:8083"
IA = "http://localhost:8002"
MCP = "http://localhost:4000/mcp/rpc"

ADMIN = ("admin.salon", "Admin#2026")
STYLIST = ("valentina.rossi", "Estilista#2026")
CLIENT = ("camila.fernandez", "Cliente#2026")


def login(credentials):
    """Inicia sesión por el flujo del navegador (authorization code + PKCE) con cookies nuevas."""
    username, password = credentials
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    redirect_uri = "http://localhost:3000/"

    with httpx.Client() as browser:
        page = browser.get(f"{KEYCLOAK}/auth", params={
            "client_id": "salon-web", "response_type": "code", "scope": "openid",
            "redirect_uri": redirect_uri, "code_challenge": challenge, "code_challenge_method": "S256",
        })
        assert page.status_code == 200, page.text
        action = html.unescape(re.search(r'action="([^"]+)"', page.text).group(1))
        # Las cookies de Keycloak son Secure: un navegador las envía en localhost, pero httpx no
        cookies = "; ".join(f"{cookie.name}={cookie.value}" for cookie in browser.cookies.jar)
        sent = httpx.post(action, data={"username": username, "password": password}, headers={"Cookie": cookies})
        assert sent.status_code == 302, sent.text
        code = parse_qs(urlparse(sent.headers["location"]).query)["code"][0]
        response = browser.post(f"{KEYCLOAK}/token", data={
            "grant_type": "authorization_code", "client_id": "salon-web", "code": code,
            "redirect_uri": redirect_uri, "code_verifier": verifier,
        })
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def claims_of(token):
    return jwt.decode(token, options={"verify_signature": False})


def auth(token):
    return {"Authorization": f"Bearer {token}"} if token else {}


def gql(query, token):
    return httpx.post(GESTION, json={"query": query}, headers=auth(token))


def rpc(method, params, token):
    return httpx.post(MCP, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, headers=auth(token))


# Una petición protegida por servicio. Son consultas de lectura.
SERVICIOS = {
    "ms-gestion": lambda t: gql("{getCriticalStockItems{code}}", t),
    "ms-asesoria": lambda t: httpx.get(f"{ASESORIA}/community", headers=auth(t)),
    "ms-crm": lambda t: httpx.get(f"{CRM}/api/clients", headers=auth(t)),
    "ms-ia": lambda t: httpx.post(f"{IA}/api/v1/recommendations/styles", json={}, headers=auth(t)),
    "mcp-server": lambda t: rpc("tools/list", {}, t),
}
servicios = pytest.mark.parametrize("servicio", SERVICIOS)


def token_falsificado(alg="RS256", **cambios):
    """Token con la forma correcta y los claims de un ADMIN, firmado con una llave ajena."""
    real = jwt.get_unverified_header(login(CLIENT))
    claims = {
        "sub": "atacante", "iss": ISSUER, "aud": "salon-api", "exp": int(time.time()) + 300,
        "realm_access": {"roles": ["ADMIN"]}, **cambios,
    }
    if alg == "none":
        def b64(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()
        return f"{b64({'alg': 'none', 'kid': real['kid']})}.{b64(claims)}."
    llave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return jwt.encode(claims, llave, algorithm="RS256", headers={"kid": real["kid"]})


class TestRechazoDeTokens:
    @servicios
    def test_sin_token_responde_401(self, servicio):
        assert SERVICIOS[servicio](None).status_code == 401

    @servicios
    def test_token_basura_responde_401(self, servicio):
        assert SERVICIOS[servicio]("basura").status_code == 401

    @servicios
    def test_firma_ajena_responde_401(self, servicio):
        assert SERVICIOS[servicio](token_falsificado()).status_code == 401

    @servicios
    def test_algoritmo_none_responde_401(self, servicio):
        assert SERVICIOS[servicio](token_falsificado(alg="none")).status_code == 401

    @servicios
    def test_token_de_otro_cliente_sin_audiencia_responde_401(self, servicio):
        # admin-cli es un cliente real de Keycloak, pero no tiene la audiencia salon-api
        response = httpx.post(
            "http://localhost:8080/realms/master/protocol/openid-connect/token",
            data={"grant_type": "password", "client_id": "admin-cli", "username": "admin", "password": "admin_secret_pass"},
        )
        assert response.status_code == 200
        assert SERVICIOS[servicio](response.json()["access_token"]).status_code == 401


class TestAccesoValido:
    @servicios
    def test_admin_es_aceptado(self, servicio):
        response = SERVICIOS[servicio](login(ADMIN))
        assert response.status_code == 200
        assert "errors" not in response.json()

    def test_token_contiene_identidad_y_sesion(self):
        claims = claims_of(login(CLIENT))
        assert claims["salon_id"] == "cli-001"
        assert claims["sid"]
        assert claims["auth_time"] > 0
        assert "CLIENT" in claims["realm_access"]["roles"]
        assert "salon-api" in claims["aud"]

    def test_agente_de_servicio_usa_mcp(self):
        response = httpx.post(f"{KEYCLOAK}/token", data={
            "grant_type": "client_credentials", "client_id": "salon-agent", "client_secret": "salon-agent-secret-local",
        })
        assert response.status_code == 200
        result = rpc("tools/call", {"name": "obtener_metricas_negocio", "arguments": {}}, response.json()["access_token"])
        assert result.status_code == 200


class TestAutorizacionPorRol:
    def test_cliente_recibe_403_en_crm(self):
        assert SERVICIOS["ms-crm"](login(CLIENT)).status_code == 403

    def test_estilista_lee_clientes_en_crm(self):
        assert SERVICIOS["ms-crm"](login(STYLIST)).status_code == 200

    def test_cliente_recibe_403_en_metricas_mcp(self):
        response = rpc("tools/call", {"name": "obtener_metricas_negocio", "arguments": {}}, login(CLIENT))
        assert response.status_code == 403

    def test_cliente_no_puede_leer_inventario(self):
        # GraphQL sobre HTTP informa los errores de autorización dentro de la respuesta
        body = gql("{getAllInventory{id}}", login(CLIENT)).json()
        assert body["errors"][0]["extensions"]["classification"] == "FORBIDDEN"

    def test_estilista_no_puede_modificar_inventario(self):
        body = gql('mutation{updateStock(input:{id:"inv-001",quantityChange:1,reason:"x"}){id}}', login(STYLIST)).json()
        assert body["errors"][0]["extensions"]["classification"] == "FORBIDDEN"


class TestPropiedadDeDatos:
    def test_cliente_lee_sus_citas_pero_no_las_de_otro(self):
        token = login(CLIENT)
        propias = gql('{getAppointmentsByClient(clientId:"cli-001"){id}}', token).json()
        ajenas = gql('{getAppointmentsByClient(clientId:"cli-002"){id}}', token).json()
        assert "errors" not in propias
        assert ajenas["errors"][0]["extensions"]["classification"] == "FORBIDDEN"

    def test_cliente_no_agenda_a_nombre_de_otro(self):
        body = gql(
            'mutation{scheduleAppointment(input:{clientId:"cli-002",stylistId:"x",serviceName:"x",'
            'appointmentDate:"2030-01-01T10:00:00",durationMinutes:30,totalPrice:1}){id}}',
            login(CLIENT),
        ).json()
        assert body["errors"][0]["extensions"]["classification"] == "FORBIDDEN"

    def test_cliente_no_lee_closet_de_otro(self):
        token = login(CLIENT)
        assert httpx.get(f"{ASESORIA}/closet/client/cli-001", headers=auth(token)).status_code == 200
        assert httpx.get(f"{ASESORIA}/closet/client/cli-002", headers=auth(token)).status_code == 403

    def test_la_identidad_sale_del_token_y_no_del_cuerpo(self):
        token = login(CLIENT)
        creado = httpx.post(f"{ASESORIA}/closet", headers=auth(token), json={
            "clientId": "cli-002", "name": "Prueba seguridad", "category": "TOP",
            "color": "Negro", "season": "ALL_SEASON", "imageUrl": "http://x/y.jpg",
        })
        assert creado.status_code == 201
        assert creado.json()["clientId"] == "cli-001"
        borrado = httpx.delete(f"{ASESORIA}/closet/{creado.json()['id']}", headers=auth(token))
        assert borrado.json() == {"success": True}


class TestSesionUnica:
    @servicios
    def test_login_nuevo_de_admin_desplaza_al_anterior(self, servicio):
        anterior = login(ADMIN)
        assert SERVICIOS[servicio](anterior).status_code == 200

        time.sleep(1.2)  # auth_time tiene resolución de un segundo
        nuevo = login(ADMIN)
        assert SERVICIOS[servicio](nuevo).status_code == 200
        assert SERVICIOS[servicio](anterior).status_code == 401

    def test_un_servicio_rechaza_lo_que_otro_ya_desplazo(self):
        anterior = login(ADMIN)
        assert SERVICIOS["ms-crm"](anterior).status_code == 200
        time.sleep(1.2)
        nuevo = login(ADMIN)
        # El nuevo login se registra en un servicio y los demás rechazan el anterior
        assert SERVICIOS["ms-ia"](nuevo).status_code == 200
        for servicio in SERVICIOS:
            assert SERVICIOS[servicio](anterior).status_code == 401, servicio

    def test_cliente_puede_tener_varias_sesiones(self):
        primera = login(CLIENT)
        time.sleep(1.2)
        segunda = login(CLIENT)
        assert SERVICIOS["ms-asesoria"](primera).status_code == 200
        assert SERVICIOS["ms-asesoria"](segunda).status_code == 200


class TestCierreDeSesion:
    def test_logout_invalida_el_token_en_todos_los_servicios(self):
        time.sleep(1.2)
        token = login(ADMIN)
        for servicio in SERVICIOS:
            assert SERVICIOS[servicio](token).status_code == 200, servicio

        assert httpx.post(f"{ASESORIA}/auth/logout", headers=auth(token)).status_code == 200

        for servicio in SERVICIOS:
            assert SERVICIOS[servicio](token).status_code == 401, servicio

    def test_logout_de_un_cliente_no_afecta_su_otra_sesion(self):
        primera = login(CLIENT)
        time.sleep(1.2)
        segunda = login(CLIENT)
        httpx.post(f"{ASESORIA}/auth/logout", headers=auth(primera))
        assert SERVICIOS["ms-asesoria"](primera).status_code == 401
        assert SERVICIOS["ms-asesoria"](segunda).status_code == 200

    def test_auth_me_devuelve_la_identidad(self):
        body = httpx.get(f"{ASESORIA}/auth/me", headers=auth(login(CLIENT))).json()
        assert body["id"] == "cli-001"
        assert "CLIENT" in body["roles"]


class TestIdempotenciaAutenticada:
    def _crear(self, token, llave, nombre):
        return httpx.post(
            f"{ASESORIA}/closet",
            headers={**auth(token), "Idempotency-Key": llave},
            json={"name": nombre, "category": "TOP", "color": "Negro", "season": "ALL_SEASON", "imageUrl": "http://x/y.jpg"},
        )

    def test_reintento_no_duplica_y_contenido_distinto_responde_422(self):
        token = login(CLIENT)
        llave = f"prueba-{uuid.uuid4()}"
        original = self._crear(token, llave, "Prueba idempotencia")
        assert original.status_code == 201

        for _ in range(20):
            reintento = self._crear(token, llave, "Prueba idempotencia")
            if reintento.status_code != 409:
                break
            time.sleep(0.1)
        assert reintento.json()["id"] == original.json()["id"]
        assert reintento.headers["X-Idempotent-Replay"] == "true"

        assert self._crear(token, llave, "Otro contenido").status_code == 422
        httpx.delete(f"{ASESORIA}/closet/{original.json()['id']}", headers=auth(token))

    def test_otro_usuario_no_lee_la_respuesta_guardada(self):
        token = login(CLIENT)
        llave = f"prueba-{uuid.uuid4()}"
        original = self._crear(token, llave, "Privada")
        otro = self._crear(login(("alejandro.morales", "Cliente#2026")), llave, "Privada")
        assert otro.json()["clientId"] == "cli-002"
        assert otro.json()["id"] != original.json()["id"]
        httpx.delete(f"{ASESORIA}/closet/{original.json()['id']}", headers=auth(token))
        httpx.delete(f"{ASESORIA}/closet/{otro.json()['id']}", headers=auth(login(("alejandro.morales", "Cliente#2026"))))
