from fastapi.testclient import TestClient

from app.main import app
from app.services.recommendation_service import CATALOG, COLOR, CUT, TREATMENT, RecommendationService

client = TestClient(app)
URL = "/api/v1/recommendations/styles"


def recomendar(**atributos):
    return RecommendationService.recommend(atributos)


def nombres(resultado, categoria):
    return [estilo["style_id"] for estilo in resultado if estilo["category"] == categoria]


def test_devuelve_cortes_color_y_tratamiento():
    resultado = recomendar(face="OVAL", hair="WAVY", undertone="WARM")
    assert len(nombres(resultado, CUT)) == 3
    assert len(nombres(resultado, COLOR)) == 2
    assert len(nombres(resultado, TREATMENT)) == 1


def test_el_cabello_rizado_recibe_estilos_para_rizo():
    resultado = recomendar(hair="CURLY", face="OVAL")
    assert nombres(resultado, CUT)[0] in ("cut-rizos", "cut-shag")
    assert nombres(resultado, TREATMENT) == ["trat-keratina"]


def test_el_cabello_liso_recibe_su_tratamiento():
    assert nombres(recomendar(hair="STRAIGHT"), TREATMENT) == ["trat-brillo"]


def test_el_subtono_cambia_el_color_recomendado():
    calido = nombres(recomendar(undertone="WARM", tone="DARK"), COLOR)[0]
    frio = nombres(recomendar(undertone="COOL", tone="DARK"), COLOR)[0]
    assert calido == "color-miel"
    assert frio == "color-espresso"


def test_las_preferencias_cambian_el_resultado():
    corto = nombres(recomendar(face="OVAL", hair="STRAIGHT", length="SHORT", vibe="BOLD"), CUT)[0]
    largo = nombres(recomendar(face="OVAL", hair="STRAIGHT", length="LONG", vibe="NATURAL"), CUT)[0]
    assert corto == "cut-pixie"
    assert largo == "cut-capas"


def test_explica_que_coincidio_sin_inventar():
    estilo = next(e for e in recomendar(face="OVAL", hair="CURLY") if e["style_id"] == "cut-rizos")
    assert estilo["matched_factors"] == ["tu forma de rostro", "tu tipo de cabello"]
    pixie = next((e for e in recomendar(face="ROUND", hair="CURLY") if e["style_id"] == "cut-pixie"), None)
    assert pixie is None or pixie["matched_factors"] == []


def test_ordena_por_afinidad_dentro_de_cada_categoria():
    resultado = [e["match_score"] for e in recomendar(face="OVAL", hair="WAVY") if e["category"] == CUT]
    assert resultado == sorted(resultado, reverse=True)


def test_la_afinidad_no_es_una_constante():
    assert len({e["match_score"] for e in recomendar(face="OVAL", hair="WAVY", vibe="NATURAL")}) > 1


def test_todo_el_catalogo_es_alcanzable():
    """Ningún estilo queda muerto: quien tiene sus mismos atributos lo recibe entre los primeros de su categoría."""
    for estilo in CATALOG:
        atributos = {a: estilo[a][0] for a in ("face", "hair", "tone", "undertone", "length", "maintenance", "vibe") if a in estilo}
        assert estilo["id"] in nombres(recomendar(**atributos), estilo["category"]), estilo["id"]


def test_endpoint_une_los_estilos_al_catalogo_real(plataforma):
    response = client.post(URL, json={"face_shape": "OVAL", "hair_type": "WAVY"})
    assert response.status_code == 200
    cortes = [e for e in response.json() if e["category"] == CUT]
    assert cortes[0]["service"]["id"] == "srv-03"
    assert cortes[0]["service"]["price"] == 45.0


def test_si_el_servicio_no_esta_en_el_catalogo_no_ofrece_reservarlo(plataforma):
    plataforma.catalog = {}
    response = client.post(URL, json={"face_shape": "OVAL"})
    assert all(e["service"] is None for e in response.json())


def test_endpoint_rechaza_valores_desconocidos(plataforma):
    assert client.post(URL, json={"face_shape": "TRIANGLE"}).status_code == 422


def test_endpoint_exige_algun_atributo(plataforma):
    assert client.post(URL, json={}).status_code == 422
