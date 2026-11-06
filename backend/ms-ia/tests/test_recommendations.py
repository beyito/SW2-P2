from fastapi.testclient import TestClient

from app.main import app
from app.services.recommendation_service import CATALOG, COLOR, CUT, TREATMENT, RecommendationService

client = TestClient(app)
URL = "/api/v1/recommendations/styles"


def recomendar(genero=None, **atributos):
    return RecommendationService.recommend(atributos, gender=genero)


def nombres(resultado, categoria):
    return [estilo["style_id"] for estilo in resultado if estilo["category"] == categoria]


def test_devuelve_cortes_color_y_tratamiento():
    resultado = recomendar(face="OVAL", hair="WAVY", undertone="WARM")
    assert len(nombres(resultado, CUT)) == 3
    assert len(nombres(resultado, COLOR)) == 2
    assert len(nombres(resultado, TREATMENT)) == 1


def test_el_cabello_rizado_recibe_estilos_para_rizo():
    resultado = recomendar("FEMALE", hair="CURLY", face="OVAL")
    assert nombres(resultado, CUT)[0] in ("cut-rizos", "cut-shag")
    assert nombres(resultado, TREATMENT) == ["trat-keratina"]


def test_el_cabello_liso_recibe_su_tratamiento():
    assert nombres(recomendar(hair="STRAIGHT"), TREATMENT) == ["trat-brillo"]


def test_el_subtono_cambia_el_color_recomendado():
    calido = nombres(recomendar("FEMALE", undertone="WARM", tone="DARK"), COLOR)[0]
    frio = nombres(recomendar("FEMALE", undertone="COOL", tone="DARK"), COLOR)[0]
    assert calido == "color-miel"
    assert frio == "color-espresso"


def test_las_preferencias_cambian_el_resultado():
    corto = nombres(recomendar("FEMALE", face="OVAL", hair="STRAIGHT", length="SHORT", vibe="BOLD"), CUT)[0]
    largo = nombres(recomendar("FEMALE", face="OVAL", hair="STRAIGHT", length="LONG", vibe="NATURAL"), CUT)[0]
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
        genero = estilo.get("audience")
        assert estilo["id"] in nombres(recomendar(genero, **atributos), estilo["category"]), estilo["id"]


def publico(estilo_id):
    return next(e for e in CATALOG if e["id"] == estilo_id).get("audience")


def test_un_hombre_no_recibe_cortes_ni_color_de_mujer():
    for estilo in recomendar("MALE", face="OVAL", hair="STRAIGHT", undertone="WARM", tone="DARK", length="LONG"):
        assert publico(estilo["style_id"]) in ("MALE", None), estilo["style_id"]


def test_una_mujer_no_recibe_cortes_ni_color_de_hombre():
    for estilo in recomendar("FEMALE", face="OVAL", hair="STRAIGHT", undertone="WARM", tone="DARK", length="SHORT"):
        assert publico(estilo["style_id"]) in ("FEMALE", None), estilo["style_id"]


def test_hombre_y_mujer_con_los_mismos_rasgos_reciben_cortes_distintos():
    rasgos = {"face": "OVAL", "hair": "WAVY", "undertone": "WARM"}
    assert set(nombres(recomendar("MALE", **rasgos), CUT)) != set(nombres(recomendar("FEMALE", **rasgos), CUT))


def test_ambos_publicos_reciben_todas_las_categorias_completas():
    for genero in ("MALE", "FEMALE"):
        resultado = recomendar(genero, face="OVAL")
        assert len(nombres(resultado, CUT)) == 3
        assert len(nombres(resultado, COLOR)) == 2
        assert len(nombres(resultado, TREATMENT)) == 1


def test_sin_indicar_el_genero_no_se_filtra_el_catalogo():
    """Quien no responde, o responde no binario, ve estilos de todo el catálogo."""
    for genero in (None, "NON_BINARY", "UNDISCLOSED"):
        filtrados = RecommendationService.recommend({"length": "SHORT"}, gender=genero, limits={CUT: 20})
        publicos = {publico(e["style_id"]) for e in filtrados}
        assert {"MALE", "FEMALE"} <= publicos


def test_la_edad_orienta_la_recomendacion():
    joven = nombres(recomendar("MALE", hair="WAVY", age="18_29"), COLOR)[0]
    mayor = nombres(recomendar("MALE", hair="WAVY", age="60_PLUS"), COLOR)[0]
    assert joven == "color-reflejos-h"
    assert mayor == "color-canas"


def test_la_edad_se_explica_si_influyo():
    estilo = next(e for e in recomendar("MALE", age="60_PLUS", maintenance="LOW") if e["style_id"] == "color-canas")
    assert "tu rango de edad" in estilo["matched_factors"]


def test_un_estilo_sin_servicio_en_el_catalogo_no_ofrece_reservar():
    servicios = {"srv-01": {"id": "srv-01"}}
    resultado = RecommendationService.recommend({"age": "60_PLUS"}, services=servicios, gender="MALE")
    canas = next(e for e in resultado if e["style_id"] == "color-canas")
    assert canas["service"] is None


def test_endpoint_acepta_genero_y_edad(plataforma):
    response = client.post(URL, json={"gender": "MALE", "age_range": "30_44"})
    assert response.status_code == 200
    assert all(publico(e["style_id"]) in ("MALE", None) for e in response.json())


def test_endpoint_rechaza_genero_o_edad_desconocidos(plataforma):
    assert client.post(URL, json={"gender": "OTRO"}).status_code == 422
    assert client.post(URL, json={"age_range": "99"}).status_code == 422


def test_endpoint_une_los_estilos_al_catalogo_real(plataforma):
    response = client.post(URL, json={"face_shape": "OVAL", "hair_type": "WAVY"})
    assert response.status_code == 200
    cortes = [e for e in response.json() if e["category"] == CUT]
    assert cortes[0]["service"]["id"] == "srv-03"
    assert cortes[0]["service"]["price"] == 45.0


def test_si_el_servicio_no_esta_en_el_catalogo_no_ofrece_reservarlo(plataforma):
    plataforma.catalog = {}
    response = client.post(URL, json={"face_shape": "OVAL"})
    assert response.status_code == 200
    assert all(e["service"] is None for e in response.json())


def test_endpoint_rechaza_valores_desconocidos(plataforma):
    assert client.post(URL, json={"face_shape": "TRIANGLE"}).status_code == 422


def test_endpoint_exige_algun_atributo(plataforma):
    assert client.post(URL, json={}).status_code == 422
