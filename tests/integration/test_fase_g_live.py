"""
Pruebas en vivo de la Fase G: consentimiento, diagnóstico real, recomendador, marca personal y voz.
Requiere el entorno levantado: docker compose up -d --wait. Todo lo que crea se borra al terminar.
"""
import json
import pathlib
import struct
import subprocess
import time
import zlib

import httpx
import pytest

from test_seguridad_live import ADMIN, ASESORIA, CLIENT, IA, MCP, STYLIST, auth, login, rpc

FIXTURES = pathlib.Path(__file__).parents[2] / "backend" / "ms-ia" / "tests" / "fixtures"
CONSENT = f"{ASESORIA}/biometrics/consent"
DIAGNOSES = f"{ASESORIA}/biometrics/diagnoses"
SCAN = f"{IA}/api/v1/biometrics/scan"
STYLES = f"{IA}/api/v1/recommendations/styles"
BRAND = f"{IA}/api/v1/brand/strategy"
TRANSCRIBE = f"{IA}/api/v1/speech/transcribe"
OTRO_CLIENTE = ("alejandro.morales", "Cliente#2026")
# PNG real de 300x300 en un solo color: una imagen válida, sin ningún rostro
SIN_ROSTRO_SEED = (b"\x00\x00\x00", 300)


def mongo(script):
    result = subprocess.run(
        ["docker", "exec", "salon-mongodb", "mongosh", "--quiet", "-u", "mongo_admin", "-p", "mongo_secret_pass",
         "--authenticationDatabase", "admin", "salon_asesoria", "--eval", script],
        capture_output=True, text=True, check=True, encoding="utf-8",
    )
    return result.stdout.strip()


def foto():
    return (FIXTURES / "retrato.png").read_bytes()


def sin_rostro():
    """PNG real de un solo color, que se puede decodificar pero no contiene ningún rostro."""
    def chunk(kind, content):
        return struct.pack(">I", len(content)) + kind + content + struct.pack(">I", zlib.crc32(kind + content))

    color, side = SIN_ROSTRO_SEED
    raw = (b"\x00" + color * side) * side
    header = struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def escanear(token, contenido=None):
    return httpx.post(SCAN, headers=auth(token), files={"file": ("foto", contenido if contenido is not None else foto())}, timeout=60)


def aceptar(token):
    version = httpx.get(CONSENT, headers=auth(token)).json()["policyVersion"]
    response = httpx.post(CONSENT, headers=auth(token), json={"policyVersion": version})
    assert response.status_code == 201, response.text


@pytest.fixture(scope="module")
def cliente():
    return login(CLIENT)


@pytest.fixture(scope="module")
def otro():
    return login(OTRO_CLIENTE)


@pytest.fixture(autouse=True)
def limpiar(cliente, otro):
    """Cada prueba empieza sin consentimiento ni resultados, y no deja datos biométricos."""
    def borrar():
        for token in (cliente, otro):
            assert httpx.delete(CONSENT, headers=auth(token)).status_code == 200
        mongo("db.biometric_consents.deleteMany({clientId: {$in: ['cli-001', 'cli-002']}})")

    borrar()
    yield
    borrar()


class TestConsentimiento:
    def test_empieza_sin_consentimiento_y_muestra_la_politica(self, cliente):
        body = httpx.get(CONSENT, headers=auth(cliente)).json()
        assert body["granted"] is False
        assert "se descartan" in body["policyText"]
        assert f'{body["retentionDays"]} días' in body["policyText"]

    def test_sin_consentimiento_el_escaneo_da_403(self, cliente):
        response = escanear(cliente)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "CONSENT_REQUIRED"
        assert httpx.get(DIAGNOSES, headers=auth(cliente)).json() == []

    def test_sin_token_da_401(self):
        assert httpx.get(CONSENT).status_code == 401
        assert httpx.post(SCAN, files={"file": ("foto", foto())}).status_code == 401

    def test_version_de_politica_antigua_da_422(self, cliente):
        response = httpx.post(CONSENT, headers=auth(cliente), json={"policyVersion": "antigua"})
        assert response.status_code == 422
        assert httpx.get(CONSENT, headers=auth(cliente)).json()["granted"] is False

    def test_nadie_puede_guardar_un_diagnostico_sin_consentimiento(self, cliente):
        response = httpx.post(DIAGNOSES, headers=auth(cliente), json={"source": "IMAGE"})
        assert response.status_code == 403

    def test_si_no_se_puede_comprobar_el_consentimiento_no_analiza(self, cliente):
        """Falla cerrado: con ms-asesoria detenido, ms-ia no procesa la imagen."""
        aceptar(cliente)
        subprocess.run(["docker", "stop", "salon-ms-asesoria"], check=True, capture_output=True)
        try:
            response = escanear(cliente)
            assert response.status_code == 503
            assert response.json()["detail"]["code"] == "ASESORIA_UNAVAILABLE"
        finally:
            subprocess.run(["docker", "start", "salon-ms-asesoria"], check=True, capture_output=True)
            limite = time.time() + 60
            while time.time() < limite:
                try:
                    if httpx.get(f"{ASESORIA}/health", timeout=2).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(1)


class TestDiagnosticoReal:
    def test_analiza_y_guarda_solo_el_resultado(self, cliente):
        aceptar(cliente)
        imagenes = mongo("db.getCollection('media.files').countDocuments()")
        response = escanear(cliente)
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["clientId"] == "cli-001"
        assert body["faceShape"] in ("OVAL", "ROUND", "SQUARE", "HEART", "OBLONG")
        assert body["skinUndertone"] in ("WARM", "COOL", "NEUTRAL")
        assert body["method"].startswith("MediaPipe")
        # Lo guardado es lo mismo que se devolvió, sin imagen ni puntos del rostro
        guardado = json.loads(mongo("JSON.stringify(db.biometric_diagnoses.findOne({clientId: 'cli-001'}))"))
        assert guardado["faceShape"] == body["faceShape"]
        assert not {"image", "imageUrl", "landmarks", "video"} & set(guardado)
        assert mongo("db.getCollection('media.files').countDocuments()") == imagenes

    def test_no_deja_archivos_temporales_en_el_contenedor(self, cliente):
        aceptar(cliente)
        assert escanear(cliente).status_code == 201
        temporales = subprocess.run(["docker", "exec", "salon-ms-ia", "ls", "-A", "/tmp"], capture_output=True, text=True, check=True).stdout
        assert ".video" not in temporales

    def test_imagen_sin_rostro_da_422_y_no_guarda(self, cliente):
        aceptar(cliente)
        response = escanear(cliente, sin_rostro())
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "NO_FACE"
        assert httpx.get(DIAGNOSES, headers=auth(cliente)).json() == []

    def test_archivo_falso_da_415(self, cliente):
        aceptar(cliente)
        assert escanear(cliente, b"<script>alert(1)</script>").status_code == 415

    def test_la_retencion_es_real_en_mongodb(self, cliente):
        aceptar(cliente)
        body = escanear(cliente).json()
        creado = time.strptime(body["createdAt"][:19], "%Y-%m-%dT%H:%M:%S")
        expira = time.strptime(body["expiresAt"][:19], "%Y-%m-%dT%H:%M:%S")
        dias = (time.mktime(expira) - time.mktime(creado)) / 86400
        assert round(dias) == httpx.get(CONSENT, headers=auth(cliente)).json()["retentionDays"]
        indices = json.loads(mongo("JSON.stringify(db.biometric_diagnoses.getIndexes())"))
        ttl = [indice for indice in indices if indice["key"] == {"expiresAt": 1}]
        assert ttl and ttl[0]["expireAfterSeconds"] == 0


class TestPropiedadYBorrado:
    def test_cada_cliente_solo_ve_y_borra_lo_suyo(self, cliente, otro):
        aceptar(cliente)
        propio = escanear(cliente).json()
        assert httpx.get(DIAGNOSES, headers=auth(otro)).json() == []
        assert httpx.delete(f"{DIAGNOSES}/{propio['id']}", headers=auth(otro)).status_code == 404
        assert len(httpx.get(DIAGNOSES, headers=auth(cliente)).json()) == 1

    def test_ni_el_administrador_ni_el_estilista_ven_los_datos_del_cliente(self, cliente):
        aceptar(cliente)
        propio = escanear(cliente).json()
        for credenciales in (ADMIN, STYLIST):
            token = login(credenciales)
            assert httpx.get(DIAGNOSES, headers=auth(token)).json() == []
            assert httpx.delete(f"{DIAGNOSES}/{propio['id']}", headers=auth(token)).status_code == 404

    def test_borrar_un_resultado(self, cliente):
        aceptar(cliente)
        primero = escanear(cliente).json()
        segundo = escanear(cliente).json()
        assert httpx.delete(f"{DIAGNOSES}/{primero['id']}", headers=auth(cliente)).status_code == 200
        assert [d["id"] for d in httpx.get(DIAGNOSES, headers=auth(cliente)).json()] == [segundo["id"]]

    def test_el_listado_trae_primero_el_mas_reciente(self, cliente):
        aceptar(cliente)
        primero = escanear(cliente).json()
        time.sleep(0.01)
        segundo = escanear(cliente).json()
        assert [d["id"] for d in httpx.get(DIAGNOSES, headers=auth(cliente)).json()] == [segundo["id"], primero["id"]]

    def test_revocar_borra_de_verdad_y_bloquea_nuevos_escaneos(self, cliente):
        aceptar(cliente)
        escanear(cliente)
        escanear(cliente)
        response = httpx.delete(CONSENT, headers=auth(cliente))
        assert response.json() == {"deletedDiagnoses": 2}
        assert mongo("db.biometric_diagnoses.countDocuments({clientId: 'cli-001'})") == "0"
        estado = httpx.get(CONSENT, headers=auth(cliente)).json()
        assert estado["granted"] is False and estado["revokedAt"]
        assert escanear(cliente).status_code == 403


class TestRecomendaciones:
    def test_funciona_sin_consentimiento_con_rasgos_a_mano(self, cliente):
        response = httpx.post(STYLES, headers=auth(cliente), json={"hair_type": "CURLY", "face_shape": "OVAL"}, timeout=15)
        assert response.status_code == 200, response.text
        assert response.json()[0]["style_id"] in ("cut-rizos", "cut-shag")

    def test_cada_estilo_apunta_a_un_servicio_real_con_su_precio_real(self, cliente):
        estilos = httpx.post(STYLES, headers=auth(cliente), json={"face_shape": "OVAL"}, timeout=15).json()
        precios = subprocess.run(
            ["docker", "exec", "salon-postgres", "psql", "-U", "salon_admin", "-d", "salon_gestion", "-Atc",
             "SELECT id || '=' || price FROM services WHERE active"],
            capture_output=True, text=True, check=True,
        ).stdout.split()
        reales = {linea.split("=")[0]: float(linea.split("=")[1]) for linea in precios}
        assert all(estilo["service"] for estilo in estilos)
        for estilo in estilos:
            assert estilo["service"]["price"] == reales[estilo["service"]["id"]]

    def test_valor_invalido_da_422(self, cliente):
        assert httpx.post(STYLES, headers=auth(cliente), json={"face_shape": "X"}).status_code == 422


class TestMarcaPersonal:
    def pedir(self, token, red="LINKEDIN", **extra):
        response = httpx.post(BRAND, headers=auth(token), json={"platform": red, **extra}, timeout=40)
        assert response.status_code == 200, response.text
        return response.json()

    def test_sin_diagnostico_no_se_presenta_como_personalizada(self, cliente):
        assert self.pedir(cliente)["personalized"] is False

    def test_usa_el_diagnostico_real_y_el_closet_real(self, cliente):
        aceptar(cliente)
        diagnostico = escanear(cliente).json()
        color = diagnostico["recommendedPalette"][0]
        prenda = httpx.post(f"{ASESORIA}/closet", headers=auth(cliente), json={
            "name": "[prueba-g] Blazer", "category": "OUTERWEAR", "color": color, "season": "ALL_SEASON",
        }).json()
        try:
            cuerpo = self.pedir(cliente, sector="diseño", goal="Conseguir clientes")
            assert cuerpo["personalized"] is True
            assert cuerpo["color_palette"] == diagnostico["recommendedPalette"]
            assert prenda["id"] in [p["id"] for p in cuerpo["closet_matches"]]
            assert cuerpo["bio"] and len(cuerpo["content_ideas"]) >= 1
        finally:
            httpx.delete(f"{ASESORIA}/closet/{prenda['id']}", headers=auth(cliente))

    def test_al_revocar_deja_de_estar_personalizada(self, cliente):
        aceptar(cliente)
        escanear(cliente)
        assert self.pedir(cliente)["personalized"] is True
        httpx.delete(CONSENT, headers=auth(cliente))
        assert self.pedir(cliente)["personalized"] is False

    def test_red_desconocida_da_422(self, cliente):
        assert httpx.post(BRAND, headers=auth(cliente), json={"platform": "MYSPACE"}).status_code == 422


class TestVoz:
    def transcribir(self, token, contenido=None):
        audio = contenido if contenido is not None else (FIXTURES / "pregunta.wav").read_bytes()
        return httpx.post(TRANSCRIBE, headers=auth(token), files={"file": ("audio", audio)}, timeout=120)

    def test_el_cliente_y_el_estilista_no_pueden_usarla(self, cliente):
        assert self.transcribir(cliente).status_code == 403
        assert self.transcribir(login(STYLIST)).status_code == 403

    def test_de_la_voz_al_reporte_por_el_servidor_mcp(self):
        token = login(ADMIN)
        response = self.transcribir(token)
        assert response.status_code == 200, response.text
        pregunta = response.json()["text"]
        assert "ingresos" in pregunta.lower()

        resultado = rpc("tools/call", {"name": "generar_reporte_lenguaje_natural", "arguments": {"prompt": pregunta}}, token)
        estructurado = resultado.json()["result"]["structuredContent"]
        assert estructurado["query"] == pregunta
        assert estructurado["generatedReport"]
        assert "metrics" in estructurado["data"]

    def test_archivo_que_no_es_audio_da_415(self):
        assert self.transcribir(login(ADMIN), b"no es audio").status_code == 415
