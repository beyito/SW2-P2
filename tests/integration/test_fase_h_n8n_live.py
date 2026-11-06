"""
Pruebas en vivo de los flujos de n8n (CU-19, RF-12), disparados por eventos reales de RabbitMQ.
La API de WhatsApp se sustituye por un servidor local que captura lo que n8n le envía.
Reinicia n8n con esa configuración y lo restaura al terminar. Lo que crea se borra.
"""
import datetime
import http.server
import json
import os
import subprocess
import threading
import time
import uuid
import zoneinfo

import httpx
import pytest

from soporte_crm import foto_de_puntos, limpiar_crm_de_pruebas, sql_crm, sql_gestion
from test_crm_live import CLIENTE, CLIENTE_ID, crm, reservar_y_pagar
from test_seguridad_live import CLIENT, STYLIST, login

N8N = "http://localhost:5678"
RABBIT = ("rabbit_admin", "rabbit_secret_pass")
CLAVE = "clave-local-de-automatizacion"
PUERTO = 19099
TOKEN_WA = "token-de-prueba"
TELEFONO_ADMIN = "59170000000"
ZONA = zoneinfo.ZoneInfo("America/La_Paz")
ESTILISTA = "sty-103"


class WhatsappFalso(http.server.BaseHTTPRequestHandler):
    """Se comporta como la API de Meta y guarda cada mensaje."""

    recibidos = []

    def do_POST(self):
        cuerpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        WhatsappFalso.recibidos.append({"ruta": self.path, "auth": self.headers.get("Authorization"), "cuerpo": cuerpo})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"messages": [{"id": "wamid.prueba"}]}')

    def log_message(self, *_):
        pass


def reiniciar_n8n(**entorno):
    subprocess.run(
        ["docker", "compose", "up", "-d", "--force-recreate", "--wait", "n8n"],
        check=True, capture_output=True, env={**os.environ, **entorno},
    )
    # Tras quedar sano, n8n todavía tarda en conectar sus disparadores de RabbitMQ
    limite = time.time() + 60
    while time.time() < limite:
        colas = {q["name"]: q for q in httpx.get("http://localhost:15672/api/queues", auth=RABBIT).json()}
        if all(colas.get(nombre, {}).get("consumers", 0) >= 1 for nombre in ("n8n.saga.completed", "n8n.stock.critical")):
            return
        time.sleep(1)
    raise AssertionError("n8n no se conectó a RabbitMQ")


@pytest.fixture(scope="module")
def whatsapp():
    servidor = http.server.ThreadingHTTPServer(("0.0.0.0", PUERTO), WhatsappFalso)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    reiniciar_n8n(
        WHATSAPP_API_URL=f"http://host.docker.internal:{PUERTO}",
        WHATSAPP_TOKEN=TOKEN_WA,
        WHATSAPP_PHONE_NUMBER_ID="123",
        WHATSAPP_VERIFY_TOKEN="verificar",
        WHATSAPP_ADMIN_PHONE=f"+{TELEFONO_ADMIN}",
    )
    yield WhatsappFalso
    servidor.shutdown()
    reiniciar_n8n()


@pytest.fixture(autouse=True)
def estado_limpio(whatsapp):
    """Parte sin mensajes capturados y restaura la autorización, el teléfono y los avisos del cliente."""
    whatsapp.recibidos.clear()
    fila = sql_crm(f"SELECT whatsapp_opt_in::text || '|' || phone FROM crm_clients WHERE id='{CLIENTE_ID}'")
    autorizado, telefono = fila.split("|")
    foto = foto_de_puntos()
    inicio = sql_crm("SELECT NOW()")
    yield
    limpiar_crm_de_pruebas(foto)
    # Las citas pagadas de la prueba, y lo que consumieron del inventario
    sql_gestion(
        "UPDATE inventory_items i SET current_stock = current_stock - m.total FROM (SELECT item_id, SUM(quantity_change) AS total "
        "FROM inventory_logs WHERE appointment_id IN (SELECT id FROM appointments WHERE appointment_date >= '2036-01-01') GROUP BY item_id) m "
        "WHERE i.id = m.item_id"
    )
    sql_gestion("DELETE FROM inventory_logs WHERE appointment_id IN (SELECT id FROM appointments WHERE appointment_date >= '2036-01-01')")
    sql_gestion("DELETE FROM appointments WHERE appointment_date >= '2036-01-01'")
    sql_crm(f"UPDATE crm_clients SET whatsapp_opt_in={autorizado}, phone='{telefono}' WHERE id='{CLIENTE_ID}'")
    sql_crm(f"DELETE FROM notices WHERE created_at >= '{inicio}' AND (source_ref LIKE 'automation:%' OR source_ref LIKE 'stock:E2E%')")


def autorizar(telefono="+591-70012345", si=True):
    sql_crm(f"UPDATE crm_clients SET whatsapp_opt_in={str(si).lower()}, phone='{telefono}' WHERE id='{CLIENTE_ID}'")


def esperar_mensajes(whatsapp, cantidad=1, timeout=30):
    limite = time.time() + timeout
    while time.time() < limite:
        if len(whatsapp.recibidos) >= cantidad:
            return whatsapp.recibidos
        time.sleep(0.3)
    raise AssertionError(f"Se esperaban {cantidad} mensajes y llegaron {len(whatsapp.recibidos)}")


def sin_mensajes(whatsapp, segundos=6):
    time.sleep(segundos)
    assert whatsapp.recibidos == []


def publicar(routing_key, cuerpo):
    respuesta = httpx.post(
        "http://localhost:15672/api/exchanges/%2F/salon.saga/publish",
        auth=RABBIT,
        json={"properties": {"content_type": "application/json"}, "routing_key": routing_key,
              "payload": json.dumps(cuerpo), "payload_encoding": "string"},
    )
    assert respuesta.json()["routed"] is True


def publicar_solo_a_n8n(cola, cuerpo):
    """Directo a la cola de n8n: un evento incompleto no debe llegar al CRM, que con razón lo rechazaría."""
    respuesta = httpx.post(
        "http://localhost:15672/api/exchanges/%2F/amq.default/publish",
        auth=RABBIT,
        json={"properties": {"content_type": "application/json"}, "routing_key": cola,
              "payload": json.dumps(cuerpo), "payload_encoding": "string"},
    )
    assert respuesta.json()["routed"] is True


def ejecutar_recordatorios():
    return httpx.post(f"{N8N}/webhook/recordatorios/ejecutar", headers={"x-automation-key": CLAVE}, timeout=30)


class CitaProxima:
    """Cita real en la base, dentro de la ventana del recordatorio."""

    def __init__(self, horas=23.5, estado="CONFIRMED"):
        self.horas = horas
        self.estado = estado
        self.id = f"prueba-n8n-{uuid.uuid4().hex[:12]}"

    def __enter__(self):
        fecha = datetime.datetime.now(ZONA).replace(tzinfo=None) + datetime.timedelta(hours=self.horas)
        sql_gestion(
            "INSERT INTO appointments (id, client_id, stylist_id, service_name, appointment_date, "
            "duration_minutes, total_price, status, created_at, updated_at) VALUES "
            f"('{self.id}', '{CLIENTE_ID}', '{ESTILISTA}', '[prueba] Corte', '{fecha}', "
            f"30, 45, '{self.estado}', NOW(), NOW())"
        )
        return self

    def __exit__(self, *_):
        sql_gestion(f"DELETE FROM appointments WHERE id='{self.id}'")

    def avisos(self):
        return sql_crm(f"SELECT count(*) FROM notices WHERE source_ref='automation:reminder:{self.id}'")


class TestDespliegue:
    def test_los_cuatro_flujos_quedan_activos_sin_pasos_manuales(self):
        activos = subprocess.run(
            ["docker", "exec", "salon-n8n", "n8n", "list:workflow", "--active=true"],
            capture_output=True, text=True, check=True, encoding="utf-8",
        ).stdout
        for nombre in ("Confirmación de reserva", "Recordatorio de cita", "Alerta de stock", "Respuestas y reservas"):
            assert nombre in activos, activos

    def test_n8n_consume_de_sus_colas_en_rabbitmq(self):
        colas = {q["name"]: q for q in httpx.get("http://localhost:15672/api/queues", auth=RABBIT).json()}
        assert colas["n8n.saga.completed"]["consumers"] >= 1
        assert colas["n8n.stock.critical"]["consumers"] >= 1


class TestConfirmacion:
    def test_un_pago_real_envia_la_confirmacion_con_el_formato_de_meta(self, whatsapp):
        autorizar()
        reservar_y_pagar(login(CLIENTE))
        mensaje = esperar_mensajes(whatsapp)[0]
        assert mensaje["ruta"] == "/123/messages"
        assert mensaje["auth"] == f"Bearer {TOKEN_WA}"
        assert mensaje["cuerpo"]["messaging_product"] == "whatsapp"
        assert mensaje["cuerpo"]["to"] == "59170012345"
        assert mensaje["cuerpo"]["type"] == "text"
        assert "Corte" in mensaje["cuerpo"]["text"]["body"]
        assert sql_crm(f"SELECT split_part(full_name, ' ', 1) FROM crm_clients WHERE id='{CLIENTE_ID}'") in mensaje["cuerpo"]["text"]["body"]

    def test_sin_autorizacion_no_se_envia_nada(self, whatsapp):
        autorizar(si=False)
        reservar_y_pagar(login(CLIENTE))
        sin_mensajes(whatsapp)

    def test_sin_telefono_no_se_envia_nada(self, whatsapp):
        autorizar(telefono="")
        publicar_solo_a_n8n("n8n.saga.completed", {"clientId": CLIENTE_ID, "serviceName": "Corte", "sagaId": str(uuid.uuid4())})
        sin_mensajes(whatsapp)


class TestRecordatorio:
    def test_avisa_una_sola_vez_aunque_el_flujo_corra_varias_veces(self, whatsapp):
        autorizar()
        with CitaProxima() as cita:
            assert ejecutar_recordatorios().status_code == 200
            mensaje = esperar_mensajes(whatsapp)[0]["cuerpo"]
            assert mensaje["to"] == "59170012345"
            assert "[prueba] Corte" in mensaje["text"]["body"]
            assert "Responde 1" in mensaje["text"]["body"]
            assert cita.avisos() == "1"

            ejecutar_recordatorios()
            ejecutar_recordatorios()
            time.sleep(3)
            assert len(whatsapp.recibidos) == 1
            assert cita.avisos() == "1"

    def test_sin_autorizar_whatsapp_igual_llega_el_aviso_en_la_aplicacion(self, whatsapp):
        autorizar(si=False)
        with CitaProxima() as cita:
            ejecutar_recordatorios()
            limite = time.time() + 15
            while time.time() < limite and cita.avisos() != "1":
                time.sleep(0.3)
            assert cita.avisos() == "1"
            assert whatsapp.recibidos == []

    @pytest.mark.parametrize("horas,estado", [(5, "CONFIRMED"), (30, "CONFIRMED"), (23.5, "CANCELLED")])
    def test_no_avisa_fuera_de_la_ventana_ni_a_citas_canceladas(self, whatsapp, horas, estado):
        autorizar()
        with CitaProxima(horas, estado) as cita:
            ejecutar_recordatorios()
            time.sleep(3)
            assert cita.avisos() == "0"
            assert whatsapp.recibidos == []

    def test_la_ejecucion_manual_exige_la_clave(self):
        with CitaProxima() as cita:
            respuesta = httpx.post(f"{N8N}/webhook/recordatorios/ejecutar", headers={"x-automation-key": "incorrecta"}, timeout=30)
            assert respuesta.status_code >= 400
            assert cita.avisos() == "0"

    def test_usa_la_plantilla_aprobada_si_esta_configurada(self, whatsapp):
        reiniciar_n8n(
            WHATSAPP_API_URL=f"http://host.docker.internal:{PUERTO}", WHATSAPP_TOKEN=TOKEN_WA, WHATSAPP_PHONE_NUMBER_ID="123",
            WHATSAPP_TEMPLATE_RECORDATORIO="recordatorio_cita",
        )
        try:
            autorizar()
            with CitaProxima():
                ejecutar_recordatorios()
                cuerpo = esperar_mensajes(whatsapp)[0]["cuerpo"]
                assert cuerpo["type"] == "template"
                assert cuerpo["template"]["name"] == "recordatorio_cita"
                assert cuerpo["template"]["components"][0]["parameters"][0]["text"] == "[prueba] Corte"
        finally:
            reiniciar_n8n(
                WHATSAPP_API_URL=f"http://host.docker.internal:{PUERTO}", WHATSAPP_TOKEN=TOKEN_WA, WHATSAPP_PHONE_NUMBER_ID="123",
                WHATSAPP_VERIFY_TOKEN="verificar", WHATSAPP_ADMIN_PHONE=f"+{TELEFONO_ADMIN}",
            )


class TestStock:
    def test_el_evento_real_de_stock_avisa_al_administrador(self, whatsapp):
        publicar("inventory.stock.critical", {"items": ["E2E-KERATINA"]})
        mensaje = esperar_mensajes(whatsapp)[0]["cuerpo"]
        assert mensaje["to"] == TELEFONO_ADMIN
        assert "E2E-KERATINA" in mensaje["text"]["body"]


class TestEntrante:
    def entrante(self, texto, tipo="text"):
        cuerpo = {"entry": [{"changes": [{"value": {"messages": [{"from": "59171111111", "type": tipo, "text": {"body": texto}}]}}]}]}
        assert httpx.post(f"{N8N}/webhook/whatsapp/entrante", json=cuerpo, timeout=15).status_code == 200

    def test_reservar_responde_con_los_servicios_y_precios_reales(self, whatsapp):
        self.entrante("Quiero reservar una cita")
        cuerpo = esperar_mensajes(whatsapp)[0]["cuerpo"]
        assert cuerpo["to"] == "59171111111"
        servicio = sql_gestion("SELECT name || ': $' || to_char(price, 'FM999990.00') FROM services WHERE active ORDER BY id LIMIT 1")
        assert servicio in cuerpo["text"]["body"]
        assert "localhost:3000" in cuerpo["text"]["body"]

    @pytest.mark.parametrize("texto,esperado", [("1", "Te esperamos"), ("2", "reprogramar"), ("hola", "reservar")])
    def test_responde_a_las_opciones_del_recordatorio(self, whatsapp, texto, esperado):
        self.entrante(texto)
        assert esperado in esperar_mensajes(whatsapp)[0]["cuerpo"]["text"]["body"]

    def test_ignora_los_avisos_de_entrega_de_meta(self, whatsapp):
        cuerpo = {"entry": [{"changes": [{"value": {"statuses": [{"status": "delivered"}]}}]}]}
        assert httpx.post(f"{N8N}/webhook/whatsapp/entrante", json=cuerpo, timeout=15).status_code == 200
        sin_mensajes(whatsapp, 3)

    def test_verificacion_de_meta(self):
        bueno = httpx.get(f"{N8N}/webhook/whatsapp/entrante", params={"hub.mode": "subscribe", "hub.verify_token": "verificar", "hub.challenge": "12345"}, timeout=15)
        assert bueno.status_code == 200 and bueno.text == "12345"
        malo = httpx.get(f"{N8N}/webhook/whatsapp/entrante", params={"hub.verify_token": "otro", "hub.challenge": "12345"}, timeout=15)
        assert malo.status_code >= 400 or "12345" not in malo.text


class TestPermisos:
    AVISO = 'mutation{recordAutomationNotice(recipient:"cli-001",title:"x",message:"y",sourceRef:"prueba-permiso")}'

    @pytest.mark.parametrize("credenciales", [CLIENT, STYLIST])
    def test_solo_una_cuenta_autorizada_crea_avisos_de_automatizacion(self, credenciales):
        cuerpo = crm(self.AVISO, login(credenciales)).json()
        assert "errors" in cuerpo
        assert sql_crm("SELECT count(*) FROM notices WHERE source_ref='automation:prueba-permiso'") == "0"

    def test_el_cliente_gestiona_su_propia_autorizacion(self):
        cliente = login(CLIENTE)
        assert crm("mutation{setMyWhatsappOptIn(enabled:true){whatsappOptIn}}", cliente).json()["data"]["setMyWhatsappOptIn"]["whatsappOptIn"] is True
        assert sql_crm(f"SELECT whatsapp_opt_in FROM crm_clients WHERE id='{CLIENTE_ID}'") == "t"
        assert crm("mutation{setMyWhatsappOptIn(enabled:false){whatsappOptIn}}", cliente).json()["data"]["setMyWhatsappOptIn"]["whatsappOptIn"] is False
