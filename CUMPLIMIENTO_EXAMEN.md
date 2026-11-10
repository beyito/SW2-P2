# Cumplimiento de las preguntas del examen

Respuestas a las preguntas de los modelos de examen de semestres anteriores, con la evidencia en el código y cómo demostrarla en vivo. El detalle de cada fase está en [ROADMAP.md](ROADMAP.md); el despliegue, en [DESPLIEGUE_MULTICLOUD.md](DESPLIEGUE_MULTICLOUD.md).

**Plataforma en la nube:** https://salon-sw2-app.web.app

## Modelo 1

### 1. ¿Está desarrollada al 100 % de acuerdo con lo solicitado?

**Sí.** Los 22 casos de uso están completos y verificados en vivo (matriz del ROADMAP), incluido el envío real por WhatsApp (CU-19). Además, la plataforma está desplegada en tres nubes. La salvedad es la app de Meta: está sin publicar, así que solo escribe a los números de su lista de prueba.

### 2. ¿Realiza la lógica, notificaciones, logs, protocolo MCP y uso de recursos de memoria y de red?

**Sí.**
- **Protocolo MCP:** servidor con el SDK oficial (`@modelcontextprotocol/sdk`), transporte Streamable HTTP, token de Keycloak y rol por herramienta (`backend/mcp-server/src/server.js`).
- **Notificaciones:** avisos dentro de la app (CRM, `07_avisos_crm.sql`) y por WhatsApp con n8n (`docker/n8n/workflows`).
- **Logs:** cada servicio escribe a la salida estándar, que en la nube recogen CloudWatch (AWS), Container Apps (Azure) y Cloud Logging (Google).
- **Memoria y red:** el móvil y la web funcionan sin conexión, con una cola local (SQLite en Android) que se sincroniza al volver la red, con idempotencia (RF-10, CU-22).

### 3. ¿Contiene funciones de deep learning para visión artificial con TensorFlow o similares?

**Sí.** Malla facial y segmentación con MediaPipe, y un **clasificador propio entrenado en TensorFlow Lite** para el tipo de cabello (`backend/ms-ia/training`). Corre en el servidor (`ms-ia`) y también dentro del teléfono sin conexión (`mobile/salon_mobile`, `tflite_flutter`).

### 4. ¿Genera reportes dinámicos por prompt con agentes conectados a la base de datos?

**Sí.** En **Gestión del salón → Reportes**:
- Se pide el reporte por **texto o voz** al **agente de reportes** (Skill `reportes`), o se arma con un formulario.
- El **Servidor MCP consulta PostgreSQL directamente** con el usuario `salon_reportes`, que es de **solo lectura** y solo ve las tablas de los reportes. El agente nunca toca la base: pide el reporte por la herramienta MCP `generar_reporte` (RNF-02).
- Se eligen las **columnas**, los **criterios** (fechas, estilista, estado, servicio, cliente...), una **agrupación** con totales y el formato **Excel o PDF**.
- Código: `backend/mcp-server/src/reports.js` y `skills/reportes/SKILL.md`; pantalla: `frontend/mfe-gestion/src/app/features/reports.component.ts`.
- **Demostración:** pedir «facturas de este año con cliente, servicio y total, en PDF» y descargar el archivo.

### 5. ¿Está desplegada en microservicios con Docker y Kubernetes en al menos 3 nubes, con bases relacionales y NoSQL?

**Sí.**
- **Microservicios con Docker:** cada servicio tiene su Dockerfile y su base. En local corren con Docker Compose.
- **Tres nubes:** AWS (Ohio), Azure (Toronto) y Google Cloud (Virginia).
- **Kubernetes en las tres:** con los manifiestos de `k8s/` (Kustomize: un Deployment y un Service por cada uno de los 14 microservicios, con sondas, límites y escalado automático), un clúster administrado por nube, en producción:
  - **EKS (AWS)** sobre Fargate: una réplica de `ms-gestion` que consume los comandos de la SAGA.
  - **AKS (Azure)**, nodo ARM64: un worker del CRM que consume los eventos de la SAGA.
  - **GKE Autopilot (Google)**: el tablero de BI en https://bi.salon-ai.beauty, con Ingress y certificado administrado.

  RabbitMQ muestra 2 consumidores en cada cola, uno en Kubernetes y otro en el servicio administrado. Ver la sección 10 de DESPLIEGUE_MULTICLOUD.md.
- **Demostración:** `kubectl get pods -n salon` con el kubeconfig de cada nube (`deploy/salida/kubeconfig-eks`, `-aks` y `-gke`).
- **Bases relacionales:** PostgreSQL en Amazon RDS (gestión y Keycloak) y en Azure Database for PostgreSQL (CRM y n8n).
- **Bases NoSQL:** MongoDB Atlas (asesoría, clóset y comunidad) y Amazon DynamoDB (sesiones, idempotencia, SAGA y cupos).

### Inteligencia de negocios: dataset de miles de registros y dashboards con KPI en Python

**Sí.** Tablero en **Python** (Streamlit, pandas y Plotly) en `backend/bi-dashboard`:
- **Dataset:** más de 60 000 registros de dos años de operación (citas, facturas, puntos, consumo de insumos, reseñas y clientes), en `backend/bi-dashboard/datos`, generado de forma reproducible por `generar_dataset.py`.
- **KPI:** ingresos netos, citas atendidas, ticket promedio, margen bruto, cancelación, inasistencia, clientes recurrentes y satisfacción, comparados con el año anterior.
- **Dashboards:** ventas por mes y categoría, métodos de pago, horas pico, desempeño por estilista, clientes nuevos, mejores clientes (RFM), márgenes por servicio y costo de insumos.
- Solo entra la administración (Keycloak). Se abre desde **Reportes → Abrir el tablero**.

## Modelo 2

| # | Pregunta | Respuesta |
| :-: | :--- | :--- |
| ① | Terminada y en calidad de producto | **Sí:** los 22 casos de uso, desplegada en tres nubes con HTTPS, dominio propio, Kubernetes, pagos reales en modo prueba, WhatsApp y push, y probada en vivo. Las salvedades están en las "Limitaciones conocidas" del ROADMAP. |
| ② | Móvil con notificaciones push, IA y recursos más allá de cámara y micrófono | **Sí.** **Notificaciones push con Firebase Cloud Messaging**: cada aviso del CRM (pago confirmado, reembolso, stock crítico…) llega al teléfono aunque la app esté cerrada (`mobile/salon_mobile/lib/core/push/push_service.dart`; el envío, en `backend/ms-crm/app/FrameworksDrivers/Push/FcmPushSender.php`). **IA dentro del teléfono:** TFLite y MediaPipe sin conexión. **Otros recursos:** base local SQLite, detección de red y cola sin conexión, almacenamiento seguro, impresión y PDF, y pago con Stripe. |
| ③ | La gestión empresarial usa GraphQL al 100 % | **Sí.** El ERP tiene un solo `fetch`, hacia dos API GraphQL: gestión y CRM. Lo que atienden otros servicios (moderación, cobro en el mostrador, comprobante, voz y agentes MCP) pasa por la **puerta GraphQL** de `ms-gestion` (patrón *Backend for Frontend*), que lo reenvía con el token de la persona (`backend/ms-gestion/src/main/resources/graphql/erp.graphqls`). |
| ④ | IA sin servicios públicos (modelos locales) | **Sí, salvo una función opcional.** Visión (MediaPipe y TFLite propio), voz (Whisper) y también **los agentes, los reportes por prompt y los textos de marca** corren con un **modelo de lenguaje local**: Qwen 2.5 de 3B en Ollama, desplegado en la propia nube y protegido con una clave (`deploy/ollama`). Gemini queda solo como respaldo si el modelo local no responde. La única excepción es la simulación de cortes y ropa en imagen (Replicate): un modelo de difusión en CPU no es práctico, y la función es opcional y no envía datos personales. |
| ⑤ | Reportes por prompt, audio o texto, eligiendo columnas, criterios y Excel o PDF | **Sí.** Ver la pregunta 4 del Modelo 1. |
| ⑥ | S3 para almacenamiento masivo | **Sí.** Las fotos del clóset y la comunidad se guardan en un bucket de **Amazon S3**, privado y cifrado, con un usuario de IAM que solo puede usar ese bucket (`backend/ms-asesoria/src/adapters/outbound/storage/s3-media.storage.ts`). Las fotos anteriores se migran solas desde GridFS la primera vez que se piden. |
