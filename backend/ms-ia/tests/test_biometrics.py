"""Diagnóstico con modelos reales e imágenes y videos reales; solo se sustituye el acceso a los demás servicios."""
import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.biometrics_service import PALETTES, BiometricsService
from app.vision.errors import BiometricRejection, UnsupportedMedia
from app.vision.face import SHAPE_CENTROIDS, classify_shape, classify_undertone, head_angles
from app.vision.hair import CROP_SIZE, HAIR_TYPES, classify_crop, hair_crop, read_hair, segmenter
from app.vision.media import detect_kind
from tests.conftest import jpeg, png, video

client = TestClient(app)
URL = "/api/v1/biometrics/scan"


def escanear(contenido, nombre="foto.jpg"):
    return client.post(URL, files={"file": (nombre, contenido, "application/octet-stream")})


def sin_rostro():
    gradient = np.tile(np.linspace(0, 255, 400, dtype=np.uint8)[:, None], (1, 400))
    return cv2.cvtColor(gradient, cv2.COLOR_GRAY2BGR)


def codigo(response):
    return response.json()["detail"]["code"]


class TestFotoReal:
    def test_analiza_un_rostro_y_devuelve_atributos_derivados(self, plataforma, retrato):
        response = escanear(jpeg(retrato))
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["source"] == "IMAGE"
        assert body["faceShape"] in SHAPE_CENTROIDS
        assert 0 < body["faceShapeConfidence"] <= 0.95
        assert body["skinUndertone"] in PALETTES
        assert body["recommendedPalette"] == PALETTES[body["skinUndertone"]]
        assert body["framesAnalyzed"] == 1

    def test_detecta_el_cabello_de_la_foto(self, plataforma, retrato):
        body = escanear(png(retrato)).json()
        assert body["hairType"] in ("STRAIGHT", "WAVY", "CURLY")
        assert 0 < body["hairTypeConfidence"] <= 1
        assert body["hairTone"] in ("DARK", "MEDIUM", "LIGHT")

    def test_solo_se_guardan_atributos_ni_pixeles_ni_puntos(self, plataforma, retrato):
        escanear(jpeg(retrato))
        assert set(plataforma.saved[0]) == {
            "source", "faceShape", "faceShapeConfidence", "skinUndertone", "undertoneConfidence",
            "recommendedPalette", "hairType", "hairTypeConfidence", "hairTone", "framesAnalyzed", "method",
        }

    def test_una_foto_en_mejor_o_peor_formato_no_cambia_la_forma(self, plataforma, retrato):
        assert escanear(png(retrato)).json()["faceShape"] == escanear(jpeg(retrato)).json()["faceShape"]

    def test_acepta_webp(self, plataforma, retrato):
        contenido = cv2.imencode(".webp", retrato)[1].tobytes()
        assert escanear(contenido).status_code == 201

    def test_el_subtono_cambia_con_el_color_real_de_la_piel(self, plataforma, retrato):
        """Demuestra que el resultado sale de los píxeles: virar la foto hacia el azul lo cambia."""
        original = escanear(jpeg(retrato)).json()["skinUndertone"]
        lab = cv2.cvtColor(retrato, cv2.COLOR_BGR2LAB).astype(np.int16)
        lab[:, :, 2] -= 25
        fria = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
        assert escanear(jpeg(fria)).json()["skinUndertone"] == "COOL"
        assert original != "COOL"


class TestRechazos:
    def test_imagen_sin_rostro_da_422_y_no_guarda_nada(self, plataforma):
        response = escanear(jpeg(sin_rostro()))
        assert response.status_code == 422
        assert codigo(response) == "NO_FACE"
        assert plataforma.saved == []

    def test_ruido_da_422(self, plataforma):
        ruido = np.random.default_rng(1).integers(0, 255, (400, 400, 3), dtype=np.uint8)
        assert escanear(jpeg(ruido)).status_code == 422

    def test_dos_rostros_da_422(self, plataforma, retrato):
        response = escanear(jpeg(np.hstack([retrato, retrato])))
        assert response.status_code == 422
        assert codigo(response) == "MULTIPLE_FACES"

    def test_rostro_demasiado_pequeno(self, plataforma, retrato):
        pequeno = cv2.resize(retrato, None, fx=0.35, fy=0.35, interpolation=cv2.INTER_AREA)
        response = escanear(jpeg(pequeno))
        assert response.status_code == 422
        assert codigo(response) in ("FACE_TOO_SMALL", "NO_FACE")

    def test_imagen_borrosa(self, plataforma, retrato):
        response = escanear(jpeg(cv2.GaussianBlur(retrato, (0, 0), 3)))
        assert response.status_code == 422
        assert codigo(response) == "TOO_BLURRY"

    def test_imagen_oscura(self, plataforma, retrato):
        response = escanear(jpeg((retrato * 0.15).astype(np.uint8)))
        assert response.status_code == 422
        assert codigo(response) in ("BAD_LIGHTING", "NO_FACE")

    def test_archivo_que_no_es_imagen_da_415(self, plataforma):
        response = escanear(b"esto no es una imagen, aunque se llame foto.jpg")
        assert response.status_code == 415
        assert codigo(response) == "UNSUPPORTED_MEDIA"

    def test_jpeg_danado_da_422(self, plataforma):
        response = escanear(b"\xff\xd8\xff" + b"\x00" * 200)
        assert response.status_code == 422
        assert codigo(response) == "INVALID_IMAGE"

    def test_archivo_vacio_da_422(self, plataforma):
        assert escanear(b"").status_code in (400, 422)

    def test_sin_archivo_da_422(self, plataforma):
        assert client.post(URL).status_code == 422

    def test_imagen_gigante_comprimida_no_agota_la_memoria(self, plataforma):
        enorme = np.zeros((9000, 9000, 3), dtype=np.uint8)
        assert escanear(png(enorme)).status_code == 422

    def test_archivo_mayor_al_limite_da_413(self, plataforma, monkeypatch):
        from app.core.config import settings
        monkeypatch.setattr(settings, "MAX_SCAN_BYTES", 10)
        response = escanear(b"\xff\xd8\xff" + b"0" * 100)
        assert response.status_code == 413


class TestConsentimiento:
    def test_sin_consentimiento_no_analiza_ni_guarda(self, plataforma, retrato, monkeypatch):
        plataforma.consent = False

        def no_debe_llamarse(_):
            raise AssertionError("Se analizó sin consentimiento")

        monkeypatch.setattr(BiometricsService, "analyze", no_debe_llamarse)
        response = escanear(jpeg(retrato))
        assert response.status_code == 403
        assert codigo(response) == "CONSENT_REQUIRED"
        assert plataforma.saved == []


class TestVideo:
    def test_video_de_cuatro_segundos(self, plataforma, retrato, tmp_path):
        response = escanear(video([retrato], 4, tmp_path), "video.mp4")
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["source"] == "VIDEO"
        assert body["framesAnalyzed"] >= 6

    def test_el_diagnostico_del_video_coincide_con_el_de_la_foto(self, plataforma, retrato, tmp_path):
        foto = escanear(jpeg(retrato)).json()
        grabado = escanear(video([retrato], 4, tmp_path), "video.mp4").json()
        assert grabado["faceShape"] == foto["faceShape"]

    @pytest.mark.parametrize("segundos", [1, 10])
    def test_duracion_fuera_de_rango_da_422(self, plataforma, retrato, tmp_path, segundos):
        response = escanear(video([retrato], segundos, tmp_path), "video.mp4")
        assert response.status_code == 422
        assert codigo(response) == "VIDEO_DURATION"

    def test_video_sin_rostro_da_422(self, plataforma, tmp_path):
        response = escanear(video([sin_rostro()], 4, tmp_path), "video.mp4")
        assert response.status_code == 422
        assert codigo(response) == "NO_FACE"

    def test_un_instante_sin_rostro_no_invalida_el_video(self, plataforma, retrato, tmp_path):
        vacio = np.full_like(retrato, 128)
        fotogramas = [retrato] * 30 + [vacio] * 5
        response = escanear(video(fotogramas, 3.5, tmp_path), "video.mp4")
        assert response.status_code == 201, response.text

    def test_video_con_dos_personas_da_422(self, plataforma, retrato, tmp_path):
        response = escanear(video([np.hstack([retrato, retrato])], 4, tmp_path), "video.mp4")
        assert response.status_code == 422
        assert codigo(response) == "MULTIPLE_FACES"

    def test_video_danado_da_422(self, plataforma):
        response = escanear(b"\x1a\x45\xdf\xa3" + b"\x00" * 500, "video.webm")
        assert response.status_code == 422
        assert codigo(response) == "INVALID_VIDEO"


class TestClasificadores:
    @pytest.mark.parametrize("forma", list(SHAPE_CENTROIDS))
    def test_cada_centroide_da_su_forma(self, forma):
        assert classify_shape(*SHAPE_CENTROIDS[forma])[0] == forma

    def test_la_confianza_baja_entre_dos_formas(self):
        centro = classify_shape(*SHAPE_CENTROIDS["OBLONG"])[1]
        oval, oblongo = SHAPE_CENTROIDS["OVAL"], SHAPE_CENTROIDS["OBLONG"]
        entre = classify_shape(*[(a + b) / 2 for a, b in zip(oval, oblongo)])[1]
        assert entre < centro

    def test_un_rostro_fuera_de_rango_no_rompe_el_calculo(self):
        assert classify_shape(9.0, 9.0, 9.0)[0] in SHAPE_CENTROIDS

    @pytest.mark.parametrize("angulo,esperado", [(20, "COOL"), (54, "NEUTRAL"), (80, "WARM")])
    def test_subtono_por_angulo(self, angulo, esperado):
        assert classify_undertone(angulo)[0] == esperado

    def test_confianza_del_subtono_baja_cerca_del_limite(self):
        assert classify_undertone(46)[1] < classify_undertone(54)[1]

    def test_angulos_de_la_cabeza(self):
        identidad = np.eye(4)
        assert head_angles(identidad) == pytest.approx((0, 0))
        giro = np.radians(30)
        matriz = np.eye(4)
        matriz[0, 0], matriz[0, 2], matriz[2, 0], matriz[2, 2] = np.cos(giro), np.sin(giro), -np.sin(giro), np.cos(giro)
        assert head_angles(matriz)[0] == pytest.approx(30)


class TestCabello:
    def test_el_segmentador_encuentra_el_cabello_real(self, retrato):
        mascara = segmenter.segment(retrato)
        assert mascara.shape == retrato.shape[:2]
        # En la foto, el cabello está sobre la frente y no en la parte inferior
        filas = np.nonzero(mascara.any(axis=1))[0]
        assert filas.min() < retrato.shape[0] * 0.2
        assert filas.max() < retrato.shape[0] * 0.6

    def test_la_red_clasifica_el_cabello_ondulado_de_la_foto(self, retrato):
        lectura = read_hair(retrato, 90)
        assert lectura.hair_type == "WAVY"
        assert 0 < lectura.confidence <= 1

    def test_el_recorte_solo_conserva_el_cabello(self, retrato):
        mascara = np.zeros(retrato.shape[:2], dtype=bool)
        mascara[20:60, 80:180] = True
        recorte = hair_crop(retrato, mascara)
        assert recorte.shape == (CROP_SIZE, CROP_SIZE, 3)
        assert (recorte[0, 0] == 128).all()

    def test_la_red_devuelve_probabilidades(self, retrato):
        mascara = segmenter.segment(retrato)
        tipo, confianza = classify_crop(hair_crop(retrato, mascara))
        assert tipo in HAIR_TYPES
        assert 1 / 3 <= confianza <= 1

    def test_el_tono_refleja_el_color_real(self, retrato):
        clara = np.clip(retrato.astype(np.int16) + 90, 0, 255).astype(np.uint8)
        oscura = (retrato * 0.45).astype(np.uint8)
        assert read_hair(clara, 90).tone == "LIGHT"
        assert read_hair(oscura, 90).tone == "DARK"

    def test_sin_cabello_visible_no_inventa_un_tipo(self, retrato, monkeypatch):
        from app.vision import hair
        monkeypatch.setattr(hair.segmenter, "segment", lambda _: np.zeros(retrato.shape[:2], dtype=bool))
        assert read_hair(retrato, 90) is None

    def test_diagnostico_sin_cabello_visible(self, plataforma, retrato, monkeypatch):
        from app.vision import hair
        monkeypatch.setattr(hair.segmenter, "segment", lambda image: np.zeros(image.shape[:2], dtype=bool))
        body = escanear(jpeg(retrato)).json()
        assert body["hairType"] is None and body["hairTypeConfidence"] is None and body["hairTone"] is None

    def test_la_exactitud_medida_supera_el_azar_con_margen(self):
        """El modelo versionado debe venir con su medición sobre fotos que no vio al entrenar."""
        metricas = json.loads((Path(__file__).parents[1] / "training" / "hair_type_metrics.json").read_text("utf-8"))
        real = metricas["with_production_segmenter"]
        assert real["images"] >= 100
        assert real["accuracy"] >= 0.6


class TestTipoDeArchivo:
    @pytest.mark.parametrize("contenido,esperado", [
        (b"\xff\xd8\xff\xe0", "IMAGE"),
        (b"\x89PNG\r\n\x1a\n", "IMAGE"),
        (b"RIFF\x00\x00\x00\x00WEBP", "IMAGE"),
        (b"\x1a\x45\xdf\xa3", "VIDEO"),
        (b"\x00\x00\x00\x18ftypmp42", "VIDEO"),
    ])
    def test_reconoce_por_el_contenido(self, contenido, esperado):
        assert detect_kind(contenido) == esperado

    @pytest.mark.parametrize("contenido", [b"\x00\x00\x00\x18ftypheic", b"GIF89a", b"%PDF-1.7", b"<svg></svg>"])
    def test_rechaza_lo_demas(self, contenido):
        with pytest.raises(UnsupportedMedia):
            detect_kind(contenido)
