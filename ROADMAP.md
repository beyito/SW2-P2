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

---

## Matriz de Avance por Caso de Uso

Estado actualizado al cierre de cada fase. ✅ completo y verificado en vivo. 🟡 hay lógica real, pero incompleta o sin conectar. ❌ falta o está simulada.

| CU | Descripción | Estado | Fase |
| :---: | :--- | :---: | :---: |
| CU-01 | Autenticar usuario (SSO y sesión única) | ✅ (web y móvil) | B, H |
| CU-02 | Cerrar sesión activa | ✅ (web) | B |
| CU-03 | Registrar cliente | ✅ | E, F |
| CU-04 | Registrar o modificar estilista | ✅ (sin crear cuenta de acceso) | C |
| CU-05 | Horarios y disponibilidad | ✅ | C |
| CU-06 | Agendar cita | ✅ (web) | D |
| CU-07 | Reprogramar o cancelar cita | ✅ | D, E, F |
| CU-08 | Registrar inventario | ✅ | C |
| CU-09 | Actualizar stock mínimo | ✅ | C |
| CU-10 | Reserva y pago (SAGA e idempotencia) | ✅ (web) | D |
| CU-11 | Emitir factura | ✅ (sin validez fiscal) | E, F |
| CU-12 | Puntos de fidelidad | ✅ | E, F |
| CU-13 | Escaneo capilar y facial | ✅ (web y Android; offline con fotos) | G, H |
| CU-14 | Recomendaciones | ✅ (con simulación en imagen) | G, I |
| CU-15 | Armario virtual | ✅ (con prueba de ropa en imagen) | F, I |
| CU-16 | Asesoría para redes sociales | ✅ | G |
| CU-17 | Métricas por agente (MCP) | ✅ (tres agentes con Skills; cambios con confirmación de una persona) | F, H, J |
| CU-18 | Reportes por lenguaje natural | ✅ (texto y voz) | F, G |
| CU-19 | Recordatorios y reservas por WhatsApp | 🟡 (flujos reales; envío a Meta sin probar por falta de cuenta) | H |
| CU-20 | Publicar look | ✅ | F |
| CU-21 | Reaccionar y comentar | ✅ | F |
| CU-22 | Sincronizar cola offline | ✅ (web y Android) | H |
