"""
Pruebas en vivo de la Fase M: actor Recepcionista (RF-01, RF-02, RF-03, RF-07, RF-08, RNF-03, RNF-04).
Cobro en el mostrador por la SAGA real, llegada y ausencia, permisos y sesión única.
Requiere el entorno levantado: docker compose up -d --wait

Las reservas usan fechas posteriores a 2036. La llegada y la ausencia solo se registran el día de la cita,
así que esas pruebas insertan citas de hoy a medianoche con identificadores propios y las borran al terminar.
No llama a Stripe: el cobro del mostrador no pasa por la pasarela.
"""
import datetime
import subprocess
import time
import uuid

import httpx
import pytest

from soporte_crm import foto_de_puntos, limpiar_crm_de_pruebas, sql_crm
from test_saga_live import CORTE, ITEM_KERATINA, KERATINA, SAGA, STYLIST_ID, future_slot, sql, stock
from test_seguridad_live import ADMIN, CLIENT, CRM, SERVICIOS, STYLIST, auth, gql, login

RECEPCION = ("recepcion.salon", "Recepcion#2026")
CLIENTE_MOSTRADOR = "cli-002"
TERMINAL = {"COMPLETED", "COMPENSATED", "FAILED"}
PREFIJO_HOY = "tc-recep-"
# Las citas se guardan en la hora local del salón (America/La_Paz, UTC-4 sin horario de verano)
HORA_SALON = datetime.timezone(datetime.timedelta(hours=-4))


def hoy_en_el_salon():
    return datetime.datetime.now(HORA_SALON).date().isoformat()


def crm(query, token, variables=None):
    return httpx.post(f"{CRM}/graphql", json={"query": query, "variables": variables or {}}, headers=auth(token), timeout=15)


def mostrador(token, payment_method="CASH", date=None, key=None, service=CORTE):
    return httpx.post(
        f"{SAGA}/counter/bookings",
        headers={**auth(token), "Idempotency-Key": key or str(uuid.uuid4())},
        json={
            "clientId": CLIENTE_MOSTRADOR, "clientName": "Alejandro Morales", "clientEmail": "alejandro@correo.test",
            "serviceId": service, "stylistId": STYLIST_ID, "appointmentDate": date or future_slot(),
            "paymentMethod": payment_method,
        },
        timeout=15,
    )


def esperar(token, saga_id, estados, timeout=30):
    limite = time.time() + timeout
    while time.time() < limite:
        vista = httpx.get(f"{SAGA}/bookings/{saga_id}", headers=auth(token)).json()
        if vista["status"] in estados:
            return vista
        time.sleep(0.2)
    raise AssertionError(f"La SAGA {saga_id} quedó en {vista['status']} ({vista['failureReason']}), se esperaba {estados}")


def accion(token, saga_id, nombre):
    return httpx.post(f"{SAGA}/counter/bookings/{saga_id}/{nombre}", headers=auth(token), timeout=15)


def esperar_factura(saga_id, timeout=20):
    limite = time.time() + timeout
    while time.time() < limite:
        fila = sql_crm(f"SELECT id || '|' || payment_method || '|' || payment_reference FROM invoices WHERE saga_id='{saga_id}'")
        if fila:
            return fila.split("|")
        time.sleep(0.5)
    raise AssertionError(f"No se emitió la factura de la SAGA {saga_id}")


def cita_de_hoy(sufijo, minuto, estado="CONFIRMED", stylist=STYLIST_ID):
    """Cita de hoy a medianoche, de un minuto, para probar llegada y ausencia sin chocar con citas reales."""
    identificador = f"{PREFIJO_HOY}{sufijo}"
    sql(
        "INSERT INTO appointments (id, client_id, stylist_id, service_name, appointment_date, duration_minutes, "
        "total_price, status, created_at, updated_at) VALUES "
        f"('{identificador}', '{CLIENTE_MOSTRADOR}', '{stylist}', 'Prueba recepción', "
        f"'{hoy_en_el_salon()}'::timestamp + INTERVAL '{minuto} minutes', 1, 10, '{estado}', NOW(), NOW())"
    )
    return identificador


def mutacion(token, nombre, identificador):
    return gql(f'mutation {{ {nombre}(id: "{identificador}") {{ id status checkedInAt }} }}', token).json()


@pytest.fixture(scope="module", autouse=True)
def limpieza():
    existencias = sql("SELECT id || '=' || current_stock FROM inventory_items")
    puntos = foto_de_puntos()
    yield
    limpiar_crm_de_pruebas(puntos)
    sql("DELETE FROM inventory_logs WHERE reason='Consumo por cita confirmada' AND appointment_id IN "
        "(SELECT id FROM appointments WHERE appointment_date >= '2036-01-01')")
    sql("DELETE FROM appointments WHERE appointment_date >= '2036-01-01'")
    sql(f"DELETE FROM appointments WHERE id LIKE '{PREFIJO_HOY}%'")
    for linea in existencias.splitlines():
        item, valor = linea.split("=")
        sql(f"UPDATE inventory_items SET current_stock={valor} WHERE id='{item}'")


@pytest.fixture
def recepcion():
    # auth_time tiene resolución de un segundo: dos logins en el mismo segundo no se ordenan
    time.sleep(1.2)
    return login(RECEPCION)


class TestSesionYPermisos:
    def test_la_recepcion_tiene_sesion_unica_en_todos_los_servicios(self):
        time.sleep(1.2)
        anterior = login(RECEPCION)
        assert SERVICIOS["ms-gestion"](anterior).status_code == 200
        time.sleep(1.2)
        nuevo = login(RECEPCION)
        # El nuevo login se registra en un servicio y todos rechazan el anterior
        assert SERVICIOS["ms-crm"](nuevo).status_code == 200
        for servicio in SERVICIOS:
            assert SERVICIOS[servicio](anterior).status_code == 401, servicio
        assert httpx.get(f"{SAGA}/bookings/no-existe", headers=auth(anterior)).status_code == 401

    def test_ve_la_agenda_los_estilistas_y_los_clientes(self, recepcion):
        assert "errors" not in gql("{ getPanelAgenda(from: \"2036-01-01\", to: \"2036-01-02\") { id checkedInAt } }", recepcion).json()
        assert gql("{ getAllStylists { id } }", recepcion).json()["data"]["getAllStylists"]
        clientes = crm("{ getClients { id } }", recepcion).json()
        assert "errors" not in clientes and clientes["data"]["getClients"]

    def test_configura_horarios_de_estilistas(self, recepcion):
        # Guarda el mismo bloque que ya existe: prueba el permiso sin cambiar la jornada real
        consulta = (f"SELECT to_char(start_time,'HH24:MI') || '|' || to_char(end_time,'HH24:MI') || '|' "
                    f"|| CASE WHEN is_available THEN 'true' ELSE 'false' END "
                    f"FROM stylist_schedules WHERE stylist_id='{STYLIST_ID}' AND day_of_week=1")
        antes = sql(consulta)
        inicio_turno, fin_turno, disponible = antes.split("|")
        try:
            cuerpo = gql(
                f'mutation {{ setStylistSchedule(input: {{ stylistId: "{STYLIST_ID}", dayOfWeek: 1, '
                f'startTime: "{inicio_turno}", endTime: "{fin_turno}", isAvailable: {disponible} }}) {{ id }} }}',
                recepcion,
            ).json()
            assert "errors" not in cuerpo, cuerpo
            assert sql(consulta) == antes
        finally:
            sql(f"UPDATE stylist_schedules SET start_time='{inicio_turno}', end_time='{fin_turno}', "
                f"is_available={disponible} WHERE stylist_id='{STYLIST_ID}' AND day_of_week=1")

    @pytest.mark.parametrize("consulta", [
        '{ getPanelSummary(from: "2036-01-01", to: "2036-01-02") { totalAppointments } }',
        '{ getAllInventory { id } }',
        'mutation { createStylist(input: { name: "No permitido" }) { id } }',
        'mutation { updateMinimumStock(id: "inv-002", minimumStock: 1) { id } }',
        'mutation { scheduleAppointment(input: { clientId: "cli-002", stylistId: "sty-101", serviceId: "srv-03", '
        'appointmentDate: "2036-03-03T10:00:00" }) { id } }',
    ])
    def test_no_accede_a_inventario_finanzas_ni_reservas_sin_pago(self, recepcion, consulta):
        cuerpo = gql(consulta, recepcion).json()
        assert cuerpo.get("errors"), cuerpo
        assert cuerpo["errors"][0]["extensions"]["classification"] == "FORBIDDEN"

    def test_no_ve_las_metricas_del_crm(self, recepcion):
        cuerpo = crm('{ getCrmMetrics(from: "2036-01-01", to: "2036-01-02") { revenue } }', recepcion).json()
        assert cuerpo.get("errors")

    @pytest.mark.parametrize("credenciales", [CLIENT, STYLIST])
    def test_clientes_y_estilistas_no_usan_el_mostrador(self, credenciales):
        assert mostrador(login(credenciales)).status_code == 403


class TestCobroEnMostrador:
    def test_cobro_en_efectivo_confirma_la_cita_descuenta_insumos_y_factura(self, recepcion):
        antes, _ = stock(ITEM_KERATINA)
        puntos_antes = int(sql_crm(f"SELECT loyalty_points FROM crm_clients WHERE id='{CLIENTE_MOSTRADOR}'") or 0)
        inicio = mostrador(recepcion, "CASH", service=KERATINA)
        assert inicio.status_code == 202
        saga_id = inicio.json()["sagaId"]

        vista = esperar(recepcion, saga_id, {"AWAITING_PAYMENT"} | TERMINAL)
        assert vista["status"] == "AWAITING_PAYMENT", vista["failureReason"]
        assert vista["clientSecret"] is None, "el mostrador no crea un cobro en Stripe"
        assert vista["amountToPayCents"] == 9500
        assert sql(f"SELECT status || '|' || client_id FROM appointments WHERE saga_id='{saga_id}'") == f"PENDING_PAYMENT|{CLIENTE_MOSTRADOR}"
        assert stock(ITEM_KERATINA) == (antes, 1)

        assert accion(recepcion, saga_id, "pay").status_code == 202
        final = esperar(recepcion, saga_id, TERMINAL)
        assert final["status"] == "COMPLETED"
        assert sql(f"SELECT status FROM appointments WHERE saga_id='{saga_id}'") == "CONFIRMED"
        assert stock(ITEM_KERATINA) == (antes - 1, 0)

        factura, forma, referencia = esperar_factura(saga_id)
        assert forma == "CASH"
        assert referencia == f"mostrador-{saga_id}"
        time.sleep(1)
        puntos = int(sql_crm(f"SELECT loyalty_points FROM crm_clients WHERE id='{CLIENTE_MOSTRADOR}'"))
        assert puntos == puntos_antes + 950

        comprobante = httpx.get(f"{CRM}/api/invoices/{factura}/comprobante", headers=auth(recepcion))
        assert comprobante.status_code == 200
        assert "Efectivo en el mostrador" in comprobante.text

        # Repetir el cobro no cobra ni factura dos veces (RNF-04)
        assert accion(recepcion, saga_id, "pay").status_code == 200
        time.sleep(1)
        assert sql_crm(f"SELECT count(*) FROM invoices WHERE saga_id='{saga_id}'") == "1"
        assert accion(recepcion, saga_id, "void").status_code == 409

    def test_anular_libera_turno_e_insumos_sin_facturar(self, recepcion):
        antes, _ = stock(ITEM_KERATINA)
        fecha = future_slot()
        saga_id = mostrador(recepcion, "CARD_TERMINAL", date=fecha, service=KERATINA).json()["sagaId"]
        esperar(recepcion, saga_id, {"AWAITING_PAYMENT"})

        assert accion(recepcion, saga_id, "void").status_code == 202
        final = esperar(recepcion, saga_id, {"COMPENSATED", "FAILED"})
        assert final["status"] == "COMPENSATED"
        assert final["failureReason"] == "COUNTER_VOIDED"
        assert sql(f"SELECT status FROM appointments WHERE saga_id='{saga_id}'") == "CANCELLED"
        assert stock(ITEM_KERATINA) == (antes, 0)
        assert sql_crm(f"SELECT count(*) FROM invoices WHERE saga_id='{saga_id}'") == "0"
        assert accion(recepcion, saga_id, "pay").json()["code"] == "BOOKING_REVERTED"

        # El turno quedó libre: se puede volver a agendar en el mismo horario
        otra = mostrador(recepcion, date=fecha).json()["sagaId"]
        assert esperar(recepcion, otra, {"AWAITING_PAYMENT"} | TERMINAL)["status"] == "AWAITING_PAYMENT"
        accion(recepcion, otra, "void")
        esperar(recepcion, otra, {"COMPENSATED"})

    def test_reintentar_con_la_misma_llave_no_agenda_dos_veces(self, recepcion):
        llave = str(uuid.uuid4())
        fecha = future_slot()
        primera = mostrador(recepcion, date=fecha, key=llave)
        segunda = mostrador(recepcion, date=fecha, key=llave)
        assert primera.status_code == 202 and segunda.status_code == 200
        assert primera.json()["sagaId"] == segunda.json()["sagaId"]
        saga_id = primera.json()["sagaId"]
        esperar(recepcion, saga_id, {"AWAITING_PAYMENT"})
        assert sql(f"SELECT count(*) FROM appointments WHERE appointment_date='{fecha}' AND stylist_id='{STYLIST_ID}'") == "1"
        accion(recepcion, saga_id, "void")
        esperar(recepcion, saga_id, {"COMPENSATED"})

    def test_un_turno_ocupado_se_rechaza_sin_cobrar(self, recepcion):
        fecha = future_slot()
        primera = mostrador(recepcion, date=fecha).json()["sagaId"]
        esperar(recepcion, primera, {"AWAITING_PAYMENT"})
        segunda = mostrador(recepcion, date=fecha).json()["sagaId"]
        final = esperar(recepcion, segunda, TERMINAL)
        assert final["status"] == "FAILED"
        assert final["failureReason"] == "SLOT_TAKEN"
        accion(recepcion, primera, "void")
        esperar(recepcion, primera, {"COMPENSATED"})

    def test_la_administracion_tambien_atiende_el_mostrador(self):
        time.sleep(1.2)
        admin = login(ADMIN)
        saga_id = mostrador(admin).json()["sagaId"]
        esperar(admin, saga_id, {"AWAITING_PAYMENT"})
        accion(admin, saga_id, "void")
        esperar(admin, saga_id, {"COMPENSATED"})


class TestLlegadaYAusencia:
    def test_registra_la_llegada_una_sola_vez(self, recepcion):
        cita = cita_de_hoy("llegada", 0)
        primera = mutacion(recepcion, "checkInAppointment", cita)
        assert "errors" not in primera, primera
        hora = primera["data"]["checkInAppointment"]["checkedInAt"]
        assert hora
        segunda = mutacion(recepcion, "checkInAppointment", cita)
        assert segunda["data"]["checkInAppointment"]["checkedInAt"] == hora

        dia = hoy_en_el_salon()
        agenda = gql(f'{{ getPanelAgenda(from: "{dia}", to: "{dia}") {{ id checkedInAt }} }}', recepcion).json()
        agenda = agenda["data"]["getPanelAgenda"]
        assert any(fila["id"] == cita and fila["checkedInAt"] for fila in agenda)

        # Con el cliente en el salón ya no se puede marcar ausente
        assert mutacion(recepcion, "markNoShow", cita).get("errors")

    def test_la_ausencia_libera_el_turno(self, recepcion):
        cita = cita_de_hoy("ausente", 2)
        cuerpo = mutacion(recepcion, "markNoShow", cita)
        assert cuerpo["data"]["markNoShow"]["status"] == "NO_SHOW"
        # La base acepta otra cita en el mismo horario y el mismo estilista
        cita_de_hoy("reemplazo", 2)

    def test_no_registra_la_llegada_de_una_cita_de_otro_dia(self, recepcion):
        saga_id = mostrador(recepcion).json()["sagaId"]
        esperar(recepcion, saga_id, {"AWAITING_PAYMENT"})
        accion(recepcion, saga_id, "pay")
        esperar(recepcion, saga_id, {"COMPLETED"})
        cita = sql(f"SELECT id FROM appointments WHERE saga_id='{saga_id}'")
        cuerpo = mutacion(recepcion, "checkInAppointment", cita)
        assert cuerpo["errors"][0]["extensions"]["classification"] == "CONFLICT"
        assert "día de la cita" in cuerpo["errors"][0]["message"]

    def test_un_estilista_no_registra_llegadas(self):
        cita = cita_de_hoy("estilista", 4)
        time.sleep(1.2)
        cuerpo = mutacion(login(STYLIST), "checkInAppointment", cita)
        assert cuerpo["errors"][0]["extensions"]["classification"] == "FORBIDDEN"

    def test_las_migraciones_se_pueden_repetir_con_ausencias_registradas(self):
        cita_de_hoy("migracion", 6, estado="NO_SHOW")
        cita_de_hoy("migracion-ocupa", 6)
        resultado = subprocess.run(["docker", "compose", "run", "--rm", "db-migrate"], capture_output=True, text=True,
                                   encoding="utf-8", timeout=180)
        assert resultado.returncode == 0, resultado.stderr[-500:]
