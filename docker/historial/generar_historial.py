"""
Historial de operación para las bases de la plataforma (Fase Y).

Genera un año de citas, facturas, puntos, reseñas y movimientos de inventario con el
catálogo real (3 servicios y 3 estilistas), para que las cuentas de demostración tengan
historial y los agentes y reportes trabajen con datos. Es reproducible: la semilla es fija.

No pasa por la SAGA: no cobra con Stripe ni envía WhatsApp ni push. Todo lleva el prefijo
`hist-` (o `hist:` en las referencias de puntos), y `limpiar_*.sql` lo borra.

Uso:  python generar_historial.py      (escribe historial_gestion.sql e historial_crm.sql)
"""
import random
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path

SEMILLA = 2611
DESDE = date(2025, 11, 10)
HASTA = date(2026, 11, 4)          # último día del historial; las citas reales de la nube son posteriores
DIFERENCIA_UTC = timedelta(hours=4)  # Bolivia está en UTC-4: las citas van en hora local, lo demás en UTC
IVA = 0.13

SERVICIOS = {
    'srv-01': ('Balayage Deluxe & Matizado', 150, 120.00, [('inv-001', 2), ('inv-003', 1)]),
    'srv-02': ('Tratamiento Keratina Brasileña', 120, 95.00, [('inv-002', 1)]),
    'srv-03': ('Corte Visagista & Styling', 60, 45.00, []),
}
# Horario y peso de cada servicio según la especialidad del estilista
ESTILISTAS = {
    'sty-101': (time(9), time(18), {'srv-03': 0.45, 'srv-01': 0.35, 'srv-02': 0.20}, [5, 5, 5, 5, 4]),
    'sty-102': (time(10), time(19), {'srv-01': 0.60, 'srv-03': 0.30, 'srv-02': 0.10}, [5, 5, 4, 4, 4, 3]),
    'sty-103': (time(9), time(17), {'srv-02': 0.60, 'srv-03': 0.30, 'srv-01': 0.10}, [5, 5, 4, 4, 3]),
}
# Temporada: diciembre (fiestas), febrero (carnaval) y mayo (Día de la Madre) llenan más la agenda
TEMPORADA = {1: 0.9, 2: 1.25, 3: 1.0, 4: 1.0, 5: 1.2, 6: 0.85, 7: 0.85, 8: 0.95, 9: 1.0, 10: 1.05, 11: 1.1, 12: 1.45}
INSUMOS_INICIALES = {'inv-001': 40, 'inv-002': 25, 'inv-003': 30}
REPOSICION = {'inv-001': (24, 40), 'inv-002': (15, 25), 'inv-003': (15, 25)}  # (cantidad, umbral)

NOMBRES = ['Mariana', 'Lucía', 'Daniela', 'Gabriela', 'Fernanda', 'Valeria', 'Paola', 'Natalia', 'Andrea', 'Carla',
           'Sofía', 'Camila', 'Jimena', 'Alejandra', 'Rocío', 'Claudia', 'Verónica', 'Patricia', 'Mónica', 'Silvia',
           'Diego', 'Rodrigo', 'Javier', 'Marcelo', 'Sergio', 'Gonzalo', 'Mauricio', 'Luis', 'Pablo', 'Ricardo']
APELLIDOS = ['Rojas', 'Vargas', 'Gutiérrez', 'Mendoza', 'Flores', 'Quiroga', 'Suárez', 'Justiniano', 'Áñez', 'Rivero',
             'Pinto', 'Salvatierra', 'Montaño', 'Arteaga', 'Céspedes', 'Paz', 'Saavedra', 'Peña', 'Zabala', 'Villarroel']
COMENTARIOS = {
    5: ['Excelente atención, quedé encantada.', 'El mejor resultado que he tenido.', 'Muy profesional y puntual.',
        'Me explicó todo el proceso, volveré.', 'Superó mis expectativas.', None, None],
    4: ['Muy buen servicio, solo esperé un poco.', 'Buen resultado, el color quedó lindo.', 'Contenta con el trabajo.', None],
    3: ['El resultado está bien, pero tardó más de lo previsto.', 'Correcto, esperaba un poco más.'],
    2: ['No quedó como lo pedí.'],
    1: ['Llegué a mi hora y me atendieron muy tarde.'],
}
CALIFICACION_MEDIA = {'sty-101': [1, 1, 3, 20, 75], 'sty-102': [1, 2, 5, 25, 67], 'sty-103': [1, 2, 7, 28, 62]}


@dataclass
class Cliente:
    id: str
    nombre: str
    correo: str
    telefono: str
    peso: float
    alta: date
    citas: list = field(default_factory=list)


def texto(valor):
    if valor is None:
        return 'NULL'
    if isinstance(valor, (int, float)):
        return repr(round(valor, 2)) if isinstance(valor, float) else str(valor)
    if isinstance(valor, datetime):
        return f"'{valor:%Y-%m-%d %H:%M:%S}'"
    return "'" + str(valor).replace("'", "''") + "'"


def fila(*valores):
    return '(' + ', '.join(texto(v) for v in valores) + ')'


def clientes(azar):
    lista = [
        # Cuentas de demostración: su saldo actual se conserva y se le suma el del historial
        Cliente('cli-001', 'Camila Fernandez', 'camila.f@example.com', '+591-70012345', 0, DESDE),
        Cliente('cli-002', 'Alejandro Morales', 'alejandro.m@example.com', '+591-71198765', 0, DESDE),
    ]
    usados = set()
    for n in range(1, 41):
        while True:
            nombre = f'{azar.choice(NOMBRES)} {azar.choice(APELLIDOS)}'
            if nombre not in usados:
                usados.add(nombre)
                break
        usuario = nombre.lower().replace(' ', '.').translate(str.maketrans('áéíóúñ', 'aeioun'))
        lista.append(Cliente(
            f'hist-cli-{n:03d}', nombre, f'{usuario}@cliente.example.com',
            # Teléfono ficticio a propósito (no existe en Bolivia): nunca se escribe a una persona real
            f'+591-000{n:05d}', azar.paretovariate(1.4),
            # Los primeros 15 ya eran clientes al empezar el historial; el resto llega durante el año
            DESDE if n <= 15 else DESDE + timedelta(days=azar.randint(0, 200)),
        ))
    return lista


def elegir_cliente(azar, lista, estilista, servicio, dia, inicio, fin):
    camila, alejandro, *resto = lista
    candidatos = []
    if azar.random() < (0.045 if estilista == 'sty-101' else 0.012):
        candidatos.append(camila)
    if servicio == 'srv-03' and azar.random() < 0.03:
        candidatos.append(alejandro)
    activos = [c for c in resto if c.alta <= dia]
    candidatos += azar.choices(activos, weights=[c.peso for c in activos], k=4)
    for c in candidatos:
        # Una persona no puede estar en dos citas a la vez
        if all(not (inicio < f and i < fin) for i, f in c.citas):
            c.citas.append((inicio, fin))
            return c
    return None


def agenda(azar, lista):
    citas = []
    dia = DESDE
    while dia <= HASTA:
        if dia.isoweekday() <= 6:
            for estilista, (abre, cierra, pesos, _) in ESTILISTAS.items():
                media = 1.9 * TEMPORADA[dia.month] * (0.8 if dia.isoweekday() == 1 else 1.25 if dia.isoweekday() == 6 else 1)
                cantidad = min(5, max(0, round(azar.gauss(media, 1.0))))
                cursor = datetime.combine(dia, abre) + timedelta(minutes=30 * azar.randint(0, 4))
                cierre = datetime.combine(dia, cierra)
                for _ in range(cantidad):
                    servicio = azar.choices(list(pesos), weights=list(pesos.values()))[0]
                    nombre, duracion, precio, _ = SERVICIOS[servicio]
                    fin = cursor + timedelta(minutes=duracion)
                    if fin > cierre:
                        break
                    cliente = elegir_cliente(azar, lista, estilista, servicio, dia, cursor, fin)
                    if cliente:
                        citas.append({'estilista': estilista, 'servicio': servicio, 'inicio': cursor, 'fin': fin, 'cliente': cliente})
                    cursor = fin + timedelta(minutes=30 * azar.choice([0, 0, 1, 1, 2, 3]))
        dia += timedelta(days=1)
    citas.sort(key=lambda c: (c['inicio'], c['estilista']))
    for n, cita in enumerate(citas, 1):
        cita['id'] = f'hist-apt-{n:05d}'
        cita['reservada'] = cita['inicio'] - timedelta(days=azar.choice([1, 1, 2, 3, 5, 7, 10, 14]), hours=azar.randint(1, 8))
        r = azar.random()
        cita['estado'] = 'COMPLETED' if r < 0.88 else 'CANCELLED' if r < 0.95 else 'NO_SHOW'
        cita['metodo'] = azar.choices(['CARD', 'CASH', 'CARD_TERMINAL'], weights=[60, 25, 15])[0]
    return citas


def puntos(azar, citas):
    """Canjes, acumulación y reversiones en orden de tiempo, sin dejar nunca un saldo negativo."""
    saldo = {}
    pendientes = {}  # puntos ganados por reservas que todavía podrían reembolsarse
    eventos = []
    for c in citas:
        eventos.append((c['reservada'], 0, c))
        if c['estado'] == 'CANCELLED':
            c['cancelada'] = c['inicio'] - timedelta(hours=azar.randint(3, 48))
            eventos.append((max(c['cancelada'], c['reservada'] + timedelta(minutes=30)), 1, c))
        else:
            eventos.append((c['fin'], 2, c))
    eventos.sort(key=lambda e: (e[0], e[1], e[2]['id']))
    for momento, tipo, c in eventos:
        cid = c['cliente'].id
        precio = SERVICIOS[c['servicio']][2]
        if tipo == 0:
            disponible = saldo.get(cid, 0) - pendientes.get(cid, 0)
            canje = 0
            if disponible >= 1000 and azar.random() < 0.35:
                canje = min(disponible, int(precio * 0.3 * 100)) // 100 * 100
            c['canje'] = canje
            c['total'] = round(precio - canje / 100, 2)
            c['ganados'] = int(c['total'] * 10)
            saldo[cid] = saldo.get(cid, 0) - canje + c['ganados']
            pendientes[cid] = pendientes.get(cid, 0) + c['ganados']
        elif tipo == 1:
            saldo[cid] += c['canje'] - c['ganados']
            pendientes[cid] -= c['ganados']
        else:
            pendientes[cid] -= c['ganados']
        assert saldo[cid] >= 0, (cid, momento)
    return saldo


def inventario(azar, citas):
    """Consumo al confirmar, devolución al cancelar y reposiciones; termina con un ajuste por conteo."""
    stock = dict(INSUMOS_INICIALES)
    movimientos = []
    eventos = []
    for c in citas:
        for item, cantidad in SERVICIOS[c['servicio']][3]:
            eventos.append((c['reservada'], item, -cantidad, 'Consumo por cita confirmada', c['id']))
            if c['estado'] == 'CANCELLED':
                eventos.append((c['cancelada'] + timedelta(minutes=1), item, cantidad, 'Devolución por cita cancelada', c['id']))
    eventos.sort(key=lambda e: (e[0], e[1]))
    minimo = dict(stock)
    for momento, item, cambio, motivo, cita in eventos:
        cantidad, umbral = REPOSICION[item]
        if stock[item] + cambio < 8:
            # El salón repone antes de quedarse sin insumo
            entrada = momento - timedelta(hours=azar.randint(2, 20))
            movimientos.append([entrada, item, cantidad + azar.randint(0, umbral // 4), 'Reposición de proveedor', None])
            stock[item] += movimientos[-1][2]
        stock[item] += cambio
        movimientos.append([momento, item, cambio, motivo, cita])
        minimo[item] = min(minimo[item], stock[item])
    final = datetime.combine(HASTA, time(20, 30))
    for item in stock:
        # El ajuste deja el último saldo en el mínimo del año: al sumarle el stock real, nada queda negativo
        if stock[item] > minimo[item]:
            movimientos.append([final, item, minimo[item] - stock[item], 'Ajuste por conteo físico', None])
            stock[item] = minimo[item]
    movimientos.sort(key=lambda m: (m[0], m[1]))
    saldos, filas = dict(INSUMOS_INICIALES), []
    for n, (momento, item, cambio, motivo, cita) in enumerate(movimientos, 1):
        anterior = saldos[item]
        saldos[item] += cambio
        filas.append((f'hist-log-{n:05d}', item, cambio, anterior, saldos[item], motivo, cita, momento + DIFERENCIA_UTC))
    return filas, stock


def resenas(azar, citas):
    filas = []
    for c in citas:
        if c['estado'] == 'COMPLETED' and azar.random() < 0.55:
            nota = azar.choices([1, 2, 3, 4, 5], weights=CALIFICACION_MEDIA[c['estilista']])[0]
            filas.append((f"hist-rev-{c['id'][9:]}", c['id'], c['estilista'], c['cliente'].id, nota,
                          azar.choice(COMENTARIOS[nota]), c['fin'] + DIFERENCIA_UTC + timedelta(hours=azar.randint(1, 30))))
    return filas


def insertar(tabla, columnas, filas, extra='ON CONFLICT DO NOTHING', lote=500):
    partes = []
    for i in range(0, len(filas), lote):
        valores = ',\n'.join(fila(*f) for f in filas[i:i + lote])
        partes.append(f'INSERT INTO {tabla} ({columnas}) VALUES\n{valores}\n{extra};')
    return '\n'.join(partes)


def sql_gestion(citas, logs, stock_final, revs):
    apts = [(c['id'], c['cliente'].id, c['estilista'], c['servicio'], SERVICIOS[c['servicio']][0], c['inicio'],
             SERVICIOS[c['servicio']][1], c['total'], c['estado'],
             'Cancelación: la clienta pidió cancelar' if c['estado'] == 'CANCELLED' else None,
             c['reservada'] + DIFERENCIA_UTC,
             (c.get('cancelada') or c['fin']) + DIFERENCIA_UTC) for c in citas]
    ajuste = ',\n'.join(fila(item, s) for item, s in sorted(stock_final.items()))
    return f"""-- Historial de operación de ms-gestion (Fase Y). Generado por generar_historial.py: no editar a mano.
-- {len(apts)} citas, {len(revs)} reseñas y {len(logs)} movimientos de inventario, del {DESDE} al {HASTA}.
\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM appointments WHERE id LIKE 'hist-%') THEN
    RAISE EXCEPTION 'El historial ya está cargado en salon_gestion: bórralo antes con limpiar_gestion.sql';
  END IF;
END $$;

{insertar('appointments', 'id, client_id, stylist_id, service_id, service_name, appointment_date, duration_minutes, total_price, status, notes, created_at, updated_at', apts)}

-- Ninguna cita puede chocar con una real: si alguna se descartó, se deshace todo
DO $$ BEGIN
  IF (SELECT count(*) FROM appointments WHERE id LIKE 'hist-%') <> {len(apts)} THEN
    RAISE EXCEPTION 'Una cita del historial chocó con otra existente; no se cargó nada';
  END IF;
END $$;

{insertar('stylist_reviews', 'id, appointment_id, stylist_id, client_id, rating, comment, created_at', revs)}

-- Movimientos de inventario: el stock actual no cambia. Se desplazan los saldos para que la
-- cadena termine en el stock real de hoy, descontando los movimientos reales posteriores al historial.
{insertar('inventory_logs', 'id, item_id, quantity_change, previous_stock, new_stock, reason, appointment_id, created_at', logs)}
UPDATE inventory_logs l
SET previous_stock = l.previous_stock + d.desplazamiento, new_stock = l.new_stock + d.desplazamiento
FROM (
  SELECT f.item_id, i.current_stock - f.saldo
         - COALESCE((SELECT sum(r.quantity_change) FROM inventory_logs r
                     WHERE r.item_id = f.item_id AND r.id NOT LIKE 'hist-%' AND r.created_at > '{HASTA + timedelta(days=1)} 00:30:00'), 0) AS desplazamiento
  FROM (VALUES
{ajuste}
  ) AS f(item_id, saldo)
  JOIN inventory_items i ON i.id = f.item_id
) d
WHERE l.item_id = d.item_id AND l.id LIKE 'hist-%';
COMMIT;
"""


def sql_crm(lista, citas, saldo):
    nuevos = [(c.id, c.nombre, c.correo, c.telefono, saldo.get(c.id, 0), datetime.combine(c.alta, time(14)))
              for c in lista if c.id.startswith('hist-')]
    facturas, notas, libro = [], [], []
    for c in citas:
        n = c['id'][9:]
        nombre, _, precio, _ = SERVICIOS[c['servicio']]
        emitida = c['reservada'] + DIFERENCIA_UTC
        cid = c['cliente'].id
        facturas.append((f'hist-inv-{n}', c['id'], cid, c['cliente'].nombre, c['total'], round(c['total'] * IVA, 2),
                         c['metodo'], 'REFUNDED' if c['estado'] == 'CANCELLED' else 'ISSUED', emitida, nombre,
                         precio, round(precio - c['total'], 2)))
        if c['canje']:
            libro.append((f'hist-pts-{n}-c', cid, -c['canje'], 'REDEMPTION', 'Canje de puntos en una reserva', f'hist:{n}:redeem', emitida))
        libro.append((f'hist-pts-{n}-g', cid, c['ganados'], 'ACCUMULATION', f'Puntos por {nombre}', f'hist:{n}:earn', emitida + timedelta(minutes=1)))
        if c['estado'] == 'CANCELLED':
            cancelada = c['cancelada'] + DIFERENCIA_UTC
            notas.append((f'hist-cn-{n}', f'hist-inv-{n}', cid, c['total'], round(c['total'] * IVA, 2),
                          'Cancelación de la cita: reembolso total', cancelada))
            libro.append((f'hist-pts-{n}-r', cid, -c['ganados'], 'REVERSAL', 'Reversión de puntos ganados: reserva reembolsada', f'hist:{n}:reverse', cancelada))
            if c['canje']:
                libro.append((f'hist-pts-{n}-d', cid, c['canje'], 'REVERSAL', 'Devolución de puntos canjeados: reserva reembolsada', f'hist:{n}:return', cancelada))
    demo = '\n'.join(f"UPDATE crm_clients SET loyalty_points = loyalty_points + {saldo.get(cid, 0)} WHERE id = '{cid}';"
                     for cid in ('cli-001', 'cli-002'))
    return f"""-- Historial de operación de ms-crm (Fase Y). Generado por generar_historial.py: no editar a mano.
-- {len(nuevos)} clientes, {len(facturas)} facturas, {len(notas)} notas de crédito y {len(libro)} movimientos de puntos.
\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id LIKE 'hist-%') THEN
    RAISE EXCEPTION 'El historial ya está cargado en salon_crm: bórralo antes con limpiar_crm.sql';
  END IF;
END $$;

{insertar('crm_clients', 'id, full_name, email, phone, loyalty_points, created_at', nuevos)}
-- Las cuentas de demostración conservan su saldo y suman el del historial
{demo}

{insertar('invoices', 'id, appointment_id, client_id, client_name, total_amount, tax_amount, payment_method, status, issued_at, service_name, subtotal_amount, discount_amount', facturas)}

{insertar('credit_notes', 'id, invoice_id, client_id, amount, tax_amount, reason, issued_at', notas)}

{insertar('loyalty_transactions', 'id, client_id, points, type, description, source_ref, created_at', libro)}
COMMIT;
"""


def main():
    azar = random.Random(SEMILLA)
    lista = clientes(azar)
    citas = agenda(azar, lista)
    saldo = puntos(azar, citas)
    logs, stock_final = inventario(azar, citas)
    revs = resenas(azar, citas)
    carpeta = Path(__file__).parent
    (carpeta / 'historial_gestion.sql').write_text(sql_gestion(citas, logs, stock_final, revs), encoding='utf-8', newline='\n')
    (carpeta / 'historial_crm.sql').write_text(sql_crm(lista, citas, saldo), encoding='utf-8', newline='\n')
    por = lambda clave: {k: sum(1 for c in citas if clave(c) == k) for k in sorted({clave(c) for c in citas})}
    print(f'{len(citas)} citas | por estado {por(lambda c: c["estado"])} | por estilista {por(lambda c: c["estilista"])}')
    print(f'Camila: {sum(1 for c in citas if c["cliente"].id == "cli-001")} citas, +{saldo.get("cli-001", 0)} puntos | '
          f'Alejandro: {sum(1 for c in citas if c["cliente"].id == "cli-002")} citas, +{saldo.get("cli-002", 0)} puntos')
    print(f'{len(revs)} reseñas, {len(logs)} movimientos de inventario, ingresos {sum(c["total"] for c in citas if c["estado"] != "CANCELLED"):.2f} USD')


if __name__ == '__main__':
    main()
