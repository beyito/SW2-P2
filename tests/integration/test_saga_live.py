"""
Pruebas en vivo de la Fase D: SAGA real con RabbitMQ, DynamoDB, PostgreSQL y Stripe en modo prueba
(CU-06, CU-10, RF-02, RF-03, RF-07, RNF-03, RNF-04).
Requiere el entorno levantado: docker compose up -d --wait
Solo usa fechas posteriores a 2036, y al terminar borra sus citas y restaura el stock.
"""
import concurrent.futures
import datetime
import os
import pathlib
import random
import subprocess
import time
import uuid

import httpx
import pytest

from test_seguridad_live import ADMIN, CLIENT, STYLIST, auth, gql, login

SAGA = "http://localhost:4100"
OTHER_CLIENT = ("alejandro.morales", "Cliente#2026")
STRIPE = "https://api.stripe.com/v1"
KERATINA = "srv-02"
CORTE = "srv-03"
ITEM_KERATINA = "inv-002"
STYLIST_ID = "sty-101"
TERMINAL = {"COMPLETED", "COMPENSATED", "FAILED"}


def stripe_key():
    if os.environ.get("STRIPE_SECRET_KEY"):
        return os.environ["STRIPE_SECRET_KEY"]
    env = pathlib.Path(__file__).resolve().parents[2] / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("STRIPE_SECRET_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("Falta STRIPE_SECRET_KEY")


def sql(query):
    result = subprocess.run(
        ["docker", "exec", "salon-postgres", "psql", "-U", "salon_admin", "-d", "salon_gestion", "-Atc", query],
        capture_output=True, text=True, check=True, encoding="utf-8",
    )
    return result.stdout.strip()


def future_slot(hour=10):
    """Día laboral aleatorio lejano, para que las ejecuciones no choquen entre sí."""
    day = datetime.date(2036, 1, 1) + datetime.timedelta(days=random.randint(0, 3000))
    while day.isoweekday() == 7:
        day += datetime.timedelta(days=1)
    return f"{day.isoformat()}T{hour:02d}:00:00"


def book(token, service=CORTE, date=None, key=None, stylist=STYLIST_ID):
    return httpx.post(
        f"{SAGA}/bookings",
        headers={**auth(token), "Idempotency-Key": key or str(uuid.uuid4())},
        json={"serviceId": service, "stylistId": stylist, "appointmentDate": date or future_slot()},
        timeout=15,
    )


def wait_for(token, saga_id, statuses, timeout=30):
    limit = time.time() + timeout
    while time.time() < limit:
        body = httpx.get(f"{SAGA}/bookings/{saga_id}", headers=auth(token)).json()
        if body["status"] in statuses:
            return body
        time.sleep(0.2)
    raise AssertionError(f"La SAGA {saga_id} quedó en {body['status']}, se esperaba {statuses}")


def intent_id(view):
    return view["clientSecret"].split("_secret_")[0]


def confirm_card(view, payment_method):
    """Paga con una tarjeta de prueba de Stripe, como lo haría el navegador."""
    return httpx.post(
        f"{STRIPE}/payment_intents/{intent_id(view)}/confirm",
        auth=(stripe_key(), ""),
        data={"payment_method": payment_method},
        timeout=30,
    )


def stripe_intent(payment_intent):
    return httpx.get(f"{STRIPE}/payment_intents/{payment_intent}", auth=(stripe_key(), ""), timeout=30).json()


def stock(item):
    current, reserved = sql(f"SELECT current_stock, reserved_stock FROM inventory_items WHERE id='{item}'").split("|")
    return int(current), int(reserved)


def appointment_status(saga_id):
    return sql(f"SELECT status FROM appointments WHERE saga_id='{saga_id}'")


def slots(token, date, service=CORTE):
    day = date[:10]
    body = gql(
        f'{{getAvailableSlots(stylistId:"{STYLIST_ID}",serviceId:"{service}",date:"{day}"){{start}}}}', token
    ).json()
    return [slot["start"] for slot in body["data"]["getAvailableSlots"]]


@pytest.fixture(scope="module", autouse=True)
def limpieza():
    snapshot = sql("SELECT id || '=' || current_stock FROM inventory_items")
    yield
    sql("DELETE FROM inventory_logs WHERE reason='Consumo por cita confirmada' AND appointment_id IN "
        "(SELECT id FROM appointments WHERE appointment_date >= '2036-01-01')")
    sql("DELETE FROM appointments WHERE appointment_date >= '2036-01-01'")
    for line in snapshot.splitlines():
        item, value = line.split("=")
        sql(f"UPDATE inventory_items SET current_stock={value} WHERE id='{item}'")


@pytest.fixture
def cliente():
    return login(CLIENT)


class TestFlujoExitoso:
    def test_pago_con_tarjeta_confirma_cita_y_descuenta_insumos(self, cliente):
        antes, _ = stock(ITEM_KERATINA)
        date = future_slot()
        started = book(cliente, KERATINA, date)
        assert started.status_code == 202
        saga_id = started.json()["sagaId"]

        view = wait_for(cliente, saga_id, {"AWAITING_PAYMENT"} | TERMINAL)
        assert view["status"] == "AWAITING_PAYMENT"
        assert view["amountCents"] == 9500
        assert appointment_status(saga_id) == "PENDING_PAYMENT"
        assert stock(ITEM_KERATINA) == (antes, 1)
        assert date not in slots(cliente, date, KERATINA)

        assert confirm_card(view, "pm_card_visa").status_code == 200

        # Solo el webhook firmado de Stripe puede completar este flujo: aquí no se llama a /sync
        final = wait_for(cliente, saga_id, TERMINAL, timeout=45)
        assert final["status"] == "COMPLETED"
        assert final["clientSecret"] is None
        assert appointment_status(saga_id) == "CONFIRMED"
        assert stock(ITEM_KERATINA) == (antes - 1, 0)

        appointment_id = sql(f"SELECT id FROM appointments WHERE saga_id='{saga_id}'")
        log = sql(f"SELECT quantity_change, new_stock FROM inventory_logs WHERE appointment_id='{appointment_id}'")
        assert log == f"-1|{antes - 1}"

    def test_el_monto_del_cobro_sale_del_catalogo(self, cliente):
        response = httpx.post(
            f"{SAGA}/bookings",
            headers={**auth(cliente), "Idempotency-Key": str(uuid.uuid4())},
            json={"serviceId": CORTE, "stylistId": STYLIST_ID, "appointmentDate": future_slot(),
                  "totalPrice": 1, "amountCents": 50},
        )
        view = wait_for(cliente, response.json()["sagaId"], {"AWAITING_PAYMENT"})
        assert view["amountCents"] == 4500
        assert stripe_intent(intent_id(view))["amount"] == 4500


class TestCompensaciones:
    def test_pago_rechazado_libera_turno_y_stock(self, cliente):
        antes, _ = stock(ITEM_KERATINA)
        date = future_slot()
        saga_id = book(cliente, KERATINA, date).json()["sagaId"]
        view = wait_for(cliente, saga_id, {"AWAITING_PAYMENT"})
        assert stock(ITEM_KERATINA) == (antes, 1)

        assert confirm_card(view, "pm_card_chargeDeclined").status_code == 402

        final = wait_for(cliente, saga_id, TERMINAL, timeout=45)
        assert final["status"] == "COMPENSATED"
        assert final["failureReason"] == "PAYMENT_DECLINED"
        assert appointment_status(saga_id) == "CANCELLED"
        assert stock(ITEM_KERATINA) == (antes, 0)
        assert date in slots(cliente, date, KERATINA)
        estados = [paso["state"] for paso in final["history"]]
        assert estados.index("COMPENSATING_STOCK") < estados.index("COMPENSATING_APPOINTMENT")

    def test_sin_stock_libera_el_turno_y_no_cobra(self, cliente):
        admin = login(ADMIN)
        antes, _ = stock(ITEM_KERATINA)
        gql(f'mutation{{updateStock(input:{{id:"{ITEM_KERATINA}",quantityChange:{-antes},reason:"prueba"}}){{id}}}}', admin)
        try:
            date = future_slot()
            saga_id = book(cliente, KERATINA, date).json()["sagaId"]
            final = wait_for(cliente, saga_id, TERMINAL)
            assert final["status"] == "COMPENSATED"
            assert final["failureReason"] == "STOCK_INSUFFICIENT"
            assert final["clientSecret"] is None
            assert appointment_status(saga_id) == "CANCELLED"
            assert date in slots(cliente, date, KERATINA)
        finally:
            gql(f'mutation{{updateStock(input:{{id:"{ITEM_KERATINA}",quantityChange:{antes},reason:"prueba"}}){{id}}}}', login(ADMIN))

    def test_vencer_el_plazo_cancela_el_cobro_y_compensa(self, cliente):
        date = future_slot()
        saga_id = book(cliente, CORTE, date).json()["sagaId"]
        view = wait_for(cliente, saga_id, {"AWAITING_PAYMENT"})

        # RabbitMQ vence desde la cabeza de la cola, así que no se puede adelantar un mensaje dentro de ella.
        # Se publica el mismo evento que la cola emite al vencer; abajo se valida la configuración de la cola.
        published = httpx.post(
            "http://localhost:15672/api/exchanges/%2f/salon.saga/publish",
            auth=("rabbit_admin", "rabbit_secret_pass"),
            json={"properties": {}, "routing_key": "saga.event.payment.timeout",
                  "payload": f'{{"sagaId":"{saga_id}"}}', "payload_encoding": "string"},
        )
        assert published.json()["routed"] is True

        final = wait_for(cliente, saga_id, TERMINAL)
        assert final["status"] == "COMPENSATED"
        assert final["failureReason"] == "PAYMENT_TIMEOUT"
        assert stripe_intent(intent_id(view))["status"] == "canceled"
        assert date in slots(cliente, date)


    def test_la_cola_de_espera_reenvia_el_vencimiento_a_la_saga(self):
        queue = httpx.get(
            "http://localhost:15672/api/queues/%2f/saga.payment.delay", auth=("rabbit_admin", "rabbit_secret_pass")
        ).json()
        assert queue["arguments"]["x-dead-letter-exchange"] == "salon.saga"
        assert queue["arguments"]["x-dead-letter-routing-key"] == "saga.event.payment.timeout"


class TestIdempotencia:
    def test_reintento_no_crea_otra_saga_ni_otro_cobro(self, cliente):
        key, date = str(uuid.uuid4()), future_slot()
        first = book(cliente, CORTE, date, key)
        assert first.status_code == 202
        view = wait_for(cliente, first.json()["sagaId"], {"AWAITING_PAYMENT"})

        retry = book(cliente, CORTE, date, key)
        assert retry.status_code == 200
        assert retry.headers["X-Idempotent-Replay"] == "true"
        assert retry.json()["sagaId"] == first.json()["sagaId"]
        assert retry.json()["clientSecret"] == view["clientSecret"]
        assert sql(f"SELECT COUNT(*) FROM appointments WHERE saga_id='{first.json()['sagaId']}'") == "1"

    def test_reintentos_simultaneos_producen_una_sola_saga(self, cliente):
        key, date = str(uuid.uuid4()), future_slot()
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            responses = list(pool.map(lambda _: book(cliente, CORTE, date, key), range(8)))

        sagas = {response.json()["sagaId"] for response in responses}
        assert len(sagas) == 1
        assert sorted(response.status_code for response in responses) == [200] * 7 + [202]

        view = wait_for(cliente, sagas.pop(), {"AWAITING_PAYMENT"})
        assert confirm_card(view, "pm_card_visa").status_code == 200
        wait_for(cliente, view["sagaId"], TERMINAL, timeout=45)
        cobros = httpx.get(
            f"{STRIPE}/charges", auth=(stripe_key(), ""), params={"payment_intent": intent_id(view)}, timeout=30
        ).json()["data"]
        assert len(cobros) == 1

    def test_misma_llave_con_otros_datos_responde_422(self, cliente):
        key = str(uuid.uuid4())
        assert book(cliente, CORTE, future_slot(), key).status_code == 202
        assert book(cliente, CORTE, future_slot(14), key).status_code == 422

    def test_la_llave_es_obligatoria(self, cliente):
        response = httpx.post(f"{SAGA}/bookings", headers=auth(cliente), json={})
        assert response.status_code == 400
        assert response.json()["code"] == "IDEMPOTENCY_KEY_REQUIRED"

    def test_la_llave_es_por_usuario(self, cliente):
        key, date = str(uuid.uuid4()), future_slot()
        mine = book(cliente, CORTE, date, key)
        other = book(login(OTHER_CLIENT), CORTE, future_slot(14), key)
        assert other.status_code == 202
        assert other.json()["sagaId"] != mine.json()["sagaId"]


class TestDobleReserva:
    def test_reservas_simultaneas_del_mismo_turno_solo_una_gana(self, cliente):
        date = future_slot()
        with concurrent.futures.ThreadPoolExecutor(6) as pool:
            responses = list(pool.map(lambda _: book(cliente, CORTE, date), range(6)))

        finals = [wait_for(cliente, r.json()["sagaId"], {"AWAITING_PAYMENT", "FAILED"}) for r in responses]
        assert sum(view["status"] == "AWAITING_PAYMENT" for view in finals) == 1
        perdedoras = [view for view in finals if view["status"] == "FAILED"]
        assert len(perdedoras) == 5
        assert all(view["failureReason"] == "SLOT_TAKEN" for view in perdedoras)
        assert sql(f"SELECT COUNT(*) FROM appointments WHERE appointment_date='{date}' "
                   f"AND stylist_id='{STYLIST_ID}' AND status <> 'CANCELLED'") == "1"

    def test_la_base_de_datos_rechaza_el_solape_por_si_sola(self):
        date = future_slot()
        insert = ("INSERT INTO appointments (id, client_id, stylist_id, service_name, appointment_date, "
                  f"duration_minutes, total_price, status) VALUES ('{{}}', 'cli-001', 'sty-solape', 'x', "
                  f"'{date}', 60, 1, 'CONFIRMED')")
        sql(insert.format(str(uuid.uuid4())))
        with pytest.raises(subprocess.CalledProcessError) as error:
            sql(insert.format(str(uuid.uuid4())))
        assert "appointments_no_overlap" in error.value.stderr


class TestValidaciones:
    def test_fuera_de_la_jornada_falla(self, cliente):
        saga_id = book(cliente, CORTE, future_slot(hour=22)).json()["sagaId"]
        final = wait_for(cliente, saga_id, TERMINAL)
        assert final["status"] == "FAILED"
        assert final["failureReason"] == "OUTSIDE_WORKING_HOURS"

    def test_fecha_pasada_falla(self, cliente):
        saga_id = book(cliente, CORTE, "2020-01-06T10:00:00").json()["sagaId"]
        assert wait_for(cliente, saga_id, TERMINAL)["failureReason"] == "OUTSIDE_WORKING_HOURS"

    def test_servicio_inexistente_falla(self, cliente):
        saga_id = book(cliente, "srv-falso").json()["sagaId"]
        assert wait_for(cliente, saga_id, TERMINAL)["failureReason"] == "SERVICE_NOT_FOUND"


class TestSeguridad:
    def test_sin_token_responde_401(self):
        assert httpx.post(f"{SAGA}/bookings", json={}).status_code == 401

    def test_token_falso_responde_401(self):
        assert book("basura").status_code == 401

    def test_un_cliente_no_ve_la_reserva_de_otro(self, cliente):
        saga_id = book(cliente).json()["sagaId"]
        response = httpx.get(f"{SAGA}/bookings/{saga_id}", headers=auth(login(OTHER_CLIENT)))
        assert response.status_code == 403

    def test_webhook_sin_firma_valida_se_rechaza(self):
        response = httpx.post(f"{SAGA}/webhooks/stripe", headers={"stripe-signature": "t=1,v1=falsa"},
                              content=b'{"type":"payment_intent.succeeded"}')
        assert response.status_code == 400

    def test_cliente_no_puede_cancelar_directamente_una_cita_de_otro(self, cliente):
        saga_id = book(login(OTHER_CLIENT)).json()["sagaId"]
        wait_for(login(OTHER_CLIENT), saga_id, {"AWAITING_PAYMENT"})
        appointment_id = sql(f"SELECT id FROM appointments WHERE saga_id='{saga_id}'")
        body = gql(f'mutation{{cancelAppointment(id:"{appointment_id}"){{id}}}}', cliente).json()
        assert body["errors"][0]["extensions"]["classification"] == "FORBIDDEN"


class TestCatalogoYErrores:
    def test_catalogo_y_estilistas_disponibles_para_clientes(self, cliente):
        body = gql("{getServices{id name price durationMinutes} getStylists{id name}}", cliente).json()
        assert {"srv-01", "srv-02", "srv-03"} <= {service["id"] for service in body["data"]["getServices"]}
        assert {"sty-101", "sty-102", "sty-103"} <= {stylist["id"] for stylist in body["data"]["getStylists"]}

    def test_consulta_de_horarios_ya_no_falla(self, cliente):
        body = gql('{getStylistSchedules(stylistId:"sty-101"){dayOfWeek startTime}}', cliente).json()
        assert "errors" not in body
        assert len(body["data"]["getStylistSchedules"]) >= 6

    def test_errores_de_negocio_son_semanticos(self):
        token = login(STYLIST)
        body = gql('mutation{cancelAppointment(id:"no-existe"){id}}', token).json()
        assert body["errors"][0]["extensions"]["classification"] == "BAD_REQUEST"


class TestBroker:
    def test_las_colas_tienen_consumidor_y_no_hay_mensajes_muertos(self):
        queues = {
            queue["name"]: queue
            for queue in httpx.get("http://localhost:15672/api/queues", auth=("rabbit_admin", "rabbit_secret_pass")).json()
        }
        assert queues["gestion.saga.commands"]["consumers"] >= 1
        assert queues["saga.orchestrator.events"]["consumers"] >= 1
        assert queues["saga.dead-letter"]["messages"] == 0
