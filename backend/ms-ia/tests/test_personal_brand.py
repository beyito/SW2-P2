from fastapi.testclient import TestClient

from app.adapters import gemini
from app.core.config import settings
from app.main import app
from app.services.biometrics_service import PALETTES
from app.services.brand_service import match_closet

client = TestClient(app)
URL = "/api/v1/brand/strategy"
DIAGNOSTICO = {"faceShape": "OVAL", "hairType": "CURLY", "hairTone": "DARK", "skinUndertone": "COOL"}


def estrategia(red="LINKEDIN", **extra):
    return client.post(URL, json={"platform": red, **extra})


def test_sin_diagnostico_responde_sin_personalizar(plataforma):
    body = estrategia().json()
    assert body["personalized"] is False
    assert body["color_palette"] == PALETTES["NEUTRAL"]


def test_con_diagnostico_usa_el_perfil_real(plataforma):
    plataforma.diagnosis = DIAGNOSTICO
    body = estrategia().json()
    assert body["personalized"] is True
    assert body["color_palette"] == PALETTES["COOL"]
    assert body["recommended_color"] in ("Matiz chocolate frío", "Balayage cenizo y perla")


def test_cambiar_el_perfil_cambia_el_consejo(plataforma):
    plataforma.diagnosis = DIAGNOSTICO
    rizado = estrategia().json()
    plataforma.diagnosis = {**DIAGNOSTICO, "hairType": "STRAIGHT", "skinUndertone": "WARM", "hairTone": "MEDIUM"}
    liso = estrategia().json()
    assert rizado["color_palette"] != liso["color_palette"]
    assert rizado["recommended_color"] != liso["recommended_color"]


def test_cada_red_da_consejos_distintos(plataforma):
    plataforma.diagnosis = DIAGNOSTICO
    redes = [estrategia(red).json() for red in ("LINKEDIN", "INSTAGRAM", "TIKTOK", "FACEBOOK")]
    assert len({r["tone"] for r in redes}) == 4
    assert len({r["lighting_tip"] for r in redes}) == 4
    assert len({r["recommended_look"] for r in redes}) >= 2


def test_el_look_respeta_el_genero_del_perfil(plataforma):
    plataforma.diagnosis = DIAGNOSTICO
    hombre = estrategia(gender="MALE").json()["recommended_look"]
    mujer = estrategia(gender="FEMALE").json()["recommended_look"]
    assert hombre != mujer


def test_red_desconocida_da_422(plataforma):
    assert estrategia("MYSPACE").status_code == 422


def test_textos_demasiado_largos_dan_422(plataforma):
    assert estrategia(goal="x" * 201).status_code == 422
    assert estrategia(sector="x" * 81).status_code == 422


def test_incluye_las_prendas_del_closet_que_combinan(plataforma):
    plataforma.diagnosis = DIAGNOSTICO
    plataforma.items = [
        {"id": "1", "name": "Blazer", "color": "Azul marino", "category": "OUTERWEAR"},
        {"id": "2", "name": "Polera", "color": "Mostaza", "category": "TOP"},
    ]
    assert [p["id"] for p in estrategia().json()["closet_matches"]] == ["1"]


def test_el_color_se_compara_sin_mayusculas_ni_tildes():
    prendas = [{"id": "1", "name": "A", "color": "CHOCOLATE FRIO", "category": "TOP"},
               {"id": "2", "name": "B", "color": "azul", "category": "TOP"},
               {"id": "3", "name": "C", "color": "", "category": "TOP"}]
    assert [p["id"] for p in match_closet(prendas, PALETTES["COOL"])] == ["1", "2"]


def test_sin_gemini_usa_plantilla_con_lo_que_escribio_el_cliente(plataforma, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    body = estrategia(goal="Conseguir clientes", sector="diseño").json()
    assert body["generated_by"].startswith("Plantilla")
    assert "diseño" in body["bio"] and "Conseguir clientes" in body["bio"]
    assert len(body["content_ideas"]) == 3


class RespuestaGemini:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body


def _texto(texto):
    return {"candidates": [{"content": {"parts": [{"text": texto}]}}]}


def test_con_gemini_usa_su_texto_y_no_envia_rasgos_ni_identidad(plataforma, monkeypatch):
    enviado = {}

    def falso_post(url, headers, json, timeout):
        enviado["texto"] = json["contents"][0]["parts"][0]["text"]
        return RespuestaGemini(200, _texto('{"bio": "Bio real", "content_ideas": ["a", "b", "c", "d"]}'))

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave")
    monkeypatch.setattr(gemini.httpx, "post", falso_post)
    plataforma.diagnosis = DIAGNOSTICO
    body = estrategia(goal="Mi objetivo", gender="MALE", age_range="18_29").json()
    assert body["bio"] == "Bio real"
    assert body["content_ideas"] == ["a", "b", "c"]
    assert body["generated_by"].startswith("Google")
    assert "Mi objetivo" in enviado["texto"]
    for dato_personal in ("Camila", "cli-001", "faceShape", "OVAL", "CURLY", "skinUndertone", "MALE", "18_29"):
        assert dato_personal not in enviado["texto"]


def test_si_gemini_falla_usa_la_plantilla(plataforma, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave")
    monkeypatch.setattr(gemini.httpx, "post", lambda *a, **k: RespuestaGemini(500, {}))
    assert estrategia().json()["generated_by"].startswith("Plantilla")


def test_si_gemini_responde_algo_invalido_usa_la_plantilla(plataforma, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave")
    monkeypatch.setattr(gemini.httpx, "post", lambda *a, **k: RespuestaGemini(200, _texto("no es json")))
    assert estrategia().json()["generated_by"].startswith("Plantilla")
