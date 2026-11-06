"""Transcripción con el modelo Whisper real y una pregunta grabada en español."""
import io
import wave

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthenticatedUser, get_current_user
from app.main import app
from tests.conftest import FIXTURES

client = TestClient(app)
URL = "/api/v1/speech/transcribe"


def como(*roles):
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        subject="u", id="adm-1", name="Admin", roles=list(roles)
    )


def transcribir(contenido, nombre="audio.wav"):
    return client.post(URL, files={"file": (nombre, contenido, "application/octet-stream")})


def silencio(segundos=2):
    salida = io.BytesIO()
    with wave.open(salida, "wb") as archivo:
        archivo.setnchannels(1)
        archivo.setsampwidth(2)
        archivo.setframerate(16000)
        archivo.writeframes(b"\x00\x00" * 16000 * segundos)
    return salida.getvalue()


def test_transcribe_una_pregunta_real_en_espanol():
    como("ADMIN")
    response = transcribir((FIXTURES / "pregunta.wav").read_bytes())
    assert response.status_code == 200, response.text
    texto = response.json()["text"].lower()
    assert "ingresos" in texto and "salón" in texto and "insumos" in texto
    assert response.json()["duration_seconds"] > 3


@pytest.mark.parametrize("rol", ["CLIENT", "STYLIST"])
def test_solo_el_administrador_puede_usarla(rol):
    como(rol)
    assert transcribir((FIXTURES / "pregunta.wav").read_bytes()).status_code == 403


def test_silencio_da_422_sin_inventar_texto():
    como("ADMIN")
    response = transcribir(silencio())
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "NO_SPEECH"


def test_archivo_que_no_es_audio_da_415():
    como("ADMIN")
    assert transcribir(b"esto no es audio").status_code == 415


def test_audio_danado_da_422():
    como("ADMIN")
    response = transcribir(b"OggS" + b"\x00" * 300)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_AUDIO"


def test_audio_demasiado_largo_da_422():
    como("ADMIN")
    response = transcribir(silencio(61))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "AUDIO_TOO_LONG"


def test_audio_mayor_al_limite_da_413(monkeypatch):
    from app.core.config import settings
    como("ADMIN")
    monkeypatch.setattr(settings, "MAX_AUDIO_BYTES", 10)
    assert transcribir(silencio()).status_code == 413
