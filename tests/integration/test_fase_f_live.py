"""
Pruebas en vivo de la Fase F y del cierre de la C sobre los servicios reales: estilistas, horarios, stock mínimo,
reseñas, Read Model, avisos, comunidad, clóset y Servidor MCP.
Requiere el entorno levantado: docker compose up -d --wait. Todo lo que crea se borra al terminar.
"""
import concurrent.futures
import datetime
import json
import random
import struct
import time
import uuid
import zlib

import httpx
import pytest

from soporte_crm import borrar_imagenes, esperar_colas_vacias, foto_de_puntos, limpiar_crm_de_pruebas, sql_crm, sql_gestion
from test_crm_live import CLIENTE, CLIENTE_ID, crm, reservar_y_pagar
from test_saga_live import CORTE, future_slot
from test_seguridad_live import ADMIN, ASESORIA, CLIENT, GESTION, KEYCLOAK, MCP, STYLIST, auth, login, rpc

SIN_ROL = "FORBIDDEN"
INICIO = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
PREFIJO = "[prueba-f]"
ITEM = "inv-003"


def gql(query, token, variables=None):
    response = httpx.post(GESTION, json={"query": query, "variables": variables or {}}, headers=auth(token), timeout=15)
    assert response.status_code == 200, response.text
    return response.json()


def data(query, token, variables=None):
    body = gql(query, token, variables)
    assert "errors" not in body, body
    return body["data"]


def clasificacion(body):
    return body["errors"][0]["extensions"]["classification"]


def png():
    """PNG real de un píxel, único en cada llamada."""
    def chunk(kind, content):
        return struct.pack(">I", len(content)) + kind + content + struct.pack(">I", zlib.crc32(kind + content))

    pixel = zlib.compress(b"\x00" + random.randbytes(3))
    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixel) + chunk(b"IEND", b"")


IMAGENES_SUBIDAS = []


def subir(token, contenido=None, nombre="foto.png"):
    response = httpx.post(
        f"{ASESORIA}/media",
        headers=auth(token),
        files={"file": (nombre, contenido if contenido is not None else png(), "image/png")},
        timeout=30,
    )
    if response.status_code == 201:
        IMAGENES_SUBIDAS.append(response.json()["id"])
    return response


@pytest.fixture(scope="module")
def tokens():
    return {"admin": login(ADMIN), "stylist": login(STYLIST), "client": login(CLIENT), "other": login(CLIENTE)}


@pytest.fixture(scope="module", autouse=True)
def limpieza():
    puntos = foto_de_puntos()
    item = sql_gestion(f"SELECT current_stock || ',' || minimum_stock FROM inventory_items WHERE id='{ITEM}'").split(",")
    yield
    limpiar_crm_de_pruebas(puntos)
    esperar_colas_vacias()
    sql_gestion(f"DELETE FROM stylist_reviews WHERE comment LIKE '{PREFIJO}%'")
    sql_gestion(f"DELETE FROM appointments WHERE service_name = '{PREFIJO}'")
    sql_gestion("DELETE FROM inventory_logs WHERE appointment_id IN "
                "(SELECT id FROM appointments WHERE appointment_date >= '2036-01-01')")
    sql_gestion("DELETE FROM appointments WHERE appointment_date >= '2036-01-01'")
    sql_gestion(f"DELETE FROM stylist_schedules WHERE stylist_id IN (SELECT id FROM stylists WHERE name LIKE '{PREFIJO}%')")
    sql_gestion(f"DELETE FROM stylists WHERE name LIKE '{PREFIJO}%'")
    sql_gestion(f"DELETE FROM inventory_logs WHERE item_id='{ITEM}' AND reason LIKE '{PREFIJO}%'")
    sql_gestion(f"UPDATE inventory_items SET current_stock={item[0]}, minimum_stock={item[1]} WHERE id='{ITEM}'")
    sql_crm(f"DELETE FROM notices WHERE created_at >= '{INICIO}'")
    borrar_imagenes(IMAGENES_SUBIDAS)


def crear_estilista(token, nombre="Marta"):
    query = "mutation($i:StylistInput!){createStylist(input:$i){id name specialty phone active}}"
    variables = {"i": {"name": f"{PREFIJO} {nombre}", "specialty": "Color", "phone": "700"}}
    return data(query, token, variables)["createStylist"]


def poner_horario(token, stylist_id, dia, inicio="09:00", fin="18:00", disponible=True):
    return gql(
        "mutation($i:ScheduleInput!){setStylistSchedule(input:$i){dayOfWeek startTime endTime isAvailable stylistName}}",
        token,
        {"i": {"stylistId": stylist_id, "dayOfWeek": dia, "startTime": inicio, "endTime": fin, "isAvailable": disponible}},
    )


def proximo_dia(iso_dia):
    """Fecha lejana que cae en el día de la semana indicado."""
    fecha = datetime.date(2040, 1, 2) + datetime.timedelta(days=random.randint(0, 5000))
    while fecha.isoweekday() != iso_dia:
        fecha += datetime.timedelta(days=1)
    return fecha.isoformat()


def turnos(token, stylist_id, fecha, servicio=CORTE):
    return data(
        "query($a:String!,$s:String!,$d:String!){getAvailableSlots(stylistId:$a,serviceId:$s,date:$d){start}}",
        token, {"a": stylist_id, "s": servicio, "d": fecha},
    )["getAvailableSlots"]


class TestEstilistas:
    """CU-04"""

    def test_admin_registra_y_modifica(self, tokens):
        creado = crear_estilista(tokens["admin"])
        assert creado["active"] is True
        modificado = data(
            'mutation($id:ID!){updateStylist(id:$id,input:{name:"' + PREFIJO + ' Marta Paz",specialty:"Corte"}){name specialty active}}',
            tokens["admin"], {"id": creado["id"]},
        )["updateStylist"]
        assert modificado == {"name": f"{PREFIJO} Marta Paz", "specialty": "Corte", "active": True}
        todos = data("{getAllStylists{id name}}", tokens["stylist"])["getAllStylists"]
        assert {"id": creado["id"], "name": f"{PREFIJO} Marta Paz"} in todos

    @pytest.mark.parametrize("rol", ["stylist", "client"])
    def test_solo_admin_registra(self, tokens, rol):
        body = gql('mutation{createStylist(input:{name:"X"}){id}}', tokens[rol])
        assert clasificacion(body) == SIN_ROL

    def test_cliente_no_ve_la_lista_completa(self, tokens):
        assert clasificacion(gql("{getAllStylists{id}}", tokens["client"])) == SIN_ROL

    def test_nombre_vacio_es_rechazado(self, tokens):
        body = gql('mutation{createStylist(input:{name:"   "}){id}}', tokens["admin"])
        assert clasificacion(body) == "BAD_REQUEST"

    def test_estilista_inexistente(self, tokens):
        body = gql('mutation{updateStylist(id:"nadie",input:{name:"X"}){id}}', tokens["admin"])
        assert clasificacion(body) == "BAD_REQUEST"


class TestHorarios:
    """CU-05"""

    def test_el_horario_define_los_turnos_reservables(self, tokens):
        estilista = crear_estilista(tokens["admin"], "Horario")
        lunes = proximo_dia(1)
        assert turnos(tokens["client"], estilista["id"], lunes) == []

        body = poner_horario(tokens["admin"], estilista["id"], 1, "10:00", "12:00")
        assert body["data"]["setStylistSchedule"]["startTime"].startswith("10:00")

        disponibles = [turno["start"] for turno in turnos(tokens["client"], estilista["id"], lunes)]
        assert disponibles == [f"{lunes}T10:00:00", f"{lunes}T10:30:00", f"{lunes}T11:00:00"]

        # Editar el mismo día reemplaza el bloque en lugar de duplicarlo
        poner_horario(tokens["admin"], estilista["id"], 1, "11:00", "12:00")
        disponibles = [turno["start"] for turno in turnos(tokens["client"], estilista["id"], lunes)]
        assert disponibles == [f"{lunes}T11:00:00"]

    def test_horario_invalido(self, tokens):
        estilista = crear_estilista(tokens["admin"], "Invalido")
        for dia, inicio, fin in [(1, "18:00", "09:00"), (8, "09:00", "18:00"), (1, "nueve", "18:00")]:
            assert clasificacion(poner_horario(tokens["admin"], estilista["id"], dia, inicio, fin)) == "BAD_REQUEST"

    def test_estilista_solo_edita_su_propio_horario(self, tokens):
        ajeno = crear_estilista(tokens["admin"], "Ajeno")
        assert clasificacion(poner_horario(tokens["stylist"], ajeno["id"], 2)) == SIN_ROL
        # Valentina (sty-101) puede guardar su propio horario; se repite el que ya tiene
        propio = next(
            bloque for bloque in data('{getAllStylists{id schedules{dayOfWeek startTime endTime isAvailable}}}', tokens["admin"])["getAllStylists"]
            if bloque["id"] == "sty-101"
        )["schedules"][0]
        body = poner_horario(tokens["stylist"], "sty-101", propio["dayOfWeek"], propio["startTime"], propio["endTime"], propio["isAvailable"])
        assert "errors" not in body, body

    def test_cliente_no_edita_horarios(self, tokens):
        assert clasificacion(poner_horario(tokens["client"], "sty-101", 1)) == SIN_ROL

    def test_no_deja_fuera_una_cita_reservada_ni_desactiva_con_citas(self, tokens):
        estilista = crear_estilista(tokens["admin"], "ConCita")
        poner_horario(tokens["admin"], estilista["id"], 1, "09:00", "18:00")
        lunes = proximo_dia(1)
        cita = gql(
            "mutation($i:CreateAppointmentInput!){scheduleAppointment(input:$i){id}}",
            tokens["admin"],
            {"i": {"clientId": CLIENTE_ID, "stylistId": estilista["id"], "serviceId": CORTE, "appointmentDate": f"{lunes}T10:00:00"}},
        )
        assert "errors" not in cita, cita

        assert clasificacion(poner_horario(tokens["admin"], estilista["id"], 1, "11:00", "18:00")) == "CONFLICT"
        assert clasificacion(poner_horario(tokens["admin"], estilista["id"], 1, "09:00", "18:00", False)) == "CONFLICT"
        desactivar = gql('mutation($id:ID!){setStylistActive(id:$id,active:false){id}}', tokens["admin"], {"id": estilista["id"]})
        assert clasificacion(desactivar) == "CONFLICT"

        # Un horario que sigue cubriendo la cita sí se acepta
        assert "errors" not in poner_horario(tokens["admin"], estilista["id"], 1, "10:00", "12:00")

    def test_estilista_inactivo_no_recibe_reservas(self, tokens):
        estilista = crear_estilista(tokens["admin"], "Inactivo")
        poner_horario(tokens["admin"], estilista["id"], 1)
        lunes = proximo_dia(1)
        assert turnos(tokens["client"], estilista["id"], lunes)
        assert estilista["id"] in [s["id"] for s in data("{getStylists{id}}", tokens["client"])["getStylists"]]

        data("mutation($id:ID!){setStylistActive(id:$id,active:false){active}}", tokens["admin"], {"id": estilista["id"]})

        assert turnos(tokens["client"], estilista["id"], lunes) == []
        assert estilista["id"] not in [s["id"] for s in data("{getStylists{id}}", tokens["client"])["getStylists"]]

        # Sigue en la lista del administrador con sus horarios, y se puede reactivar
        todos = data("{getAllStylists{id active schedules{dayOfWeek}}}", tokens["admin"])["getAllStylists"]
        inactivo = next(s for s in todos if s["id"] == estilista["id"])
        assert inactivo["active"] is False and inactivo["schedules"] == [{"dayOfWeek": 1}]
        data("mutation($id:ID!){setStylistActive(id:$id,active:true){active}}", tokens["admin"], {"id": estilista["id"]})
        assert turnos(tokens["client"], estilista["id"], lunes)


class TestInventario:
    """CU-08, CU-09"""

    def actual(self, token):
        return data(f'{{getInventoryItem(id:"{ITEM}"){{currentStock minimumStock reservedStock isCriticalStock}}}}', token)["getInventoryItem"]

    def test_stock_minimo_cambia_el_estado_critico(self, tokens):
        inicial = self.actual(tokens["admin"])
        minimo = inicial["currentStock"] + 5
        cambiado = data(
            f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:{minimo}){{minimumStock isCriticalStock}}}}',
            tokens["admin"],
        )["updateMinimumStock"]
        assert cambiado == {"minimumStock": minimo, "isCriticalStock": True}
        assert ITEM in [i["id"] for i in data("{getCriticalStockItems{id}}", tokens["stylist"])["getCriticalStockItems"]]

        data(f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:0){{id}}}}', tokens["admin"])
        assert self.actual(tokens["admin"])["isCriticalStock"] is False

    def test_stock_minimo_invalido_y_permisos(self, tokens):
        negativo = gql(f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:-1){{id}}}}', tokens["admin"])
        assert clasificacion(negativo) == "BAD_REQUEST"
        inexistente = gql('mutation{updateMinimumStock(id:"nada",minimumStock:1){id}}', tokens["admin"])
        assert clasificacion(inexistente) == "BAD_REQUEST"
        for rol in ("stylist", "client"):
            prohibido = gql(f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:1){{id}}}}', tokens[rol])
            assert clasificacion(prohibido) == SIN_ROL

    def test_cada_movimiento_queda_registrado_con_su_motivo(self, tokens):
        motivo = f"{PREFIJO} compra {uuid.uuid4()}"
        antes = self.actual(tokens["admin"])["currentStock"]
        data(
            "mutation($i:UpdateStockInput!){updateStock(input:$i){id}}",
            tokens["admin"], {"i": {"id": ITEM, "quantityChange": 2, "reason": motivo}},
        )
        fila = sql_gestion(f"SELECT quantity_change, previous_stock, new_stock FROM inventory_logs WHERE reason='{motivo}'")
        assert fila == f"2|{antes}|{antes + 2}"

    def test_movimientos_simultaneos_no_se_pierden(self, tokens):
        antes = self.actual(tokens["admin"])["currentStock"]

        def sumar(_):
            return gql(
                "mutation($i:UpdateStockInput!){updateStock(input:$i){id}}",
                tokens["admin"], {"i": {"id": ITEM, "quantityChange": 1, "reason": f"{PREFIJO} simultaneo"}},
            )

        with concurrent.futures.ThreadPoolExecutor(10) as pool:
            resultados = list(pool.map(sumar, range(10)))
        assert all("errors" not in r for r in resultados), resultados
        assert self.actual(tokens["admin"])["currentStock"] == antes + 10

    def test_no_puede_quedar_menos_stock_que_lo_reservado(self, tokens):
        actual = self.actual(tokens["admin"])["currentStock"]
        sql_gestion(f"UPDATE inventory_items SET reserved_stock=2 WHERE id='{ITEM}'")
        try:
            body = gql(
                "mutation($i:UpdateStockInput!){updateStock(input:$i){id}}",
                tokens["admin"], {"i": {"id": ITEM, "quantityChange": -(actual - 1), "reason": f"{PREFIJO} merma"}},
            )
            assert clasificacion(body) == "CONFLICT"
            assert self.actual(tokens["admin"])["currentStock"] == actual
        finally:
            sql_gestion(f"UPDATE inventory_items SET reserved_stock=0 WHERE id='{ITEM}'")

    def test_movimiento_sin_motivo(self, tokens):
        body = gql(
            "mutation($i:UpdateStockInput!){updateStock(input:$i){id}}",
            tokens["admin"], {"i": {"id": ITEM, "quantityChange": 1, "reason": "  "}},
        )
        assert clasificacion(body) == "BAD_REQUEST"


def cita_pasada(cliente, estado="CONFIRMED", estilista="sty-103"):
    """Inserta una cita ya iniciada: por API no se puede crear una con fecha pasada."""
    cita = str(uuid.uuid4())
    fecha = datetime.datetime(2020, 1, 1) + datetime.timedelta(hours=random.randint(0, 40000))
    sql_gestion(
        "INSERT INTO appointments (id, client_id, stylist_id, service_name, appointment_date, duration_minutes, total_price, status) "
        f"VALUES ('{cita}', '{cliente}', '{estilista}', '{PREFIJO}', '{fecha}', 30, 10, '{estado}')"
    )
    return cita


class TestResenas:
    def completar(self, token, cita):
        return gql("mutation($id:ID!){completeAppointment(id:$id){status}}", token, {"id": cita})

    def resenar(self, token, cita, rating=5):
        return gql(
            "mutation($i:CreateReviewInput!){createReview(input:$i){id rating comment stylistId}}",
            token, {"i": {"appointmentId": cita, "rating": rating, "comment": f"{PREFIJO} muy bien"}},
        )

    def test_flujo_completo_de_resena(self, tokens):
        cita = cita_pasada("cli-001")
        pendiente = self.resenar(tokens["client"], cita)
        assert clasificacion(pendiente) == "CONFLICT"

        assert self.completar(tokens["client"], cita)["errors"][0]["extensions"]["classification"] == SIN_ROL
        assert self.completar(tokens["stylist"], cita)["data"]["completeAppointment"]["status"] == "COMPLETED"

        creada = self.resenar(tokens["client"], cita)
        assert creada["data"]["createReview"]["stylistId"] == "sty-103"

        duplicada = self.resenar(tokens["client"], cita, 1)
        assert clasificacion(duplicada) == "CONFLICT"

        mias = data("{getMyAppointments{id stylistName reviewed}}", tokens["client"])["getMyAppointments"]
        mia = next(a for a in mias if a["id"] == cita)
        assert mia["reviewed"] is True and mia["stylistName"] == "Sofía Morales"

        publicas = data('{getStylistReviews(stylistId:"sty-103"){appointmentId comment}}', tokens["other"])["getStylistReviews"]
        assert {"appointmentId": cita, "comment": f"{PREFIJO} muy bien"} in publicas

    def test_calificacion_del_estilista_se_recalcula(self, tokens):
        def calificacion():
            todos = data("{getStylists{id rating{average count}}}", tokens["client"])["getStylists"]
            return next(s["rating"] for s in todos if s["id"] == "sty-102")

        antes = calificacion()
        cita = cita_pasada("cli-001", "COMPLETED", "sty-102")
        assert "errors" not in self.resenar(tokens["client"], cita, 4)
        despues = calificacion()
        assert despues["count"] == antes["count"] + 1
        esperado = float(sql_gestion("SELECT ROUND(AVG(rating), 2) FROM stylist_reviews WHERE stylist_id='sty-102'"))
        assert despues["average"] == esperado

    def test_no_se_resena_una_cita_ajena(self, tokens):
        cita = cita_pasada("cli-001", "COMPLETED")
        assert clasificacion(self.resenar(tokens["other"], cita)) == "BAD_REQUEST"

    def test_calificacion_fuera_de_rango(self, tokens):
        cita = cita_pasada("cli-001", "COMPLETED")
        for rating in (0, 6):
            assert clasificacion(self.resenar(tokens["client"], cita, rating)) == "BAD_REQUEST"

    def test_no_se_completa_una_cita_futura(self, tokens):
        estilista = crear_estilista(tokens["admin"], "Futura")
        poner_horario(tokens["admin"], estilista["id"], 1)
        cita = data(
            "mutation($i:CreateAppointmentInput!){scheduleAppointment(input:$i){id}}",
            tokens["admin"],
            {"i": {"clientId": CLIENTE_ID, "stylistId": estilista["id"], "serviceId": CORTE, "appointmentDate": f"{proximo_dia(1)}T10:00:00"}},
        )["scheduleAppointment"]["id"]
        assert clasificacion(self.completar(tokens["admin"], cita)) == "CONFLICT"

    def test_no_se_reprograma_una_cita_completada(self, tokens):
        cita = cita_pasada("cli-001", "COMPLETED")
        body = gql(
            'mutation($id:ID!){rescheduleAppointment(id:$id,newDate:"' + proximo_dia(1) + 'T10:00:00"){id}}',
            tokens["admin"], {"id": cita},
        )
        assert clasificacion(body) == "CONFLICT"


class TestPanel:
    """RNF-01"""

    def test_agenda_desnormalizada(self, tokens):
        cita = cita_pasada("cli-001", "CONFIRMED", "sty-101")
        fecha = sql_gestion(f"SELECT appointment_date::date FROM appointments WHERE id='{cita}'")
        agenda = data(
            f'{{getPanelAgenda(from:"{fecha}",to:"{fecha}"){{id clientId stylistName serviceName appointmentDate status totalPrice}}}}',
            tokens["stylist"],
        )["getPanelAgenda"]
        fila = next(a for a in agenda if a["id"] == cita)
        assert fila["stylistName"] == "Valentina Rossi"
        assert fila["clientId"] == "cli-001" and fila["status"] == "CONFIRMED" and fila["totalPrice"] == 10

    def test_resumen_del_periodo(self, tokens):
        desde, hasta = "2021-06-01", "2021-12-31"
        sql_filtro = f"appointment_date >= '{desde}' AND appointment_date < '2022-01-01'"
        cita_pasada("cli-001", "CONFIRMED", "sty-101")
        resumen = data(
            f'{{getPanelSummary(from:"{desde}",to:"{hasta}"){{totalAppointments active completed cancelled bookedValue occupancyRate}}}}',
            tokens["admin"],
        )["getPanelSummary"]
        total, activas, completas = sql_gestion(
            "SELECT COUNT(*), COUNT(*) FILTER (WHERE status IN ('SCHEDULED','CONFIRMED','RESCHEDULED')), "
            f"COUNT(*) FILTER (WHERE status='COMPLETED') FROM appointments WHERE {sql_filtro}"
        ).split("|")
        assert resumen["totalAppointments"] == int(total)
        assert resumen["active"] == int(activas)
        assert resumen["completed"] == int(completas)
        assert 0 <= resumen["occupancyRate"] <= 1

    def test_ocupacion_exacta(self, tokens):
        """Un día de un estilista nuevo no altera a los demás: se calcula el valor esperado desde los horarios."""
        lunes = proximo_dia(1)
        minutos = int(float(sql_gestion(
            "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM b.end_time - b.start_time) / 60), 0) FROM stylist_schedules b "
            "JOIN stylists s ON s.id = b.stylist_id AND s.active WHERE b.is_available AND b.day_of_week = 1"
        )))
        reservados = int(sql_gestion(
            f"SELECT COALESCE(SUM(duration_minutes), 0) FROM appointments WHERE appointment_date::date = '{lunes}' AND status <> 'CANCELLED'"
        ))
        resumen = data(f'{{getPanelSummary(from:"{lunes}",to:"{lunes}"){{occupancyRate}}}}', tokens["admin"])["getPanelSummary"]
        assert resumen["occupancyRate"] == pytest.approx(reservados / minutos, abs=0.0001)

    def test_permisos_del_panel(self, tokens):
        assert clasificacion(gql('{getPanelAgenda(from:"2026-01-01",to:"2026-01-02"){id}}', tokens["client"])) == SIN_ROL
        assert clasificacion(gql('{getPanelSummary(from:"2026-01-01",to:"2026-01-02"){active}}', tokens["stylist"])) == SIN_ROL

    def test_rangos_invalidos(self, tokens):
        for desde, hasta in [("2026-02-01", "2026-01-01"), ("hoy", "2026-01-01"), ("2020-01-01", "2026-01-01")]:
            body = gql(f'{{getPanelAgenda(from:"{desde}",to:"{hasta}"){{id}}}}', tokens["admin"])
            assert clasificacion(body) == "BAD_REQUEST"

    @pytest.mark.parametrize("query", [
        '{getPanelAgenda(from:"2036-01-01",to:"2036-12-31"){id stylistName status}}',
        '{getPanelSummary(from:"2026-01-01",to:"2026-12-31"){active occupancyRate}}',
        "{getAllStylists{id name rating{average count} schedules{dayOfWeek startTime}}}",
    ])
    def test_rnf_01_latencia(self, tokens, query):
        headers = auth(tokens["admin"])
        latencias = []
        with httpx.Client() as client:
            for _ in range(3):
                client.post(GESTION, json={"query": query}, headers=headers)
            for _ in range(20):
                inicio = time.perf_counter()
                response = client.post(GESTION, json={"query": query}, headers=headers)
                latencias.append((time.perf_counter() - inicio) * 1000)
                assert "errors" not in response.json(), response.text
        latencias.sort()
        p95 = latencias[18]
        print(f"[RNF-01] p95={p95:.1f} ms para {query[:40]}")
        assert p95 < 200

    def test_dataloader_consulta_una_sola_vez_por_lote(self, tokens):
        """Con varios estilistas, las calificaciones deben leerse en una sola consulta y no en una por fila."""
        def lecturas():
            return int(sql_gestion(
                "SELECT COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0) FROM pg_stat_user_tables WHERE relname = 'stylist_reviews'"
            ))

        cantidad = len(data("{getAllStylists{id}}", tokens["admin"])["getAllStylists"])
        assert cantidad >= 3
        time.sleep(12)  # PostgreSQL publica sus estadísticas con retraso
        antes = lecturas()
        data("{getAllStylists{id rating{count}}}", tokens["admin"])
        time.sleep(12)
        assert lecturas() - antes == 1


class TestAvisos:
    AVISOS = "{getMyNotices{id type title message read}}"

    def avisos(self, token):
        return crm(self.AVISOS, token).json()["data"]["getMyNotices"]

    def esperar_aviso(self, token, condicion, timeout=20):
        limite = time.time() + timeout
        while time.time() < limite:
            encontrados = [a for a in self.avisos(token) if condicion(a)]
            if encontrados:
                return encontrados
            time.sleep(0.3)
        raise AssertionError("El aviso no apareció")

    def test_pago_y_reembolso_avisan_al_cliente(self, tokens):
        from test_crm_live import cancelar, esperar_estado
        cliente = login(CLIENTE)
        view, _ = reservar_y_pagar(cliente)
        pagado = self.esperar_aviso(cliente, lambda a: a["type"] == "PAYMENT")
        assert "Corte" in pagado[0]["message"]

        assert cancelar(cliente, view["sagaId"]).status_code == 202
        esperar_estado(cliente, view["sagaId"], lambda v: v["status"] == "REFUNDED")
        reembolso = self.esperar_aviso(cliente, lambda a: a["type"] == "REFUND")
        assert "45.00" in reembolso[0]["message"]

        # Otro cliente no ve esos avisos
        ids = [a["id"] for a in self.avisos(tokens["client"])]
        assert pagado[0]["id"] not in ids and reembolso[0]["id"] not in ids

    def test_stock_critico_avisa_solo_a_administradores(self, tokens):
        codigo = sql_gestion(f"SELECT code FROM inventory_items WHERE id='{ITEM}'")
        sql_crm(f"DELETE FROM notices WHERE source_ref LIKE 'stock:{codigo}:%'")
        data(f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:99999){{id}}}}', tokens["admin"])
        try:
            aviso = self.esperar_aviso(tokens["admin"], lambda a: a["type"] == "STOCK" and codigo in a["message"])
            assert len(aviso) == 1
            assert aviso[0]["id"] not in [a["id"] for a in self.avisos(tokens["client"])]
            assert aviso[0]["id"] not in [a["id"] for a in self.avisos(tokens["stylist"])]
        finally:
            data(f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:0){{id}}}}', tokens["admin"])

    def test_marcar_como_leido_solo_lo_propio(self, tokens):
        aviso_id = f"ntc_prueba_{uuid.uuid4().hex[:8]}"
        sql_crm(f"INSERT INTO notices (id, recipient, type, title, message) VALUES ('{aviso_id}', 'cli-001', 'TEST', 'T', 'M')")
        mutacion = f'mutation{{markNoticeRead(id:"{aviso_id}")}}'

        ajeno = crm(mutacion, tokens["other"]).json()
        assert ajeno["errors"][0]["extensions"]["classification"] == "NOT_FOUND"
        assert sql_crm(f"SELECT read_at IS NULL FROM notices WHERE id='{aviso_id}'") == "t"

        assert crm(mutacion, tokens["client"]).json()["data"]["markNoticeRead"] is True
        leido = next(a for a in self.avisos(tokens["client"]) if a["id"] == aviso_id)
        assert leido["read"] is True


class TestMetricasCrm:
    def test_coinciden_con_la_base(self, tokens):
        hoy = datetime.date.today()
        desde, hasta = (hoy - datetime.timedelta(days=30)).isoformat(), (hoy + datetime.timedelta(days=1)).isoformat()
        cuerpo = crm(
            f'{{getCrmMetrics(from:"{desde}",to:"{hasta}"){{revenue refunded invoicesIssued totalClients pointsEarned}}}}',
            tokens["admin"],
        ).json()
        assert "errors" not in cuerpo, cuerpo
        metricas = cuerpo["data"]["getCrmMetrics"]
        fin = (hoy + datetime.timedelta(days=2)).isoformat()
        facturado, emitidas = sql_crm(
            f"SELECT COALESCE(SUM(total_amount),0), COUNT(*) FROM invoices WHERE issued_at >= '{desde}' AND issued_at < '{fin}'"
        ).split("|")
        reembolsado = sql_crm(f"SELECT COALESCE(SUM(amount),0) FROM credit_notes WHERE issued_at >= '{desde}' AND issued_at < '{fin}'")
        assert metricas["invoicesIssued"] == int(emitidas)
        assert metricas["refunded"] == float(reembolsado)
        assert metricas["revenue"] == pytest.approx(float(facturado) - float(reembolsado))
        assert metricas["totalClients"] == int(sql_crm("SELECT COUNT(*) FROM crm_clients"))

    @pytest.mark.parametrize("rol", ["client", "stylist"])
    def test_solo_admin(self, tokens, rol):
        cuerpo = crm('{getCrmMetrics(from:"2026-01-01",to:"2026-01-02"){revenue}}', tokens[rol]).json()
        assert cuerpo["errors"][0]["extensions"]["classification"] == SIN_ROL

    @pytest.mark.parametrize("desde,hasta", [("ayer", "2026-01-02"), ("2026-02-30", "2026-03-01"), ("2026-03-01", "2026-02-01")])
    def test_fechas_invalidas(self, tokens, desde, hasta):
        cuerpo = crm(f'{{getCrmMetrics(from:"{desde}",to:"{hasta}"){{revenue}}}}', tokens["admin"]).json()
        assert cuerpo["errors"][0]["extensions"]["classification"] == "BAD_REQUEST"


class TestImagenes:
    def test_subir_y_descargar(self, tokens):
        contenido = png()
        subida = subir(tokens["client"], contenido)
        assert subida.status_code == 201, subida.text
        url = subida.json()["url"]
        # <img> no envía token: la imagen se sirve sin autenticación, con su tipo real
        imagen = httpx.get(f"{ASESORIA}{url}")
        assert imagen.status_code == 200
        assert imagen.content == contenido
        assert imagen.headers["content-type"] == "image/png"
        assert imagen.headers["x-content-type-options"] == "nosniff"

    def test_sin_token(self):
        assert httpx.post(f"{ASESORIA}/media", files={"file": ("a.png", png(), "image/png")}).status_code == 401

    def test_sin_archivo(self, tokens):
        assert httpx.post(f"{ASESORIA}/media", headers=auth(tokens["client"])).status_code == 400

    def test_un_svg_disfrazado_de_png_es_rechazado(self, tokens):
        assert subir(tokens["client"], b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>").status_code == 422

    def test_archivo_demasiado_grande(self, tokens):
        assert subir(tokens["client"], b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024 + 1)).status_code == 413

    def test_imagen_inexistente(self):
        assert httpx.get(f"{ASESORIA}/media/{'0' * 32}").status_code == 404
        assert httpx.get(f"{ASESORIA}/media/noexiste").status_code == 404


@pytest.fixture
def publicacion(tokens):
    """Publicación de camila.fernandez, que se elimina al terminar la prueba."""
    imagen = subir(tokens["client"]).json()["url"]
    creada = httpx.post(
        f"{ASESORIA}/community", headers=auth(tokens["client"]),
        json={"title": f"{PREFIJO} Mi look", "description": "Balayage", "imageUrl": imagen},
    )
    assert creada.status_code == 201, creada.text
    post = creada.json()
    yield post
    httpx.delete(f"{ASESORIA}/community/{post['id']}", headers=auth(tokens["admin"]))


class TestComunidad:
    """CU-20, CU-21"""

    def leer(self, token, post_id):
        return httpx.get(f"{ASESORIA}/community/{post_id}", headers=auth(token))

    def comentar(self, token, post_id, contenido="Hola", padre=None):
        cuerpo = {"content": contenido}
        if padre:
            cuerpo["parentId"] = padre
        return httpx.post(f"{ASESORIA}/community/{post_id}/comment", headers=auth(token), json=cuerpo)

    def test_el_autor_sale_del_token(self, tokens):
        imagen = subir(tokens["client"]).json()["url"]
        creada = httpx.post(
            f"{ASESORIA}/community", headers=auth(tokens["client"]),
            json={"title": f"{PREFIJO} Autor", "description": "x", "imageUrl": imagen, "authorId": "cli-002", "authorName": "Otro"},
        )
        assert creada.json()["authorId"] == "cli-001"
        httpx.delete(f"{ASESORIA}/community/{creada.json()['id']}", headers=auth(tokens["client"]))

    def test_rechaza_imagen_externa_y_datos_vacios(self, tokens):
        malos = [
            {"title": "T", "description": "D", "imageUrl": "https://tracker.example/x.gif"},
            {"title": "T", "description": "D", "imageUrl": "javascript:alert(1)"},
            {"title": "  ", "description": "D", "imageUrl": subir(tokens["client"]).json()["url"]},
            {"title": "T"},
        ]
        for cuerpo in malos:
            assert httpx.post(f"{ASESORIA}/community", headers=auth(tokens["client"]), json=cuerpo).status_code == 400

    def test_el_muro_no_expone_quien_dio_like(self, tokens, publicacion):
        muro = httpx.get(f"{ASESORIA}/community", headers=auth(tokens["other"])).json()
        post = next(p for p in muro if p["id"] == publicacion["id"])
        assert "likes" not in post
        assert post.get("reports") is None
        assert post["totalLikes"] == 0 and post["likedByMe"] is False

    def test_like_alterna_y_se_refleja_por_usuario(self, tokens, publicacion):
        url = f"{ASESORIA}/community/{publicacion['id']}/like"
        primero = httpx.post(url, headers=auth(tokens["other"]))
        assert primero.status_code == 200 and primero.json() == {"liked": True, "totalLikes": 1}
        assert self.leer(tokens["other"], publicacion["id"]).json()["likedByMe"] is True
        assert self.leer(tokens["client"], publicacion["id"]).json()["likedByMe"] is False
        assert httpx.post(url, headers=auth(tokens["other"])).json() == {"liked": False, "totalLikes": 0}

    def test_likes_simultaneos_no_se_pierden(self, tokens, publicacion):
        url = f"{ASESORIA}/community/{publicacion['id']}/like"
        usuarios = [tokens["client"], tokens["other"], tokens["admin"], tokens["stylist"]]
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            respuestas = list(pool.map(lambda t: httpx.post(url, headers=auth(t)), usuarios))
        assert all(r.json()["liked"] is True for r in respuestas), [r.text for r in respuestas]
        assert self.leer(tokens["client"], publicacion["id"]).json()["totalLikes"] == 4

    def test_clics_repetidos_simultaneos_son_consistentes(self, tokens, publicacion):
        """Un mismo usuario con 12 clics a la vez nunca duplica su like: termina en 0 o 1 según la paridad."""
        url = f"{ASESORIA}/community/{publicacion['id']}/like"
        with concurrent.futures.ThreadPoolExecutor(12) as pool:
            respuestas = list(pool.map(lambda _: httpx.post(url, headers=auth(tokens["other"])), range(12)))
        assert all(r.status_code == 200 for r in respuestas)
        assert self.leer(tokens["other"], publicacion["id"]).json()["totalLikes"] == 0

    def test_comentarios_en_cascada(self, tokens, publicacion):
        post_id = publicacion["id"]
        nivel1 = self.comentar(tokens["other"], post_id, "Nivel 1")
        assert nivel1.status_code == 201
        nivel2 = self.comentar(tokens["client"], post_id, "Nivel 2", nivel1.json()["id"])
        nivel3 = self.comentar(tokens["other"], post_id, "Nivel 3", nivel2.json()["id"])
        assert nivel3.json()["parentId"] == nivel2.json()["id"]
        assert self.comentar(tokens["client"], post_id, "Nivel 4", nivel3.json()["id"]).status_code == 422
        assert self.comentar(tokens["client"], post_id, "Huérfano", "no-existe").status_code == 422
        assert self.comentar(tokens["client"], post_id, "   ").status_code == 400

        comentarios = self.leer(tokens["client"], post_id).json()["comments"]
        assert [c["content"] for c in comentarios] == ["Nivel 1", "Nivel 2", "Nivel 3"]
        assert comentarios[0]["authorName"]

    def test_eliminar_comentario_conserva_sus_respuestas(self, tokens, publicacion):
        post_id = publicacion["id"]
        padre = self.comentar(tokens["other"], post_id, "Padre").json()["id"]
        hijo = self.comentar(tokens["client"], post_id, "Hijo", padre).json()["id"]

        url = f"{ASESORIA}/community/{post_id}/comment/{padre}"
        assert httpx.delete(url, headers=auth(tokens["client"])).status_code == 403
        assert httpx.delete(url, headers=auth(tokens["other"])).status_code == 200

        comentarios = {c["id"]: c for c in self.leer(tokens["client"], post_id).json()["comments"]}
        assert comentarios[padre]["deleted"] is True and comentarios[padre]["content"] is None
        assert comentarios[padre]["authorName"] is None
        assert comentarios[hijo]["content"] == "Hijo"
        assert self.comentar(tokens["client"], post_id, "Otra", padre).status_code == 422

    def test_solo_autor_o_personal_eliminan(self, tokens):
        imagen = subir(tokens["client"]).json()["url"]
        post = httpx.post(
            f"{ASESORIA}/community", headers=auth(tokens["client"]),
            json={"title": f"{PREFIJO} Borrar", "description": "x", "imageUrl": imagen},
        ).json()
        url = f"{ASESORIA}/community/{post['id']}"
        assert httpx.delete(url, headers=auth(tokens["other"])).status_code == 403
        assert httpx.delete(url, headers=auth(tokens["client"])).status_code == 200
        assert self.leer(tokens["client"], post["id"]).status_code == 404
        # La imagen se borra junto con la publicación
        assert httpx.get(f"{ASESORIA}{imagen}").status_code == 404


class TestModeracion:
    def accion(self, token, post_id, accion, motivo="Contenido ofensivo"):
        return httpx.post(f"{ASESORIA}/community/{post_id}/{accion}", headers=auth(token), json={"reason": motivo})

    def test_denuncias(self, tokens, publicacion):
        post_id = publicacion["id"]
        assert self.accion(tokens["client"], post_id, "report").status_code == 422
        assert self.accion(tokens["other"], post_id, "report", "  ").status_code == 400
        assert self.accion(tokens["other"], post_id, "report").status_code == 201
        assert self.accion(tokens["other"], post_id, "report").status_code == 409

        vista = httpx.get(f"{ASESORIA}/community/{post_id}", headers=auth(tokens["other"])).json()
        assert vista["reportedByMe"] is True and vista.get("reports") is None

        cola = httpx.get(f"{ASESORIA}/community/moderation/queue", headers=auth(tokens["stylist"]))
        assert cola.status_code == 200
        en_cola = next(p for p in cola.json() if p["id"] == post_id)
        assert en_cola["reports"][0]["reason"] == "Contenido ofensivo"
        assert "userId" not in en_cola["reports"][0]

    @pytest.mark.parametrize("rol", ["client", "other"])
    def test_cliente_no_modera(self, tokens, publicacion, rol):
        post_id = publicacion["id"]
        assert httpx.get(f"{ASESORIA}/community/moderation/queue", headers=auth(tokens[rol])).status_code == 403
        assert self.accion(tokens[rol], post_id, "hide").status_code == 403
        assert self.accion(tokens[rol], post_id, "restore").status_code == 403

    def test_ocultar_y_restaurar(self, tokens, publicacion):
        post_id = publicacion["id"]
        assert self.accion(tokens["stylist"], post_id, "hide", " ").status_code == 400
        assert self.accion(tokens["other"], post_id, "report").status_code == 201

        oculta = self.accion(tokens["stylist"], post_id, "hide")
        assert oculta.status_code == 200 and oculta.json()["status"] == "HIDDEN"

        # Desaparece para los demás, y no admite interacción
        otros = httpx.get(f"{ASESORIA}/community", headers=auth(tokens["other"])).json()
        assert post_id not in [p["id"] for p in otros]
        assert httpx.get(f"{ASESORIA}/community/{post_id}", headers=auth(tokens["other"])).status_code == 404
        assert httpx.post(f"{ASESORIA}/community/{post_id}/like", headers=auth(tokens["other"])).status_code == 404
        comentario = httpx.post(f"{ASESORIA}/community/{post_id}/comment", headers=auth(tokens["other"]), json={"content": "x"})
        assert comentario.status_code == 404

        # Su autor la sigue viendo, con el motivo
        propias = httpx.get(f"{ASESORIA}/community", headers=auth(tokens["client"])).json()
        propia = next(p for p in propias if p["id"] == post_id)
        assert propia["status"] == "HIDDEN" and propia["moderationReason"] == "Contenido ofensivo"

        # Y recibe un aviso real, a través de RabbitMQ y el CRM
        limite = time.time() + 20
        aviso = []
        while time.time() < limite and not aviso:
            avisos = crm("{getMyNotices{type message}}", tokens["client"]).json()["data"]["getMyNotices"]
            aviso = [a for a in avisos if a["type"] == "MODERATION" and PREFIJO in a["message"]]
            time.sleep(0.3)
        assert aviso, "El autor no recibió el aviso"
        assert "Contenido ofensivo" in aviso[0]["message"]

        restaurada = self.accion(tokens["admin"], post_id, "restore")
        assert restaurada.json()["status"] == "VISIBLE"
        assert restaurada.json()["reports"] == []
        otros = httpx.get(f"{ASESORIA}/community", headers=auth(tokens["other"])).json()
        vuelta = next(p for p in otros if p["id"] == post_id)
        assert vuelta["moderationReason"] is None


class TestCloset:
    """CU-15"""

    def crear(self, token, **cambios):
        return httpx.post(f"{ASESORIA}/closet", headers=auth(token), json={
            "name": f"{PREFIJO} Blazer", "category": "OUTERWEAR", "color": "Beige", "season": "SPRING", **cambios,
        })

    def test_ciclo_completo_con_imagen(self, tokens):
        imagen = subir(tokens["client"]).json()["url"]
        creada = self.crear(tokens["client"], imageUrl=imagen, tags=["oficina"])
        assert creada.status_code == 201, creada.text
        prenda = creada.json()
        assert prenda["clientId"] == "cli-001"

        modificada = httpx.patch(f"{ASESORIA}/closet/{prenda['id']}", headers=auth(tokens["client"]), json={"color": "Negro", "clientId": "cli-002"})
        assert modificada.status_code == 200
        assert modificada.json()["color"] == "Negro" and modificada.json()["clientId"] == "cli-001"
        assert modificada.json()["name"] == prenda["name"]

        lista = httpx.get(f"{ASESORIA}/closet/client/cli-001", headers=auth(tokens["client"])).json()
        assert prenda["id"] in [p["id"] for p in lista]

        assert httpx.delete(f"{ASESORIA}/closet/{prenda['id']}", headers=auth(tokens["client"])).status_code == 200
        assert httpx.get(f"{ASESORIA}{imagen}").status_code == 404

    def test_prenda_sin_imagen_es_valida(self, tokens):
        creada = self.crear(tokens["client"])
        assert creada.status_code == 201 and creada.json()["imageUrl"] == ""
        httpx.delete(f"{ASESORIA}/closet/{creada.json()['id']}", headers=auth(tokens["client"]))

    @pytest.mark.parametrize("cambios", [
        {"category": "SOMBRERO"}, {"season": "NUNCA"}, {"name": "  "}, {"color": ""},
        {"imageUrl": "javascript:alert(1)"}, {"tags": "no-es-lista"},
    ])
    def test_datos_invalidos_responden_400(self, tokens, cambios):
        assert self.crear(tokens["client"], **cambios).status_code == 400

    def test_otro_cliente_no_modifica_ni_borra(self, tokens):
        prenda = self.crear(tokens["client"]).json()
        url = f"{ASESORIA}/closet/{prenda['id']}"
        assert httpx.patch(url, headers=auth(tokens["other"]), json={"color": "Rojo"}).status_code == 403
        assert httpx.delete(url, headers=auth(tokens["other"])).status_code == 403
        assert httpx.delete(url, headers=auth(tokens["client"])).status_code == 200


def herramienta(token, nombre, argumentos=None):
    response = rpc("tools/call", {"name": nombre, "arguments": argumentos or {}}, token)
    assert response.status_code == 200, response.text
    return response.json()["result"]


class TestServidorMcp:
    """CU-17, RF-11, RNF-02"""

    def test_handshake_del_protocolo(self, tokens):
        response = rpc("initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "prueba", "version": "1"},
        }, tokens["admin"])
        assert response.status_code == 200, response.text
        resultado = response.json()["result"]
        assert resultado["serverInfo"]["name"] == "salon-mcp"
        assert "tools" in resultado["capabilities"]

    def test_herramientas_por_rol_con_esquema_estandar(self, tokens):
        nombres = lambda t: {h["name"] for h in rpc("tools/list", {}, t).json()["result"]["tools"]}
        assert nombres(tokens["client"]) == {"listar_estilistas", "consultar_disponibilidad_estilista"}
        assert "consultar_stock_critico" in nombres(tokens["stylist"])
        assert "obtener_metricas_negocio" not in nombres(tokens["stylist"])
        herramientas = rpc("tools/list", {}, tokens["admin"]).json()["result"]["tools"]
        assert len(herramientas) == 5 and all(h["inputSchema"]["type"] == "object" for h in herramientas)

    def test_estilistas_reales(self, tokens):
        resultado = herramienta(tokens["client"], "listar_estilistas")
        esperados = data("{getStylists{id}}", tokens["client"])["getStylists"]
        assert [s["id"] for s in resultado["structuredContent"]["stylists"]] == [s["id"] for s in esperados]

    def test_disponibilidad_real(self, tokens):
        estilista = crear_estilista(tokens["admin"], "Mcp")
        poner_horario(tokens["admin"], estilista["id"], 1, "10:00", "11:00")
        lunes = proximo_dia(1)
        resultado = herramienta(tokens["client"], "consultar_disponibilidad_estilista", {"stylistId": estilista["id"], "date": lunes, "serviceId": CORTE})
        assert resultado["structuredContent"]["availableSlots"] == [{"start": f"{lunes}T10:00:00", "end": f"{lunes}T11:00:00"}]

        # Un día sin horario queda sin turnos, en lugar de devolver una lista fija
        martes = proximo_dia(2)
        vacio = herramienta(tokens["client"], "consultar_disponibilidad_estilista", {"stylistId": estilista["id"], "date": martes})
        assert vacio["structuredContent"]["isFullyBooked"] is True

    def test_stock_critico_real(self, tokens):
        resultado = herramienta(tokens["stylist"], "consultar_stock_critico")["structuredContent"]
        esperado = data("{getCriticalStockItems{id currentStock minimumStock}}", tokens["stylist"])["getCriticalStockItems"]
        assert {i["id"] for i in resultado["items"]} == {i["id"] for i in esperado}
        assert resultado["criticalItemsCount"] == len(esperado)

        # Cambiar un dato en la base cambia la respuesta de la herramienta
        data(f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:99999){{id}}}}', tokens["admin"])
        try:
            despues = herramienta(tokens["stylist"], "consultar_stock_critico")["structuredContent"]
            assert ITEM in [i["id"] for i in despues["items"]]
            filtrado = herramienta(tokens["stylist"], "consultar_stock_critico", {"category": "NO-EXISTE"})
            assert filtrado["structuredContent"]["items"] == []
        finally:
            data(f'mutation{{updateMinimumStock(id:"{ITEM}",minimumStock:0){{id}}}}', tokens["admin"])

    def test_metricas_reales(self, tokens):
        resultado = herramienta(tokens["admin"], "obtener_metricas_negocio", {"period": "MONTHLY"})["structuredContent"]
        desde, hasta = resultado["range"]["from"], resultado["range"]["to"]
        panel = data(
            f'{{getPanelSummary(from:"{desde}",to:"{hasta}"){{totalAppointments active completed cancelled occupancyRate}}}}',
            tokens["admin"],
        )["getPanelSummary"]
        for campo, valor in panel.items():
            assert resultado["appointments"][campo] == valor
        facturas = crm(f'{{getCrmMetrics(from:"{desde}",to:"{hasta}"){{revenue invoicesIssued}}}}', tokens["admin"]).json()["data"]["getCrmMetrics"]
        assert resultado["billing"]["revenue"] == facturas["revenue"]
        assert resultado["billing"]["invoicesIssued"] == facturas["invoicesIssued"]

    def test_periodo_invalido_es_error_de_herramienta(self, tokens):
        resultado = herramienta(tokens["admin"], "obtener_metricas_negocio", {"period": "ANUAL"})
        assert resultado["isError"] is True

    def test_agente_de_servicio_llega_a_datos_reales(self):
        token = httpx.post(f"{KEYCLOAK}/token", data={
            "grant_type": "client_credentials", "client_id": "salon-agent", "client_secret": "salon-agent-secret-local",
        }).json()["access_token"]
        resultado = herramienta(token, "obtener_metricas_negocio", {"period": "DAILY"})
        assert resultado.get("isError") is not True, resultado
        assert "billing" in resultado["structuredContent"]

    def test_reporte_con_datos_reales(self, tokens):
        resultado = herramienta(tokens["admin"], "generar_reporte_lenguaje_natural", {"prompt": "¿Qué insumos debo reponer?"})
        assert resultado.get("isError") is not True, resultado
        contenido = resultado["structuredContent"]
        print(f"[CU-18] motor: {contenido['engine']}")
        assert contenido["generatedReport"]
        assert contenido["data"]["criticalStock"]["criticalItemsCount"] == len(
            data("{getCriticalStockItems{id}}", tokens["admin"])["getCriticalStockItems"]
        )
        assert json.dumps(contenido["data"])

    @pytest.mark.parametrize("nombre", ["consultar_stock_critico", "obtener_metricas_negocio", "generar_reporte_lenguaje_natural"])
    def test_cliente_recibe_403(self, tokens, nombre):
        assert rpc("tools/call", {"name": nombre, "arguments": {"prompt": "x"}}, tokens["client"]).status_code == 403

    def test_herramienta_inexistente_recibe_403(self, tokens):
        assert rpc("tools/call", {"name": "borrar_todo", "arguments": {}}, tokens["admin"]).status_code == 403
