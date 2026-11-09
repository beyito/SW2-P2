"""Pruebas de los KPI sobre el dataset real del tablero y sobre datos mínimos armados a mano."""
import pandas as pd
import pytest

import kpis


@pytest.fixture(scope="module")
def datos():
    return kpis.cargar()


def test_el_dataset_tiene_miles_de_registros(datos):
    assert datos.total_registros > 50000
    assert len(datos.citas) > 10000
    assert datos.citas.fecha.min() == pd.Timestamp("2024-11-01")
    assert datos.citas.fecha.max() <= pd.Timestamp("2026-10-31")


def test_el_dataset_es_coherente(datos):
    # Cada factura y cada consumo pertenecen a una cita que existe
    assert datos.facturas.cita_id.isin(datos.citas.cita_id).all()
    assert datos.consumos.cita_id.isin(datos.citas.cita_id).all()
    # Solo se factura lo atendido, o lo cancelado que ya estaba pagado (y se reembolsó)
    estados = datos.citas.set_index("cita_id").loc[datos.facturas.cita_id, "estado"].values
    assert set(estados) <= {"Atendida", "Cancelada"}
    assert (datos.facturas[estados == "Cancelada"].estado == "Reembolsada").all()
    # El descuento por puntos nunca supera el precio
    assert (datos.facturas.total >= 0).all()
    # Los domingos el salón está cerrado
    assert (datos.citas.fecha.dt.dayofweek < 6).all()


def test_indicadores_con_datos_conocidos():
    citas = pd.DataFrame({
        "cita_id": ["c1", "c2", "c3", "c4"], "fecha": pd.to_datetime(["2026-01-05"] * 4), "cliente_id": ["a", "a", "b", "c"],
        "estado": ["Atendida", "Atendida", "Cancelada", "No asistió"], "estilista": ["E"] * 4, "categoria": ["Corte"] * 4,
        "canal": ["En línea"] * 4, "duracion_min": [60] * 4, "hora": ["10:00"] * 4, "dia_semana": ["Lunes"] * 4,
    })
    facturas = pd.DataFrame({
        "numero": [1, 2, 3], "fecha": pd.to_datetime(["2026-01-05"] * 3), "cita_id": ["c1", "c2", "c3"], "cliente_id": ["a", "a", "b"],
        "estado": ["Emitida", "Emitida", "Reembolsada"], "total": [100.0, 50.0, 40.0], "descuento": [0.0, 10.0, 0.0], "estilista": ["E"] * 3,
    })
    vacia = pd.DataFrame({"cita_id": pd.Series(dtype=str), "costo": pd.Series(dtype=float), "calificacion": pd.Series(dtype=float)})
    d = kpis.Datos(citas=citas, facturas=facturas, clientes=pd.DataFrame(), puntos=vacia,
                   consumos=pd.DataFrame({"cita_id": ["c1"], "costo": [15.0]}), resenas=vacia,
                   estilistas=pd.DataFrame(), servicios=pd.DataFrame(), insumos=pd.DataFrame())
    k = kpis.indicadores(d)
    assert k["ingresos"] == 150
    assert k["ticket_promedio"] == 75
    assert k["tasa_cancelacion"] == 0.25
    assert k["tasa_inasistencia"] == 0.25
    assert k["clientes_atendidos"] == 1
    assert k["tasa_recurrencia"] == 1.0  # el único atendido vino dos veces
    assert k["margen_bruto"] == pytest.approx(0.9)
    assert k["reembolsado"] == 40
    assert k["descuentos_puntos"] == 10


def test_los_filtros_se_aplican_a_todas_las_tablas(datos):
    d = kpis.filtrar(datos, "2026-01-01", "2026-03-31", estilistas=["Valentina Rossi"])
    assert set(d.citas.estilista) == {"Valentina Rossi"}
    assert d.citas.fecha.between("2026-01-01", "2026-03-31").all()
    assert d.facturas.cita_id.isin(d.citas.cita_id).all()
    assert d.consumos.cita_id.isin(d.citas.cita_id).all()


def test_tablas_de_los_graficos(datos):
    d = kpis.filtrar(datos, "2025-11-01", "2026-10-31")
    mensual = kpis.ingresos_mensuales(d)
    assert len(mensual) == 12
    assert mensual.ingresos.sum() == pytest.approx(kpis.indicadores(d)["ingresos"])
    # Diciembre es el mes fuerte por las fiestas
    assert mensual.loc[mensual.ingresos.idxmax(), "mes"].month == 12
    estilistas = kpis.por_estilista(d)
    assert (estilistas.ocupacion.between(0, 1)).all()
    calor = kpis.mapa_de_calor(d)
    assert "Domingo" not in calor.index and calor.loc["Sábado"].sum() > calor.loc["Lunes"].sum()
    assert len(kpis.mejores_clientes(d, 10)) == 10
    servicios = kpis.por_servicio(d)
    assert (servicios.margen <= 1).all()
