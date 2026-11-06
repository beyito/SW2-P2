"""Utilidades de las pruebas en vivo: consultas SQL al CRM y limpieza de lo que crean las pruebas."""
import subprocess
import time

import httpx

RABBIT = ("rabbit_admin", "rabbit_secret_pass")


def sql_crm(query):
    result = subprocess.run(
        ["docker", "exec", "salon-postgres", "psql", "-U", "salon_admin", "-d", "salon_crm", "-Atc", query],
        capture_output=True, text=True, check=True, encoding="utf-8",
    )
    return result.stdout.strip()


def sql_gestion(query):
    result = subprocess.run(
        ["docker", "exec", "salon-postgres", "psql", "-U", "salon_admin", "-d", "salon_gestion", "-Atc", query],
        capture_output=True, text=True, check=True, encoding="utf-8",
    )
    return result.stdout.strip()


def esperar_colas_vacias(timeout=30):
    """Espera a que los consumidores terminen, para no limpiar antes de que llegue un evento."""
    limit = time.time() + timeout
    colas = ["gestion.saga.commands", "saga.orchestrator.events", "crm.saga.events"]
    while time.time() < limit:
        queues = {q["name"]: q for q in httpx.get("http://localhost:15672/api/queues", auth=RABBIT).json()}
        if all(queues[name].get("messages", 0) == 0 for name in colas):
            return
        time.sleep(0.5)
    raise AssertionError("Las colas de la SAGA no se vaciaron")


def foto_de_puntos():
    return sql_crm("SELECT id || '=' || loyalty_points FROM crm_clients")


def limpiar_crm_de_pruebas(foto):
    """Borra lo que generaron las citas de prueba (posteriores a 2036) y restaura los saldos."""
    esperar_colas_vacias()
    time.sleep(2)  # Las estadísticas de RabbitMQ se actualizan cada pocos segundos
    esperar_colas_vacias()
    sagas = sql_gestion(
        "SELECT saga_id FROM appointments WHERE appointment_date >= '2036-01-01' AND saga_id IS NOT NULL"
    ).splitlines()
    if sagas:
        lista = ",".join(f"'{saga}'" for saga in sagas)
        sql_crm(f"DELETE FROM credit_notes WHERE invoice_id IN (SELECT id FROM invoices WHERE saga_id IN ({lista}))")
        sql_crm(f"DELETE FROM invoices WHERE saga_id IN ({lista})")
        patrones = " OR ".join(f"source_ref LIKE 'saga:{saga}:%'" for saga in sagas)
        sql_crm(f"DELETE FROM loyalty_transactions WHERE {patrones}")
        sql_crm(f"DELETE FROM notices WHERE {patrones.replace('source_ref', 'notices.source_ref')}")
    # Los ajustes manuales de las pruebas no deben quedar en el historial que ve el cliente
    sql_crm("DELETE FROM loyalty_transactions WHERE source_ref LIKE 'manual:%' AND description = 'prueba'")
    for linea in foto.splitlines():
        cliente, puntos = linea.split("=")
        sql_crm(f"UPDATE crm_clients SET loyalty_points={puntos} WHERE id='{cliente}'")


def borrar_imagenes(ids):
    """Borra de GridFS las imágenes que subieron las pruebas y que no quedaron unidas a ninguna publicación."""
    if not ids:
        return
    lista = ",".join(f"'{identificador}'" for identificador in ids)
    subprocess.run(
        ["docker", "exec", "salon-mongodb", "mongosh", "--quiet", "-u", "mongo_admin", "-p", "mongo_secret_pass",
         "--authenticationDatabase", "admin", "salon_asesoria", "--eval",
         f"const f = db.getCollection('media.files').find({{filename: {{$in: [{lista}]}}}}).toArray().map(x => x._id);"
         "db.getCollection('media.chunks').deleteMany({files_id: {$in: f}});"
         "db.getCollection('media.files').deleteMany({_id: {$in: f}});"],
        capture_output=True, text=True, check=True, encoding="utf-8",
    )
