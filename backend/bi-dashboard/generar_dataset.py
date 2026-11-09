"""
Genera el dataset histórico del tablero de inteligencia de negocios: dos años de operación del salón
(noviembre de 2024 a octubre de 2026) con miles de registros.

Parte del catálogo real (servicios, estilistas e insumos de las semillas) y lo amplía a un salón completo.
Los datos son sintéticos pero siguen patrones realistas: estacionalidad, días y horas pico, crecimiento,
clientes frecuentes y ocasionales, cancelaciones, inasistencias, canjes de puntos y consumo de insumos
según la receta de cada servicio. La semilla es fija: cada ejecución produce exactamente los mismos datos.

Uso: python generar_dataset.py   (escribe los CSV en datos/)
"""
import csv
import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path

SEMILLA = 2026
INICIO = date(2024, 11, 1)
FIN = date(2026, 10, 31)
CARPETA = Path(__file__).parent / "datos"
IVA = 0.13  # Bolivia: incluido en el precio
PUNTOS_POR_DOLAR = 10
VALOR_PUNTO = 0.01

# Los tres primeros son los del catálogo real del salón
SERVICIOS = [
    ("srv-01", "Balayage Deluxe & Matizado", "Coloración", 150, 120.00, 6),
    ("srv-02", "Tratamiento Keratina Brasileña", "Tratamientos", 120, 95.00, 7),
    ("srv-03", "Corte Visagista & Styling", "Corte", 60, 45.00, 20),
    ("srv-04", "Retoque de raíz", "Coloración", 90, 55.00, 12),
    ("srv-05", "Mechas iluminadas", "Coloración", 120, 85.00, 7),
    ("srv-06", "Hidratación profunda", "Tratamientos", 60, 40.00, 10),
    ("srv-07", "Corte caballero", "Corte", 30, 18.00, 14),
    ("srv-08", "Peinado de evento", "Peinado", 60, 50.00, 6),
    ("srv-09", "Maquillaje social", "Maquillaje", 60, 45.00, 5),
    ("srv-10", "Manicure spa", "Uñas", 45, 22.00, 12),
    ("srv-11", "Pedicure spa", "Uñas", 60, 28.00, 8),
    ("srv-12", "Alisado orgánico", "Tratamientos", 150, 110.00, 4),
]

# Especialidades: qué categorías atiende cada estilista. Los tres primeros son los reales.
ESTILISTAS = [
    ("sty-101", "Valentina Rossi", "Master Stylist", date(2024, 11, 1), {"Corte", "Coloración", "Peinado"}),
    ("sty-102", "Carlos Mendoza", "Colorista Experto", date(2024, 11, 1), {"Coloración", "Corte"}),
    ("sty-103", "Sofía Morales", "Tratamientos", date(2024, 11, 1), {"Tratamientos", "Peinado"}),
    ("sty-104", "Lucía Paredes", "Uñas y spa", date(2025, 2, 3), {"Uñas"}),
    ("sty-105", "Daniela Rojas", "Maquillaje y peinado", date(2025, 6, 2), {"Maquillaje", "Peinado"}),
    ("sty-106", "Andrés Vaca", "Barbería y corte", date(2025, 10, 6), {"Corte"}),
]

# Insumos: los tres reales y otros de uso diario, con su costo unitario
INSUMOS = [
    ("inv-001", "Tinte Rubio Cenizo 8.1 60ml", "COLORACION", 14.50),
    ("inv-002", "Tratamiento Keratina Hidronutritiva 1000ml", "TRATAMIENTOS", 65.00),
    ("inv-003", "Oxidante en Crema 20 Volúmenes 1L", "DECOLORACION", 9.80),
    ("inv-004", "Polvo decolorante 500g", "DECOLORACION", 18.00),
    ("inv-005", "Mascarilla hidratante 500ml", "TRATAMIENTOS", 21.00),
    ("inv-006", "Esmalte semipermanente", "UÑAS", 6.50),
    ("inv-007", "Base de maquillaje profesional", "MAQUILLAJE", 12.00),
    ("inv-008", "Laca fijadora 400ml", "PEINADO", 7.20),
    ("inv-009", "Alisado orgánico 1L", "TRATAMIENTOS", 58.00),
]

# Receta: unidades (o fracción de envase) de cada insumo por servicio
RECETA = {
    "srv-01": [("inv-001", 2), ("inv-003", 1), ("inv-004", 0.5)],
    "srv-02": [("inv-002", 1)],
    "srv-04": [("inv-001", 1), ("inv-003", 0.5)],
    "srv-05": [("inv-004", 0.5), ("inv-003", 0.5)],
    "srv-06": [("inv-005", 0.3)],
    "srv-08": [("inv-008", 0.3)],
    "srv-09": [("inv-007", 0.2)],
    "srv-10": [("inv-006", 1)],
    "srv-11": [("inv-006", 1)],
    "srv-12": [("inv-009", 1)],
}

NOMBRES = ["Camila", "Valeria", "Daniela", "Gabriela", "Mariana", "Andrea", "Paola", "Natalia", "Carla", "Lucía",
           "Fernanda", "Sofía", "Isabel", "Alejandra", "Paula", "Mónica", "Carolina", "Jimena", "Rocío", "Verónica",
           "Alejandro", "Diego", "Luis", "Jorge", "Sebastián", "Marcelo", "Rodrigo", "Gonzalo", "Mauricio", "Javier"]
APELLIDOS = ["Fernandez", "Morales", "Gutiérrez", "Rojas", "Vargas", "Suárez", "Mendoza", "Quiroga", "Rivero", "Justiniano",
             "Salvatierra", "Paz", "Aguilera", "Antelo", "Roca", "Chávez", "Flores", "Ribera", "Saavedra", "Montaño"]
ZONAS = ["Equipetrol", "Urbarí", "Norte", "Sur", "Centro", "Las Palmas", "Urubó", "Plan 3000", "Villa 1ro de Mayo", "Warnes"]

# Demanda: mes (1-12), día de la semana (0 = lunes) y hora
ESTACIONALIDAD = {1: 0.85, 2: 0.95, 3: 0.95, 4: 1.0, 5: 1.05, 6: 0.95, 7: 0.9, 8: 1.0, 9: 1.0, 10: 1.05, 11: 1.1, 12: 1.35}
DIA_SEMANA = {0: 0.75, 1: 0.85, 2: 0.9, 3: 1.0, 4: 1.2, 5: 1.45, 6: 0.0}  # domingo cerrado
HORAS = {9: 6, 10: 9, 11: 10, 12: 7, 13: 5, 14: 7, 15: 9, 16: 10, 17: 9, 18: 6}


def escribir(nombre, filas, columnas):
    with open(CARPETA / f"{nombre}.csv", "w", newline="", encoding="utf-8") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=columnas)
        escritor.writeheader()
        escritor.writerows(filas)
    print(f"  {nombre}.csv: {len(filas)} registros")


def generar():
    azar = random.Random(SEMILLA)
    CARPETA.mkdir(exist_ok=True)
    dias = (FIN - INICIO).days + 1
    servicio = {s[0]: s for s in SERVICIOS}

    # Clientes: el salón crece, así que se registran más hacia el final del periodo
    clientes = []
    for i in range(1, 1801):
        avance = azar.random() ** 0.8
        alta = INICIO + timedelta(days=int(avance * (dias - 1)))
        frecuencia = azar.choices(["frecuente", "regular", "ocasional"], [0.18, 0.37, 0.45])[0]
        clientes.append({
            "cliente_id": f"cli-{i:05d}",
            "nombre": f"{azar.choice(NOMBRES)} {azar.choice(APELLIDOS)}",
            "genero": "M" if azar.random() < 0.17 else "F",
            "zona": azar.choices(ZONAS, [10, 8, 12, 9, 7, 8, 5, 6, 4, 3])[0],
            "fecha_registro": alta.isoformat(),
            "segmento": frecuencia,
            "canal_registro": azar.choices(["Web", "App móvil", "Mostrador"], [0.45, 0.35, 0.2])[0],
        })
    peso_cliente = {"frecuente": 9.0, "regular": 3.0, "ocasional": 1.0}

    citas, facturas, puntos, consumos, resenas = [], [], [], [], []
    saldo_puntos = {c["cliente_id"]: 0 for c in clientes}
    numero_factura = 1000

    for d in range(dias):
        dia = INICIO + timedelta(days=d)
        if DIA_SEMANA[dia.weekday()] == 0:
            continue
        # Tendencia de crecimiento (~18 % anual) y una caída breve por el feriado de carnaval
        tendencia = 1 + 0.18 * d / 365
        carnaval = 0.55 if (dia.month == 2 and 10 <= dia.day <= 13) or (dia.month == 3 and dia.day <= 4 and dia.year == 2025) else 1
        esperadas = 21 * ESTACIONALIDAD[dia.month] * DIA_SEMANA[dia.weekday()] * tendencia * carnaval
        cantidad = max(0, int(azar.gauss(esperadas, math.sqrt(esperadas))))

        activos = [c for c in clientes if c["fecha_registro"] <= dia.isoformat()]
        if not activos:
            continue
        pesos = [peso_cliente[c["segmento"]] for c in activos]
        estilistas = [e for e in ESTILISTAS if e[3] <= dia]

        for _ in range(cantidad):
            cliente = azar.choices(activos, pesos)[0]
            # Diciembre: más peinados y maquillaje por fiestas
            pesos_servicio = [s[5] * (2.2 if dia.month == 12 and s[2] in ("Peinado", "Maquillaje") else 1) for s in SERVICIOS]
            srv = azar.choices(SERVICIOS, pesos_servicio)[0]
            capaces = [e for e in estilistas if srv[2] in e[4]]
            if not capaces:
                continue
            estilista = azar.choice(capaces)
            hora = azar.choices(list(HORAS), list(HORAS.values()))[0]
            inicio = datetime(dia.year, dia.month, dia.day, hora, azar.choice([0, 30]))
            canal = azar.choices(["ONLINE", "COUNTER"], [0.64, 0.36])[0]
            estado = azar.choices(["COMPLETED", "CANCELLED", "NO_SHOW"], [0.86, 0.095, 0.045])[0]
            cita_id = f"cit-{len(citas) + 1:06d}"
            precio = srv[4]

            # Canje de puntos: solo en línea y si alcanza para al menos 5 dólares
            descuento = 0.0
            if canal == "ONLINE" and saldo_puntos[cliente["cliente_id"]] >= 500 and azar.random() < 0.35:
                usar = min(saldo_puntos[cliente["cliente_id"]], int(precio * 0.3 / VALOR_PUNTO))
                descuento = round(usar * VALOR_PUNTO, 2)
                saldo_puntos[cliente["cliente_id"]] -= usar
                puntos.append({"fecha": inicio.date().isoformat(), "cliente_id": cliente["cliente_id"], "tipo": "Canje",
                               "puntos": -usar, "cita_id": cita_id})

            citas.append({
                "cita_id": cita_id, "fecha": inicio.date().isoformat(), "hora": inicio.strftime("%H:%M"),
                "dia_semana": ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][inicio.weekday()],
                "cliente_id": cliente["cliente_id"], "estilista_id": estilista[0], "estilista": estilista[1],
                "servicio_id": srv[0], "servicio": srv[1], "categoria": srv[2], "duracion_min": srv[3],
                "precio": precio, "canal": "En línea" if canal == "ONLINE" else "Mostrador",
                "estado": {"COMPLETED": "Atendida", "CANCELLED": "Cancelada", "NO_SHOW": "No asistió"}[estado],
            })

            pagado_en_linea = canal == "ONLINE"
            if estado == "COMPLETED" or (estado == "CANCELLED" and pagado_en_linea):
                total = round(precio - descuento, 2)
                metodo = "Tarjeta en línea" if pagado_en_linea else azar.choices(["Efectivo en el mostrador", "Tarjeta en el mostrador"], [0.6, 0.4])[0]
                numero_factura += 1
                facturas.append({
                    "numero": numero_factura, "fecha": inicio.date().isoformat(), "cita_id": cita_id,
                    "cliente_id": cliente["cliente_id"], "servicio": srv[1], "categoria": srv[2], "estilista": estilista[1],
                    "subtotal": precio, "descuento": descuento, "impuesto": round(total * IVA / (1 + IVA), 2), "total": total,
                    "metodo_pago": metodo, "estado": "Reembolsada" if estado == "CANCELLED" else "Emitida",
                })

            if estado == "COMPLETED":
                ganados = int((precio - descuento) * PUNTOS_POR_DOLAR)
                saldo_puntos[cliente["cliente_id"]] += ganados
                puntos.append({"fecha": inicio.date().isoformat(), "cliente_id": cliente["cliente_id"], "tipo": "Acumulación",
                               "puntos": ganados, "cita_id": cita_id})
                for insumo, cantidad_usada in RECETA.get(srv[0], []):
                    costo = next(i[3] for i in INSUMOS if i[0] == insumo)
                    consumos.append({"fecha": inicio.date().isoformat(), "cita_id": cita_id, "insumo_id": insumo,
                                     "cantidad": cantidad_usada, "costo": round(cantidad_usada * costo, 2), "servicio": srv[1]})
                if azar.random() < 0.32:
                    # Calificación: los más experimentados puntúan un poco mejor
                    base = 4.6 if estilista[0] in ("sty-101", "sty-102") else 4.3
                    resenas.append({"fecha": inicio.date().isoformat(), "cita_id": cita_id, "estilista": estilista[1],
                                    "servicio": srv[1], "calificacion": max(1, min(5, round(azar.gauss(base, 0.7))))})

    print(f"Dataset {INICIO} a {FIN}:")
    escribir("servicios", [{"servicio_id": s[0], "servicio": s[1], "categoria": s[2], "duracion_min": s[3], "precio": s[4]} for s in SERVICIOS],
             ["servicio_id", "servicio", "categoria", "duracion_min", "precio"])
    escribir("estilistas", [{"estilista_id": e[0], "estilista": e[1], "especialidad": e[2], "fecha_ingreso": e[3].isoformat()} for e in ESTILISTAS],
             ["estilista_id", "estilista", "especialidad", "fecha_ingreso"])
    escribir("insumos", [{"insumo_id": i[0], "insumo": i[1], "categoria": i[2], "costo_unitario": i[3]} for i in INSUMOS],
             ["insumo_id", "insumo", "categoria", "costo_unitario"])
    escribir("clientes", clientes, list(clientes[0]))
    escribir("citas", citas, list(citas[0]))
    escribir("facturas", facturas, list(facturas[0]))
    escribir("puntos", puntos, list(puntos[0]))
    escribir("consumo_insumos", consumos, list(consumos[0]))
    escribir("resenas", resenas, list(resenas[0]))
    total = sum(len(x) for x in (clientes, citas, facturas, puntos, consumos, resenas)) + len(SERVICIOS) + len(ESTILISTAS) + len(INSUMOS)
    print(f"Total: {total} registros")


if __name__ == "__main__":
    generar()
