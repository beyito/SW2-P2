"""
Carga del dataset y cálculo de los KPI del tablero de inteligencia de negocios.
Funciones puras sobre DataFrames de pandas: la interfaz (app.py) solo las muestra.
"""
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

CARPETA = Path(__file__).parent / "datos"
HORAS_POR_JORNADA = 9  # horas que cada estilista tiene disponibles por día abierto


@dataclass
class Datos:
    citas: pd.DataFrame
    facturas: pd.DataFrame
    clientes: pd.DataFrame
    puntos: pd.DataFrame
    consumos: pd.DataFrame
    resenas: pd.DataFrame
    estilistas: pd.DataFrame
    servicios: pd.DataFrame
    insumos: pd.DataFrame

    @property
    def total_registros(self) -> int:
        return sum(len(tabla) for tabla in vars(self).values())


def cargar(carpeta: Path = CARPETA) -> Datos:
    leer = lambda nombre, fechas=("fecha",): pd.read_csv(carpeta / f"{nombre}.csv", parse_dates=[f for f in fechas])
    return Datos(
        citas=leer("citas"),
        facturas=leer("facturas"),
        clientes=leer("clientes", ("fecha_registro",)),
        puntos=leer("puntos"),
        consumos=leer("consumo_insumos"),
        resenas=leer("resenas"),
        estilistas=leer("estilistas", ("fecha_ingreso",)),
        servicios=leer("servicios", ()),
        insumos=leer("insumos", ()),
    )


def filtrar(datos: Datos, desde, hasta, estilistas=None, categorias=None, canales=None) -> Datos:
    """Aplica el periodo y los filtros a todas las tablas con fecha, de forma coherente entre ellas."""
    desde, hasta = pd.Timestamp(desde), pd.Timestamp(hasta)
    citas = datos.citas[(datos.citas.fecha >= desde) & (datos.citas.fecha <= hasta)]
    if estilistas:
        citas = citas[citas.estilista.isin(estilistas)]
    if categorias:
        citas = citas[citas.categoria.isin(categorias)]
    if canales:
        citas = citas[citas.canal.isin(canales)]
    ids = set(citas.cita_id)
    return Datos(
        citas=citas,
        facturas=datos.facturas[datos.facturas.cita_id.isin(ids)],
        clientes=datos.clientes[datos.clientes.fecha_registro <= hasta],
        puntos=datos.puntos[datos.puntos.cita_id.isin(ids)],
        consumos=datos.consumos[datos.consumos.cita_id.isin(ids)],
        resenas=datos.resenas[datos.resenas.cita_id.isin(ids)],
        estilistas=datos.estilistas,
        servicios=datos.servicios,
        insumos=datos.insumos,
    )


def indicadores(d: Datos) -> dict:
    """KPI principales del periodo filtrado."""
    emitidas = d.facturas[d.facturas.estado == "Emitida"]
    ingresos = float(emitidas.total.sum())
    atendidas = int((d.citas.estado == "Atendida").sum())
    total_citas = len(d.citas)
    costo_insumos = float(d.consumos.costo.sum())
    visitas = d.citas[d.citas.estado == "Atendida"].groupby("cliente_id").size()
    return {
        "ingresos": ingresos,
        "citas": total_citas,
        "atendidas": atendidas,
        "ticket_promedio": ingresos / len(emitidas) if len(emitidas) else 0.0,
        "tasa_cancelacion": (d.citas.estado == "Cancelada").mean() if total_citas else 0.0,
        "tasa_inasistencia": (d.citas.estado == "No asistió").mean() if total_citas else 0.0,
        "clientes_atendidos": int(len(visitas)),
        "tasa_recurrencia": float((visitas >= 2).mean()) if len(visitas) else 0.0,
        "satisfaccion": float(d.resenas.calificacion.mean()) if len(d.resenas) else 0.0,
        "costo_insumos": costo_insumos,
        "margen_bruto": (ingresos - costo_insumos) / ingresos if ingresos else 0.0,
        "descuentos_puntos": float(emitidas.descuento.sum()),
        "reembolsado": float(d.facturas[d.facturas.estado == "Reembolsada"].total.sum()),
    }


def ingresos_mensuales(d: Datos) -> pd.DataFrame:
    """Ingresos y citas por mes, para la tendencia."""
    emitidas = d.facturas[d.facturas.estado == "Emitida"]
    mensual = emitidas.groupby(emitidas.fecha.dt.to_period("M")).agg(ingresos=("total", "sum"), facturas=("numero", "count"))
    mensual.index = mensual.index.to_timestamp()
    return mensual.reset_index(names="mes")


def por_estilista(d: Datos) -> pd.DataFrame:
    """Desempeño por estilista: ingresos, citas, ticket, cancelaciones, calificación y ocupación."""
    emitidas = d.facturas[d.facturas.estado == "Emitida"]
    base = d.citas.groupby("estilista").agg(
        citas=("cita_id", "count"),
        atendidas=("estado", lambda e: (e == "Atendida").sum()),
        cancelaciones=("estado", lambda e: (e == "Cancelada").mean()),
        minutos=("duracion_min", lambda m: m[d.citas.loc[m.index, "estado"] == "Atendida"].sum()),
        dias=("fecha", "nunique"),
    )
    base["ingresos"] = emitidas.groupby("estilista").total.sum()
    base["ticket_promedio"] = base.ingresos / emitidas.groupby("estilista").size()
    base["calificacion"] = d.resenas.groupby("estilista").calificacion.mean()
    # Ocupación: horas atendidas sobre las horas de los días en que trabajó
    base["ocupacion"] = (base.minutos / 60) / (base.dias * HORAS_POR_JORNADA)
    return base.drop(columns=["minutos", "dias"]).fillna(0).sort_values("ingresos", ascending=False).reset_index()


def por_servicio(d: Datos) -> pd.DataFrame:
    """Ventas, costo de insumos y margen por servicio."""
    emitidas = d.facturas[d.facturas.estado == "Emitida"]
    tabla = emitidas.groupby(["servicio", "categoria"]).agg(ventas=("numero", "count"), ingresos=("total", "sum")).reset_index()
    costo = d.consumos.groupby("servicio").costo.sum()
    tabla["costo_insumos"] = tabla.servicio.map(costo).fillna(0)
    tabla["margen"] = (tabla.ingresos - tabla.costo_insumos) / tabla.ingresos
    return tabla.sort_values("ingresos", ascending=False)


def mapa_de_calor(d: Datos) -> pd.DataFrame:
    """Citas por día de la semana y hora: muestra las horas pico."""
    orden = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
    tabla = d.citas.assign(hora_del_dia=d.citas.hora.str.slice(0, 2) + ":00").pivot_table(
        index="dia_semana", columns="hora_del_dia", values="cita_id", aggfunc="count", fill_value=0)
    return tabla.reindex([dia for dia in orden if dia in tabla.index])


def nuevos_clientes(datos_completos: Datos, desde, hasta) -> pd.DataFrame:
    """Altas de clientes por mes y por canal de registro."""
    c = datos_completos.clientes
    c = c[(c.fecha_registro >= pd.Timestamp(desde)) & (c.fecha_registro <= pd.Timestamp(hasta))]
    tabla = c.groupby([c.fecha_registro.dt.to_period("M"), "canal_registro"]).size().rename("clientes").reset_index()
    tabla["mes"] = tabla.fecha_registro.dt.to_timestamp()
    return tabla.drop(columns="fecha_registro")


def mejores_clientes(d: Datos, cantidad: int = 15) -> pd.DataFrame:
    """Clientes con más gasto en el periodo, con su frecuencia y última visita (análisis RFM)."""
    emitidas = d.facturas[d.facturas.estado == "Emitida"]
    tabla = emitidas.groupby("cliente_id").agg(gasto=("total", "sum"), visitas=("numero", "count"), ultima_visita=("fecha", "max"))
    tabla = tabla.join(d.clientes.set_index("cliente_id")[["nombre", "segmento", "zona"]])
    return tabla.sort_values("gasto", ascending=False).head(cantidad).reset_index()


def consumo_mensual(d: Datos) -> pd.DataFrame:
    """Costo de insumos consumidos por mes y categoría de insumo."""
    consumo = d.consumos.merge(d.insumos[["insumo_id", "insumo", "categoria"]], on="insumo_id")
    tabla = consumo.groupby([consumo.fecha.dt.to_period("M"), "categoria"]).costo.sum().reset_index()
    tabla["mes"] = tabla.fecha.dt.to_timestamp()
    return tabla.drop(columns="fecha")
