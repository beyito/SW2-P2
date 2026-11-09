"""
Pruebas en vivo de los reportes dinámicos (CU-18): el Servidor MCP consulta PostgreSQL con el usuario
de solo lectura salon_reportes y entrega Excel o PDF. Llaman a la herramienta directamente, así que no
consumen el cupo del modelo, y no cambian ningún dato.
Requiere el entorno levantado: docker compose up -d --wait
"""
import base64
import io
import subprocess

import pytest
from openpyxl import load_workbook

from test_seguridad_live import ADMIN, STYLIST, login, rpc


def sql(base, consulta):
    resultado = subprocess.run(
        ["docker", "exec", "salon-postgres", "psql", "-U", "salon_admin", "-d", base, "-Atc", consulta],
        capture_output=True, text=True, check=True, encoding="utf-8",
    )
    return resultado.stdout.strip()


def reporte(token, **peticion):
    respuesta = rpc("tools/call", {"name": "generar_reporte", "arguments": peticion}, token)
    return respuesta, respuesta.json().get("result")


def contenido(resultado):
    assert not resultado.get("isError"), resultado
    datos = resultado["structuredContent"]
    return datos, base64.b64decode(datos["archivo"]["base64"])


@pytest.fixture(scope="module")
def admin():
    return login(ADMIN)


class TestReportes:
    def test_catalogo_con_entidades_y_formatos(self, admin):
        datos = rpc("tools/call", {"name": "catalogo_reportes", "arguments": {}}, admin).json()["result"]["structuredContent"]
        assert datos["formatos"] == ["excel", "pdf"]
        assert {e["clave"] for e in datos["entidades"]} == {"citas", "facturas", "inventario", "movimientos_inventario", "puntos", "clientes"}

    def test_excel_de_inventario_coincide_con_la_base(self, admin):
        _, resultado = reporte(admin, entidad="inventario", columnas=["codigo", "insumo", "stock", "minimo"], formato="excel")
        datos, archivo = contenido(resultado)
        assert datos["totalFilas"] == int(sql("salon_gestion", "SELECT count(*) FROM inventory_items"))
        assert datos["totales"]["stock"] == int(sql("salon_gestion", "SELECT sum(current_stock) FROM inventory_items"))

        hoja = load_workbook(io.BytesIO(archivo)).active
        assert [c.value for c in hoja[4]] == ["Código", "Insumo", "Stock", "Mínimo"]
        assert hoja.max_row == 4 + datos["totalFilas"] + 1  # encabezado, filas y total

    def test_filtro_de_criticos(self, admin):
        _, resultado = reporte(admin, entidad="inventario", filtros={"solo_criticos": True})
        datos, _ = contenido(resultado)
        assert datos["totalFilas"] == int(sql("salon_gestion", "SELECT count(*) FROM inventory_items WHERE is_critical_stock"))
        assert all(fila["critico"] == "Sí" for fila in datos["vistaPrevia"])

    def test_pdf_de_facturas_agrupado_por_servicio(self, admin):
        _, resultado = reporte(admin, entidad="facturas", columnas=["servicio", "total"], agrupar_por="servicio", formato="pdf")
        datos, archivo = contenido(resultado)
        assert archivo[:5] == b"%PDF-"
        esperado = sql("salon_crm", "SELECT count(DISTINCT coalesce(service_name, '')) FROM invoices")
        assert datos["totalFilas"] == int(esperado)
        suma = float(sql("salon_crm", "SELECT coalesce(sum(total_amount), 0) FROM invoices"))
        assert round(sum(fila["total"] for fila in datos["vistaPrevia"]), 2) == round(suma, 2)

    def test_citas_por_fecha_y_estado_en_espanol(self, admin):
        _, resultado = reporte(admin, entidad="citas", desde="2026-01-01", hasta="2026-12-31", filtros={"estado": "Confirmada"})
        datos, _ = contenido(resultado)
        esperado = sql("salon_gestion", "SELECT count(*) FROM appointments WHERE status='CONFIRMED' AND appointment_date >= '2026-01-01' AND appointment_date < '2027-01-01'")
        assert datos["totalFilas"] == int(esperado)
        assert all(fila["estado"] == "Confirmada" for fila in datos["vistaPrevia"])

    def test_un_intento_de_inyeccion_no_cambia_nada(self, admin):
        antes = sql("salon_crm", "SELECT count(*) FROM invoices")
        _, resultado = reporte(admin, entidad="facturas", filtros={"cliente": "x'; DELETE FROM invoices; --"})
        datos, _ = contenido(resultado)
        assert datos["totalFilas"] == 0
        assert sql("salon_crm", "SELECT count(*) FROM invoices") == antes

    def test_columna_inexistente_explica_las_validas(self, admin):
        _, resultado = reporte(admin, entidad="citas", columnas=["password"])
        assert resultado["isError"]
        assert "Columnas no válidas" in resultado["content"][0]["text"]


class TestPermisosYSoloLectura:
    def test_un_estilista_no_puede_generar_reportes(self):
        respuesta, _ = reporte(login(STYLIST), entidad="facturas")
        assert respuesta.status_code == 403

    def test_el_usuario_de_reportes_no_puede_escribir(self):
        resultado = subprocess.run(
            ["docker", "exec", "-e", "PGPASSWORD=salon_reportes_local", "salon-postgres", "psql", "-h", "localhost",
             "-U", "salon_reportes", "-d", "salon_crm", "-Atc", "UPDATE invoices SET status = status WHERE false"],
            capture_output=True, text=True, encoding="utf-8",
        )
        assert "read-only transaction" in resultado.stderr
