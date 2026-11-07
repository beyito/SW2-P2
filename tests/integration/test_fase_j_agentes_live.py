"""
Pruebas en vivo de los agentes y sus propuestas, contra Keycloak, DynamoDB, ms-gestion y el Servidor MCP reales.
Llaman a las herramientas directamente, así que no consumen el cupo del modelo. Todo lo que cambian se restaura.
Requiere el entorno levantado: docker compose up -d --wait
"""
import json
import subprocess
import uuid

import pytest

from test_seguridad_live import ADMIN, CLIENT, STYLIST, login, rpc

INSUMO = "inv-003"
ESTILISTA = "sty-103"
SERVICIO = "srv-03"
FECHA_LIBRE = "2043-03-10"


def sql(consulta):
    resultado = subprocess.run(
        ["docker", "exec", "salon-postgres", "psql", "-U", "salon_admin", "-d", "salon_gestion", "-Atc", consulta],
        capture_output=True, text=True, check=True, encoding="utf-8",
    )
    return resultado.stdout.strip()


def herramienta(token, nombre, **argumentos):
    return rpc("tools/call", {"name": nombre, "arguments": argumentos}, token).json()["result"]


def datos(resultado):
    assert not resultado.get("isError"), resultado
    return resultado["structuredContent"]


def stock():
    return int(sql(f"SELECT current_stock FROM inventory_items WHERE id='{INSUMO}'"))


@pytest.fixture(scope="module")
def admin():
    return login(ADMIN)


@pytest.fixture(scope="module")
def estilista():
    return login(STYLIST)


@pytest.fixture
def stock_restaurado():
    inicial = stock()
    yield inicial
    sql(f"UPDATE inventory_items SET current_stock={inicial} WHERE id='{INSUMO}'")
    sql(f"DELETE FROM inventory_logs WHERE item_id='{INSUMO}' AND reason LIKE 'Reposición propuesta por el agente%'")


@pytest.fixture
def cita():
    identificador = str(uuid.uuid4())
    sql(
        "INSERT INTO appointments (id, client_id, stylist_id, service_id, service_name, appointment_date, "
        "duration_minutes, total_price, status, created_at, updated_at) VALUES "
        f"('{identificador}', 'cli-001', '{ESTILISTA}', '{SERVICIO}', 'Corte Visagista & Styling', '{FECHA_LIBRE} 09:00', "
        "45, 45, 'CONFIRMED', NOW(), NOW())"
    )
    yield identificador
    sql(f"DELETE FROM appointments WHERE id='{identificador}'")


def nombres(token):
    return {tool["name"] for tool in rpc("tools/list", {}, token).json()["result"]["tools"]}


class TestPermisos:
    def test_cada_rol_ve_sus_herramientas(self, admin, estilista):
        assert {"proponer_reposicion", "proponer_reprogramacion", "confirmar_accion", "consultar_agenda"} <= nombres(admin)
        herramientas = nombres(estilista)
        assert "proponer_reposicion" not in herramientas
        assert {"proponer_reprogramacion", "consultar_agenda", "consultar_inventario"} <= herramientas

    @pytest.mark.parametrize("nombre", ["confirmar_accion", "rechazar_accion", "proponer_reposicion", "consultar_agenda", "consultar_inventario"])
    def test_un_cliente_recibe_403(self, nombre):
        respuesta = rpc("tools/call", {"name": nombre, "arguments": {}}, login(CLIENT))
        assert respuesta.status_code == 403

    def test_el_estilista_no_puede_proponer_reposicion(self, estilista):
        assert rpc("tools/call", {"name": "proponer_reposicion", "arguments": {"itemId": INSUMO, "quantity": 1}}, estilista).status_code == 403

    @pytest.mark.parametrize("nombre", ["confirmar_accion", "rechazar_accion", "proponer_reposicion"])
    def test_sin_token_recibe_401(self, nombre):
        assert rpc("tools/call", {"name": nombre, "arguments": {}}, None).status_code == 401


class TestReposicion:
    def test_proponer_no_cambia_nada_y_confirmar_si(self, admin, stock_restaurado):
        propuesta = datos(herramienta(admin, "proponer_reposicion", itemId=INSUMO, quantity=7, reason="Prueba"))
        assert propuesta["status"] == "PENDIENTE_DE_CONFIRMACION"
        assert f"de {stock_restaurado} a {stock_restaurado + 7}" in propuesta["summary"]
        assert stock() == stock_restaurado

        confirmada = datos(herramienta(admin, "confirmar_accion", actionId=propuesta["actionId"]))
        assert confirmada["executed"] is True
        assert confirmada["item"]["currentStock"] == stock_restaurado + 7
        assert stock() == stock_restaurado + 7

    def test_confirmar_dos_veces_solo_aplica_una(self, admin, stock_restaurado):
        propuesta = datos(herramienta(admin, "proponer_reposicion", itemId=INSUMO, quantity=2))
        assert not herramienta(admin, "confirmar_accion", actionId=propuesta["actionId"]).get("isError")
        segunda = herramienta(admin, "confirmar_accion", actionId=propuesta["actionId"])
        assert segunda["isError"] and "ya no está disponible" in segunda["content"][0]["text"]
        assert stock() == stock_restaurado + 2

    def test_rechazar_no_cambia_nada_y_la_retira(self, admin, stock_restaurado):
        propuesta = datos(herramienta(admin, "proponer_reposicion", itemId=INSUMO, quantity=2))
        assert datos(herramienta(admin, "rechazar_accion", actionId=propuesta["actionId"]))["rejected"] is True
        assert herramienta(admin, "confirmar_accion", actionId=propuesta["actionId"])["isError"]
        assert stock() == stock_restaurado

    def test_otra_persona_no_puede_confirmarla(self, admin, estilista, stock_restaurado):
        propuesta = datos(herramienta(admin, "proponer_reposicion", itemId=INSUMO, quantity=2))
        assert herramienta(estilista, "confirmar_accion", actionId=propuesta["actionId"])["isError"]
        assert stock() == stock_restaurado
        # Sigue disponible para quien la pidió
        datos(herramienta(admin, "rechazar_accion", actionId=propuesta["actionId"]))

    def test_una_propuesta_inventada_no_existe(self, admin):
        assert herramienta(admin, "confirmar_accion", actionId=str(uuid.uuid4()))["isError"]

    def test_valida_cantidad_e_insumo(self, admin, stock_restaurado):
        assert herramienta(admin, "proponer_reposicion", itemId=INSUMO, quantity=-5)["isError"]
        assert herramienta(admin, "proponer_reposicion", itemId=INSUMO, quantity=100000)["isError"]
        assert herramienta(admin, "proponer_reposicion", itemId="no-existe", quantity=1)["isError"]
        assert stock() == stock_restaurado

    def test_una_propuesta_vencida_no_se_ejecuta(self, admin, stock_restaurado):
        propuesta = datos(herramienta(admin, "proponer_reposicion", itemId=INSUMO, quantity=2))
        vencer = f"""
const http = require('node:http');
const body = JSON.stringify({{TableName:'AgentPendingActions',Key:{{actionId:{{S:'{propuesta["actionId"]}'}}}},UpdateExpression:'SET expiresAt = :v',ExpressionAttributeValues:{{':v':{{N:'1000'}}}}}});
const req = http.request(process.env.DYNAMODB_ENDPOINT, {{method:'POST',headers:{{'Content-Type':'application/x-amz-json-1.0','X-Amz-Target':'DynamoDB_20120810.UpdateItem','Authorization':'AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, SignedHeaders=host, Signature=local'}}}}, (r) => {{ r.resume(); r.on('end', () => process.exit(r.statusCode === 200 ? 0 : 1)); }});
req.end(body);
"""
        subprocess.run(["docker", "exec", "-i", "salon-mcp-server", "node", "-"], input=vencer, text=True, check=True, encoding="utf-8")
        resultado = herramienta(admin, "confirmar_accion", actionId=propuesta["actionId"])
        assert resultado["isError"] and "venció" in resultado["content"][0]["text"]
        assert stock() == stock_restaurado


class TestAgenda:
    def libre(self, admin):
        turnos = datos(herramienta(admin, "consultar_disponibilidad_estilista", stylistId=ESTILISTA, date=FECHA_LIBRE, serviceId=SERVICIO))
        return turnos["availableSlots"][-1]["start"]

    def test_la_agenda_no_trae_datos_de_clientes_ni_precios(self, admin, cita):
        agenda = datos(herramienta(admin, "consultar_agenda", **{"from": FECHA_LIBRE, "to": FECHA_LIBRE}))
        encontrada = next(item for item in agenda["appointments"] if item["id"] == cita)
        assert encontrada["stylistName"] and encontrada["serviceName"]
        assert "clientId" not in encontrada and "totalPrice" not in encontrada
        assert "cli-001" not in json.dumps(agenda)

    def test_mover_una_cita_requiere_confirmacion(self, admin, cita):
        nuevo = self.libre(admin)
        propuesta = datos(herramienta(admin, "proponer_reprogramacion", appointmentId=cita, newDate=nuevo))
        assert sql(f"SELECT appointment_date::time FROM appointments WHERE id='{cita}'") == "09:00:00"
        assert datos(herramienta(admin, "confirmar_accion", actionId=propuesta["actionId"]))["executed"] is True
        assert sql(f"SELECT to_char(appointment_date, 'HH24:MI') FROM appointments WHERE id='{cita}'") == nuevo[11:16]

    def test_no_propone_un_turno_ocupado(self, admin, cita):
        resultado = herramienta(admin, "proponer_reprogramacion", appointmentId=cita, newDate=f"{FECHA_LIBRE}T09:00:00")
        assert resultado["isError"] and "no está libre" in resultado["content"][0]["text"]

    def test_si_el_turno_se_ocupa_antes_de_confirmar_no_se_mueve(self, admin, cita):
        nuevo = self.libre(admin)
        propuesta = datos(herramienta(admin, "proponer_reprogramacion", appointmentId=cita, newDate=nuevo))
        rival = str(uuid.uuid4())
        sql(
            "INSERT INTO appointments (id, client_id, stylist_id, service_id, service_name, appointment_date, "
            "duration_minutes, total_price, status, created_at, updated_at) VALUES "
            f"('{rival}', 'cli-002', '{ESTILISTA}', '{SERVICIO}', 'Corte', '{nuevo.replace('T', ' ')}', "
            "45, 45, 'CONFIRMED', NOW(), NOW())"
        )
        try:
            assert herramienta(admin, "confirmar_accion", actionId=propuesta["actionId"])["isError"]
            assert sql(f"SELECT appointment_date::time FROM appointments WHERE id='{cita}'") == "09:00:00"
        finally:
            sql(f"DELETE FROM appointments WHERE id='{rival}'")

    def test_una_cita_cancelada_no_se_mueve(self, admin, cita):
        nuevo = self.libre(admin)
        sql(f"UPDATE appointments SET status='CANCELLED' WHERE id='{cita}'")
        resultado = herramienta(admin, "proponer_reprogramacion", appointmentId=cita, newDate=nuevo)
        assert resultado["isError"] and "confirmadas" in resultado["content"][0]["text"]


class TestAgentes:
    def test_un_agente_inexistente_se_rechaza(self, admin):
        resultado = herramienta(admin, "preguntar_al_agente", prompt="hola", agente="pirata")
        assert resultado["isError"]

    def test_las_skills_estan_dentro_de_la_imagen(self):
        resultado = subprocess.run(
            ["docker", "exec", "salon-mcp-server", "node", "-e", "console.log(Object.keys(require('./src/tools').SKILLS).sort().join())"],
            capture_output=True, text=True, check=True, encoding="utf-8",
        )
        assert resultado.stdout.strip() == "agenda,inventario,operacion"
