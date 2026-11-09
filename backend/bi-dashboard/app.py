"""
Tablero de inteligencia de negocios del salón, en Python (Streamlit, pandas y Plotly).
Muestra KPI y dashboards sobre el dataset histórico de dos años (generar_dataset.py).
Solo entra la administración: inicia sesión con Keycloak (OIDC) y se exige el rol ADMIN.
"""
import os

import pandas as pd
import plotly.express as px
import streamlit as st

import kpis

ROSA = "#9E6066"
PALETA = ["#9E6066", "#C98B8B", "#8C6A3F", "#4F7D5B", "#D9B7A9", "#7D6A65", "#A8464C", "#E3C9A8"]
SIN_LOGIN = os.environ.get("BI_SIN_LOGIN") == "1"  # solo para las pruebas automáticas de la interfaz

st.set_page_config(page_title="Salón & IA Studio · Inteligencia de negocios", page_icon="✂️", layout="wide")
st.markdown(f"""
<style>
  .stApp {{ background: #FBF6F2; }}
  h1, h2, h3 {{ font-family: 'Playfair Display', Georgia, serif; color: #3D2F2D; }}
  [data-testid="stMetricValue"] {{ color: {ROSA}; }}
  [data-testid="stMetric"] {{ background: #FFFFFF; border: 1px solid #EBDDD5; border-radius: 14px; padding: 12px 16px; }}
</style>""", unsafe_allow_html=True)


def exigir_administracion():
    """Inicio de sesión con Keycloak; el rol llega en el ID token (claim "roles")."""
    if SIN_LOGIN:
        return
    if not st.user.is_logged_in:
        st.title("Inteligencia de negocios")
        st.write("Este tablero es solo para la administración del salón.")
        st.button("Iniciar sesión", on_click=st.login, args=("keycloak",), type="primary")
        st.stop()
    if "ADMIN" not in (st.user.get("roles") or []):
        st.error("Su cuenta no tiene acceso: el tablero es solo para la administración.")
        st.button("Cerrar sesión", on_click=st.logout)
        st.stop()


exigir_administracion()


@st.cache_data
def datos_completos():
    return kpis.cargar()


def dinero(valor: float) -> str:
    return f"${valor:,.0f}"


def porcentaje(valor: float) -> str:
    return f"{valor * 100:.1f}%"


def grafico(figura):
    figura.update_layout(paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", margin=dict(l=10, r=10, t=40, b=10),
                         font=dict(color="#3D2F2D"), legend_title_text="")
    st.plotly_chart(figura, use_container_width=True)


todo = datos_completos()
minimo, maximo = todo.citas.fecha.min().date(), todo.citas.fecha.max().date()

with st.sidebar:
    st.header("Filtros")
    periodo = st.date_input("Periodo", value=(maximo.replace(day=1, month=1) if maximo.month > 1 else minimo, maximo),
                            min_value=minimo, max_value=maximo, format="DD/MM/YYYY")
    desde, hasta = (periodo if len(periodo) == 2 else (periodo[0], periodo[0]))
    estilistas = st.multiselect("Estilistas", sorted(todo.citas.estilista.unique()), placeholder="Todos")
    categorias = st.multiselect("Categorías", sorted(todo.citas.categoria.unique()), placeholder="Todas")
    canales = st.multiselect("Canal de reserva", sorted(todo.citas.canal.unique()), placeholder="Todos")
    st.caption(f"Dataset: {todo.total_registros:,} registros, del {minimo:%d/%m/%Y} al {maximo:%d/%m/%Y}.")
    if not SIN_LOGIN:
        st.caption(f"Sesión: {st.user.get('name') or st.user.get('preferred_username')}")
        st.button("Cerrar sesión", on_click=st.logout)

d = kpis.filtrar(todo, desde, hasta, estilistas, categorias, canales)
k = kpis.indicadores(d)

# Mismo periodo del año anterior, para comparar
anterior = kpis.indicadores(kpis.filtrar(todo, pd.Timestamp(desde) - pd.DateOffset(years=1), pd.Timestamp(hasta) - pd.DateOffset(years=1),
                                         estilistas, categorias, canales))
variacion = lambda actual, previo: f"{(actual - previo) / previo * 100:+.1f}% vs. año anterior" if previo else None

st.title("Inteligencia de negocios")
st.caption(f"Del {desde:%d/%m/%Y} al {hasta:%d/%m/%Y} · {len(d.citas):,} citas · {len(d.facturas):,} facturas")

fila1 = st.columns(4)
fila1[0].metric("Ingresos netos", dinero(k["ingresos"]), variacion(k["ingresos"], anterior["ingresos"]))
fila1[1].metric("Citas atendidas", f"{k['atendidas']:,}", variacion(k["atendidas"], anterior["atendidas"]))
fila1[2].metric("Ticket promedio", f"${k['ticket_promedio']:.2f}", variacion(k["ticket_promedio"], anterior["ticket_promedio"]))
fila1[3].metric("Margen bruto (sin insumos)", porcentaje(k["margen_bruto"]))
fila2 = st.columns(4)
fila2[0].metric("Tasa de cancelación", porcentaje(k["tasa_cancelacion"]), variacion(k["tasa_cancelacion"], anterior["tasa_cancelacion"]), delta_color="inverse")
fila2[1].metric("Inasistencia", porcentaje(k["tasa_inasistencia"]), delta_color="inverse")
fila2[2].metric("Clientes recurrentes", porcentaje(k["tasa_recurrencia"]), help="Clientes atendidos dos o más veces en el periodo.")
fila2[3].metric("Satisfacción", f"{k['satisfaccion']:.2f} / 5")

ventas, agenda, equipo, clientes, servicios, datos = st.tabs(["Ventas", "Agenda", "Estilistas", "Clientes", "Servicios e insumos", "Datos"])

with ventas:
    mensual = kpis.ingresos_mensuales(d)
    grafico(px.area(mensual, x="mes", y="ingresos", title="Ingresos por mes", color_discrete_sequence=[ROSA],
                    labels={"mes": "", "ingresos": "Ingresos (USD)"}))
    izquierda, derecha = st.columns(2)
    emitidas = d.facturas[d.facturas.estado == "Emitida"]
    with izquierda:
        categoria = emitidas.groupby("categoria").total.sum().sort_values().reset_index()
        grafico(px.bar(categoria, x="total", y="categoria", orientation="h", title="Ingresos por categoría",
                       color_discrete_sequence=[ROSA], labels={"total": "USD", "categoria": ""}))
    with derecha:
        metodo = emitidas.groupby("metodo_pago").total.sum().reset_index()
        grafico(px.pie(metodo, names="metodo_pago", values="total", hole=0.55, title="Método de pago", color_discrete_sequence=PALETA))
    st.info(f"Descuentos por canje de puntos: {dinero(k['descuentos_puntos'])} · Reembolsado por cancelaciones: {dinero(k['reembolsado'])}")

with agenda:
    grafico(px.imshow(kpis.mapa_de_calor(d), text_auto=True, aspect="auto", color_continuous_scale=["#FBF6F2", "#C98B8B", "#9E6066"],
                      title="Citas por día y hora (horas pico)", labels={"x": "Hora", "y": "", "color": "Citas"}))
    estados = d.citas.groupby([d.citas.fecha.dt.to_period("M").dt.to_timestamp(), "estado"]).size().rename("citas").reset_index()
    grafico(px.bar(estados, x="fecha", y="citas", color="estado", title="Citas por mes y estado", color_discrete_sequence=PALETA,
                   labels={"fecha": "", "citas": "Citas"}))

with equipo:
    tabla = kpis.por_estilista(d)
    izquierda, derecha = st.columns(2)
    with izquierda:
        grafico(px.bar(tabla, x="estilista", y="ingresos", title="Ingresos por estilista", color_discrete_sequence=[ROSA],
                       labels={"estilista": "", "ingresos": "USD"}))
    with derecha:
        grafico(px.scatter(tabla, x="ocupacion", y="calificacion", size="citas", text="estilista", title="Ocupación vs. satisfacción",
                           color_discrete_sequence=["#8C6A3F"], labels={"ocupacion": "Ocupación", "calificacion": "Calificación"}))
    st.dataframe(tabla.rename(columns={"estilista": "Estilista", "citas": "Citas", "atendidas": "Atendidas", "cancelaciones": "Cancelación",
                                       "ingresos": "Ingresos", "ticket_promedio": "Ticket", "calificacion": "Calificación", "ocupacion": "Ocupación"}),
                 hide_index=True, use_container_width=True,
                 column_config={"Ingresos": st.column_config.NumberColumn(format="$%.0f"), "Ticket": st.column_config.NumberColumn(format="$%.2f"),
                                "Cancelación": st.column_config.NumberColumn(format="percent"), "Ocupación": st.column_config.NumberColumn(format="percent"),
                                "Calificación": st.column_config.NumberColumn(format="%.2f")})

with clientes:
    izquierda, derecha = st.columns(2)
    with izquierda:
        grafico(px.bar(kpis.nuevos_clientes(todo, desde, hasta), x="mes", y="clientes", color="canal_registro", title="Clientes nuevos por mes",
                       color_discrete_sequence=PALETA, labels={"mes": "", "clientes": "Clientes"}))
    with derecha:
        atendidos = d.citas[d.citas.estado == "Atendida"].merge(d.clientes[["cliente_id", "zona"]], on="cliente_id")
        grafico(px.pie(atendidos.groupby("zona").size().rename("citas").reset_index(), names="zona", values="citas",
                       title="Citas por zona de la ciudad", color_discrete_sequence=PALETA))
    st.subheader("Mejores clientes del periodo (RFM)")
    st.dataframe(kpis.mejores_clientes(d), hide_index=True, use_container_width=True,
                 column_config={"gasto": st.column_config.NumberColumn("Gasto", format="$%.2f"), "ultima_visita": st.column_config.DateColumn("Última visita")})

with servicios:
    tabla = kpis.por_servicio(d)
    grafico(px.bar(tabla, x="servicio", y=["ingresos", "costo_insumos"], barmode="group", title="Ingresos y costo de insumos por servicio",
                   color_discrete_sequence=[ROSA, "#8C6A3F"], labels={"servicio": "", "value": "USD", "variable": ""}))
    grafico(px.line(kpis.consumo_mensual(d), x="mes", y="costo", color="categoria", title="Costo de insumos consumidos por mes",
                    color_discrete_sequence=PALETA, labels={"mes": "", "costo": "USD"}))
    st.dataframe(tabla, hide_index=True, use_container_width=True,
                 column_config={"ingresos": st.column_config.NumberColumn(format="$%.0f"), "costo_insumos": st.column_config.NumberColumn(format="$%.0f"),
                                "margen": st.column_config.NumberColumn(format="percent")})

with datos:
    st.write("Registros del periodo filtrado. Se pueden descargar en CSV.")
    tabla = st.selectbox("Tabla", ["citas", "facturas", "puntos", "consumos", "resenas"])
    marco = getattr(d, tabla)
    st.dataframe(marco.head(1000), hide_index=True, use_container_width=True)
    st.download_button(f"Descargar {tabla}.csv ({len(marco):,} registros)", marco.to_csv(index=False).encode("utf-8"), f"{tabla}.csv", "text/csv")
