# Guía para defender el proyecto

Para cada pregunta de los modelos de examen: qué decir, qué mostrar en la aplicación y qué abrir en el código. Las respuestas resumidas, con su evidencia, están en [CUMPLIMIENTO_EXAMEN.md](CUMPLIMIENTO_EXAMEN.md).

**Regla para hablar:** primero la respuesta («Sí, y lo muestro»), después la demostración y al final el código. Si el docente pregunta por una limitación, dila tal como está en el ROADMAP: es más creíble que negarla.

## Antes de la presentación (30 minutos antes)

1. **Abrir las pestañas** del navegador:
   - Plataforma: https://salon-sw2-app.web.app (sesión de administración iniciada).
   - BI en Kubernetes: https://bi.salon-ai.beauty
   - Keycloak: https://auth.salon-ai.beauty
2. **Calentar el modelo local:** hacer una pregunta cualquiera a un agente en **Gestión → Agentes**. En la nube responde en unos 25 s, y la primera respuesta puede tardar más.
3. **Tener a mano** las cuentas de demostración de la nube (`deploy/salida/cuentas-demo.env`). No mostrar ese archivo en pantalla.
4. **Teléfono:** la app instalada, con la sesión iniciada y el cable USB o la pantalla compartida listos.
5. **Editor:** VS Code con el proyecto abierto. Los enlaces de esta guía llevan a la línea exacta.
6. **Terminal:** en la raíz del proyecto, para los comandos de Kubernetes.

**Orden sugerido (unos 15 minutos):**
1. Arquitectura y nubes, para dar el mapa.
2. Reserva con pago, que recorre la SAGA y avisa por WhatsApp y push.
3. IA (visión y agentes).
4. Reportes por prompt.
5. BI.
6. Móvil sin conexión.

---

## Modelo 1

### 1. ¿Está desarrollada al 100 %?

**Decir:**
> «Sí. Los 22 casos de uso del documento de requisitos están completos y verificados en vivo. La matriz del ROADMAP indica en qué fase se cerró cada uno y con qué prueba. Además, hay más de 1 300 pruebas automáticas entre todos los servicios.»

**Mostrar:**
- [ROADMAP.md](ROADMAP.md), la «Matriz de casos de uso», al final: todos con ✅.
- **Flujo completo en la plataforma:** el cliente reserva y paga con la tarjeta de prueba de Stripe `4242 4242 4242 4242`. Luego llegan la confirmación por WhatsApp, el push en el teléfono, la factura en el CRM y los puntos.

**Si preguntan por lo que falta:**
- **iOS:** no se compiló, porque requiere una Mac.
- **WhatsApp:** la app de Meta no está publicada, así que solo escribe a los números de su lista de prueba.
- **Imágenes:** la simulación de cortes y ropa usa un proveedor externo (Replicate).

### 2. ¿Lógica, notificaciones, logs, protocolo MCP y uso de memoria y red?

**Decir:**
> «La lógica de negocio está separada por arquitectura en cada microservicio:
> - DDD en gestión;
> - hexagonal en asesoría;
> - Clean Architecture en el CRM.
>
> La reserva es una SAGA orquestada con compensaciones. Los agentes de IA nunca tocan la base de datos: todo pasa por un servidor MCP con token y rol.»

**Lógica (la SAGA):**
- [backend/saga-orchestrator/src/saga-engine.js](backend/saga-orchestrator/src/saga-engine.js): pasos y compensaciones.
- Puntos que conviene explicar:
  - **Idempotencia:** el mismo pago no se cobra dos veces.
  - **Paso pivote:** el cobro de Stripe.
  - **Reembolso:** si algo falla después del cobro, la SAGA devuelve el dinero.
- **Capas de cada servicio:**
  - `backend/ms-gestion/src/main/java/com/salon/gestion/`: `domain`, `application` e `infrastructure`.
  - `backend/ms-asesoria/src/`: `domain`, `ports` y `adapters`.
  - `backend/ms-crm/app/`: `Core`, `InterfaceAdapters` y `FrameworksDrivers`.

**Notificaciones (tres canales):**
- **Dentro de la app:** [07_avisos_crm.sql](docker/postgres/migrations/07_avisos_crm.sql) y [RecordNoticesUseCase.php](backend/ms-crm/app/Core/UseCases/RecordNoticesUseCase.php).
- **Push (FCM):** [FcmPushSender.php:45](backend/ms-crm/app/FrameworksDrivers/Push/FcmPushSender.php#L45).
- **WhatsApp:** flujos de n8n en `docker/n8n/workflows/`. Por ejemplo, [alerta-stock.json](docker/n8n/workflows/alerta-stock.json) escucha RabbitMQ y envía la plantilla de Meta.

**Protocolo MCP:**
- [server.js:8](backend/mcp-server/src/server.js#L8): SDK oficial `@modelcontextprotocol/sdk`, transporte Streamable HTTP.
- [tools.js:26](backend/mcp-server/src/tools.js#L26) (`TOOL_ROLES`): cada herramienta declara qué roles la pueden usar.
- [server.js:66](backend/mcp-server/src/server.js#L66): se rechaza la llamada si el rol no alcanza.
- [tools.js:46](backend/mcp-server/src/tools.js#L46): `confirmar_accion` y `rechazar_accion` son solo para personas. Un agente propone; una persona pulsa **Confirmar**.
- **Skills:** `backend/mcp-server/skills/<agente>/SKILL.md` (agenda, inventario, operación y reportes).

**Logs:**
> «Cada servicio escribe a la salida estándar, como recomiendan los doce factores. En la nube los recogen CloudWatch, Container Apps y Cloud Logging.»

Para demostrarlo, abrir CloudWatch o los registros de Cloud Run en su consola.

**Memoria y red:**
- **Memoria:** los manifiestos de Kubernetes de los 14 servicios declaran `requests` y `limits` de CPU y memoria, y sondas de salud (`k8s/base/<servicio>/`). Gestión, asesoría e IA tienen además escalado automático (`HorizontalPodAutoscaler`).
- **Red:**
  - Funcionamiento sin conexión con una cola local: IndexedDB en la web y SQLite en el móvil. Se sincroniza al volver la red, con `Idempotency-Key` para no duplicar.
  - Web: [queue.js:42](frontend/shell/src/offline/queue.js#L42) y [queue.js:153](frontend/shell/src/offline/queue.js#L153) (escucha el evento `online`).
  - Móvil: [offline_queue.dart](mobile/salon_mobile/lib/core/sync/offline_queue.dart).
  - Los microservicios se comunican de forma asíncrona por RabbitMQ.

### 3. ¿Deep learning para visión artificial con TensorFlow o similares?

**Decir:**
> «Sí, en dos niveles:
> - MediaPipe, que son redes neuronales de Google, para la malla facial de 478 puntos y la segmentación de cabello y piel;
> - un clasificador propio de tipo de cabello, que entrenamos con TensorFlow y convertimos a TFLite.
>
> Corre en el servidor y también dentro del teléfono sin internet.»

**Mostrar en la app:** Estudio IA → diagnóstico con una foto: forma del rostro, tipo de cabello y tono de piel. Luego, en el móvil, en modo avión, el mismo análisis.

**Mostrar en el código:**
- **Entrenamiento:** [train_hair_type.py:57](backend/ms-ia/training/train_hair_type.py#L57) (extractor) y [train_hair_type.py:124](backend/ms-ia/training/train_hair_type.py#L124) (conversión a TFLite con cuantización).
- **Métricas honestas:** [hair_type_metrics.json](backend/ms-ia/training/hair_type_metrics.json), con 87 % de exactitud sobre Figaro-1k y la matriz de confusión.
- **En el teléfono:**
  - Modelos en `mobile/salon_mobile/assets/models/`.
  - Inferencia en [on_device_analyzer.dart](mobile/salon_mobile/lib/features/biometrics/on_device_analyzer.dart).

**Si preguntan por los fallos:** la clase «ondulado» acierta un 60 %, porque se confunde con «lacio». No se midió el sesgo por tono de piel.

### 4. ¿Reportes dinámicos por prompt con agentes conectados a la base de datos?

**Decir:**
> «Sí. El usuario pide el reporte con texto o voz. El agente de reportes interpreta el pedido y llama a la herramienta MCP `generar_reporte`. El servidor MCP consulta PostgreSQL con un usuario de solo lectura y devuelve un Excel o un PDF. El modelo nunca escribe SQL: elige columnas y filtros de un catálogo cerrado, así que no puede haber inyección.»

**Mostrar en la app:**
1. **Gestión → Reportes**: escribir o dictar «facturas de este año con cliente, servicio y total, agrupadas por estilista, en PDF».
2. Descargar y abrir el archivo.
3. Repetir con el formulario: columnas, criterios y formato Excel.

**Mostrar en el código:**
- [reports.js:171](backend/mcp-server/src/reports.js#L171): catálogo de entidades y columnas permitidas.
- [reports.js:198](backend/mcp-server/src/reports.js#L198): `construirConsulta`, con SQL parametrizado a partir del catálogo.
- [reports.js:381](backend/mcp-server/src/reports.js#L381): `BEGIN READ ONLY`, la segunda barrera.
- **Usuario de base de datos:** [10_reportes_gestion.sql](docker/postgres/migrations/10_reportes_gestion.sql) crea el rol `salon_reportes`, que solo tiene `SELECT` sobre las tablas de reportes.
- **Skill:** [skills/reportes/SKILL.md](backend/mcp-server/skills/reportes/SKILL.md).

### 5. ¿Microservicios con Docker y Kubernetes en 3 nubes, con bases relacionales y NoSQL?

**Decir:**
> «Son catorce servicios, cada uno con su Dockerfile. En local corren con Docker Compose. En producción están repartidos en AWS, Azure y Google Cloud, y además hay un clúster de Kubernetes administrado en cada nube: EKS, AKS y GKE.»

**Dónde corre cada servicio:**

| Nube | Servicios | Kubernetes |
| :--- | :--- | :--- |
| AWS (Ohio) | Keycloak, gestión y MCP en ECS Fargate; RDS PostgreSQL, DynamoDB y S3 | EKS: consumidor de la SAGA |
| Azure (Toronto) | CRM, worker, orquestador SAGA y n8n en Container Apps; PostgreSQL | AKS: worker del CRM |
| Google Cloud (Virginia) | Asesoría, IA y modelo local en Cloud Run; web en Firebase | GKE: tablero de BI con HTTPS |

**Bases de datos:**
- **Relacionales:** PostgreSQL en RDS (gestión y Keycloak) y en Azure (CRM y n8n).
- **NoSQL:** MongoDB Atlas (asesoría, clóset y comunidad) y DynamoDB (sesiones, idempotencia, SAGA y cupos).

**Mostrar en la terminal:**
```bash
kubectl --kubeconfig deploy/salida/kubeconfig-eks get pods -n salon
kubectl --kubeconfig deploy/salida/kubeconfig-aks get pods -n salon
kubectl --kubeconfig deploy/salida/kubeconfig-gke get pods,ingress -n salon
```
Después, abrir https://bi.salon-ai.beauty: ese tablero se sirve desde GKE.

**Mostrar en el código:**
- `k8s/base/`: un `Deployment` y un `Service` por cada microservicio, con su `kustomization.yaml`.
- `k8s/overlays/aws`, `azure` y `gcp`: lo que cambia por nube. Por ejemplo, AKS usa una imagen ARM64 y GKE agrega Ingress y certificado en [publicacion.yaml](k8s/overlays/gcp/publicacion.yaml).
- [docker-compose.yml](docker-compose.yml) para el entorno local.
- [DESPLIEGUE_MULTICLOUD.md](DESPLIEGUE_MULTICLOUD.md): tabla de qué corre en cada nube.

**Si preguntan por qué no todo está en Kubernetes:** por costo. Los servicios administrados (Fargate, Container Apps y Cloud Run) escalan a cero y entran en los créditos gratuitos. En cada clúster corre una réplica real que consume de las mismas colas. RabbitMQ muestra dos consumidores por cola, y los manifiestos sirven para desplegar los catorce servicios.

### Inteligencia de negocios: dataset de miles de registros y KPI en Python

**Decir:**
> «El tablero está hecho en Python con Streamlit, pandas y Plotly, sobre un dataset de 62 745 registros de dos años de operación. Solo entra la administración, con Keycloak.»

**Mostrar en la app:**
1. **Gestión → Reportes → Abrir el tablero.** También se puede abrir https://bi.salon-ai.beauty.
2. Iniciar sesión.
3. Cambiar el rango de fechas y filtrar por estilista: los KPI se recalculan y se comparan con el año anterior.

**Mostrar en el código:**
- `backend/bi-dashboard/datos/*.csv`: citas 14 934, facturas 13 778, puntos 15 545, consumo 12 480 y más.
- **Datos:** [generar_dataset.py](backend/bi-dashboard/generar_dataset.py) los genera de forma reproducible, con semilla fija, estacionalidad y horas pico.
- [kpis.py:70](backend/bi-dashboard/kpis.py#L70): `indicadores` (ingresos netos, ticket promedio, margen, cancelación, inasistencia, recurrencia y satisfacción).
- [app.py:28](backend/bi-dashboard/app.py#L28): el acceso exige el rol `ADMIN`.

---

## Modelo 2

### ① ¿Terminada y en calidad de producto?

**Decir:**
> «Sí. Está desplegada en tres nubes, con HTTPS, dominio propio, inicio de sesión centralizado con Keycloak y sesión única para el personal. Los pagos son reales en modo prueba de Stripe, y los avisos llegan por WhatsApp y push. Se probó en vivo con pruebas automáticas y de navegador.»

**Mostrar:**
- La plataforma en https://salon-sw2-app.web.app.
- El candado HTTPS en `auth.salon-ai.beauty` y `gestion.salon-ai.beauty`.
- **Sesión única:** iniciar sesión con la misma cuenta de administración en otro navegador. Gana el inicio de sesión más reciente, guardado en DynamoDB, y la primera sesión queda rechazada en su siguiente acción.

### ② ¿Móvil con push, IA y recursos más allá de cámara y micrófono?

**Decir:**
> «La app está hecha en Flutter. Recibe notificaciones push con Firebase Cloud Messaging aunque esté cerrada. Hace el diagnóstico con IA dentro del teléfono, sin internet. Usa una base SQLite local, detecta la red, guarda la sesión de forma segura, imprime comprobantes en PDF y cobra con Stripe.»

**Mostrar en el teléfono:**
1. Cerrar la app. Desde la web, pagar una reserva de ese cliente: llega el push.
2. Activar el modo avión:
   - abrir «Mis citas», que sale de SQLite;
   - imprimir un comprobante;
   - cancelar o reservar, que queda en la cola.
3. Quitar el modo avión: la operación se envía sola.
4. Diagnóstico de una foto sin red.

**Mostrar en el código:**
- **Recepción del push:** [push_service.dart](mobile/salon_mobile/lib/core/push/push_service.dart).
- **Envío del push:** [FcmPushSender.php:53](backend/ms-crm/app/FrameworksDrivers/Push/FcmPushSender.php#L53), con canal `avisos` y prioridad alta. Firma el JWT con la cuenta de servicio, sin SDK.
- **Base local:** [local_database.dart](mobile/salon_mobile/lib/core/database/local_database.dart).
- **Cola sin conexión:** [offline_queue.dart](mobile/salon_mobile/lib/core/sync/offline_queue.dart).

### ③ ¿La gestión empresarial usa GraphQL al 100 %?

**Decir:**
> «Sí. El ERP, hecho en Angular, tiene un solo `fetch` en todo el código, y solo llama a dos API GraphQL: gestión y CRM. Lo que vive en otros servicios (moderación, cobro en el mostrador, comprobante, voz y agentes) pasa por una puerta GraphQL en el servicio de gestión. Es el patrón Backend for Frontend: reenvía cada operación con el token de la persona, así que cada servicio vuelve a validar el rol.»

**Mostrar:**
- En el navegador, F12 → pestaña Red, filtrar por Fetch: todas las peticiones del ERP van a `/graphql`.
- [api.service.ts:18](frontend/mfe-gestion/src/app/core/api.service.ts#L18): el único `fetch`.
- **Esquema de la puerta:** [erp.graphqls](backend/ms-gestion/src/main/resources/graphql/erp.graphqls).
- **Controlador:** [ErpGatewayGraphQLController.java:67](backend/ms-gestion/src/main/java/com/salon/gestion/infrastructure/adapter/graphql/ErpGatewayGraphQLController.java#L67).
- **Cliente:** [ErpServicesClient.java:116](backend/ms-gestion/src/main/java/com/salon/gestion/infrastructure/adapter/erp/ErpServicesClient.java#L116) reenvía el token.

### ④ ¿IA sin servicios públicos (modelos locales)?

**Decir:**
> «Sí, salvo una función opcional:
> - La visión artificial (MediaPipe y nuestro TFLite) corre en nuestros servidores y en el teléfono.
> - La voz se transcribe con Whisper local.
> - Los agentes, los reportes por prompt y los textos de marca usan un modelo de lenguaje local: Qwen 2.5 de 3 mil millones de parámetros, servido con Ollama en nuestra propia nube y protegido con una clave.
>
> Gemini queda solo como respaldo si el modelo local no responde. La excepción es la simulación de cortes y ropa en imagen: un modelo de difusión en CPU no es práctico. Esa función es opcional y no envía datos personales.»

**Mostrar:**
- **Gestión → Agentes:** preguntar «¿qué insumos están en nivel crítico?». La respuesta indica el motor, «Ollama qwen2.5:3b (local)», y la herramienta que usó.
- **Cadena de proveedores:** [server.js:34-35](backend/mcp-server/src/server.js#L34-L35) y [ollama.js:115](backend/mcp-server/src/ollama.js#L115) (`firstAvailable`: primero local, después Gemini).
- [ollama.js:14](backend/mcp-server/src/ollama.js#L14): traduce el ciclo del agente al formato de Ollama, con *tool calling*.
- [deploy/ollama/](deploy/ollama/): la imagen con el modelo incluido y un nginx que exige la clave.
- **Voz:** dictar en Reportes y mostrar que lo transcribe `ms-ia` con Whisper.

**Si preguntan por la velocidad:** en CPU tarda entre 20 y 40 s. Con GPU bajaría a pocos segundos, pero los créditos gratuitos no la incluyen.

### ⑤ ¿Reportes por prompt, audio o texto, eligiendo columnas, criterios y Excel o PDF?

Ver la pregunta 4 del Modelo 1. En la demostración, hacer uno **por voz** y otro **con el formulario**, uno en Excel y otro en PDF.

### ⑥ ¿S3 para almacenamiento masivo?

**Decir:**
> «Sí. Las fotos del clóset y de la comunidad se guardan en un bucket de Amazon S3, privado y cifrado. El usuario de IAM solo puede usar ese bucket. Las peticiones se firman con SigV4, que implementamos y probamos con los vectores oficiales. Las fotos antiguas se migran solas desde GridFS la primera vez que se piden.»

**Mostrar:**
- Subir una prenda al clóset o una publicación a la comunidad.
- En la consola de AWS → S3, ver el objeto nuevo.
- [s3-media.storage.ts:31](backend/ms-asesoria/src/adapters/outbound/storage/s3-media.storage.ts#L31) (clase) y la [línea 48](backend/ms-asesoria/src/adapters/outbound/storage/s3-media.storage.ts#L48) (firma SigV4).

**Si preguntan por qué no se usa el SDK:** para mantener la imagen liviana y el mismo firmador en todos los servicios, probado contra los vectores de botocore.

---

## Preguntas difíciles y respuestas honestas

| Pregunta | Respuesta |
| :--- | :--- |
| ¿Por qué microservicios en lenguajes distintos? | Cada uno muestra una arquitectura: DDD en Java, hexagonal en NestJS, Clean en Laravel y la IA en Python, que es el ecosistema de ML. Se comunican por GraphQL, REST y RabbitMQ. |
| ¿Qué pasa si Stripe cobra y luego falla la cita? | La SAGA compensa: libera el turno, devuelve el stock y los puntos, y reembolsa por Stripe. Si el reembolso mismo falla, queda en `REFUNDING_PAYMENT` para intervención manual. |
| ¿Puede un agente borrar datos? | No. No tiene acceso a la base de datos, y toda acción que cambia datos queda pendiente hasta que una persona pulsa **Confirmar**. |
| ¿Se guardan las fotos del rostro? | No. Ni la foto ni el resultado de la simulación. Requieren una autorización biométrica separada. |
| ¿Funciona la web sin internet? | Si se corta con la página abierta, sí: la cola en IndexedDB guarda las operaciones. No abre desde cero sin red, porque no tiene *service worker*. El móvil sí funciona por completo sin conexión. |
| ¿Cuánto cuesta la nube? | Unos 20 USD al día, sobre todo el modelo local siempre encendido y los clústeres. Todo sale de créditos gratuitos y se borra después de la entrega. |
| ¿Por qué el push no aparece arriba? | Llega con prioridad alta y un canal de importancia alta. Que flote o no lo decide un ajuste del teléfono. |
