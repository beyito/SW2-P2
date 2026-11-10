# Plan de Implementación y Seguimiento (Roadmap)

Registro oficial del desarrollo de la **Plataforma Inteligente para Salón de Belleza y Asesoramiento de Imagen Personal**, conforme a [AGENTS.md](AGENTS.md).

**Entrega:** martes 10 de noviembre de 2026.

> **Nota de auditoría (5-6 de noviembre de 2026).** Este documento reemplaza la versión anterior, que marcaba las fases 0 a 6 como completadas y certificadas. La auditoría contra el código y los servicios en ejecución encontró 0 de 22 casos de uso completos de extremo a extremo. Una fase solo se marca como completada cuando su criterio de aceptación se ha verificado en vivo.

---

## Estado Global

| Fase | Descripción | Fecha objetivo | Estado |
| :---: | :--- | :---: | :---: |
| **A** | Sinceramiento e infraestructura completa en Compose | Vie 6 | **COMPLETADA** |
| **B** | Seguridad real: Keycloak, JWT, roles y sesión única | Vie 6 | **COMPLETADA** |
| **C** | Catálogo, receta de insumos, estilistas, horarios y stock mínimo | Vie 6 | **COMPLETADA** |
| **D** | Reserva y pago real: SAGA, Stripe e idempotencia | Vie 6 | **COMPLETADA** |
| **E** | CRM: Laravel, GraphQL, factura, puntos, canje y reembolso | Vie 6 | **COMPLETADA** |
| **F** | Frontends y MCP con datos reales, perfil, reseñas, avisos y moderación | Vie 6 | **COMPLETADA** |
| **G** | IA real y consentimiento biométrico | Vie 6 | **COMPLETADA** |
| **H** | Perfil de estilo, agente autónomo, n8n, offline, Module Federation, móvil, Testcontainers y certificación final | Vie 6 | **COMPLETADA** |
| **I** | Simulación de cortes y ropa con IA en web y móvil | Vie 6 | **COMPLETADA** |
| **J** | Agentes de operación, inventario y agenda con Skills sobre MCP (RF-11) | Vie 6 | **COMPLETADA** |
| **K** | Prueba de conjuntos de ropa en una sola imagen, en web y móvil | Sáb 7 | **COMPLETADA** |
| **L** | Cierre de entrega: regresión, README, frontends en Docker y pantallas móviles que faltan | Sáb 7 | **COMPLETADA** |
| **M** | Actor Recepcionista: agenda global, llegada y ausencia, cobro en mostrador y horarios | Sáb 7 | **COMPLETADA** |
| **N** | Móvil a la par de la web: cierre de sesión en el servidor y canje de puntos | Dom 8 | **COMPLETADA** |
| **O** | Móvil completo: comprobante imprimible, cancelación con reembolso y reprogramación | Dom 8 | **COMPLETADA** |
| **P** | Despliegue en AWS, Azure y Google Cloud | Lun 9 | **COMPLETADA** |
| **Q** | Diseño de salón de belleza en web y móvil | Dom 8 | **COMPLETADA** |
| **R** | Reportes dinámicos en Excel y PDF por prompt, voz o formulario | Lun 9 | **COMPLETADA** |
| **S** | Inteligencia de negocios en Python con un dataset de miles de registros | Lun 9 | **COMPLETADA** |
| **T** | Imágenes del clóset y la comunidad en Amazon S3 | Lun 9 | **COMPLETADA** |
| **U** | Kubernetes en AWS, Azure y Google Cloud | Lun 9 | **COMPLETADA** |
| **V** | Notificaciones push en el móvil (Firebase Cloud Messaging) | Lun 9 | **COMPLETADA** |
| **W** | ERP 100 % GraphQL con una puerta en ms-gestion | Lun 9 | **COMPLETADA** |
| **X** | IA con un modelo de lenguaje local (Ollama) | Lun 9 | **COMPLETADA** |
| **Y** | Historial de operación y prendas de demostración | Mar 10 | **COMPLETADA** |

---

## Fase A: Sinceramiento e Infraestructura (Completada)

- [x] `.env` y variantes excluidos de git; `.env.example` actualizado sin secretos reales.
- [x] Variables de Stripe renombradas a `STRIPE_SECRET_KEY` y `STRIPE_PUBLISHABLE_KEY`.
- [x] Repositorio git inicializado en la rama `main`.
- [x] `docker-compose.yml` con `ms-gestion`, `ms-asesoria`, `ms-crm`, `ms-ia`, `mcp-server`, Keycloak y n8n.
- [x] Inicialización idempotente: `db-migrate`, `mongo-init` y `dynamodb-init`.
- [x] Dockerfiles corregidos (`ms-ia`, `ms-asesoria`, `ms-crm`) y creado el de `mcp-server`; `.dockerignore` por servicio.
- [x] Actuator agregado a `ms-gestion` para su healthcheck.
- [x] Tests de dominio de `ms-gestion` movidos a la carpeta de su paquete (`domain/model`).
- [x] `MANUAL_EJECUCION.md` y `start-all.ps1` corregidos.

**Verificación en vivo (6 de noviembre):**
- [x] `docker compose up -d --build --wait`: 11 servicios `healthy` y 3 tareas de inicialización con salida 0.
- [x] Humo: endpoints HTTP de los 5 servicios de backend y n8n responden; GraphQL lee PostgreSQL; Keycloak emite un token de administrador; `ms-gestion` reporta `UP`.
- [x] Las tareas de inicialización se reejecutan sin duplicar semillas (MongoDB) y las migraciones funcionan sobre un PostgreSQL nuevo.
- [x] Suites: `ms-gestion` 14/14, `ms-asesoria` 8/8, `ms-crm` 5/5, `ms-ia` 7/7.

**Pendiente deliberado:** el orquestador SAGA no está en Compose, porque hoy solo ejecuta una demostración que publica eventos falsos. Entra en la Fase D. Los microfrontends siguen ejecutándose en modo desarrollo fuera de Compose.

---

## Fase B: Seguridad Real (CU-01, CU-02, RF-01, RNF-02) (Completada)
- [x] Realm de Keycloak versionado (`docker/keycloak/salon-realm.json`) e importado al arrancar, con roles `ADMIN`, `STYLIST` y `CLIENT`.
- [x] Validación de firma RS256 (JWKS), emisor, audiencia y vigencia en `ms-gestion`, `ms-asesoria`, `ms-crm`, `ms-ia` y Servidor MCP.
- [x] Sesión única concurrente para `ADMIN` con DynamoDB: gana el login más reciente, con escritura condicional.
- [x] Cierre de sesión con revocación inmediata del `sid` en todos los servicios (`POST /auth/logout`).
- [x] Login y logout reales en el Shell (PKCE) y entrega del token a los microfrontends por `postMessage` con origen verificado.
- [x] Propiedad de datos: la identidad sale del token y un cliente solo opera sobre lo suyo.
- [x] Roles por herramienta en el Servidor MCP; cuenta de servicio `salon-agent` para agentes.
- [x] Idempotencia de `ms-asesoria` movida detrás de la autenticación, atómica y limitada por usuario (422 si cambia el contenido).
- [x] CORS restringido a los orígenes de la plataforma; eliminados el token fijo, el alternador de rol y los indicadores falsos del Shell.

**Aceptación:** un token falso o ausente recibe 401, y un rol insuficiente recibe 403. En GraphQL sobre HTTP, el rol insuficiente se informa con `extensions.classification = FORBIDDEN` dentro de una respuesta 200, conforme a la convención de ese protocolo.

**Verificación en vivo (6 de noviembre):**
- [x] `tests/integration/test_seguridad_live.py`: 53/53 contra Keycloak y los 5 servicios reales.
- [x] `tests/e2e/seguridad.e2e.mjs`: 14/14 en Chromium real (login, roles, token en microfrontends, sesión única y logout).
- [x] RNF-01 con autenticación: p95 de 58 ms.
- [x] Suites: `ms-gestion` 22/22, `ms-asesoria` 25/25, `ms-crm` 15/15, `ms-ia` 20/20, `mcp-server` 11/11.

**Limitaciones conocidas:**
- `mfe-reservas` aún no llama al backend (Fase D) y la app móvil aún no autentica (Fase H), por lo que su sincronización recibirá 401.
- Un cierre de sesión hecho fuera de la plataforma (consola de Keycloak) no revoca el `sid`; el token sigue valiendo hasta vencer, un máximo de 5 minutos.
- Los datos de las herramientas MCP siguen simulados (Fase F).
- Las llamadas a DynamoDB no llevan firma SigV4: funcionan con DynamoDB Local, no con AWS real.
- El realm versionado contiene contraseñas y un secreto de desarrollo; es solo para entorno local.

## Fase C: Catálogo e Inventario (CU-04, CU-05, CU-08, CU-09, RF-02, RF-03) (Completada)
La Fase D se ejecutó antes por decisión del usuario, e incorporó las piezas de esta fase de las que depende. El resto se cerró junto con la Fase F.

- [x] Catálogo de servicios con precio y duración definidos en el servidor.
- [x] Receta de insumos por servicio y registro de movimientos en `inventory_logs`.
- [x] Consultas de estilistas, horarios y turnos disponibles.
- [x] Validar horario laboral, fechas pasadas y solapes (también al reprogramar); doble reserva imposible con una restricción de exclusión en PostgreSQL.
- [x] Errores GraphQL semánticos.
- [x] Registro y modificación de estilistas, activación y horario por día; ningún cambio puede dejar fuera una cita ya reservada (CU-04, CU-05).
- [x] Mutación para cambiar el stock mínimo (CU-09).
- [x] ERP conectado al inventario real.
- [x] Movimientos de stock atómicos y registrados con su motivo. Antes, `updateStock` podía pisar un descuento simultáneo de la SAGA e ignoraba el motivo.

**Aceptación:** una cita calcula en el backend su precio y sus insumos (verificado); dos reservas simultáneas no pueden ocupar el mismo turno (verificado); el administrador gestiona estilistas, horarios y stock mínimo (verificado).

## Fase D: Reserva y Pago Real (CU-06, CU-07, CU-10, RF-07, RNF-03, RNF-04) (Completada)
- [x] Orquestador SAGA como servicio (`saga-orchestrator`), con estado persistente en DynamoDB y consumidores RabbitMQ reales en ambos lados.
- [x] Stripe en modo prueba como paso pivote, detrás de un adaptador, con webhooks firmados (`stripe-cli`) y sincronización de respaldo.
- [x] Compensaciones reales de stock y turno, en orden inverso.
- [x] Plazo de pago de 15 minutos con cola de espera en RabbitMQ; un cobro tardío se reembolsa.
- [x] Idempotencia atómica en DynamoDB por usuario con verificación del hash (422 si difiere).
- [x] Checkout Vue conectado a datos reales; eliminado el simulador.
- [x] Mensajes que fallan tres veces van a la cola `saga.dead-letter`.

**Aceptación:** un pago rechazado libera el turno y el stock; un reintento con la misma llave no cobra dos veces. Ambas verificadas.

**Verificación en vivo (6 de noviembre):**
- [x] `tests/integration/test_saga_live.py` contra Stripe, RabbitMQ, DynamoDB y PostgreSQL reales. Con seguridad y RNF-01, la carpeta suma 79/79.
- [x] `tests/e2e/reservas.e2e.mjs`: 6/6 en Chromium, con tarjeta aprobada y rechazada en el formulario real de Stripe. `seguridad.e2e.mjs` sigue en 14/14.
- [x] 8 reintentos simultáneos con la misma llave: una SAGA y un solo cobro en Stripe.
- [x] 6 reservas simultáneas del mismo turno: una gana y 5 reciben `SLOT_TAKEN`.
- [x] Vencimiento real: una SAGA esperó de 05:38:41 a 05:53:42 y se compensó con `PAYMENT_TIMEOUT`.
- [x] Suites: `ms-gestion` 35/35, `saga-orchestrator` 22/22, `ms-asesoria` 25/25, `ms-crm` 15/15, `ms-ia` 20/20, `mcp-server` 11/11.

**Limitaciones conocidas:**
- `saga.completed` aún no tiene consumidor: el pago no genera factura ni puntos hasta la Fase E.
- Una cita pagada no se puede cancelar hasta la Fase E, porque requiere reembolso; sí se puede reprogramar.
- La alerta `inventory.stock.critical` se publica, pero nadie la consume hasta la Fase H.
- Solo se acepta tarjeta: otros métodos de Stripe son asíncronos y la SAGA no los contempla.
- Los webhooks requieren internet y el contenedor `stripe-cli`; sin él, el checkout confirma con la sincronización.
- Todos los mensajes de la cola de espera deben usar el mismo plazo, porque RabbitMQ los vence desde la cabeza.

## Fase E: CRM (CU-03, CU-07, CU-11, CU-12, RF-08) (Completada)
- [x] `ms-crm` sobre Laravel 12 y Lighthouse (GraphQL), conservando Clean Architecture. Laravel 11 está bloqueado por avisos de seguridad.
- [x] Worker `ms-crm-worker`: el evento de pago genera factura con IVA incluido y puntos, de forma idempotente.
- [x] Libro de puntos atómico en `loyalty_transactions`, con referencia única por movimiento.
- [x] Canje como paso de la SAGA: aparta puntos antes de cobrar y los devuelve si el pago falla.
- [x] Cancelación de una cita pagada: libera el turno, devuelve los insumos, reembolsa en Stripe, emite nota de crédito y revierte los puntos.
- [x] Comprobante imprimible (`/api/invoices/{id}/comprobante`), de demostración y sin validez fiscal.
- [x] Checkout con canje de puntos y botón de cancelar con reembolso.

**Reglas de puntos (supuesto a confirmar):** se ganan 10 puntos por dólar pagado y cada punto vale $0.01, es decir, 10% de retorno. El canje no puede dejar un cobro menor a $0.50, el mínimo de Stripe.

**Aceptación:** un pago genera factura y puntos; un reembolso los revierte. Ambas verificadas.

**Verificación en vivo (6 de noviembre):**
- [x] `tests/integration`: 105/105 contra Laravel, RabbitMQ, DynamoDB, PostgreSQL y Stripe reales.
- [x] `tests/e2e`: `reservas` 9/9 y `seguridad` 14/14 en Chromium.
- [x] Reembolso confirmado en la API de Stripe: un solo reembolso por el monto cobrado, aunque se cancele dos veces.
- [x] Evento `saga.completed` repetido: una sola factura y sin puntos dobles.
- [x] Dos canjes simultáneos con saldo para uno: solo uno aparta los puntos.
- [x] Suites: `ms-gestion` 39/39, `saga-orchestrator` 31/31, `ms-crm` 29/29 (`php artisan test`), `ms-asesoria` 25/25, `ms-ia` 20/20, `mcp-server` 11/11.

**Limitaciones conocidas:**
- Si Stripe falla al reembolsar, el mensaje se reintenta una vez y pasa a `saga.dead-letter`: la SAGA queda en `REFUNDING_PAYMENT` con la cita ya cancelada y requiere intervención manual.
- La cancelación solo se ofrece en la pantalla del checkout; el listado "Mis citas / Mis facturas" llega en la Fase F.
- Si el cliente ya gastó los puntos ganados, la reversión deja el saldo en cero y no recupera la diferencia.
- Solo hay reembolso total, permitido hasta el inicio de la cita.
- Una cuenta cuyo correo ya exista en el CRM con otro ID manda su factura a `saga.dead-letter`.
- El servidor web es `php -S` con varios procesos: es suficiente para este entorno, no para producción.

## Fase F: Frontends y MCP (CU-03, CU-04, CU-05, CU-07, CU-08, CU-09, CU-15, CU-17, CU-20, CU-21, RF-09, RF-11, RNF-01, RNF-02) (Completada)
- [x] ERP en Angular 21 real, en lugar del HTML con datos fijos: panel, agenda, inventario, estilistas, clientes, moderación y agente.
- [x] Clóset y comunidad en React conectados a `ms-asesoria`.
- [x] Portal en Vue: "Mis citas" (reprogramar, cancelar con reembolso y reseñar), "Mis facturas" con comprobante y nota de crédito, perfil con puntos e historial, y avisos.
- [x] Reseñas: solo sobre una cita propia ya atendida y una por cita. La calificación se muestra al reservar.
- [x] Avisos en la aplicación por pago, reembolso, stock crítico y moderación, generados por eventos reales de RabbitMQ.
- [x] Comunidad: imágenes en GridFS validadas por su contenido, comentarios en cascada hasta tres niveles, like atómico y moderación con denuncias.
- [x] Servidor MCP con el SDK oficial (Streamable HTTP, `POST /mcp`). Sus herramientas consultan los servicios reales con el token de quien llama.
- [x] Reportes con `gemini-2.5-flash`; sin clave o si la API falla, se arma un resumen con los mismos datos reales.
- [x] DataLoader (`@BatchMapping`) y Read Model (`panel_appointments_view`) para el panel empresarial (RNF-01).

**Aceptación:** ninguna pantalla ni herramienta MCP usa datos fijos. Verificada, con una excepción prevista, ya cerrada: el escáner biométrico llamaba al diagnóstico simulado de `ms-ia` hasta la Fase G.

**Verificación en vivo (6 de noviembre):**
- [x] `tests/integration`: 188/188 contra todos los servicios reales.
- [x] `tests/e2e`: `fase_f` 51/51, `reservas` 9/9 y `seguridad` 14/14 en Chromium.
- [x] RNF-01 con autenticación: p95 entre 53 y 57 ms en agenda, resumen y estilistas.
- [x] DataLoader medido con las estadísticas de PostgreSQL: las calificaciones de todos los estilistas se leen con una sola consulta.
- [x] 10 movimientos de stock simultáneos no se pierden; 12 clics simultáneos en like no duplican ninguno.
- [x] Las métricas de MCP coinciden con ms-gestion, ms-crm y la base; cambiar un dato cambia la respuesta de la herramienta.
- [x] Suites: `ms-gestion` 61/61, `ms-crm` 33/33, `ms-asesoria` 47/47, `mcp-server` 30/30, `saga-orchestrator` 31/31, `ms-ia` 20/20.

**Limitaciones conocidas:**
- El E2E del ERP usó el Angular compilado (`ERP_DESDE_DIST=1`), porque el puerto 3003 seguía ocupado por el servidor estático anterior. Cerrada en la Fase G: todas las suites corren contra `ng serve`.
- El modelo aún no elegía herramientas por sí mismo. Cerrada en la Fase H.
- Registrar un estilista no le crea una cuenta en Keycloak. Un cliente registrado por el personal tampoco queda vinculado a una cuenta.
- Un administrador que marca un aviso de stock como leído lo marca para todos los administradores.
- Cada estilista tiene un solo bloque de horario por día.
- La URL de la imagen de una publicación oculta sigue accesible, y una imagen subida que nunca se usa queda huérfana en GridFS.
- Los comentarios y las reseñas no tienen paginación; el muro muestra las 50 publicaciones más recientes.
- No había pruebas de componentes de frontend. Cerrada en la Fase H.

## Fase G: IA Real (CU-13, CU-14, CU-16, CU-18, RF-04, RF-05, RF-06) (Completada)
- [x] Consentimiento biométrico versionado en `ms-asesoria`: sin él no se analiza nada; si no se puede comprobar, tampoco. Es voluntario: se pueden indicar los rasgos a mano.
- [x] Retención y borrado: la foto o el video se descartan al terminar, solo se guarda el resultado, MongoDB lo borra a los 365 días (`BIOMETRIC_RETENTION_DAYS`) y revocar lo borra todo. Ni el personal del salón puede leer los resultados de un cliente.
- [x] Análisis real de foto y de video de 3 a 5 segundos: MediaPipe Face Landmarker para el rostro y dos redes en TensorFlow Lite para el cabello. Rechaza con 422 y su motivo: sin rostro, varias personas, de perfil, lejos, borroso o mal iluminado.
- [x] Clasificador de tipo de cabello propio (MobileNetV2, `training/train_hair_type.py`), entrenado y medido con Figaro-1k.
- [x] Cámara y grabación en el navegador, o subida de un archivo validado por su contenido.
- [x] Recomendador con Scikit-Learn (filtrado por contenido con similitud de coseno), unido al catálogo real, con el motivo de cada sugerencia y un botón para reservar el servicio.
- [x] Marca personal que usa el último diagnóstico y el clóset del cliente. Gemini redacta los textos sin recibir su nombre, su foto ni sus rasgos.
- [x] Reportes por voz: Whisper local transcribe la pregunta y el reporte sigue pasando por el Servidor MCP.

**Aceptación:** una imagen sin rostro se rechaza y los datos biométricos se pueden borrar. Verificada en vivo y en navegador.

**Medición de los modelos:**
- Tipo de cabello, sobre las 118 fotos de prueba de Figaro-1k que el modelo no vio, con el segmentador de producción: exactitud 87,3% (liso 100%, ondulado 60%, rizado 95%). Detalle en `backend/ms-ia/training/hair_type_metrics.json`.
- Forma de rostro y subtono: sus umbrales se calibraron con 1128 rostros frontales de LFW. Con 408 rostros aceptados de otra muestra, las cinco formas aparecen entre el 12% y el 32%. **No hay un conjunto etiquetado, así que su exactitud no está medida.**

**Verificación en vivo (6 de noviembre):**
- [x] `tests/integration`: 214/214 contra todos los servicios reales, con `ms-asesoria` detenido a propósito para comprobar que `ms-ia` no analiza sin poder revisar el consentimiento.
- [x] `tests/e2e` en Chromium, contra `ng serve` real: `fase_g` 32/32 con cámara y micrófono alimentados por un video y un audio reales, `fase_f` 51/51, `reservas` 9/9, `seguridad` 14/14.
- [x] Un video WebM real grabado por el navegador, sin duración en su cabecera, se mide y se analiza.
- [x] Voz a reporte con Gemini real (`gemini-3.1-flash-lite`, por el cupo agotado de `gemini-2.5-flash`). Marca personal con ambos modelos.
- [x] Suites: `ms-ia` 103/103 con los modelos reales, `ms-asesoria` 68/68, `ms-gestion` 61/61, `ms-crm` 33/33, `mcp-server` 30/30, `saga-orchestrator` 31/31.

**Limitaciones conocidas:**
- El diagnóstico es una estimación orientativa, y la pantalla lo indica. El subtono depende de la luz de la foto.
- LFW y Figaro-1k no representan por igual a todas las personas: no se midió el comportamiento por tono de piel o etnia. Las trenzas y las rastas no se entrenaron; una foto con ellas recibe igualmente una de las tres clases.
- Ondulado es la clase menos fiable, con 60% de acierto.
- Figaro-1k se publicó para investigación, aunque su espejo indique licencia MIT. Sirve para este proyecto académico; un uso comercial requiere revisar sus condiciones o reentrenar con datos propios.
- El plan gratuito de Gemini permite 20 consultas diarias por modelo. Al agotarlas, los reportes y la marca personal siguen funcionando con datos reales y plantillas, y lo indican en pantalla.
- La imagen de `ms-ia` pesa 3,9 GB y el contenedor usa unos 700 MB de memoria sin Whisper cargado.
- El análisis se hace de uno en uno en CPU: varias peticiones simultáneas esperan su turno.
- El agente no elegía herramientas por sí mismo (RF-11). Cerrada en la Fase H.

## Fase H: Cierre (CU-13, CU-17, CU-19, CU-22, RF-10, RF-11, RF-12) (Completada)
- [x] Perfil de estilo pedido por el usuario: cuestionario opcional en la primera sesión (género, rango de edad, largo, mantenimiento y estilo), editable en "Mi perfil". El catálogo se separa para hombre y mujer, y la edad orienta el resultado. Quien responde "no binario" o no responde ve todo el catálogo.
- [x] El consentimiento biométrico exige declarar la mayoría de edad; a un menor solo se le ofrece el modo a mano.
- [x] Agente autónomo: el modelo elige las herramientas del Servidor MCP según la pregunta, limitado a las del rol de quien pregunta. La voz y el texto usan este agente.
- [x] Cuatro flujos de n8n que se importan y activan solos: confirmación por evento real de pago, recordatorio 24 h antes sin repetirlo, alerta de stock crítico y respuestas o reservas por WhatsApp. Exigen la autorización del cliente.
- [x] Module Federation: React, Vue y Angular en una sola página, con React compartido y estilos aislados. Un módulo caído solo afecta a su pestaña.
- [x] Offline web: cola en IndexedDB por usuario, con envío automático en orden, conflictos visibles y sin duplicados. Reservas guardadas sin conexión que luego se pagan con Stripe.
- [x] Móvil: login real con Keycloak, cola en SQLite, lecturas sin conexión y diagnóstico en el dispositivo con los mismos modelos del servidor en TFLite.
- [x] Testcontainers en `ms-gestion`, `ms-asesoria` y `ms-crm`; pruebas de contrato de todas las consultas GraphQL de los clientes; pruebas de componentes en los cuatro frontends.

**Aceptación:** una operación hecha sin conexión llega una sola vez al volver la red, en web y móvil, y los recordatorios salen por eventos y horarios reales. Verificada.

**Verificación en vivo (6 de noviembre):**
- [x] `tests/integration`: 245 pruebas contra todos los servicios reales. En la corrida final fallaron 3, por errores de las propias pruebas (una lista de herramientas desactualizada y un evento incompleto que generaba mensajes muertos). Se corrigieron y se repitieron esas suites: 46/46, con 0 mensajes muertos.
- [x] `tests/e2e` en Chromium: `seguridad` 14/14, `reservas` 9/9, `fase_f` 51/51, `fase_g` 33/33, `perfil_estilo` 15/15, `fase_h_offline` 24/24.
- [x] Android en emulador: 4/4 con modelos y servicios reales, con el mismo diagnóstico que el servidor. Login real con Keycloak y cola con el servidor inalcanzable, comprobados a mano.
- [x] Contrato: 48 consultas GraphQL de web, móvil, MCP y n8n, válidas contra los esquemas reales.
- [x] Suites: `ms-gestion` 68/68, `ms-crm` 50/50, `ms-asesoria` 80/80, `ms-ia` 114/114, `mcp-server` 43/43, `saga-orchestrator` 31/31, `shell` 15/15, `mfe-estudio-ia` 23/23, `mfe-reservas` 10/10, `mfe-gestion` 14/14, móvil 17/17. Incluyen Testcontainers con PostgreSQL y MongoDB reales.
- [x] Datos intactos tras las pruebas: stock, puntos, facturas y citas reales sin cambios; 0 mensajes muertos.

**Limitaciones conocidas:**
- **WhatsApp no se probó contra Meta:** el formato se verificó con un servidor local que imita su API. Enviar de verdad requiere una cuenta de Meta, y para escribir fuera de una conversación, plantillas aprobadas.
- **iOS no se compiló:** requiere macOS. El código y los permisos están listos, pero no se ejecutó.
- **Móvil:** se verificó en un emulador Android, no en un teléfono físico. La captura con cámara del móvil no se probó; el análisis sí, con una foto real. Sin conexión solo analiza fotos, no video. En 20 de 124 rostros cercanos a un límite, el cálculo manual de los puntos asignó otra forma que el servidor.
- **Offline web:** requiere tener la plataforma abierta, porque el token solo vive en memoria y recargar sin conexión exige Keycloak. El ERP y el diagnóstico con IA necesitan conexión. Subir imágenes también.
- **Una reserva sin conexión no conoce la disponibilidad:** se valida al enviarla, y si el turno está ocupado se informa como rechazada. No usa puntos, y debe pagarse en 15 minutos.
- **Catálogo por género:** los dos estilos de color para hombre no tienen servicio en el catálogo y se indican como "consulta en el salón". Hasta agregarlos no se pueden reservar directamente.
- **Cuenta de automatización:** n8n usa la cuenta de servicio `salon-agent`, con rol ADMIN. En producción convendría un rol más limitado.
- **Frontends fuera de Docker Compose:** los cuatro se ejecutan con `npm` en el equipo.
- La verificación de firma de los webhooks de Meta (`X-Hub-Signature-256`) no está implementada: es necesaria antes de exponer n8n a Internet.

## Fase I: Simulación de cortes y ropa con IA (CU-14, CU-15) (Completada)
Función adicional pedida por el usuario. Modelos elegidos por él en Replicate: `flux-kontext-apps/change-haircut` para cortes y color, y `black-forest-labs/flux-2-max` para ropa.

- [x] `ms-ia`: adaptador intercambiable del proveedor, con reintentos ante su límite de velocidad, cancelación por tiempo y descarga solo desde su dominio.
- [x] Costo: fotos reducidas a 1 MP antes de enviarlas (de 9 a 3 megapíxeles contabilizados en la prueba de ropa) y cupo atómico en DynamoDB: 5 imágenes por cliente y 30 por salón al día. Si la imagen no se genera, el cupo se devuelve.
- [x] `ms-asesoria`: autorización aparte del diagnóstico (`2026-11-img-v1`), solo para mayores de 18 años, que nombra al tercero. Retirar el consentimiento biométrico también la retira.
- [x] La foto se valida en local antes de enviarla: una sola persona y, para ropa, sin encuadre de solo la cara. La plataforma no guarda la foto ni el resultado.
- [x] Una prenda solo se lee desde las imágenes subidas a la plataforma: nunca una URL escrita por el usuario, para evitar SSRF.
- [x] Web: "Ver cómo me queda" en las recomendaciones y "Probármela" en el clóset, con etiqueta de simulación.
- [x] Móvil: las mismas dos funciones. Se agregaron la lista de recomendaciones y las fotos de prendas, que la aplicación no tenía.
- [x] Corregido al verificar: una respuesta tardía de disponibilidad mostraba turnos de otro día, y el cliente pagaba un día distinto del que veía; también al reprogramar. La fecha de hoy se calculaba en UTC y, desde las 20:00 en Bolivia, no dejaba reservar para hoy.

**Verificación:**
- [x] Con Replicate real y fotos reales: flujo completo en navegador y en un emulador Android, pasando por las pantallas reales. El corte tardó menos de un minuto y la ropa unos 30 segundos.
- [x] Navegador real: 169/169, incluida una prueba que falla sin el arreglo de la fecha.
- [x] En vivo: 270/270 en `tests/integration`. Las pruebas automáticas no gastan crédito.
- [x] Suites: `ms-ia` 160/160, `ms-asesoria` 86/86, `mfe-estudio-ia` 32/32, `mfe-reservas` 11/11, móvil 38/38, emulador 4/4 más 2/2 con Replicate real.
- [x] Datos intactos tras las pruebas; 0 mensajes muertos.

**Limitaciones conocidas:**
- **Solo con conexión**, en web y en móvil.
- **Parecido, no igual:** `flux-2-max` regenera toda la imagen, así que la cara y el encuadre pueden cambiar un poco. El color de la prenda también varía ligeramente.
- **Cortes aproximados:** el generador tiene una lista cerrada. Degradado, Crop, Bob francés, Melena, ambos estilos de rizos y los colores balayage muestran lo más parecido, con aviso. Los cambios sobre cabello corto pueden ser sutiles.
- **Ropa:** solo prendas superiores, inferiores y abrigos. Solo se verificó con un abrigo. Calzado y accesorios no se ofrecen.
- **Precio:** Replicate no lo publica en la página de estos modelos; se estima con la tarifa de Black Forest Labs. Conviene confirmarlo en el saldo de la cuenta.
- **Privacidad:** Replicate informa que borra cada solicitud en una hora, y su API no permite borrarla antes. No se pudo confirmar qué hace con los datos el creador del modelo, ni si los usa para entrenar; por eso la autorización no lo promete.
- **Mayoría de edad:** es una declaración del cliente, no una comprobación.
- **Cupo:** el día cambia a las 00:00 UTC, es decir, a las 20:00 en Bolivia.
- **iOS y teléfono físico:** sin probar, igual que el resto de la aplicación móvil.

## Fase J: Agentes con Skills (CU-17, RF-11, RNF-02) (Completada)
Al revisarlo con el usuario, RF-11 resultó no estar completo, aunque la Fase H lo daba por cerrado: había un solo agente, solo consultaba, y no existían Skills.

- [x] Tres agentes sobre el mismo ciclo: operación, inventario y agenda. Se eligen en la pantalla del ERP.
- [x] Una Skill por agente en `backend/mcp-server/skills/*/SKILL.md`, con sus roles, herramientas permitidas e instrucciones. El servidor no arranca si una Skill es inválida o pide una herramienta reservada a las personas.
- [x] Nuevas herramientas MCP: `consultar_inventario`, `consultar_agenda`, `proponer_reposicion`, `proponer_reprogramacion`, `confirmar_accion` y `rechazar_accion`.
- [x] El modelo solo propone. Cada propuesta se guarda en DynamoDB (`AgentPendingActions`), es de un solo uso, vence en 30 minutos y solo la puede responder quien la pidió. Se ejecuta con su token, y cada servicio vuelve a validar su rol.
- [x] El resumen que se confirma lo arma el servidor con datos reales, no el texto del modelo.
- [x] El agente de agenda no recibe nombres ni identificadores de clientes, ni precios.
- [x] Sin modelo disponible, cada agente responde con datos reales de su tema.

**Verificación:**
- [x] Navegador real con modelo real: 14/14. El modelo elige sus herramientas, y no pudo confirmar aunque se le pidió expresamente. Confirmar aplica el cambio una vez; rechazar no cambia nada.
- [x] En vivo: 24/24, con doble confirmación, propuesta ajena, propuesta vencida y turno ocupado antes de confirmar.
- [x] Regresión: 295 pruebas de integración y 183 en navegador. `mcp-server` 64/64, `mfe-gestion` 20/20.
- [x] Datos intactos tras las pruebas; 0 mensajes muertos.

**Limitaciones conocidas:**
- **Modelo probado:** los tres agentes se verificaron con `gemini-3.1-flash-lite`, porque las pruebas agotaron el cupo gratuito diario de `gemini-2.5-flash`, el modelo por defecto. Las respuestas dependen del modelo, que puede elegir otros pasos para una misma pregunta.
- **Cupo gratuito:** 20 consultas diarias por modelo. Una sola pregunta puede usar varias, porque cada paso del agente cuenta. Al agotarse responde con datos reales, sin interpretar la pregunta.
- **Pruebas bajo memoria baja:** en un equipo con poca memoria libre, varias suites simultáneas pueden agotar sus tiempos de espera. Ocurrió con 421 MB libres: 2 archivos de integración y 2 suites de navegador tuvieron que repetirse, y pasaron sin cambios en el código.
- **La confirmación la hace quien tenga el token:** el servidor impide que el ciclo del agente confirme, pero un programa externo que use el token de una persona podría llamar a `confirmar_accion` como ella.
- **Sin iniciativa propia:** los agentes responden cuando se les pregunta; no vigilan ni actúan por su cuenta.
- **Solo en el ERP web:** los agentes no están en la aplicación móvil.
- **Cancelar citas:** el agente de agenda no cancela, porque cancelar implica reembolsos. Solo reprograma citas confirmadas.

## Fase K: Prueba de conjuntos (CU-15) (Completada)
Función adicional pedida por el usuario: probarse varias prendas a la vez en una sola imagen.

- [x] `POST /api/v1/image-generation/try-on-outfit`: de 2 a 3 prendas del propio clóset, una por categoría (superior, inferior y abrigo). Cuenta como un solo cupo diario.
- [x] Las prendas se validan antes de leer sus fotos, y todo se comprueba antes de apartar cupo o llamar al proveedor.
- [x] Web y móvil: marcar las prendas y pulsar "Probar conjunto". Elegir otra prenda del mismo tipo reemplaza a la anterior.

**Verificación:**
- [x] Antes de programar, una generación real con polera y pantalón: ambas prendas quedaron bien puestas y sin mezclarse, en unos 23 segundos.
- [x] `ms-ia`, web y móvil con el proveedor sustituido; en vivo, todos los rechazos contra los servicios reales; navegador real con el proveedor sustituido en la red.

**Limitaciones conocidas:**
- **Flujo programado sin imagen real:** por decisión del usuario, para no gastar crédito ajeno, el flujo completo de la aplicación no se ejecutó con Replicate. La instrucción de polera y pantalón es la misma de la prueba real, pero falta generar el primer conjunto desde la aplicación.
- **Abrigo:** la combinación con abrigo, y por tanto la de 3 prendas, nunca se probó con el modelo real.
- **Móvil:** verificado con pruebas de pantalla en el equipo; no se ejecutó en el emulador porque su flujo real gasta crédito.
- **Fidelidad:** una imagen en espejo se copia en espejo: una prenda con letras invertidas sale igual. Detalles como los rotos de un pantalón pueden variar.

## Fase L: Cierre de entrega (CU-06, CU-10, CU-11, CU-12, CU-16, CU-20, CU-21) (Completada)
Aprobada completa por el equipo el 7 de noviembre de 2026. Se hizo en una sola sesión, después de la Fase M.

### L1: Asegurar lo existente y empaquetar
- [x] **Regresión completa:** la de la Fase M, con integración en vivo 325/325 y nueve suites de navegador. Después de la L1 se repitieron las suites de navegador contra los frontends en contenedores.
- [x] **`README.md` en la raíz:** qué es, arquitectura, puesta en marcha, usuarios, funcionalidades, pruebas y limitaciones.
- [x] **Frontends en Docker Compose:** `frontend/Dockerfile` compila cada aplicación con Node y la sirve con nginx en su mismo puerto (`frontend/nginx.conf.template`): CORS para los remotos, `remoteEntry.js` sin caché y `/healthz` para el healthcheck. Son cuatro servicios nuevos: `shell`, `mfe-estudio-ia`, `mfe-reservas` y `mfe-gestion`.
- [x] **Manual y `start-all.ps1`:** una sola orden levanta toda la plataforma. El manual explica cómo desarrollar un microfrontend con recarga en caliente.

### L2: Reserva y pago en el móvil (CU-06, CU-10)
- [x] **Reservar:** servicio, estilista, fecha y turnos libres, solo futuros. "Mis citas" tiene **Reservar**.
- [x] **Pagar:** con el formulario oficial de Stripe (Payment Sheet, `flutter_stripe`), sobre el cobro que crea la misma SAGA de la web y con `Idempotency-Key`. Tras pagar se concilia con `/sync`, por si el aviso de Stripe tarda. La tarjeta nunca pasa por la aplicación ni por la plataforma.
- [x] **Sin conexión:** la reserva queda en la cola de SQLite. Una vez enviada, "Mis citas" muestra **Pagar** en toda cita pendiente de pago, con plazo de 15 minutos.
- [x] **Mensajes claros:** turno ocupado, pago rechazado o cancelado, y plazo vencido.

### L3: Resto de las pantallas móviles
- [x] **Comunidad (CU-20, CU-21):** muro sin publicaciones ocultas, publicar un look con foto, reacción y comentarios en cascada con respuestas. Sin conexión, reacciones y comentarios quedan en la cola.
- [x] **Cuenta (CU-11, CU-12):** saldo y movimientos de puntos, y facturas con detalle, IVA y forma de pago.
- [x] **Asesoría para redes (CU-16):** red, sector y objetivo; usa el perfil de estilo, el último diagnóstico y el clóset.
- [x] Las pestañas Mis citas, Comunidad y Cuenta se recargan al abrirse, para no mostrar datos de antes de un pago.

**Verificación:**
- [x] Navegador contra los frontends en contenedores: nueve suites con 193 comprobaciones sin fallos, con inicio de sesión, pago con Stripe, recepción, offline y Module Federation.
- [x] Móvil 60/60 (18 nuevas) y `flutter analyze` limpio. Contratos 11/11, que también validan las consultas GraphQL de las pantallas nuevas.
- [x] `integration_test/booking_real_test.dart` en el emulador contra la SAGA, Stripe y PostgreSQL reales: reserva, pago, cita `CONFIRMED`, factura y rechazo del mismo turno.
- [x] Manual en el emulador, como `camila.fernandez` con el inicio de sesión real de Keycloak: Keratina el 30 de noviembre, pago con el formulario de Stripe y la tarjeta 4242. La cita quedó `CONFIRMED` y la keratina bajó de 3 a 2. Se emitió la factura 212 con tarjeta por 95 USD y se sumaron 950 puntos. Cuenta, Comunidad (reacción y su reversión) y la asesoría para redes se vieron con datos reales. Al terminar se borró la reserva y se restituyeron stock y puntos.
- [x] La prueba en el emulador encontró dos errores, ya corregidos:
  - **Datos viejos:** las pestañas no se recargaban después de pagar.
  - **Token vencido al abrir:** al abrir la app con el token vencido, las pestañas lo renovaban a la vez y AppAuth rechazaba las renovaciones simultáneas. Ahora comparten una sola.
- [x] También apareció un dato dañado previo: la publicación semilla de la comunidad tenía los acentos rotos en MongoDB. Se corrigió en la base; el script de semillas ya estaba bien.

**Limitaciones conocidas:**
- **Canje en el móvil:** no había canje de puntos al reservar. Cerrada en la Fase N.
- **Comprobante en el móvil:** solo había detalle de la factura. Cerrada en la Fase O.
- **Hora de las facturas:** se muestra en UTC, como la entrega el CRM.
- **Cancelar desde el móvil:** no había cancelación con reembolso. Cerrada en la Fase O.
- **Teléfono físico e iOS:** sin probar, como el resto de la app.
- **Frontends compilados:** las direcciones de la API se fijan al compilar y apuntan a `localhost`, suficiente para Docker Compose local.
- **Sin integración continua.**

## Fase M: Actor Recepcionista (CU-01, CU-05, CU-06, CU-07, CU-10, CU-11, RF-01, RF-02, RF-03, RF-07, RF-08, RNF-03, RNF-04) (Completada)
Actor pedido por el usuario: personal administrativo que opera desde el ERP. Toda reserva se paga; lo presencial es el cliente que llega sin reserva y paga al agendar.

- [x] **Rol `RECEPTIONIST`** en Keycloak, con el usuario `recepcion.salon`. Sesión única en los seis servicios, igual que `ADMIN` (RF-01). `docker/keycloak/crear-recepcion.sh` lo agrega a un Keycloak ya instalado.
- [x] **Permisos:** agenda global, reprogramar, horarios de cualquier estilista, clientes, facturas y comprobantes. Sin inventario, métricas, moderación, agentes ni registro de estilistas. Tampoco puede agendar sin cobro (`scheduleAppointment`).
- [x] **Mostrador:** `POST /counter/bookings` inicia la misma SAGA que una reserva en línea, con canal `COUNTER` y `Idempotency-Key`. Aparta turno e insumos y espera el cobro sin crear un pago en Stripe. `POST .../pay` confirma el cobro (paso pivote) y `POST .../void` anula la atención, que se compensa como un pago rechazado. Si nadie cobra en 15 minutos, vence sola.
- [x] **Factura** con la forma de pago real: tarjeta en línea, efectivo o tarjeta en el terminal. El comprobante la muestra y los puntos se acumulan igual que en línea.
- [x] **Llegada y ausencia:** `checkInAppointment` solo el día de la cita, y `markNoShow` desde la hora de inicio y sin llegada registrada. La ausencia (`NO_SHOW`) libera el turno y no se reembolsa; un cliente que ya llegó no puede cancelar con reembolso ni reprogramar.
- [x] **ERP:** pestañas por rol; la recepción entra directo a la Agenda. En la barra del Shell solo ve el ERP, sin el Estudio IA ni las Reservas del cliente, y el Shell no descarga esos módulos para ella. La pestaña **Mostrador** busca o registra al cliente, ofrece solo turnos futuros, calcula el cambio y abre el comprobante. La Agenda tiene **Llegó** y **No asistió**.
- [x] **Migración** `09_recepcion.sql`, más el estado `NO_SHOW` en `03` y la vista recreada en `06`, porque todas las migraciones se repiten en cada arranque.
- [x] La etiqueta "No asistió" también aparece en el portal del cliente y en el móvil, que además mostraba en crudo `PENDING_PAYMENT`.

**Verificación:**
- [x] Unitarias e integración por servicio: orquestador 47/47 (16 nuevas), `ms-gestion` 77/77 con Testcontainers (9 nuevas), CRM 54/54 (4 nuevas), `ms-ia` 180/180, `ms-asesoria` en seguridad 12/12, MCP 64/64, ERP 37/37 (17 nuevas), Shell 15/15, portal de reservas 11/11 y `flutter analyze` limpio en la pantalla tocada.
- [x] `tests/integration/test_fase_m_recepcion_live.py`, 21/21 contra los servicios reales: sesión única en los seis servicios, permisos, cobro en efectivo con descuento de insumos, factura, puntos y comprobante, cobro repetido sin duplicar, anulación, misma llave sin doble reserva, turno ocupado, llegada, ausencia y migraciones repetidas con ausencias registradas.
- [x] `tests/e2e/recepcion.e2e.mjs`, 16/16 en navegador real: entra directo al ERP, registra llegada y ausencia, cobra en efectivo con cambio y comprobante, y anula.
- [x] Regresión: integración en vivo 325/325 y navegador sin la suite de agentes. Nueve suites de navegador, 193 comprobaciones sin fallos; `ms-asesoria` completa 87/87.
- [x] Las pruebas encontraron tres errores, ya corregidos: un reinicio habría fallado con una ausencia registrada, porque `03` restauraba la lista de estados sin `NO_SHOW`; anular en el mostrador no mostraba el resultado; y la hora de llegada se leía distinta en la respuesta y en la base.

**Limitaciones conocidas:**
- **Sin terminal real:** "tarjeta en el terminal" se registra al confirmar el cobro; no hay integración con un datáfono.
- **Fuera de alcance, por decisión del usuario:** venta de productos en el mostrador y apertura y cierre de caja.
- **Sin canje de puntos en el mostrador:** el cliente acumula puntos, pero no puede pagar con ellos en caja.
- **Reembolso en caja:** cancelar una reserva cobrada en el mostrador emite la nota de crédito, pero el dinero se devuelve en caja, sin registro de quién lo entregó.
- **Fecha de llegada:** el ERP compara el día con el reloj del navegador; debe estar en la hora del salón.
- **Ausencia manual:** nadie la marca automáticamente; si la recepción no lo hace, la cita queda pendiente.
- **Keycloak ya instalado:** no recibe el rol nuevo desde el realm; hay que ejecutar `crear-recepcion.sh`.
- **Agentes:** la recepción no usa los agentes del ERP, y la suite de navegador de agentes no se repitió en esta fase.

## Fase N: Móvil a la par de la web (CU-02, CU-10, CU-12) (Completada)
Aprobada por el usuario el 8 de noviembre de 2026, mientras consigue las credenciales de Meta para WhatsApp.

- [x] **Cerrar sesión en el servidor (CU-02):** el móvil hace lo mismo que la web. Primero revoca la sesión en los servicios (`POST /auth/logout`) y después la cierra en Keycloak con el refresh token, sin abrir el navegador. Sin conexión borra la sesión del teléfono y lo avisa: el token vence solo en minutos.
- [x] **Sesión terminada en otro lugar:** si un servicio responde 401, la app olvida la sesión y pide iniciarla de nuevo, sin intentar revocarla.
- [x] **Canje de puntos al reservar (CU-12):** muestra el saldo y permite elegir cuántos puntos usar, o "Usar el máximo". Aplica el mismo límite que la web y el CRM: el cobro no baja de 0,50 USD. Muestra el total a pagar, y los rechazos `POINTS_INSUFFICIENT` y `POINTS_EXCEED_LIMIT` tienen su mensaje.

**Verificación:**
- [x] Móvil 69/69 (9 nuevas) y `flutter analyze` limpio.
- [x] En el emulador, como `camila.fernandez`, con los servicios y Stripe reales:
  - **Reserva con canje:** Keratina de 95 USD con 500 puntos; el formulario de Stripe cobró 90 USD. La factura 213 salió con subtotal 95, descuento 5 y total 90. Se canjearon 500 puntos y se sumaron 900, solo por lo pagado.
  - **Cierre de sesión:** la sesión del móvil desapareció de Keycloak y su `sid` quedó revocado en DynamoDB.
  - Al terminar se borró la reserva y se restituyeron stock y puntos.

**Limitaciones conocidas:**
- **Canje sin conexión:** la reserva guardada en la cola lleva los puntos elegidos, y la SAGA los valida al enviarse. Si el saldo cambió mientras tanto, se rechaza con su mensaje.
- **Sin conexión al cerrar sesión:** no se puede revocar la sesión; el token vence solo en 5 minutos.

## Fase O: Móvil completo (CU-07, CU-11) (Completada)
Pedida por el usuario el 8 de noviembre de 2026 para que el móvil no dependa de la web en nada.

- [x] **Comprobante imprimible (CU-11):** en el detalle de la factura, **Imprimir o guardar PDF** arma el comprobante con los mismos datos que el de la web y abre el diálogo de impresión de Android, desde el que también se guarda el PDF. Una factura reembolsada aparece como anulada. Se usa el paquete `pdf`, porque la conversión de HTML de `printing` está obsoleta.
- [x] **Cancelar con reembolso (CU-07):** una cita pagada, vigente y futura se cancela por la misma SAGA de la web (`POST /bookings/{sagaId}/cancel`), y la app espera el reembolso. Si el salón la rechaza (ya comenzó, el cliente ya llegó o no se puede cancelar), se explica el motivo. Una cita sin pago en línea se cancela en `ms-gestion`.
- [x] **Reprogramar (CU-07):** también faltaba en el móvil. Muestra los turnos futuros del mismo estilista y servicio, empezando por el día de la cita, sin cambiar el cobro.

**Verificación:**
- [x] Móvil 77/77 (8 nuevas) y `flutter analyze` limpio. Contratos 11/11 con las consultas nuevas.
- [x] En el emulador, como `camila.fernandez`, con los servicios y Stripe reales: reserva de Keratina pagada con el formulario de Stripe y reprogramada de las 10:00 a las 14:00, con estado `RESCHEDULED`. El comprobante 214 se abrió en el diálogo de impresión con todos sus datos. Al cancelar, la SAGA pasó de `COMPLETED` a `REFUNDED` con el reembolso de Stripe. La cita quedó cancelada y la keratina volvió a 3. La factura quedó reembolsada, con la nota de crédito 70 por 95 USD, y se revirtieron los 950 puntos. Al terminar se borraron los registros de la prueba.
- [x] La prueba mostró que reprogramar empezaba en el día de hoy y no en el de la cita. Ya está corregido.

**Sin conexión (ampliación pedida por el usuario):**
- [x] **Imprimir** funciona sin red: el PDF se arma en el teléfono con la copia guardada de la factura. Antes se había declarado, por error, que requería conexión.
- [x] **Cancelar y reprogramar** quedan en la cola local con su `Idempotency-Key` y se envían al volver la red. Reprogramar usa los turnos ya vistos ese día; si no hay copia, se elige la hora a mano. La cita muestra "Cancelación pendiente" o "Reprogramación pendiente" y oculta sus acciones, para no pedir dos veces.
- [x] **La cola detecta los rechazos de GraphQL:** GraphQL responde 200 aunque la operación falle, y la cola los daba por hechos. Ahora quedan como conflicto con su mensaje, también si la respuesta trae bytes mal codificados.
- [x] **Verificación:** móvil 83/83 (6 nuevas). En el emulador, con la red cortada (sin túneles de `adb`):
  - **Reprogramar:** se reprogramó usando los turnos guardados; al volver la red, el servidor la dejó a las 14:00.
  - **Imprimir:** el comprobante 215 se imprimió sin red.
  - **Cancelar:** la cita pagada se canceló sin red. Al volver la red, la SAGA llegó a `REFUNDED` con el reembolso de Stripe, se emitió la nota de crédito 71 y volvieron el stock y los puntos.
  - Al terminar se borraron los registros de la prueba.

**Limitaciones conocidas:**
- **Validación sin conexión:** el salón valida al recibir el cambio. Si la cita ya empezó o el turno se ocupó mientras tanto, la operación aparece como conflicto en la cola y la cita no cambia.
- **Hora elegida a mano:** sin copia de los turnos, no se puede saber si está libre hasta enviarla.
- **Comprobante del móvil:** se arma en el teléfono con los datos del CRM, sin la referencia del pago de Stripe, que GraphQL no expone.

## Fase P: Despliegue en tres nubes (RNF-01, RNF-02, RNF-04) (Completada)
Aprobada el 8 de noviembre de 2026: el docente exige AWS, Azure y Google Cloud. El diseño, los pasos y lo que falta verificar están en [DESPLIEGUE_MULTICLOUD.md](DESPLIEGUE_MULTICLOUD.md).

**Distribución:** AWS aloja Keycloak, `ms-gestion`, MCP, RDS y DynamoDB. Azure aloja el CRM, su worker, el orquestador, n8n y su PostgreSQL. Google Cloud aloja `ms-asesoria`, `ms-ia` y los cuatro frontends. MongoDB va en Atlas y RabbitMQ en CloudAMQP.

**Cambios de código (hechos):**
- [x] **Firma SigV4 de DynamoDB en los seis servicios,** sin SDK, con las credenciales del entorno. Sin ellas se usan las de relleno, así que DynamoDB Local sigue igual.
- [x] **RabbitMQ con TLS y vhost** en el worker del CRM y en la credencial de n8n.
- [x] **Direcciones de los frontends al compilar:** argumentos `VITE_*` del Dockerfile. El ERP en Angular las recibe con `--define`.
- [x] **Móvil:** una dirección por servicio con `--dart-define`.
- [x] **Keycloak:** realm con variables (portal, secreto del agente y `sslRequired`) e imagen de producción en `deploy/keycloak`.
- [x] **Migraciones en dos servidores PostgreSQL** (AWS y Azure) y base de n8n.
- [x] **Guiones** `deploy/aws`, `deploy/azure`, `deploy/gcp` y `deploy/base-de-datos.sh`, más una simulación sin cuentas en `deploy/simulacion`.

**Verificación en local:**
- [x] **Firma:** los seis servicios coinciden con tres vectores calculados con botocore, el SDK oficial; uno es el ejemplo de la documentación de AWS. Suites: orquestador 51, MCP 68, `ms-asesoria` 91, CRM 58, `ms-gestion` 81 y `ms-ia` 184.
- [x] **Integración en vivo contra DynamoDB Local con los servicios reconstruidos:** 324 de 327 en la primera corrida. Las 3 restantes se debían a un mensaje muerto de hacía 14 horas, de una corrida anterior; tras vaciar la cola, pasaron. Con el worker y n8n nuevos, n8n, CRM y SAGA dieron 75/75.
- [x] **Keycloak:**
  - Con un Keycloak desechable, el realm toma las variables y, sin ellas, los valores locales.
  - La imagen de producción arrancó contra una base desechable, con emisor `https://auth...`, salud en el puerto 9000 y caché local. Las bases de prueba se borraron.
- [x] **ERP compilado con una dirección de prueba:** la incluye. Sin argumentos sigue en localhost. ERP 37/37.
- [x] **Migraciones:** el guion nuevo corrió en local, también con la base de n8n, que luego se borró.
- [x] **Guiones:** los cinco pasos corren completos con CLI simuladas, con 222 llamadas. La simulación encontró un error: la lista de subredes de Fargate iba separada por tabuladores. Ya está corregido.

**Despliegue real (9 de noviembre de 2026):**
- [x] **Cuentas:** AWS, Azure for Students, Google Cloud, Atlas, CloudAMQP y el dominio `salon-ai.beauty` (Porkbun). Las cuentas impusieron las regiones: AWS en Ohio (`us-east-2`) y Azure en Toronto (`canadacentral`). Ver la sección 1 de [DESPLIEGUE_MULTICLOUD.md](DESPLIEGUE_MULTICLOUD.md).
- [x] **Los cinco pasos corrieron contra las nubes reales.** Aparecieron seis fallos que la simulación no podía ver, y se corrigieron en los guiones:
  - Azure: proveedores sin registrar, un parámetro nuevo de su CLI y la imposibilidad de reiniciar revisiones.
  - Git Bash: la conversión de rutas y el arranque de `gcloud`.
  - El `\r` de `aws.exe`, que arruinaba las claves de DynamoDB.

  La simulación sigue pasando los cinco pasos.
- [x] **Webhook de Stripe** registrado hacia el orquestador en Azure; rechaza una firma falsa.
- [x] **Contraseñas de demostración** cambiadas con `deploy/keycloak/cambiar-claves-demo.sh`: la del manual ya no entra y la nueva sí.

**Verificación en vivo contra la nube:**
- [x] **Web** (https://salon-sw2-app.web.app): inicio de sesión del administrador, con sesión única en los seis servicios, y de una clienta. Los tres microfrontends cargan con datos reales y sin errores de red ni de consola; la clienta ve solo sus dos pestañas. La sesión única consulta DynamoDB desde Azure y Google: **la firma SigV4 funciona contra AWS real**.
- [x] **Reserva con pago** (Stripe en modo prueba), hecha por una persona en el navegador. La SAGA llegó a `COMPLETED` pasando por las tres nubes. El aviso de pago repetido se ignoró. El CRM emitió la factura (120 USD) y acreditó 1200 puntos, comprobados en la base de Azure.
- [x] **Móvil** compilado contra la nube (APK debug) en el emulador:
  - el inicio de sesión abre el Keycloak de la nube con el tema del salón;
  - el diagnóstico carga desde Google;
  - "Mis citas" muestra las dos reservas confirmadas, desde AWS;
  - "Cuenta" muestra 1800 puntos y las dos facturas, desde Azure.
- [x] **RNF-01:** la consulta real del resumen del panel, repetida 30 veces desde Bolivia contra `ms-gestion` en Ohio, dio una mediana de 162 ms y un **p95 de 170 ms**, red incluida. Hubo un valor aislado de 457 ms.

**Limitaciones conocidas:**
- **No probado en la nube:**
  - los agentes con Gemini, por el cupo diario;
  - n8n con WhatsApp: el webhook de Meta sigue en el túnel local, y el envío real (CU-19) depende de Meta;
  - la generación de imágenes, para no gastar crédito de Replicate.
- **Suites automáticas:** apuntan a localhost; en la nube se probó con un navegador automatizado y a mano.
- **APK release:** `flutter build apk --release` falló en Gradle tras 8 minutos y no se investigó; el APK debug sí funciona. iOS sigue sin compilar.
- **Atlas abierto:** acepta cualquier IP (con TLS y contraseña), salvo que se agregue Cloud NAT con IP fija.
- **Costo:** `ms-ia` siempre encendido, el balanceador y Fargate cobran aunque nadie use la plataforma. Hay que borrar los recursos después de la entrega.

## Fase Q: Diseño de salón de belleza (web y móvil) (Completada)
Pedida por el usuario el 8 de noviembre de 2026: la interfaz parecía un panel de IA. Eligió el estilo "rosa empolvado" para la web y el móvil.

- [x] **Paleta común** en los cuatro frontends y en Flutter (`lib/core/salon_theme.dart`):
  - Colores: fondo crema #FBF6F2, tarjetas blancas, botón principal rosa vino #9E6066, rosa empolvado #C98B8B en los detalles y dorado #8C6A3F en los precios.
  - Contraste de los textos de al menos 4,5:1; el texto tenue llega a 3,8:1.
  - Letras: Playfair Display en los títulos (con números alineados) y Lato en el texto. El móvil usa la serif del sistema para no agregar dependencias.
- [x] **Sin aspecto de demostración técnica:**
  - Se quitaron las etiquetas de React, Vue y Angular, el lema "B2B2C" y el pie "Dark Luxury Theme".
  - Los títulos ya no muestran códigos de casos de uso. "Agente MCP" pasó a llamarse "Asistentes".
  - El rol se muestra en español.
- [x] **Componentes:**
  - Pestañas subrayadas en rosa y turnos en forma de pastilla.
  - El avance de la reserva se ve como una línea de tiempo.
  - Botón de archivo y campos de formulario con el tema.
  - Formulario de tarjeta de Stripe con los colores del salón.
- [x] **Se conservaron todos los identificadores y clases:** las pruebas siguen funcionando. Se actualizaron tres textos esperados: el rol en español, las pestañas de Estudio y "Asistentes".

**Verificación:**
- [x] **Unitarias:** Shell 18, Estudio 38, Reservas 11, ERP 37 y móvil 83. `flutter analyze` limpio.
- [x] **Navegador:** seguridad, reservas, fecha de reserva, recepción, Fase F (51 comprobaciones), Fase G, perfil, imágenes y modo sin conexión: todas correctas. Fase F falló una vez por una espera de 20 s y pasó en las dos corridas siguientes. Las pruebas no dejaron datos.
- [x] **Capturas** de Estudio, Comunidad, Reservas y ERP, y del móvil en el emulador. Con ellas se corrigieron:
  - los números de estilo antiguo de Playfair;
  - el marco doble alrededor de cada sección;
  - el ícono activo de la barra móvil, que salía blanco sobre rosa claro.

**Ampliación pedida por el usuario el 8 de noviembre de 2026:**
- [x] **Inicio de sesión de Keycloak con el diseño del salón y en español:**
  - Tema `salon` (`docker/keycloak/themes/salon`), que hereda `keycloak.v2` y cambia sus variables de PatternFly.
  - Está montado en Compose y copiado en la imagen de producción.
- [x] **Ícono de la app (tijeras rosa vino sobre rosa empolvado) y pantalla de inicio crema.** Son vectores, sin imágenes nuevas. La pantalla de inicio de sesión del móvil también usa la paleta.
- [x] **Sesión del móvil que no vence:**
  - La app pide un token offline (`offline_access`): no depende de la sesión de 8 horas de la web.
  - El realm permite 10 años sin uso, sin máximo. En la práctica dura hasta cerrar sesión.
  - Las cuentas de demostración reciben solo el rol `offline_access`. No reciben `default-roles-salon`, que incluye `CLIENT`.
  - Si Keycloak rechaza la renovación (`invalid_grant`), la app vuelve a su pantalla de inicio en lugar de mostrar errores 401. Un fallo de red no cierra la sesión.
- [x] **Para una instalación ya existente:** `docker/keycloak/actualizar-realm.sh` aplica tema, idioma, duración y rol sin borrar el realm.

**Verificación de la ampliación:**
- [x] **En el emulador, como `camila.fernandez`:**
  - Keycloak registró la sesión offline del móvil.
  - Se borraron las sesiones normales, como al vencer las 8 horas, y se esperaron 6 minutos para que venciera el token. "Mis citas" cargó sin pedir la contraseña.
  - Al cerrar sesión, la sesión offline desapareció del servidor.
- [x] **Primera prueba descartada:** "Cerrar sesión" del usuario en la consola de Keycloak también invalida el token del teléfono ("Stale token"). Ahí la app volvió a su pantalla de inicio con "Tu sesión terminó", que es lo esperado ante una revocación.
- [x] **Móvil:** 85/85 (2 nuevas) y `flutter analyze` limpio.
- [x] **Inicio de sesión:** capturas en escritorio y en el teléfono, también con contraseña incorrecta.
- [x] **Integración en vivo:** 327/327, todas pasan por el inicio de sesión de Keycloak. **Navegador:** las 9 suites correctas (sin la de agentes, que gasta cupo de Gemini). La de seguridad se cayó una vez justo después de la integración y pasó al repetirla. Las pruebas no dejaron datos.

**Limitaciones conocidas:**
- **Teléfono perdido:** como la sesión del móvil no vence, si se pierde el teléfono hay que cerrarla desde la consola de Keycloak.
- **Versiones antiguas de Android:** antes de Android 8 se ve el ícono anterior, porque no admiten íconos adaptables.
- **Pantallas no revisadas:** las que requieren datos o pasos especiales (pago con Stripe, cámara, simulación de imágenes) se revisaron solo con las pruebas, sin captura.

## Fase R: Reportes dinámicos en Excel y PDF (CU-17, CU-18, RF-11, RNF-02) (Completada)
Aprobada el 9 de noviembre de 2026, a partir de los modelos de examen: los reportes deben pedirse por prompt, texto o audio, eligiendo columnas, criterios y formato Excel o PDF, con agentes conectados a la base de datos.

- [x] **Herramientas MCP `catalogo_reportes` y `generar_reporte`** (`backend/mcp-server/src/reports.js`): seis entidades (citas, facturas, inventario, movimientos de inventario, puntos y clientes), columnas, filtros, periodo, agrupación con totales y archivo Excel (exceljs) o PDF (pdfkit). Solo la administración.
- [x] **Conectadas a la base de datos sin romper RNF-02:** el Servidor MCP consulta PostgreSQL con `salon_reportes`, un usuario de **solo lectura** que solo ve las tablas del catálogo (`10_reportes_gestion.sql` y `11_reportes_crm.sql`), en una transacción de solo lectura con tiempo máximo. Las columnas y las tablas salen del catálogo y lo que escribe la persona viaja como parámetro. El agente nunca toca la base: pide el reporte por la herramienta.
- [x] **Cuarto agente, "Reportes"** (`skills/reportes/SKILL.md`): convierte la petición en los parámetros. Al modelo solo le llegan los totales, nunca filas con datos de clientes ni el archivo.
- [x] **Pestaña Reportes en el ERP:** con palabras (texto o voz con Whisper) o con un formulario; vista previa, totales y descarga.

**Verificación:**
- [x] MCP 80/80 (12 nuevas: catálogo cerrado, inyección como parámetro, filtros en español, agrupación, Excel y PDF válidos, lo que ve el modelo). ERP 43/43 (6 nuevas).
- [x] En vivo, `test_fase_r_reportes_live.py` 9/9: cada reporte coincide con la base, un intento de inyección no cambia nada, la estilista recibe 403 y el usuario de reportes no puede escribir.
- [x] Navegador, `reportes.e2e.mjs`: Excel y PDF descargados y comparados con la base; la estilista no ve la pestaña. Las E2E anteriores del ERP (`fase_f`, `recepcion` y `seguridad`) siguen pasando.
- [x] Con Gemini, una sola consulta: «Quiero un PDF con las facturas de este año, solo cliente, servicio y total» dio un PDF con esas columnas y el periodo del año.
- [x] **En la nube:** facturas (CRM en Azure) y citas (RDS en AWS) en Excel y PDF, con los totales reales.

**Red en la nube:** el CRM vive en Azure PostgreSQL, que solo acepta IP conocidas, y Fargate no tiene una IP de salida fija. El Servidor MCP corre en una **subred privada que sale por un NAT con IP elástica**, y Azure admite solo esa IP. Abrir la base a todo internet se descartó.

**Limitaciones conocidas:**
- Máximo 5 000 filas por reporte (avisa si corta) y una vista previa de 50.
- El certificado de RDS no se verifica desde Node (está firmado por la CA de Amazon): la conexión va cifrada, como el `sslmode=require` de JDBC. El de Azure sí se verifica.
- El NAT cuesta alrededor de 1 USD al día.

## Fase S: Inteligencia de negocios en Python (Completada)
Aprobada el 9 de noviembre de 2026, a partir de los modelos de examen: un dataset de miles de registros y dashboards con KPI implementados en Python.

- [x] **Dataset histórico** (`backend/bi-dashboard/generar_dataset.py`): dos años, de noviembre de 2024 a octubre de 2026, con **62 745 registros** (citas, facturas, puntos, consumo de insumos, reseñas y clientes). Parte del catálogo real y lo amplía a 12 servicios y 6 estilistas. Tiene estacionalidad, horas pico, crecimiento, cancelaciones, inasistencias y canjes. Semilla fija: siempre genera lo mismo.
- [x] **Tablero en Streamlit, pandas y Plotly:** 8 KPI comparados con el año anterior y las pestañas Ventas, Agenda, Estilistas, Clientes (con RFM), Servicios e insumos, y Datos (descarga en CSV), con filtros por periodo, estilista, categoría y canal.
- [x] **Solo la administración:** inicio de sesión con Keycloak (cliente `salon-bi`, roles en el ID token). `docker/keycloak/cliente_bi.py` lo crea en un Keycloak ya instalado.
- [x] **Enlace desde el ERP** (Reportes → Abrir el tablero).

**Verificación:**
- [x] `test_kpis.py` 5/5: tamaño y coherencia del dataset y KPI contra datos conocidos.
- [x] Navegador, `bi.e2e.mjs`: la administradora entra con Keycloak, ve los 8 KPI y recorre las pestañas sin errores; la estilista recibe el rechazo. Pasa en local y **en Cloud Run** con las contraseñas de la nube.

**Limitaciones conocidas:**
- El dataset es sintético: el salón real tiene pocos datos. El tablero no mezcla los datos en vivo.
- Cerrar sesión en el tablero no cierra la sesión de Keycloak.

## Fase T: Imágenes en Amazon S3 (CU-15, CU-20) (Completada)
Aprobada el 9 de noviembre de 2026, a partir de los modelos de examen: S3 para almacenamiento masivo.

- [x] **Adaptador S3** de `ms-asesoria` sobre el mismo puerto que GridFS (`s3-media.storage.ts`), con la API REST de S3 firmada con SigV4, sin SDK. El firmador ahora acepta contenido binario; los vectores de botocore siguen pasando.
- [x] **Bucket privado y cifrado** (AES-256, acceso público bloqueado) en Ohio, con un usuario de IAM que solo puede leer, escribir y borrar en `media/` (`aws/desplegar.sh datos`).
- [x] **Migración gradual:** una imagen anterior que no está en S3 se lee de GridFS, se copia a S3 y se borra de GridFS la primera vez que alguien la pide.
- [x] En local, sin `S3_BUCKET`, sigue GridFS (MinIO ya no publica su imagen en Docker Hub).

**Verificación:**
- [x] `ms-asesoria` 99/99 (8 nuevas: dirección, firma con el resumen del binario, migración, errores y borrado).
- [x] Contra S3 real, desde local y **desde Cloud Run**: la imagen subida quedó en el bucket, cifrada y no en GridFS, y se leyó idéntica; sin firma, S3 responde 403. Las imágenes de prueba se borraron.

**Limitaciones conocidas:**
- Las imágenes de una instalación local siguen en GridFS.
- La migración ocurre al pedir cada imagen, no de una vez.

## Fase U: Kubernetes en AWS, Azure y Google Cloud (Completada)
Aprobada el 9 de noviembre de 2026, a partir de los modelos de examen: microservicios con Docker y Kubernetes en al menos tres nubes.

- [x] **Manifiestos de toda la plataforma** en `k8s/base`: un Deployment y un Service por cada uno de los 14 microservicios, con sondas de salud, límites de recursos, contexto de seguridad y escalado automático por CPU en `ms-gestion`, `ms-asesoria` y `ms-ia`. La configuración y los secretos se generan al desplegar, fuera del repositorio.
- [x] **Overlays por nube** en `k8s/overlays` y guiones en `deploy/kubernetes`.
- [x] **EKS** (AWS) sobre Fargate: réplica de `ms-gestion` en la subred privada; arrancó, se conectó a RDS y a RabbitMQ, y `gestion.saga.commands` muestra 2 consumidores (ECS y EKS).
- [x] **GKE Autopilot** (Google): el tablero de BI corre con Ingress, IP global fija y certificado administrado para https://bi.salon-ai.beauty.
- [x] Certificado de `bi.salon-ai.beauty` emitido en 34 minutos; `bi.e2e.mjs` pasa contra GKE por HTTPS: inicio de sesión con Keycloak, 8 KPI y rechazo de la estilista.
- [x] **AKS** (Azure): worker del CRM en un nodo **ARM64** `Standard_B2pls_v2`, con la imagen compilada para ARM64. `crm.saga.events` muestra 2 consumidores (Container Apps y AKS).

**Ajustes que aparecieron al crear los clústeres:**
- Azure for Students en `canadacentral` solo permite ciertos tamaños, y todos los x86 permitidos tienen **cuota 0**. El primer intento quedó más de una hora en "Creating" sin error visible, hasta revisar el grupo de recursos de los nodos. La única familia con cuota es Bpsv2 (ARM64).
- En EKS con Fargate, CoreDNS se creó antes que el perfil de Fargate y quedó sin dónde correr: el guion lo reinicia.
- `kubectl` para GKE necesita `gke-gcloud-auth-plugin`, que gcloud no instala sin una consola interactiva si no se copia antes su Python.
- El entorno *Express* de Container Apps reutilizaba la imagen guardada de la etiqueta `latest`: ahora cada despliegue en Azure usa una etiqueta única.

**Limitaciones conocidas:**
- Cada clúster corre una parte de la plataforma, no toda: el resto sigue en Fargate, Container Apps y Cloud Run. Los manifiestos de la base cubren los 14 servicios.
- Cuestan entre 4 y 6 USD al día en total: hay que borrarlos después de la entrega.

## Fase V: Notificaciones push en el móvil (CU-19, RF-12) (Completada)
Aprobada el 9 de noviembre de 2026, a partir de los modelos de examen: el móvil debe tener notificaciones push.

- [x] **Firebase Cloud Messaging:** la app Android está registrada en el proyecto de Firebase (`deploy/firebase/push.sh`). `google-services.json` no está en el repositorio, y sin él la app compila igual, sin push.
- [x] **Móvil** (`lib/core/push/push_service.dart`): al iniciar sesión pide el permiso (Android 13 o superior), registra el token en el CRM y lo renueva si Firebase lo cambia. Al cerrar sesión lo da de baja. Con la app abierta, el push se muestra en pantalla.
- [x] **CRM:** tabla `push_devices` (`12_push_crm.sql`) y mutaciones `registerPushToken` y `unregisterPushToken`. Cada aviso **nuevo** de `RecordNoticesUseCase` (pago confirmado, reembolso, stock crítico, publicación oculta, automatizaciones) se envía también por push con la API HTTP v1 de FCM: un JWT firmado con RS256, sin SDK. Un evento repetido no se notifica dos veces, un token inválido se olvida y, si FCM falla, el aviso igual queda en la app.
- [x] Pruebas: CRM 66/66 (8 nuevas), móvil 85/85, contratos GraphQL 11/11; mutaciones probadas en vivo en local.
- [x] Cuenta de servicio de envío `salon-fcm`, solo con el rol de enviar mensajes de FCM: la creó a mano la persona dueña del proyecto (`deploy/firebase/cuenta-envio.sh`), porque otorga un permiso y genera una clave. `azure/desplegar.sh` se la entrega al CRM como secreto.
- [x] **En un teléfono real** (Moto g77, app de la nube): el token quedó registrado en el CRM de Azure, y los avisos llegaron con la app abierta (aviso en pantalla) y en segundo plano (barra de notificaciones).
- [x] Canal "Avisos del salón" de importancia alta, creado por la app y usado por cada push.

**Limitaciones conocidas:**
- En el Moto g77 el push no apareció flotando arriba de la pantalla, aunque el canal es de importancia alta: depende del ajuste de notificaciones emergentes del teléfono.
- Solo Android: iOS necesita una cuenta de Apple y macOS.
- El token usa `getToken`, que firebase_messaging 17 marca como obsoleto a favor del identificador de instalación, con otro modo de envío.

## Fase W: ERP 100 % GraphQL (Completada)
Aprobada el 9 de noviembre de 2026, a partir de los modelos de examen: la aplicación de gestión empresarial debe usar GraphQL en un 100 %.

- [x] **Puerta GraphQL en `ms-gestion`** (patrón *Backend for Frontend*, `graphql/erp.graphqls`):
  - la moderación (asesoría);
  - el cobro en el mostrador (orquestador);
  - el comprobante (CRM);
  - la voz (ms-ia);
  - las herramientas MCP.

  `ms-gestion` reenvía cada operación con el token de la persona, así que cada servicio vuelve a validar el rol. Los errores llegan con el mensaje real del servicio.
- [x] **El ERP tiene un solo `fetch`**, hacia dos API GraphQL: gestión y CRM. Se quitaron de su configuración las direcciones REST.
- [x] Pruebas: `ms-gestion` 88/88 (7 nuevas, contra un servidor HTTP real en memoria); ERP 46/46; contratos GraphQL 11/11. E2E `fase_f`, `recepcion`, `reportes`, `fase_g` (voz del administrador) y `seguridad` en verde. **En la nube**, el ERP funciona y un agente respondió por la puerta.
- [x] Error encontrado al probar: el cliente HTTP de Java intentaba subir a HTTP/2, y uvicorn (ms-ia) rechazaba esa petición cuando llevaba el audio. Ahora la puerta usa HTTP/1.1, y una prueba lo comprueba.
- [x] El balanceador de AWS espera 300 s, en lugar de 60, por las preguntas largas a los agentes.

## Fase X: IA con un modelo de lenguaje local (Completada)
Aprobada el 9 de noviembre de 2026, a partir de los modelos de examen: la IA debe funcionar con modelos locales, sin servicios públicos.

- [x] **Ollama con Qwen 2.5 de 3B**, en Docker Compose (`ollama`) y en Cloud Run (`salon-llm`: 8 vCPU, 16 GB, siempre encendido). En la nube, la imagen trae el modelo incluido y un nginx delante que exige una clave (`deploy/ollama`). Sin clave responde 401, y solo expone `/api/chat`.
- [x] **Agentes y reportes** (`mcp-server/src/ollama.js`): traduce el ciclo del agente entre el formato de Gemini y el de Ollama. Gemini queda como respaldo si el modelo local no responde.
- [x] **Textos de marca personal** (`ms-ia/app/adapters/ollama.py`): con salida JSON por esquema, y Gemini y las plantillas como respaldo.
- [x] Pruebas: MCP 87/87 (7 nuevas), `ms-ia` 189/189 (5 nuevas). En local, los agentes de inventario, operación y reportes eligieron bien su herramienta: 139 s la primera respuesta, mientras carga el modelo, y de 28 a 39 s las siguientes. **En la nube**, el agente de inventario respondió con el modelo local en 25 s, por la puerta GraphQL.

**Limitaciones conocidas:**
- Un modelo de 3B en CPU es más lento y menos preciso que Gemini: en una prueba mezcló "ingresos cobrados" con "sin pagos".
- La simulación de cortes y ropa sigue en Replicate: un modelo de difusión en CPU no es práctico.
- `salon-llm` siempre encendido cuesta unos 15 USD al día de crédito de Google: hay que borrarlo después de la entrega.

## Fase Y: Historial de operación y prendas de demostración (Completada)
Aprobada el 10 de noviembre de 2026: las cuentas de demostración partían casi vacías y los agentes y reportes tenían poco que mostrar. El dataset del BI (CSV) solo lo lee el tablero.

- [x] **Un año de historial** (10 de noviembre de 2025 al 4 de noviembre de 2026) con el catálogo real: 3 servicios y 3 estilistas. Lo genera `docker/historial/generar_historial.py` con una semilla fija:
  - 1 712 citas: 1 508 atendidas, 143 canceladas y 61 con inasistencia;
  - 40 clientes nuevos, con teléfonos ficticios a propósito;
  - 1 712 facturas con IVA del 13 %, 143 notas de crédito y 2 395 movimientos de puntos (canjes, acumulación y reversiones);
  - 825 reseñas;
  - 1 918 movimientos de inventario.

  Camila tiene 38 citas, casi todas con Valentina, y Alejandro tiene 17. Las dos cuentas conservan su saldo real y suman el del historial.
- [x] **Coherente con el sistema:**
  - Usa los mismos textos y reglas que la SAGA: «Consumo por cita confirmada», «Devolución por cita cancelada», 10 puntos por dólar y canje de hasta el 30 % del precio.
  - El saldo de puntos de cada cliente coincide con su libro de movimientos y nunca queda negativo.
  - La cadena de movimientos de inventario termina en el stock real de hoy: el stock actual no cambia.
  - Ninguna cita choca con otra real: si alguna chocara, la carga se deshace entera.
- [x] **Sin efectos externos:** se inserta directamente en las bases, sin pasar por la SAGA: no cobra con Stripe ni envía WhatsApp ni push. Todo lleva el prefijo `hist-`. Una segunda carga se rechaza, y `limpiar_*.sql` lo borra todo y devuelve los saldos originales (probado en local).
- [x] **Clóset:** 13 prendas con foto para Camila (partes de arriba y de abajo, abrigo, calzado y accesorios) y 17 de hombre para Alejandro: 11 propias y 6 unisex. Después se sumaron 2 prendas para Camila y 5 para Alejandro (37 en total).
- [x] **Comunidad:** 23 publicaciones con foto en el muro (`cargar_comunidad.mjs`), con comentarios, respuestas y reacciones:
  - Valentina, como estilista, publica trabajos del salón e inspiración retro;
  - Camila y Alejandro publican sus looks y comentan.

  Se crean por la API real con la sesión de cada cuenta, así que el autor sale del token. Las fotos son CC0 o de dominio público, con su fuente en `docker/historial/comunidad/CREDITOS.md`.
- [x] **S3 en la nube:** el bucket guarda 60 fotos (5,2 MB), contadas con `aws s3 ls --summarize`. `bash deploy/historial.sh fotos` repite solo esta parte, sin duplicar nada. Las fotos son CC0 o de dominio público, de Openverse, reducidas a menos de 1 MP; la fuente de cada una está en `docker/historial/prendas/CREDITOS.md`. Se suben por la API real (`cargar_prendas.mjs`, con inicio de sesión PKCE), así que en la nube quedan en S3.
- [x] **En la nube** (`bash deploy/historial.sh cargar|verificar|limpiar`): RDS y Azure con los mismos totales que en local. En la web, Camila ve su historial en «Mis citas» y sus 14 prendas, y Alejandro sus 17 (las 17 fotos responden desde S3); las estilistas muestran su calificación con las reseñas (Valentina: 4,6 con 277).
- [x] **Agentes en la nube, con el modelo local:**
  - el de operación resumió los ingresos y las citas del último mes en 41 s;
  - el de reportes generó «facturas de octubre agrupadas por servicio, en PDF» en 49 s.
- [x] Error encontrado al probar: un reporte agrupado sumaba el número de factura, que es un identificador. Ahora se excluye de sumas y totales. MCP 87/87, con la prueba ampliada; desplegado en AWS.
- [x] Las suites de navegador pasan con el historial cargado. `fase_f`, `fase_g` y `seguridad` fallaron alguna vez por tiempo: el agente local en CPU llegó a tardar más de un minuto con la máquina cargada, y una espera fija de 1,5 s no alcanzó. Al repetirlas, `fase_f` y `seguridad` pasaron.

- [x] Error encontrado por el usuario: una reserva en la nube envió el WhatsApp, pero no el push. El worker del CRM en AKS, que procesa la mitad de los eventos de la SAGA, no tenía la cuenta de FCM: guardaba el aviso en la app y omitía el push sin error. `deploy/kubernetes/azure.sh` ahora se la pasa; aplicada en AKS y comprobada dentro del pod.

**Limitaciones conocidas:**
- **Fechas:** el historial termina el 4 de noviembre de 2026: «este mes» y «esta semana» muestran pocos datos del historial.
- **Datos sintéticos:** no coinciden con el dataset del BI, que tiene 12 servicios y 6 estilistas.
- **Calidad del modelo local:** el de 3B a veces mezcla las cifras al resumirlas.
- **`fase_g`:** el agente por voz y la recomendación de corte pueden pasar del tiempo de espera de la prueba con la máquina cargada.

## WhatsApp con la cuenta de Meta (CU-19, RF-12) (Completada)
El 8 de noviembre de 2026 se conectó la app de Meta de un compañero del usuario.

- [x] Variables en `.env`, cargadas en n8n, y el webhook expuesto con un túnel de `cloudflared`.
- [x] **Webhook verificado por Meta:** n8n devuelve el desafío solo con el `WHATSAPP_VERIFY_TOKEN` correcto.
- [x] **Mensaje de prueba recibido:** el mensaje de prueba del panel llegó y se procesó. La respuesta falló con el error 131030 de Meta, porque el remitente de prueba es ficticio y no está en la lista de destinatarios; es lo esperado.
- [x] **Firma de Meta:** el flujo entrante comprueba `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET` y descarta lo que no esté firmado o esté firmado con otra clave. Las pruebas en vivo firman sus mensajes como Meta y usan su propia configuración, sin heredar la cuenta real del `.env`. Pasaron 24/24, 2 de ellas nuevas. Con la configuración real, un aviso sin firma enviado por el túnel se descartó antes de responder.
- [x] **Envío real (9 de noviembre de 2026), con las plantillas aprobadas:** una reserva pagada en la nube por la clienta de prueba, con su teléfono y su autorización en "Mi perfil", recibió la confirmación por WhatsApp. n8n corre en Azure con dirección fija: ya no hace falta el túnel.
- [x] Error encontrado en la nube: con TLS, la credencial de RabbitMQ de n8n usaba por defecto un certificado de cliente (SASL EXTERNAL), que CloudAMQP no admite, y ningún flujo se activaba. Ahora la credencial indica `"passwordless": false`.
- [x] Los avisos de stock dicen el nombre del insumo, y no su código, en la app, en el push y por WhatsApp.

**Limitaciones conocidas:**
- **App sin publicar:** las respuestas de clientes reales no llegan, solo las pruebas del panel. Publicarla requiere, entre otras cosas, una política de privacidad.
- **Lista de destinatarios:** solo se puede escribir a los números agregados en ella.

---

## Matriz de Avance por Caso de Uso

Estado actualizado al cierre de cada fase. ✅ completo y verificado en vivo. 🟡 hay lógica real, pero incompleta o sin conectar. ❌ falta o está simulada.

| CU | Descripción | Estado | Fase |
| :---: | :--- | :---: | :---: |
| CU-01 | Autenticar usuario (SSO y sesión única) | ✅ (web y móvil; sesión única para administración y recepción) | B, H, M |
| CU-02 | Cerrar sesión activa | ✅ (web y móvil) | B, N |
| CU-03 | Registrar cliente | ✅ | E, F |
| CU-04 | Registrar o modificar estilista | ✅ (sin crear cuenta de acceso) | C |
| CU-05 | Horarios y disponibilidad | ✅ (también la recepción) | C, M |
| CU-06 | Agendar cita | ✅ (web, móvil y mostrador) | D, L, M |
| CU-07 | Reprogramar o cancelar cita | ✅ (web y móvil, con reembolso; llegada y ausencia en recepción) | D, E, F, M, O |
| CU-08 | Registrar inventario | ✅ | C |
| CU-09 | Actualizar stock mínimo | ✅ | C |
| CU-10 | Reserva y pago (SAGA e idempotencia) | ✅ (Stripe en web y móvil, o cobro en el mostrador) | D, L, M |
| CU-11 | Emitir factura | ✅ (sin validez fiscal; con la forma de pago; comprobante imprimible en web y móvil) | E, F, L, M, O |
| CU-12 | Puntos de fidelidad | ✅ (web y móvil, con canje) | E, F, L, N |
| CU-13 | Escaneo capilar y facial | ✅ (web y Android; offline con fotos) | G, H |
| CU-14 | Recomendaciones | ✅ (con simulación en imagen) | G, I |
| CU-15 | Armario virtual | ✅ (con prueba de ropa en imagen; fotos en S3) | F, I, T |
| CU-16 | Asesoría para redes sociales | ✅ (web y móvil) | G, L |
| CU-17 | Métricas por agente (MCP) | ✅ (cuatro agentes con Skills; cambios con confirmación de una persona) | F, H, J, R |
| CU-18 | Reportes por lenguaje natural | ✅ (texto, voz o formulario; columnas, criterios, agrupación y Excel o PDF) | F, G, R |
| CU-19 | Recordatorios y reservas por WhatsApp | ✅ (envío real de la confirmación en la nube; app de Meta sin publicar: solo a números de la lista de prueba; también push en el móvil) | H, V |
| CU-20 | Publicar look | ✅ (web y móvil; fotos en S3) | F, L, T |
| CU-21 | Reaccionar y comentar | ✅ (web y móvil) | F, L |
| CU-22 | Sincronizar cola offline | ✅ (web y Android) | H |
