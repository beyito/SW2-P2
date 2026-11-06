"""Pruebas de autenticación y control de sesiones (RF-01, CU-01, CU-02)."""
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.core import security
from app.core.config import settings
from app.main import app

client = TestClient(app)
LLAVE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTRA_LLAVE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ENDPOINT = "/api/v1/recommendations/styles"


class RegistroFalso:
    def __init__(self):
        self.revocadas = set()
        self.activa = None
        self.reclamos = []

    def is_revoked(self, session_id):
        return session_id in self.revocadas

    def find_active(self, user_id):
        return self.activa

    def claim_active(self, user_id, session_id, auth_time):
        self.reclamos.append(session_id)
        return True


def token(llave=LLAVE, rol="CLIENT", sid="s1", auth_time=100, **cambios):
    claims = {
        "sub": "usuario-1",
        "iss": settings.KEYCLOAK_ISSUER,
        "aud": settings.KEYCLOAK_AUDIENCE,
        "exp": int(time.time()) + 300,
        "sid": sid,
        "auth_time": auth_time,
        "realm_access": {"roles": [rol]},
        **cambios,
    }
    return jwt.encode(claims, llave, algorithm="RS256")


def peticion(valor):
    return client.post(ENDPOINT, json={"face_shape": "OVAL"}, headers={"Authorization": f"Bearer {valor}"})


@pytest.fixture(autouse=True)
def seguridad_real(monkeypatch, usuario_autenticado):
    """Retira la identidad simulada y usa la llave pública local en lugar del JWKS."""
    app.dependency_overrides.clear()
    registro = RegistroFalso()
    monkeypatch.setattr(security, "_session_registry", registro)
    monkeypatch.setattr(
        security,
        "_jwks_client",
        SimpleNamespace(get_signing_key_from_jwt=lambda _: SimpleNamespace(key=LLAVE.public_key())),
    )
    return registro


def test_health_es_publico():
    assert client.get("/health").status_code == 200


def test_sin_token_responde_401():
    response = client.post(ENDPOINT, json={})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "TOKEN_MISSING"


def test_token_valido_es_aceptado():
    assert peticion(token()).status_code == 200


@pytest.mark.parametrize("cambios", [
    {"llave": OTRA_LLAVE},
    {"iss": "http://atacante/realms/salon"},
    {"aud": "otra-api"},
    {"exp": 1000},
])
def test_token_manipulado_responde_401(cambios):
    response = peticion(token(**cambios))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "TOKEN_INVALID"


def test_algoritmo_none_es_rechazado():
    sin_firma = jwt.encode(
        {"sub": "x", "iss": settings.KEYCLOAK_ISSUER, "aud": settings.KEYCLOAK_AUDIENCE, "exp": 9999999999},
        None,
        algorithm="none",
    )
    assert peticion(sin_firma).status_code == 401


def test_sesion_cerrada_responde_401(seguridad_real):
    seguridad_real.revocadas.add("s1")
    response = peticion(token())
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "SESSION_CLOSED"


def test_cliente_no_esta_sujeto_a_sesion_unica(seguridad_real):
    seguridad_real.activa = ("otra", 999)
    assert peticion(token()).status_code == 200
    assert seguridad_real.reclamos == []


def test_login_admin_mas_reciente_reclama_la_sesion(seguridad_real):
    seguridad_real.activa = ("s1", 100)
    assert peticion(token(rol="ADMIN", sid="s2", auth_time=200)).status_code == 200
    assert seguridad_real.reclamos == ["s2"]


def test_sesion_admin_desplazada_responde_401(seguridad_real):
    seguridad_real.activa = ("s2", 200)
    response = peticion(token(rol="ADMIN", sid="s1", auth_time=100))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "SESSION_SUPERSEDED"


def test_fallo_del_registro_rechaza_el_acceso(seguridad_real, monkeypatch):
    def caido(_):
        raise RuntimeError("DynamoDB caído")

    monkeypatch.setattr(seguridad_real, "is_revoked", caido)
    response = peticion(token())
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "SESSION_UNAVAILABLE"
