"""
Pruebas en vivo de la Fase E: factura, puntos, canje y reembolso sobre Laravel, RabbitMQ y Stripe en modo prueba
(CU-03, CU-07, CU-11, CU-12, RF-08). Requiere el entorno levantado: docker compose up -d --wait
Trabaja sobre el cliente cli-002 y fechas posteriores a 2036; al terminar restaura los datos.
"""
import concurrent.futures
import time
import uuid

import httpx
import pytest

from soporte_crm import RABBIT, esperar_colas_vacias, foto_de_puntos, limpiar_crm_de_pruebas, sql_crm, sql_gestion
from test_saga_live import (
    CORTE, ITEM_KERATINA, KERATINA, SAGA, STRIPE, TERMINAL,
    book, confirm_card, future_slot, intent_id, slots, stock, stripe_intent, stripe_key, wait_for,
)
from test_seguridad_live import ADMIN, CLIENT, STYLIST, auth, login

CRM = "http://localhost:8083/graphql"
CRM_BASE = "http://localhost:8083"
CLIENTE = ("alejandro.morales", "Cliente#2026")
CLIENTE_ID = "cli-002"


def crm(query, token):
    return httpx.post(CRM, json={"query": query}, headers=auth(token), timeout=15)


def puntos(token, cliente=CLIENTE_ID):
    return crm(f'{{getClientPoints(clientId:"{cliente}")}}', token).json()["data"]["getClientPoints"]


def dar_puntos(cantidad):
    body = crm(
        f'mutation{{accumulatePoints(clientId:"{CLIENTE_ID}",points:{cantidad},description:"prueba")}}', login(ADMIN)
    ).json()
    assert "errors" not in body, body


def reservar_y_pagar(token, service=CORTE, points=0, date=None):
    response = httpx.post(
        f"{SAGA}/bookings",
        headers={**auth(token), "Idempotency-Key": str(uuid.uuid4())},
        json={"serviceId": service, "stylistId": "sty-102", "appointmentDate": date or future_slot(),
              "pointsToRedeem": points},
        timeout=15,
    )
    assert response.status_code == 202, response.text
    view = wait_for(token, response.json()["sagaId"], {"AWAITING_PAYMENT"} | TERMINAL)
    assert view["status"] == "AWAITING_PAYMENT", view
    assert confirm_card(view, "pm_card_visa").status_code == 200
    final = wait_for(token, view["sagaId"], TERMINAL, timeout=45)
    assert final["status"] == "COMPLETED"
    return view, final


def factura_de(token, appointment_id, timeout=20):
    """La factura la crea el worker en segundo plano: se espera a que aparezca."""
    query = (f'{{getInvoicesByClient(clientId:"{CLIENTE_ID}"){{id invoiceNumber appointmentId status subtotalAmount '
             'discountAmount totalAmount taxAmount serviceName paymentMethod}}')
    limit = time.time() + timeout
    while time.time() < limit:
        for invoice in crm(query, token).json()["data"]["getInvoicesByClient"]:
            if invoice["appointmentId"] == appointment_id:
                return invoice
        time.sleep(0.3)
    raise AssertionError(f"No apareció la factura de la cita {appointment_id}")


def cancelar(token, saga_id):
    return httpx.post(f"{SAGA}/bookings/{saga_id}/cancel", headers=auth(token), timeout=15)


def esperar_estado(token, saga_id, condicion, timeout=45):
    limit = time.time() + timeout
    while time.time() < limit:
        view = httpx.get(f"{SAGA}/bookings/{saga_id}", headers=auth(token)).json()
        if condicion(view):
            return view
        time.sleep(0.2)
    raise AssertionError(f"La SAGA quedó en {view['status']}")


def reembolsado_en_stripe(view):
    intent = stripe_intent(intent_id(view))
    charge = httpx.get(f"{STRIPE}/charges/{intent['latest_charge']}", auth=(stripe_key(), ""), timeout=30).json()
    return charge["amount"], charge["amount_refunded"]


@pytest.fixture(scope="module", autouse=True)
def limpieza():
    foto = foto_de_puntos()
    stock_inicial = stock(ITEM_KERATINA)[0]
    telefono = sql_crm(f"SELECT phone FROM crm_clients WHERE id='{CLIENTE_ID}'")
    yield
    sql_crm(f"UPDATE crm_clients SET phone='{telefono}' WHERE id='{CLIENTE_ID}'")
    limpiar_crm_de_pruebas(foto)
    sql_gestion("DELETE FROM inventory_logs WHERE appointment_id IN "
                "(SELECT id FROM appointments WHERE appointment_date >= '2036-01-01')")
    sql_gestion("DELETE FROM appointments WHERE appointment_date >= '2036-01-01'")
    sql_gestion(f"UPDATE inventory_items SET current_stock={stock_inicial} WHERE id='{ITEM_KERATINA}'")


@pytest.fixture
def cliente():
    return login(CLIENTE)


class TestFacturaYPuntos:
    def test_pago_genera_factura_con_iva_y_puntos(self, cliente):
        antes = puntos(cliente)
        _, final = reservar_y_pagar(cliente)

        factura = factura_de(cliente, final["appointmentId"])
        assert factura["status"] == "ISSUED"
        assert factura["totalAmount"] == 45.0
        assert factura["subtotalAmount"] == 45.0
        assert factura["discountAmount"] == 0.0
        assert factura["taxAmount"] == 5.85
        assert factura["serviceName"] == "Corte Visagista & Styling"
        assert factura["invoiceNumber"] > 0
        assert puntos(cliente) == antes + 450

    def test_el_historial_registra_los_puntos_ganados(self, cliente):
        _, final = reservar_y_pagar(cliente)
        factura_de(cliente, final["appointmentId"])
        esperar_colas_vacias()
        historial = crm(f'{{getLoyaltyHistory(clientId:"{CLIENTE_ID}"){{points type description}}}}', cliente).json()
        assert any(
            movimiento["type"] == "ACCUMULATION" and movimiento["points"] == 450
            for movimiento in historial["data"]["getLoyaltyHistory"]
        )

    def test_evento_repetido_no_duplica_factura_ni_puntos(self, cliente):
        view, final = reservar_y_pagar(cliente)
        factura_de(cliente, final["appointmentId"])
        esperar_colas_vacias()
        saldo = puntos(cliente)
        saga_id = final["sagaId"]

        evento = (f'{{"sagaId":"{saga_id}","appointmentId":"{final["appointmentId"]}","clientId":"{CLIENTE_ID}",'
                  f'"serviceName":"x","amountCents":4500,"discountCents":0,"paymentIntentId":"{intent_id(view)}"}}')
        publicado = httpx.post(
            "http://localhost:15672/api/exchanges/%2f/salon.saga/publish", auth=RABBIT,
            json={"properties": {}, "routing_key": "saga.completed", "payload": evento, "payload_encoding": "string"},
        )
        assert publicado.json()["routed"] is True
        time.sleep(3)
        esperar_colas_vacias()

        assert sql_crm(f"SELECT COUNT(*) FROM invoices WHERE saga_id='{saga_id}'") == "1"
        assert puntos(cliente) == saldo

    def test_comprobante_imprimible(self, cliente):
        _, final = reservar_y_pagar(cliente)
        factura = factura_de(cliente, final["appointmentId"])

        response = httpx.get(f"{CRM_BASE}/api/invoices/{factura['id']}/comprobante", headers=auth(cliente))
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "$45.00" in response.text
        assert "$5.85" in response.text
        assert "sin validez fiscal" in response.text

        ajeno = httpx.get(f"{CRM_BASE}/api/invoices/{factura['id']}/comprobante", headers=auth(login(CLIENT)))
        assert ajeno.status_code == 403
        assert httpx.get(f"{CRM_BASE}/api/invoices/{factura['id']}/comprobante").status_code == 401


class TestCanje:
    def test_canje_descuenta_del_cobro_y_de_la_factura(self, cliente):
        dar_puntos(1000)
        antes = puntos(cliente)

        view, final = reservar_y_pagar(cliente, points=500)

        assert view["amountCents"] == 4500
        assert view["discountCents"] == 500
        assert view["amountToPayCents"] == 4000
        assert stripe_intent(intent_id(view))["amount"] == 4000

        factura = factura_de(cliente, final["appointmentId"])
        assert factura["subtotalAmount"] == 45.0
        assert factura["discountAmount"] == 5.0
        assert factura["totalAmount"] == 40.0
        assert factura["taxAmount"] == 5.2
        esperar_colas_vacias()
        assert puntos(cliente) == antes - 500 + 400

    def test_pago_rechazado_devuelve_los_puntos(self, cliente):
        dar_puntos(1000)
        antes = puntos(cliente)
        response = httpx.post(
            f"{SAGA}/bookings", headers={**auth(cliente), "Idempotency-Key": str(uuid.uuid4())},
            json={"serviceId": CORTE, "stylistId": "sty-102", "appointmentDate": future_slot(), "pointsToRedeem": 500},
        )
        view = wait_for(cliente, response.json()["sagaId"], {"AWAITING_PAYMENT"})
        assert puntos(cliente) == antes - 500

        assert confirm_card(view, "pm_card_chargeDeclined").status_code == 402

        final = wait_for(cliente, view["sagaId"], TERMINAL, timeout=45)
        assert final["status"] == "COMPENSATED"
        assert final["failureReason"] == "PAYMENT_DECLINED"
        estados = [paso["state"] for paso in final["history"]]
        assert estados.index("COMPENSATING_POINTS") < estados.index("COMPENSATING_STOCK")
        assert puntos(cliente) == antes

    def test_saldo_insuficiente_revierte_sin_cobrar(self, cliente):
        saldo = puntos(cliente)
        response = httpx.post(
            f"{SAGA}/bookings", headers={**auth(cliente), "Idempotency-Key": str(uuid.uuid4())},
            json={"serviceId": KERATINA, "stylistId": "sty-102", "appointmentDate": future_slot(),
                  "pointsToRedeem": saldo + 1000 if saldo + 1000 <= 9450 else 9450},
        )
        final = wait_for(cliente, response.json()["sagaId"], TERMINAL)
        assert final["status"] == "COMPENSATED"
        assert final["failureReason"] in {"POINTS_INSUFFICIENT", "POINTS_EXCEED_LIMIT"}
        assert final["clientSecret"] is None
        assert puntos(cliente) == saldo
        assert stock(ITEM_KERATINA)[1] == 0

    def test_canje_no_puede_dejar_un_cobro_menor_al_minimo(self, cliente):
        dar_puntos(5000)
        saldo = puntos(cliente)
        response = httpx.post(
            f"{SAGA}/bookings", headers={**auth(cliente), "Idempotency-Key": str(uuid.uuid4())},
            json={"serviceId": CORTE, "stylistId": "sty-102", "appointmentDate": future_slot(), "pointsToRedeem": 4460},
        )
        final = wait_for(cliente, response.json()["sagaId"], TERMINAL)
        assert final["failureReason"] == "POINTS_EXCEED_LIMIT"
        assert puntos(cliente) == saldo

    def test_canjes_simultaneos_no_gastan_dos_veces_el_mismo_saldo(self, cliente):
        # El saldo alcanza exactamente para un canje; la limpieza del módulo lo restaura
        canje = 1000
        sql_crm(f"UPDATE crm_clients SET loyalty_points={canje} WHERE id='{CLIENTE_ID}'")
        saldo = canje

        def intentar(_):
            return httpx.post(
                f"{SAGA}/bookings", headers={**auth(cliente), "Idempotency-Key": str(uuid.uuid4())},
                json={"serviceId": CORTE, "stylistId": "sty-102", "appointmentDate": future_slot(), "pointsToRedeem": canje},
                timeout=15,
            ).json()["sagaId"]

        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            sagas = list(pool.map(intentar, range(2)))

        vistas = [wait_for(cliente, saga, {"AWAITING_PAYMENT", "COMPENSATED"}) for saga in sagas]
        assert sorted(view["status"] for view in vistas) == ["AWAITING_PAYMENT", "COMPENSATED"]
        assert puntos(cliente) == saldo - canje

        ganadora = next(view for view in vistas if view["status"] == "AWAITING_PAYMENT")
        confirm_card(ganadora, "pm_card_chargeDeclined")
        wait_for(cliente, ganadora["sagaId"], TERMINAL, timeout=45)
        assert puntos(cliente) == saldo


class TestReembolso:
    def test_cancelar_reembolsa_y_revierte_todo(self, cliente):
        date = future_slot()
        puntos_antes = puntos(cliente)
        stock_antes = stock(ITEM_KERATINA)[0]

        view, final = reservar_y_pagar(cliente, KERATINA, date=date)
        factura = factura_de(cliente, final["appointmentId"])
        esperar_colas_vacias()
        assert stock(ITEM_KERATINA)[0] == stock_antes - 1
        assert puntos(cliente) == puntos_antes + 950
        assert sql_gestion(f"SELECT status FROM appointments WHERE saga_id='{final['sagaId']}'") == "CONFIRMED"

        assert cancelar(cliente, final["sagaId"]).status_code == 202
        reembolso = esperar_estado(cliente, final["sagaId"], lambda v: v["status"] == "REFUNDED")
        assert reembolso["refunded"] is True

        assert reembolsado_en_stripe(view) == (9500, 9500)
        assert sql_gestion(f"SELECT status FROM appointments WHERE saga_id='{final['sagaId']}'") == "CANCELLED"
        assert stock(ITEM_KERATINA)[0] == stock_antes
        assert puntos(cliente) == puntos_antes

        logs = sql_gestion(f"SELECT reason FROM inventory_logs WHERE appointment_id='{final['appointmentId']}'")
        assert "Devolución por cita cancelada" in logs

        assert factura_de(cliente, final["appointmentId"])["status"] == "REFUNDED"
        notas = crm(
            f'{{getCreditNotesByClient(clientId:"{CLIENTE_ID}"){{invoiceId amount taxAmount creditNoteNumber}}}}', cliente
        ).json()["data"]["getCreditNotesByClient"]
        nota = next(n for n in notas if n["invoiceId"] == factura["id"])
        assert nota["amount"] == 95.0
        assert nota["taxAmount"] == 12.35
        assert nota["creditNoteNumber"] > 0

        comprobante = httpx.get(f"{CRM_BASE}/api/invoices/{factura['id']}/comprobante", headers=auth(cliente))
        assert "ANULADA" in comprobante.text

        # El turno vuelve a ofrecerse. Se consulta sobre el mismo estilista de la reserva.
        cuerpo = httpx.post(
            "http://localhost:8081/graphql", headers=auth(cliente),
            json={"query": f'{{getAvailableSlots(stylistId:"sty-102",serviceId:"{KERATINA}",date:"{date[:10]}"){{start}}}}'},
        ).json()
        assert date in [slot["start"] for slot in cuerpo["data"]["getAvailableSlots"]]

    def test_cancelar_dos_veces_no_reembolsa_dos_veces(self, cliente):
        view, final = reservar_y_pagar(cliente)
        factura_de(cliente, final["appointmentId"])
        assert cancelar(cliente, final["sagaId"]).status_code == 202
        esperar_estado(cliente, final["sagaId"], lambda v: v["status"] == "REFUNDED")

        assert cancelar(cliente, final["sagaId"]).status_code == 200
        esperar_colas_vacias()
        assert reembolsado_en_stripe(view) == (4500, 4500)
        assert sql_crm(
            f"SELECT COUNT(*) FROM credit_notes WHERE invoice_id IN (SELECT id FROM invoices WHERE saga_id='{final['sagaId']}')"
        ) == "1"

    def test_cancelar_devuelve_los_puntos_canjeados(self, cliente):
        dar_puntos(1000)
        antes = puntos(cliente)
        view, final = reservar_y_pagar(cliente, points=500)
        factura_de(cliente, final["appointmentId"])
        esperar_colas_vacias()

        cancelar(cliente, final["sagaId"])
        esperar_estado(cliente, final["sagaId"], lambda v: v["status"] == "REFUNDED")
        esperar_colas_vacias()

        assert reembolsado_en_stripe(view) == (4000, 4000)
        assert puntos(cliente) == antes

    def test_una_cita_que_ya_paso_no_se_cancela_ni_reembolsa(self, cliente):
        view, final = reservar_y_pagar(cliente)
        factura_de(cliente, final["appointmentId"])
        original = sql_gestion(f"SELECT appointment_date FROM appointments WHERE saga_id='{final['sagaId']}'")
        sql_gestion(f"UPDATE appointments SET appointment_date='2020-01-06 10:00:00' WHERE saga_id='{final['sagaId']}'")
        try:
            assert cancelar(cliente, final["sagaId"]).status_code == 202
            rechazo = esperar_estado(cliente, final["sagaId"], lambda v: v["cancelRejectedReason"] is not None)
            assert rechazo["status"] == "COMPLETED"
            assert rechazo["cancelRejectedReason"] == "TOO_LATE"
            assert reembolsado_en_stripe(view) == (4500, 0)
            assert factura_de(cliente, final["appointmentId"])["status"] == "ISSUED"
        finally:
            sql_gestion(f"UPDATE appointments SET appointment_date='{original}' WHERE saga_id='{final['sagaId']}'")

    def test_una_reserva_sin_pagar_no_se_puede_cancelar(self, cliente):
        saga_id = book(cliente, CORTE, future_slot(), stylist="sty-102").json()["sagaId"]
        wait_for(cliente, saga_id, {"AWAITING_PAYMENT"})
        assert cancelar(cliente, saga_id).status_code == 409

    def test_otro_cliente_no_puede_cancelar(self, cliente):
        _, final = reservar_y_pagar(cliente)
        assert cancelar(login(CLIENT), final["sagaId"]).status_code == 403

    def test_el_personal_puede_cancelar(self, cliente):
        view, final = reservar_y_pagar(cliente)
        factura_de(cliente, final["appointmentId"])
        admin = login(STYLIST)
        assert cancelar(admin, final["sagaId"]).status_code == 202
        esperar_estado(admin, final["sagaId"], lambda v: v["status"] == "REFUNDED")


class TestSeguridadCrm:
    CONSULTA = "{getMyProfile{id}}"

    def test_graphql_sin_token_responde_401(self):
        assert crm(self.CONSULTA, None).status_code == 401

    def test_graphql_token_falso_responde_401(self):
        assert crm(self.CONSULTA, "basura").status_code == 401

    def test_cliente_no_ve_datos_de_otro(self, cliente):
        for consulta in ('{getInvoicesByClient(clientId:"cli-001"){id}}', '{getClientPoints(clientId:"cli-001")}',
                         '{getLoyaltyHistory(clientId:"cli-001"){id}}', '{getCreditNotesByClient(clientId:"cli-001"){id}}',
                         '{getClientById(id:"cli-001"){id}}', '{getClients{id}}', '{getClientByEmail(email:"x@y.z"){id}}'):
            cuerpo = crm(consulta, cliente).json()
            assert cuerpo["errors"][0]["extensions"]["classification"] == "FORBIDDEN", consulta

    def test_cliente_no_registra_clientes_ni_se_regala_puntos(self, cliente):
        for mutacion in ('mutation{registerClient(input:{fullName:"x",email:"x@y.z",phone:"1"}){id}}',
                         f'mutation{{accumulatePoints(clientId:"{CLIENTE_ID}",points:1000,description:"x")}}'):
            cuerpo = crm(mutacion, cliente).json()
            assert cuerpo["errors"][0]["extensions"]["classification"] == "FORBIDDEN", mutacion

    def test_estilista_no_ajusta_puntos_pero_ve_clientes(self):
        token = login(STYLIST)
        assert "errors" not in crm("{getClients{id}}", token).json()
        cuerpo = crm(f'mutation{{accumulatePoints(clientId:"{CLIENTE_ID}",points:1,description:"x")}}', token).json()
        assert cuerpo["errors"][0]["extensions"]["classification"] == "FORBIDDEN"

    def test_personal_registra_cliente_y_el_correo_duplicado_es_conflicto(self):
        token = login(STYLIST)
        correo = f"prueba-{uuid.uuid4()}@example.com"
        mutacion = f'mutation{{registerClient(input:{{fullName:"Prueba CRM",email:"{correo}",phone:"+591"}}){{id email}}}}'
        try:
            creado = crm(mutacion, token).json()
            assert creado["data"]["registerClient"]["email"] == correo
            repetido = crm(mutacion, token).json()
            assert repetido["errors"][0]["extensions"]["classification"] == "CONFLICT"
        finally:
            sql_crm(f"DELETE FROM crm_clients WHERE email='{correo}'")

    def test_perfil_propio(self, cliente):
        cuerpo = crm("{getMyProfile{id email}}", cliente).json()
        assert cuerpo["data"]["getMyProfile"]["id"] == CLIENTE_ID
        sincronizado = crm('mutation{syncMyProfile(phone:"+591-70000000"){id phone}}', cliente).json()
        assert sincronizado["data"]["syncMyProfile"]["phone"] == "+591-70000000"

    def test_cors_solo_para_la_plataforma(self):
        permitido = httpx.options(CRM, headers={"Origin": "http://localhost:3002", "Access-Control-Request-Method": "POST"})
        negado = httpx.options(CRM, headers={"Origin": "http://atacante.test", "Access-Control-Request-Method": "POST"})
        assert permitido.headers.get("access-control-allow-origin") == "http://localhost:3002"
        assert negado.headers.get("access-control-allow-origin") is None


class TestInfraestructura:
    def test_es_laravel_real(self):
        assert httpx.get(f"{CRM_BASE}/health").json()["framework"].startswith("Laravel")

    def test_el_worker_consume_y_no_hay_mensajes_muertos(self):
        esperar_colas_vacias()
        colas = {q["name"]: q for q in httpx.get("http://localhost:15672/api/queues", auth=RABBIT).json()}
        assert colas["crm.saga.events"]["consumers"] >= 1
        assert colas["saga.dead-letter"]["messages"] == 0
