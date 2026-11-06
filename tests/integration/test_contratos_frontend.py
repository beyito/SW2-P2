"""
Pruebas de contrato: toda consulta GraphQL escrita en los clientes (web, móvil y n8n) debe ser válida contra el esquema
real de su servicio, y las rutas que usan los clientes de ms-ia deben existir en su OpenAPI.
Si un servicio cambia su contrato, esta prueba falla antes de que falle la pantalla.
Requiere el entorno levantado: docker compose up -d --wait
"""
import json
import pathlib
import re

import httpx
import pytest
from graphql import build_client_schema, get_introspection_query, parse, validate

from test_seguridad_live import ADMIN, GESTION, IA, auth, login

CRM = "http://localhost:8083/graphql"
RAIZ = pathlib.Path(__file__).parents[2]
CARPETAS = [
    RAIZ / "frontend" / "mfe-estudio-ia" / "src",
    RAIZ / "frontend" / "mfe-reservas" / "src",
    RAIZ / "frontend" / "mfe-gestion" / "src",
    RAIZ / "frontend" / "shell" / "src",
    RAIZ / "backend" / "mcp-server" / "src",
    RAIZ / "backend" / "ms-ia" / "app",
    RAIZ / "mobile" / "salon_mobile" / "lib",
    RAIZ / "docker" / "n8n" / "workflows",
]
EXTENSIONES = {".js", ".jsx", ".ts", ".vue", ".py", ".dart", ".json", ".mjs"}
# Texto entre comillas que empieza como un documento GraphQL
DOCUMENTO = re.compile(r"""(['"`])\s*((?:query|mutation)\b[^'"`]*?\{[^'"`]*\}|\{\s*[a-zA-Z]\w*\s*[({][^'"`]*\})\s*\1""", re.S)
# Fragmentos interpolados en el código: se sustituyen por campos reales para validar el documento completo
INTERPOLACIONES = {
    "${profile}": "id fullName email phone loyaltyPoints whatsappOptIn styleProfile { gender ageRange preferredLength maintenance vibe }",
    "${APPOINTMENT_FIELDS}": "id stylistId stylistName serviceId serviceName appointmentDate durationMinutes totalPrice status sagaId reviewed",
}


CONSTANTE = re.compile(r"""const\s+([A-Z_]+)\s*=\s*(['"`])([^'"`]+)\2""")


def documentos():
    """Consultas del código de los clientes, con el archivo de donde salieron."""
    encontrados = []
    for carpeta in CARPETAS:
        if not carpeta.exists():
            continue
        for archivo in carpeta.rglob("*"):
            if archivo.suffix not in EXTENSIONES or ".test." in archivo.name or ".spec." in archivo.name:
                continue
            texto = archivo.read_text(encoding="utf-8")
            if archivo.suffix == ".json":
                # Los flujos de n8n guardan su código como texto JSON
                texto = texto.replace('\\n', '\n').replace('\\"', '"')
            # Fragmentos declarados como constantes en el mismo archivo
            locales = {f"${{{m.group(1)}}}": m.group(3) for m in CONSTANTE.finditer(texto)}
            for coincidencia in DOCUMENTO.finditer(texto):
                cuerpo = coincidencia.group(2)
                for marcador, valor in {**INTERPOLACIONES, **locales}.items():
                    cuerpo = cuerpo.replace(marcador, valor)
                encontrados.append((archivo.relative_to(RAIZ).as_posix(), cuerpo))
    return encontrados


def esquema(url, token):
    respuesta = httpx.post(url, json={"query": get_introspection_query()}, headers=auth(token), timeout=20)
    assert respuesta.status_code == 200, respuesta.text
    return build_client_schema(respuesta.json()["data"])


@pytest.fixture(scope="module")
def esquemas():
    token = login(ADMIN)
    return {"gestion": esquema(GESTION, token), "crm": esquema(CRM, token)}


def raices(documento):
    return {
        seleccion.name.value
        for definicion in documento.definitions
        for seleccion in definicion.selection_set.selections
    }


def campos_de(schema):
    campos = set(schema.query_type.fields)
    if schema.mutation_type:
        campos |= set(schema.mutation_type.fields)
    return campos


def test_se_encontraron_las_consultas_de_todos_los_clientes():
    origenes = {archivo.split("/")[0] + "/" + archivo.split("/")[1] for archivo, _ in documentos()}
    assert {"frontend/mfe-reservas", "frontend/mfe-gestion", "frontend/shell", "mobile/salon_mobile", "docker/n8n", "backend/mcp-server"} <= origenes, origenes
    assert len(documentos()) >= 25


def test_toda_consulta_de_un_cliente_es_valida_contra_el_esquema_real(esquemas):
    fallos = []
    for archivo, texto in documentos():
        try:
            documento = parse(texto)
        except Exception as error:
            fallos.append(f"{archivo}: no se pudo leer: {error}: {texto[:90]}")
            continue
        destinos = [s for s in esquemas.values() if raices(documento) <= campos_de(s)]
        if not destinos:
            fallos.append(f"{archivo}: ningún servicio tiene {sorted(raices(documento))}")
            continue
        errores = validate(destinos[0], documento)
        if errores:
            fallos.append(f"{archivo}: {errores[0].message}")
    assert not fallos, "\n".join(fallos)


def test_el_validador_detecta_un_contrato_roto(esquemas):
    """Comprueba la propia prueba: un campo que no existe debe fallar."""
    assert validate(esquemas["crm"], parse("{ getMyProfile { campoInexistente } }"))


@pytest.mark.parametrize("metodo,ruta,campos", [
    ("post", "/api/v1/biometrics/scan", {"file"}),
    ("post", "/api/v1/recommendations/styles", {"gender", "age_range", "face_shape", "hair_type", "hair_tone", "skin_undertone", "length", "maintenance", "vibe"}),
    ("post", "/api/v1/brand/strategy", {"platform", "goal", "sector", "gender", "age_range"}),
    ("post", "/api/v1/speech/transcribe", {"file"}),
])
def test_ms_ia_mantiene_lo_que_usan_sus_clientes(metodo, ruta, campos):
    openapi = httpx.get(f"{IA}/openapi.json").json()
    operacion = openapi["paths"][ruta][metodo]
    contenido = next(iter(operacion["requestBody"]["content"].values()))
    referencia = contenido["schema"]["$ref"].split("/")[-1]
    assert campos <= set(openapi["components"]["schemas"][referencia]["properties"])


def test_los_flujos_de_n8n_son_json_valido_y_conectan_sus_nodos():
    for archivo in (RAIZ / "docker" / "n8n" / "workflows").glob("*.json"):
        flujo = json.loads(archivo.read_text(encoding="utf-8"))
        nombres = {nodo["name"] for nodo in flujo["nodes"]}
        for origen, salida in flujo["connections"].items():
            assert origen in nombres, archivo.name
            for ramas in salida["main"]:
                assert all(destino["node"] in nombres for destino in ramas), archivo.name
