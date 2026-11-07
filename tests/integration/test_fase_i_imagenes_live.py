"""
Pruebas en vivo de la generación de imágenes: autorización, cuota y validaciones contra los servicios reales.
Todas se detienen antes de llamar al proveedor, así que no gastan crédito.
Requiere el entorno levantado: docker compose up -d --wait. Todo lo que crea se borra al terminar.
"""
import pathlib
import subprocess
import uuid

import httpx
import pytest

from test_fase_g_live import sin_rostro
from test_seguridad_live import ASESORIA, CLIENT, IA, auth, login

FIXTURES = pathlib.Path(__file__).parents[2] / "backend" / "ms-ia" / "tests" / "fixtures"
CONSENT = f"{ASESORIA}/biometrics/image-consent"
BIOMETRIC_CONSENT = f"{ASESORIA}/biometrics/consent"
CORTE = f"{IA}/api/v1/image-generation/haircut"
ROPA = f"{IA}/api/v1/image-generation/try-on"
CONJUNTO = f"{IA}/api/v1/image-generation/try-on-outfit"
OTRO_CLIENTE = ("alejandro.morales", "Cliente#2026")
# Tiene la firma de un PNG, pero su contenido no se puede decodificar: la validación local siempre lo detiene antes
# de apartar cupo o llamar al proveedor, y por eso estas pruebas no pueden gastar crédito aunque cambie otra cosa
IMAGEN_DANADA = b"\x89PNG\r\n\x1a\n" + b"contenido no decodificable" * 4


def foto():
    return (FIXTURES / "retrato.png").read_bytes()


def corte(token, contenido=None, estilo="cut-undercut"):
    return httpx.post(
        CORTE, headers=auth(token), timeout=60,
        files={"file": ("foto.png", contenido if contenido is not None else foto(), "image/png")},
        data={"style_id": estilo},
    )


def ropa(token, prenda, contenido=None):
    return httpx.post(
        ROPA, headers=auth(token), timeout=60,
        files={"file": ("foto.png", contenido if contenido is not None else foto(), "image/png")},
        data={"item_id": prenda},
    )


def conjunto(token, prendas, contenido=None):
    return httpx.post(
        CONJUNTO, headers=auth(token), timeout=60,
        files={"file": ("foto.png", contenido if contenido is not None else foto(), "image/png")},
        data={"item_ids": prendas},
    )


def conceder(token):
    version = httpx.get(CONSENT, headers=auth(token)).json()["policyVersion"]
    return httpx.post(CONSENT, headers=auth(token), json={"policyVersion": version, "declaresAdult": True})


def codigo(respuesta):
    return respuesta.json()["detail"]["code"]


@pytest.fixture
def token():
    valor = login(CLIENT)
    yield valor
    httpx.delete(CONSENT, headers=auth(valor))


@pytest.fixture
def prendas(token):
    """Crea prendas de prueba y las borra al terminar."""
    creadas = []

    def crear(imagen, categoria="TOP", propietario=token):
        respuesta = httpx.post(
            f"{ASESORIA}/closet", headers={**auth(propietario), "Idempotency-Key": str(uuid.uuid4())},
            json={"name": f"Prueba {uuid.uuid4().hex[:6]}", "color": "Azul", "category": categoria, "season": "ALL_SEASON", "imageUrl": imagen},
        )
        assert respuesta.status_code == 201, respuesta.text
        prenda = respuesta.json()
        creadas.append((prenda["id"], propietario))
        return prenda["id"]

    yield crear
    for identificador, propietario in creadas:
        httpx.delete(f"{ASESORIA}/closet/{identificador}", headers={**auth(propietario), "Idempotency-Key": str(uuid.uuid4())})


def subir_imagen(token):
    respuesta = httpx.post(f"{ASESORIA}/media", headers=auth(token), files={"file": ("p.png", IMAGEN_DANADA, "image/png")})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["url"]


class TestAutorizacion:
    def test_exige_token(self):
        assert httpx.get(CONSENT).status_code == 401
        assert httpx.post(CORTE, files={"file": ("f.png", b"x")}, data={"style_id": "cut-undercut"}).status_code == 401
        assert httpx.post(ROPA, files={"file": ("f.png", b"x")}, data={"item_id": "x"}).status_code == 401

    def test_empieza_sin_autorizacion_y_nombra_al_tercero(self, token):
        httpx.delete(CONSENT, headers=auth(token))
        estado = httpx.get(CONSENT, headers=auth(token)).json()
        assert estado["granted"] is False
        assert "Replicate" in estado["policyText"]
        assert "18 años" in estado["policyText"]

    def test_sin_autorizacion_no_se_genera(self, token):
        httpx.delete(CONSENT, headers=auth(token))
        respuesta = corte(token)
        assert respuesta.status_code == 403 and codigo(respuesta) == "IMAGE_CONSENT_REQUIRED"

    def test_el_consentimiento_biometrico_no_autoriza_el_envio(self, token):
        httpx.delete(CONSENT, headers=auth(token))
        estado = httpx.get(BIOMETRIC_CONSENT, headers=auth(token)).json()
        httpx.post(BIOMETRIC_CONSENT, headers=auth(token), json={"policyVersion": estado["policyVersion"], "declaresAdult": True})
        try:
            assert corte(token).status_code == 403
        finally:
            httpx.delete(BIOMETRIC_CONSENT, headers=auth(token))

    def test_exige_mayoria_de_edad_y_version_vigente(self, token):
        version = httpx.get(CONSENT, headers=auth(token)).json()["policyVersion"]
        sin_edad = httpx.post(CONSENT, headers=auth(token), json={"policyVersion": version, "declaresAdult": False})
        assert sin_edad.status_code == 422
        antigua = httpx.post(CONSENT, headers=auth(token), json={"policyVersion": "antigua", "declaresAdult": True})
        assert antigua.status_code == 422

    def test_retirar_detiene_la_generacion(self, token):
        assert conceder(token).status_code == 201
        assert httpx.get(CONSENT, headers=auth(token)).json()["granted"] is True
        assert httpx.delete(CONSENT, headers=auth(token)).status_code == 200
        assert corte(token).status_code == 403

    def test_retirar_el_consentimiento_biometrico_tambien_la_retira(self, token):
        conceder(token)
        assert httpx.delete(BIOMETRIC_CONSENT, headers=auth(token)).status_code == 200
        assert httpx.get(CONSENT, headers=auth(token)).json()["granted"] is False

    def test_la_autorizacion_de_un_cliente_no_vale_para_otro(self, token):
        conceder(token)
        otro = login(OTRO_CLIENTE)
        assert httpx.get(CONSENT, headers=auth(otro)).json()["granted"] is False
        assert corte(otro).status_code == 403


class TestValidaciones:
    @pytest.fixture(autouse=True)
    def autorizado(self, token):
        conceder(token)

    def test_estilo_que_no_se_puede_simular(self, token):
        respuesta = corte(token, estilo="trat-keratina")
        assert respuesta.status_code == 422 and codigo(respuesta) == "STYLE_NOT_PREVIEWABLE"

    def test_foto_sin_rostro(self, token):
        respuesta = corte(token, sin_rostro())
        assert respuesta.status_code == 422 and codigo(respuesta) == "NO_FACE"

    def test_imagen_danada(self, token):
        respuesta = corte(token, IMAGEN_DANADA)
        assert respuesta.status_code == 422 and codigo(respuesta) == "INVALID_IMAGE"

    def test_archivo_que_no_es_imagen(self, token):
        assert corte(token, b"esto no es una imagen").status_code == 415

    def test_un_video_no_sirve(self, token):
        assert corte(token, b"\x1a\x45\xdf\xa3 video").status_code == 422

    def test_prenda_inexistente(self, token):
        respuesta = ropa(token, "no-existe")
        assert respuesta.status_code == 404 and codigo(respuesta) == "ITEM_NOT_FOUND"

    def test_prenda_de_otro_cliente(self, token, prendas):
        otro = login(OTRO_CLIENTE)
        ajena = prendas(subir_imagen(otro), propietario=otro)
        respuesta = ropa(token, ajena)
        assert respuesta.status_code == 404 and codigo(respuesta) == "ITEM_NOT_FOUND"

    @pytest.mark.parametrize("url", ["", "http://ms-gestion:8081/actuator/env", "https://ejemplo.com/prenda.jpg"])
    def test_nunca_lee_una_url_escrita_por_el_cliente(self, token, prendas, url):
        respuesta = ropa(token, prendas(url))
        assert respuesta.status_code == 422 and codigo(respuesta) == "GARMENT_IMAGE_REQUIRED"

    def test_calzado_no_se_puede_probar(self, token, prendas):
        respuesta = ropa(token, prendas(subir_imagen(token), "SHOES"))
        assert respuesta.status_code == 422 and codigo(respuesta) == "GARMENT_NOT_SUPPORTED"

    def test_prueba_de_ropa_sin_persona_en_la_foto(self, token, prendas):
        respuesta = ropa(token, prendas(subir_imagen(token)), sin_rostro())
        assert respuesta.status_code == 422 and codigo(respuesta) == "NO_FACE"

    def test_foto_de_prenda_danada(self, token, prendas):
        respuesta = ropa(token, prendas(subir_imagen(token)))
        assert respuesta.status_code == 422 and codigo(respuesta) == "INVALID_GARMENT_IMAGE"


class TestConjunto:
    """Cada caso termina en un rechazo previo al proveedor: las fotos de prenda están dañadas y nunca se llega a generar."""

    @pytest.fixture(autouse=True)
    def autorizado(self, token):
        conceder(token)

    def test_exige_token(self):
        assert httpx.post(CONJUNTO, files={"file": ("f.png", b"x")}, data={"item_ids": "a,b"}).status_code == 401

    def test_sin_autorizacion_no_se_genera(self, token):
        httpx.delete(CONSENT, headers=auth(token))
        respuesta = conjunto(token, "a,b")
        assert respuesta.status_code == 403 and codigo(respuesta) == "IMAGE_CONSENT_REQUIRED"

    def test_una_sola_prenda_no_es_un_conjunto(self, token, prendas):
        respuesta = conjunto(token, prendas(subir_imagen(token)))
        assert respuesta.status_code == 422 and codigo(respuesta) == "OUTFIT_SIZE"

    def test_dos_prendas_del_mismo_tipo(self, token, prendas):
        una, otra = prendas(subir_imagen(token)), prendas(subir_imagen(token))
        respuesta = conjunto(token, f"{una},{otra}")
        assert respuesta.status_code == 422 and codigo(respuesta) == "OUTFIT_DUPLICATE_CATEGORY"

    def test_calzado_no_entra_en_un_conjunto(self, token, prendas):
        respuesta = conjunto(token, f"{prendas(subir_imagen(token))},{prendas(subir_imagen(token), 'SHOES')}")
        assert respuesta.status_code == 422 and codigo(respuesta) == "GARMENT_NOT_SUPPORTED"

    def test_una_prenda_ajena_no_se_encuentra(self, token, prendas):
        otro = login(OTRO_CLIENTE)
        respuesta = conjunto(token, f"{prendas(subir_imagen(token))},{prendas(subir_imagen(otro), 'BOTTOM', otro)}")
        assert respuesta.status_code == 404 and codigo(respuesta) == "ITEM_NOT_FOUND"

    def test_nunca_lee_una_url_escrita_por_el_cliente(self, token, prendas):
        respuesta = conjunto(token, f"{prendas(subir_imagen(token))},{prendas('http://ms-gestion:8081/actuator/env', 'BOTTOM')}")
        assert respuesta.status_code == 422 and codigo(respuesta) == "GARMENT_IMAGE_REQUIRED"

    def test_foto_sin_persona(self, token, prendas):
        respuesta = conjunto(token, f"{prendas(subir_imagen(token))},{prendas(subir_imagen(token), 'BOTTOM')}", sin_rostro())
        assert respuesta.status_code == 422 and codigo(respuesta) == "NO_FACE"

    def test_foto_de_prenda_danada_se_detiene_antes_de_gastar(self, token, prendas):
        respuesta = conjunto(token, f"{prendas(subir_imagen(token))},{prendas(subir_imagen(token), 'BOTTOM')}")
        assert respuesta.status_code == 422 and codigo(respuesta) == "INVALID_GARMENT_IMAGE"


CUOTA_REAL = """
import threading
from app.adapters import image_quota
from app.adapters.image_quota import DynamoImageQuota
from app.core.config import settings
from fastapi import HTTPException
# Un total propio de la prueba: no debe consumir el cupo real del salón
image_quota._TOTAL = "prueba-total-{sufijo}"
cuota = DynamoImageQuota()
cliente = "prueba-{sufijo}"
resultados = []
def intentar():
    try:
        resultados.append(cuota.reserve(cliente))
    except HTTPException as error:
        resultados.append(error.detail["code"])
hilos = [threading.Thread(target=intentar) for _ in range(8)]
[h.start() for h in hilos]; [h.join() for h in hilos]
aceptadas = sorted(r for r in resultados if isinstance(r, int))
rechazadas = [r for r in resultados if not isinstance(r, int)]
assert len(aceptadas) == settings.IMAGE_GEN_DAILY_LIMIT_PER_CLIENT, resultados
assert aceptadas == list(range(settings.IMAGE_GEN_DAILY_LIMIT_PER_CLIENT)), aceptadas
assert set(rechazadas) == {{"IMAGE_QUOTA_EXCEEDED"}}, rechazadas
# Una imagen fallida devuelve su cupo y otra puede usarlo
cuota.release(cliente)
assert cuota.reserve(cliente) == 0
for _ in aceptadas:
    cuota.release(cliente)
print("CUOTA-OK")
"""


def test_la_cuota_real_no_se_rebasa_con_peticiones_simultaneas():
    """Corre dentro de ms-ia contra DynamoDB real; sus claves vencen solas por su tiempo de vida."""
    resultado = subprocess.run(
        ["docker", "exec", "-i", "salon-ms-ia", "python", "-"],
        input=CUOTA_REAL.format(sufijo=uuid.uuid4().hex), capture_output=True, text=True, encoding="utf-8",
    )
    assert "CUOTA-OK" in resultado.stdout, resultado.stdout + resultado.stderr


def test_la_clave_no_aparece_en_las_respuestas_ni_en_la_documentacion():
    openapi = httpx.get(f"{IA}/openapi.json").text
    assert "REPLICATE_API_KEY" not in openapi
    assert "r8_" not in openapi
