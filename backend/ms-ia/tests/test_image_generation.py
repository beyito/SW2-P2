"""Generación de imágenes: el rostro se detecta con el modelo real; el proveedor externo se sustituye para no gastar crédito."""
import base64

import cv2
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.adapters.image_generator import GeneratedImage, ImageGenerationError, ReplicateImageGenerator, get_image_generator
from app.adapters.image_quota import get_image_quota
from app.core.config import settings
from app.core.errors import api_error
from app.main import app
from app.services.image_generation_service import SIMULATION_LABEL, encode_jpeg, output_size, reduce_to_one_megapixel
from app.services.recommendation_service import CATALOG, PREVIEWS, RecommendationService
from tests.conftest import jpeg

client = TestClient(app)
JPEG = b"\xff\xd8\xff\xe0resultado"
CORTE = "/api/v1/image-generation/haircut"
ROPA = "/api/v1/image-generation/try-on"
MEDIA = "/media/" + "a" * 32
PRENDA = {"id": "item-1", "category": "OUTERWEAR", "imageUrl": MEDIA}


class GeneradorFalso:
    def __init__(self):
        self.cortes = []
        self.pruebas = []
        self.error = None

    def _resultado(self):
        if self.error:
            raise self.error
        return GeneratedImage(JPEG, "image/jpeg")

    def haircut(self, photo, haircut, hair_color, gender):
        self.cortes.append({"photo": photo, "haircut": haircut, "hair_color": hair_color, "gender": gender})
        return self._resultado()

    def try_on(self, photo, garment, category, width, height):
        self.pruebas.append({"photo": photo, "garment": garment, "category": category, "width": width, "height": height})
        return self._resultado()


class CuotaFalsa:
    def __init__(self, cupo=5):
        self.cupo = cupo
        self.reservas = 0
        self.devueltas = 0

    def reserve(self, client_id):
        if self.reservas - self.devueltas >= self.cupo:
            raise api_error(429, "IMAGE_QUOTA_EXCEEDED", "Límite alcanzado.")
        self.reservas += 1
        return self.cupo - (self.reservas - self.devueltas)

    def release(self, client_id):
        self.devueltas += 1


@pytest.fixture
def generador():
    falso = GeneradorFalso()
    app.dependency_overrides[get_image_generator] = lambda: falso
    return falso


@pytest.fixture
def cuota():
    falsa = CuotaFalsa()
    app.dependency_overrides[get_image_quota] = lambda: falsa
    return falsa


@pytest.fixture
def con_clave(monkeypatch):
    monkeypatch.setattr(settings, "REPLICATE_API_KEY", "clave-de-prueba")


@pytest.fixture
def plataforma_ropa(plataforma, retrato):
    plataforma.image_consent = True
    plataforma.garments = {"item-1": (PRENDA, jpeg(prenda_de_prueba()))}
    return plataforma


def prenda_de_prueba():
    return np.full((400, 300, 3), (40, 90, 180), dtype=np.uint8)


def cuerpo_entero(retrato):
    """La persona ocupa una parte pequeña de un lienzo alto, como en una foto de cuerpo entero."""
    lienzo = np.full((1400, 900, 3), 200, dtype=np.uint8)
    lienzo[60:360, 320:580] = retrato
    return lienzo


def pedir_corte(foto, estilo="cut-undercut"):
    return client.post(CORTE, files={"file": ("foto.jpg", foto, "image/jpeg")}, data={"style_id": estilo})


def pedir_ropa(foto, prenda="item-1"):
    return client.post(ROPA, files={"file": ("foto.jpg", foto, "image/jpeg")}, data={"item_id": prenda})


def codigo(respuesta):
    return respuesta.json()["detail"]["code"]


@pytest.mark.usefixtures("con_clave")
class TestCorte:
    def test_genera_la_simulacion_y_la_etiqueta(self, plataforma_ropa, generador, cuota, retrato):
        respuesta = pedir_corte(jpeg(retrato))
        assert respuesta.status_code == 201, respuesta.text
        cuerpo = respuesta.json()
        assert base64.b64decode(cuerpo["image_base64"]) == JPEG
        assert cuerpo["media_type"] == "image/jpeg"
        assert cuerpo["label"] == SIMULATION_LABEL
        assert cuerpo["remaining_today"] == 4
        assert cuerpo["approximate"] is False
        assert respuesta.headers["cache-control"] == "no-store"

    def test_usa_la_equivalencia_del_catalogo_y_el_publico_del_estilo(self, plataforma_ropa, generador, cuota, retrato):
        pedir_corte(jpeg(retrato), "cut-undercut")
        assert generador.cortes[-1]["haircut"] == "Undercut" and generador.cortes[-1]["gender"] == "male"
        pedir_corte(jpeg(retrato), "cut-pixie")
        assert generador.cortes[-1]["haircut"] == "Pixie Cut" and generador.cortes[-1]["gender"] == "female"
        pedir_corte(jpeg(retrato), "cut-shag")
        assert generador.cortes[-1]["gender"] == "none"
        pedir_corte(jpeg(retrato), "color-cobre")
        assert generador.cortes[-1]["haircut"] == "No change" and generador.cortes[-1]["hair_color"] == "Copper"

    def test_avisa_cuando_el_resultado_es_aproximado(self, plataforma_ropa, generador, cuota, retrato):
        assert pedir_corte(jpeg(retrato), "cut-fade").json()["approximate"] is True

    def test_sin_autorizacion_no_envia_nada_ni_gasta_cupo(self, plataforma_ropa, generador, cuota, retrato):
        plataforma_ropa.image_consent = False
        respuesta = pedir_corte(jpeg(retrato))
        assert respuesta.status_code == 403 and codigo(respuesta) == "IMAGE_CONSENT_REQUIRED"
        assert generador.cortes == [] and cuota.reservas == 0

    def test_sin_clave_responde_que_no_esta_disponible(self, plataforma_ropa, generador, cuota, retrato, monkeypatch):
        monkeypatch.setattr(settings, "REPLICATE_API_KEY", "")
        respuesta = pedir_corte(jpeg(retrato))
        assert respuesta.status_code == 503 and codigo(respuesta) == "IMAGE_GENERATION_DISABLED"

    @pytest.mark.parametrize("estilo", ["trat-keratina", "color-canas", "no-existe"])
    def test_rechaza_estilos_que_no_se_pueden_simular(self, plataforma_ropa, generador, cuota, retrato, estilo):
        respuesta = pedir_corte(jpeg(retrato), estilo)
        assert respuesta.status_code == 422 and codigo(respuesta) == "STYLE_NOT_PREVIEWABLE"
        assert generador.cortes == [] and cuota.reservas == 0

    def test_sin_rostro_no_envia_la_foto_ni_gasta_cupo(self, plataforma_ropa, generador, cuota):
        respuesta = pedir_corte(jpeg(np.full((400, 400, 3), 128, dtype=np.uint8)))
        assert respuesta.status_code == 422 and codigo(respuesta) == "NO_FACE"
        assert generador.cortes == [] and cuota.reservas == 0

    def test_con_dos_personas_no_envia_la_foto(self, plataforma_ropa, generador, cuota, retrato):
        respuesta = pedir_corte(jpeg(np.hstack([retrato, retrato])))
        assert respuesta.status_code == 422 and codigo(respuesta) == "MULTIPLE_FACES"
        assert generador.cortes == []

    def test_rechaza_un_archivo_que_no_es_imagen(self, plataforma_ropa, generador, cuota):
        assert pedir_corte(b"esto no es una imagen").status_code == 415

    def test_cupo_agotado_no_llama_al_proveedor(self, plataforma_ropa, generador, cuota, retrato):
        cuota.cupo = 0
        respuesta = pedir_corte(jpeg(retrato))
        assert respuesta.status_code == 429 and codigo(respuesta) == "IMAGE_QUOTA_EXCEEDED"
        assert generador.cortes == []

    def test_si_el_proveedor_falla_devuelve_el_cupo(self, plataforma_ropa, generador, cuota, retrato):
        generador.error = ImageGenerationError(502, "IMAGE_GENERATION_FAILED", "Falló.")
        respuesta = pedir_corte(jpeg(retrato))
        assert respuesta.status_code == 502 and codigo(respuesta) == "IMAGE_GENERATION_FAILED"
        assert cuota.reservas == 1 and cuota.devueltas == 1

    def test_una_foto_grande_se_reduce_antes_de_enviarla(self, plataforma_ropa, generador, cuota, retrato):
        grande = cv2.resize(retrato, (retrato.shape[1] * 6, retrato.shape[0] * 6))
        assert pedir_corte(jpeg(grande)).status_code == 201
        enviada = cv2.imdecode(np.frombuffer(generador.cortes[0]["photo"], np.uint8), cv2.IMREAD_COLOR)
        assert enviada.shape[0] * enviada.shape[1] <= 1_000_000


@pytest.mark.usefixtures("con_clave")
class TestRopa:
    def test_prueba_una_prenda_propia_a_un_mega_pixel(self, plataforma_ropa, generador, cuota, retrato):
        respuesta = pedir_ropa(jpeg(cuerpo_entero(retrato)))
        assert respuesta.status_code == 201, respuesta.text
        assert respuesta.json()["item_id"] == "item-1"
        enviado = generador.pruebas[0]
        assert enviado["category"] == "OUTERWEAR"
        assert enviado["width"] * enviado["height"] <= 1_000_000
        assert enviado["width"] % 16 == 0 and enviado["height"] % 16 == 0
        assert enviado["garment"][:3] == b"\xff\xd8\xff"

    def test_una_prenda_ajena_o_inexistente_no_se_encuentra(self, plataforma_ropa, generador, cuota, retrato):
        respuesta = pedir_ropa(jpeg(cuerpo_entero(retrato)), "de-otra-persona")
        assert respuesta.status_code == 404 and codigo(respuesta) == "ITEM_NOT_FOUND"
        assert generador.pruebas == []

    def test_una_foto_de_la_cara_no_sirve_para_probar_ropa(self, plataforma_ropa, generador, cuota, retrato):
        respuesta = pedir_ropa(jpeg(retrato))
        assert respuesta.status_code == 422 and codigo(respuesta) == "FULL_BODY_REQUIRED"
        assert generador.pruebas == [] and cuota.reservas == 0

    def test_calzado_no_se_puede_probar(self, plataforma_ropa, generador, cuota, retrato):
        plataforma_ropa.garments["zapato"] = ({"id": "zapato", "category": "SHOES", "imageUrl": MEDIA}, jpeg(prenda_de_prueba()))
        respuesta = pedir_ropa(jpeg(cuerpo_entero(retrato)), "zapato")
        assert respuesta.status_code == 422 and codigo(respuesta) == "GARMENT_NOT_SUPPORTED"

    def test_sin_autorizacion_no_lee_la_prenda(self, plataforma_ropa, generador, cuota, retrato):
        plataforma_ropa.image_consent = False
        plataforma_ropa.garments = {}
        assert pedir_ropa(jpeg(cuerpo_entero(retrato))).status_code == 403


class TestPlataforma:
    """La lectura de la prenda usa el cliente real con un transporte simulado."""

    def cliente(self, monkeypatch, items, media_status=200):
        from app.adapters.platform_client import PlatformClient
        from app.core.security import AuthenticatedUser
        pedidas = []

        def request(metodo, url, **kwargs):
            pedidas.append(url)
            if url.endswith("/closet/client/cli-001"):
                return httpx.Response(200, json=items)
            return httpx.Response(media_status, content=b"\xff\xd8\xffprenda")

        monkeypatch.setattr(httpx, "request", request)
        return PlatformClient("token", AuthenticatedUser("s", "cli-001", "Ana")), pedidas

    @pytest.mark.parametrize("url", ["http://ms-gestion:8081/interno", "https://ejemplo.com/a.jpg", "/media/../secreto", ""])
    def test_nunca_pide_una_url_escrita_por_el_usuario(self, monkeypatch, url):
        plataforma, pedidas = self.cliente(monkeypatch, [{"id": "i", "imageUrl": url}])
        with pytest.raises(Exception) as error:
            plataforma.closet_garment("i")
        assert error.value.status_code == 422
        assert error.value.detail["code"] == "GARMENT_IMAGE_REQUIRED"
        assert len(pedidas) == 1

    def test_lee_la_imagen_propia(self, monkeypatch):
        plataforma, pedidas = self.cliente(monkeypatch, [{"id": "i", "imageUrl": MEDIA, "category": "TOP"}])
        item, contenido = plataforma.closet_garment("i")
        assert item["id"] == "i" and contenido.startswith(b"\xff\xd8\xff")
        assert pedidas[-1].endswith(MEDIA)


def proveedor(manejador):
    esperas = []
    cliente = httpx.Client(transport=httpx.MockTransport(manejador))
    return ReplicateImageGenerator(cliente, sleep=esperas.append), esperas


SALIDA = "https://replicate.delivery/xezq/salida.jpg"


class TestProveedor:
    @pytest.fixture(autouse=True)
    def clave(self, monkeypatch):
        monkeypatch.setattr(settings, "REPLICATE_API_KEY", "clave-secreta")

    def test_espera_el_resultado_y_lo_descarga(self):
        pedidas = []

        def manejador(peticion):
            pedidas.append(peticion)
            if peticion.method == "POST":
                return httpx.Response(201, json={"id": "p1", "status": "starting"})
            if "predictions/p1" in str(peticion.url):
                return httpx.Response(200, json={"id": "p1", "status": "succeeded", "output": SALIDA})
            return httpx.Response(200, content=JPEG)

        generador, esperas = proveedor(manejador)
        resultado = generador.haircut(b"\xff\xd8\xfffoto", "Undercut", "No change", "male")
        assert resultado.data == JPEG and resultado.media_type == "image/jpeg"
        assert len(esperas) == 1
        assert pedidas[0].headers["authorization"] == "Bearer clave-secreta"
        # La descarga no debe llevar la clave al servidor de archivos
        assert "authorization" not in pedidas[-1].headers
        assert "python" not in pedidas[0].headers["user-agent"].lower()

    def test_reintenta_lo_que_indica_el_limite_de_velocidad(self):
        respuestas = iter([
            httpx.Response(429, json={"retry_after": 7}),
            httpx.Response(201, json={"id": "p1", "status": "succeeded", "output": [SALIDA]}),
            httpx.Response(200, content=JPEG),
        ])
        generador, esperas = proveedor(lambda _: next(respuestas))
        assert generador.haircut(b"f", "Bob", "No change", "none").data == JPEG
        assert esperas == [7]

    def test_tras_varios_rechazos_pide_esperar_al_cliente(self):
        generador, esperas = proveedor(lambda _: httpx.Response(429, json={"retry_after": 99}))
        with pytest.raises(ImageGenerationError) as error:
            generador.haircut(b"f", "Bob", "No change", "none")
        assert error.value.code == "IMAGE_SERVICE_BUSY"
        assert esperas == [12, 12]

    def test_sin_credito_informa_sin_revelar_el_motivo_interno(self):
        generador, _ = proveedor(lambda _: httpx.Response(402, json={"detail": "saldo"}))
        with pytest.raises(ImageGenerationError) as error:
            generador.haircut(b"f", "Bob", "No change", "none")
        assert error.value.code == "IMAGE_CREDIT_EXHAUSTED"

    def test_un_rechazo_de_seguridad_se_distingue_de_un_fallo(self):
        generador, _ = proveedor(lambda _: httpx.Response(201, json={"id": "p", "status": "failed", "error": "Image flagged as sensitive"}))
        with pytest.raises(ImageGenerationError) as error:
            generador.haircut(b"f", "Bob", "No change", "none")
        assert error.value.status == 422 and error.value.code == "IMAGE_REJECTED"

    @pytest.mark.parametrize("url", [
        "http://replicate.delivery/a.jpg",
        "https://replicate.delivery.atacante.com/a.jpg",
        "https://ms-asesoria:3100/media/x",
        "https://169.254.169.254/latest",
    ])
    def test_no_descarga_de_un_origen_inesperado(self, url):
        descargas = []

        def manejador(peticion):
            if peticion.method == "GET":
                descargas.append(peticion)
                return httpx.Response(200, content=JPEG)
            return httpx.Response(201, json={"id": "p", "status": "succeeded", "output": url})

        generador, _ = proveedor(manejador)
        with pytest.raises(ImageGenerationError):
            generador.haircut(b"f", "Bob", "No change", "none")
        assert descargas == []

    def test_rechaza_un_resultado_que_no_es_imagen(self):
        def manejador(peticion):
            if peticion.method == "POST":
                return httpx.Response(201, json={"id": "p", "status": "succeeded", "output": SALIDA})
            return httpx.Response(200, content=b"<html>error</html>")

        generador, _ = proveedor(manejador)
        with pytest.raises(ImageGenerationError):
            generador.haircut(b"f", "Bob", "No change", "none")

    def test_cancela_si_tarda_demasiado(self):
        canceladas = []

        def manejador(peticion):
            if str(peticion.url).endswith("/cancel"):
                canceladas.append(peticion)
                return httpx.Response(200, json={})
            if peticion.method == "POST":
                return httpx.Response(201, json={"id": "p", "status": "starting"})
            return httpx.Response(200, json={"id": "p", "status": "processing"})

        generador, _ = proveedor(manejador)
        with pytest.raises(ImageGenerationError):
            generador.haircut(b"f", "Bob", "No change", "none")
        assert len(canceladas) == 1

    def test_una_falla_de_red_no_revela_la_clave(self):
        def manejador(_):
            raise httpx.ConnectError("sin red")

        generador, _ = proveedor(manejador)
        with pytest.raises(ImageGenerationError) as error:
            generador.haircut(b"f", "Bob", "No change", "none")
        assert "clave-secreta" not in str(error.value)

    def test_la_prueba_de_ropa_no_envia_datos_del_cliente_en_el_texto(self):
        cuerpos = []

        def manejador(peticion):
            if peticion.method == "POST":
                cuerpos.append(peticion.content.decode())
                return httpx.Response(201, json={"id": "p", "status": "succeeded", "output": SALIDA})
            return httpx.Response(200, content=JPEG)

        generador, _ = proveedor(manejador)
        generador.try_on(b"persona", b"prenda", "TOP", 768, 1024)
        assert "replacing their current top" in cuerpos[0]
        assert '"aspect_ratio":"custom"' in cuerpos[0].replace(" ", "")


class TestReduccion:
    def test_no_amplia_una_foto_pequena(self):
        imagen = np.zeros((100, 80, 3), dtype=np.uint8)
        assert reduce_to_one_megapixel(imagen).shape == imagen.shape

    @pytest.mark.parametrize("alto,ancho", [(2390, 1792), (1000, 1000), (4000, 500), (300, 4000)])
    def test_la_salida_no_pasa_de_un_mega_pixel(self, alto, ancho):
        w, h = output_size(np.zeros((alto, ancho, 3), dtype=np.uint8))
        assert w % 16 == 0 and h % 16 == 0
        assert 256 <= w <= 2048 and 256 <= h <= 2048
        assert w * h <= 1_000_000 or min(w, h) == 256

    def test_una_imagen_con_ruido_baja_la_calidad_para_caber(self):
        ruido = np.random.default_rng(1).integers(0, 255, (1000, 1000, 3), dtype=np.uint8)
        directo = cv2.imencode(".jpg", ruido, [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tobytes()
        assert len(encode_jpeg(ruido)) < len(directo)


class TestCatalogo:
    def test_toda_equivalencia_apunta_a_un_estilo_real(self):
        ids = {style["id"] for style in CATALOG}
        assert set(PREVIEWS) <= ids

    def test_todos_los_cortes_se_pueden_simular(self):
        cortes = {style["id"] for style in CATALOG if style["category"] == "HAIRCUT"}
        assert cortes <= set(PREVIEWS)

    def test_las_recomendaciones_indican_si_se_pueden_simular(self):
        resultados = RecommendationService.recommend({"face": "OVAL"}, services={}, gender="MALE")
        por_categoria = {r["category"]: r for r in resultados}
        assert por_categoria["HAIRCUT"]["can_preview"] is True
        assert por_categoria["TREATMENT"]["can_preview"] is False
