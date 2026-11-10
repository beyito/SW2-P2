"""Textos de marca personal con el modelo local (Ollama), con Gemini como respaldo."""
import json

import pytest
from fastapi.testclient import TestClient

from app.adapters import gemini, ollama
from app.core.config import settings
from app.main import app

client = TestClient(app)
URL = "/api/v1/brand/strategy"
DIAGNOSTICO = {"faceShape": "OVAL", "hairType": "CURLY", "hairTone": "DARK", "skinUndertone": "COOL"}


class Respuesta:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body


def ollama_responde(copia):
    return Respuesta(200, {"message": {"role": "assistant", "content": json.dumps(copia)}})


@pytest.fixture
def local(monkeypatch):
    monkeypatch.setattr(settings, "OLLAMA_URL", "http://ollama:11434")
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "qwen2.5:3b")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")


def test_el_modelo_local_escribe_la_bio_y_no_recibe_rasgos_ni_identidad(plataforma, local, monkeypatch):
    enviado = {}

    def falso_post(url, json, timeout, headers=None):
        enviado.update(url=url, cuerpo=json, cabeceras=headers)
        return ollama_responde({"bio": "Bio local", "content_ideas": ["a", "b", "c", "d"]})

    monkeypatch.setattr(ollama.httpx, "post", falso_post)
    plataforma.diagnosis = DIAGNOSTICO
    body = client.post(URL, json={"platform": "INSTAGRAM", "goal": "Mi objetivo", "gender": "MALE"}).json()

    assert body["bio"] == "Bio local"
    assert body["content_ideas"] == ["a", "b", "c"]
    assert body["generated_by"] == "Ollama qwen2.5:3b (local)"
    assert enviado["url"] == "http://ollama:11434/api/chat"
    # La salida se pide con un esquema JSON
    assert enviado["cuerpo"]["format"]["required"] == ["bio", "content_ideas"]
    texto = json.dumps(enviado["cuerpo"]["messages"], ensure_ascii=False)
    assert "Mi objetivo" in texto
    for dato_personal in ("Camila", "cli-001", "faceShape", "OVAL", "CURLY", "skinUndertone", "MALE"):
        assert dato_personal not in texto


def test_si_el_modelo_local_falla_usa_gemini(plataforma, local, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave")
    monkeypatch.setattr(ollama.httpx, "post", lambda *a, **k: Respuesta(500, {}))
    respuesta_gemini = {"candidates": [{"content": {"parts": [{"text": json.dumps({"bio": "Bio Gemini", "content_ideas": ["x"]})}]}}]}
    monkeypatch.setattr(gemini.httpx, "post", lambda *a, **k: Respuesta(200, respuesta_gemini))
    body = client.post(URL, json={"platform": "LINKEDIN"}).json()
    assert body["bio"] == "Bio Gemini"
    assert body["generated_by"].startswith("Google")


def test_si_ninguno_responde_usa_la_plantilla(plataforma, local, monkeypatch):
    monkeypatch.setattr(ollama.httpx, "post", lambda *a, **k: Respuesta(200, {"message": {"content": "no es JSON"}}))
    body = client.post(URL, json={"platform": "TIKTOK"}).json()
    assert body["bio"]
    assert body["generated_by"] == "Plantilla sin modelo de lenguaje"


def test_en_la_nube_envia_la_clave_del_proxy(local, monkeypatch):
    enviado = {}

    def falso_post(url, json, timeout, headers=None):
        enviado["cabeceras"] = headers
        return ollama_responde({"bio": "Bio", "content_ideas": ["a"]})

    monkeypatch.setattr(settings, "OLLAMA_API_KEY", "clave-del-proxy")
    monkeypatch.setattr(ollama.httpx, "post", falso_post)
    ollama.generate_brand_copy_local({"platform": "LINKEDIN"})
    assert enviado["cabeceras"] == {"Authorization": "Bearer clave-del-proxy"}


def test_una_bio_demasiado_larga_se_recorta(local, monkeypatch):
    monkeypatch.setattr(ollama.httpx, "post", lambda *a, **k: ollama_responde({"bio": "x" * 300, "content_ideas": ["a"]}))
    assert len(ollama.generate_brand_copy_local({"platform": "LINKEDIN"})["bio"]) == 160
