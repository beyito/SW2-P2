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
| **H** | Offline, n8n, Module Federation, Testcontainers y certificación final | Lun 9 - Mar 10 | Pendiente (primera en recortarse si falta tiempo) |

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
- El chat del agente ofrece consultas predefinidas y reportes en lenguaje natural, pero el modelo aún no elige herramientas por sí mismo.
- Registrar un estilista no le crea una cuenta en Keycloak. Un cliente registrado por el personal tampoco queda vinculado a una cuenta.
- Un administrador que marca un aviso de stock como leído lo marca para todos los administradores.
- Cada estilista tiene un solo bloque de horario por día.
- La URL de la imagen de una publicación oculta sigue accesible, y una imagen subida que nunca se usa queda huérfana en GridFS.
- Los comentarios y las reseñas no tienen paginación; el muro muestra las 50 publicaciones más recientes.
- No hay pruebas unitarias de componentes de frontend (Fase H); los cubre el E2E.

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
- [x] `tests/e2e` en Chromium, contra `ng serve` real: `fase_g` 33/33 con cámara y micrófono alimentados por un video y un audio reales, `fase_f` 51/51, `reservas` 9/9, `seguridad` 14/14.
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
- El agente sigue sin elegir herramientas por sí mismo (RF-11): la voz y el texto siempre usan la herramienta de reportes.

## Fase H: Cierre (CU-19, CU-22, RF-10, RF-12)
- [ ] Flujos n8n desplegados y disparados por eventos reales.
- [ ] Offline web (IndexedDB) y móvil (plataformas Android/iOS, TFLite, sincronización automática e idempotente).
- [ ] Module Federation en el Shell.
- [ ] Testcontainers, pruebas de frontend y de contrato, y certificación final.

## Funciones propuestas (sin aprobar)
Pedidas por el usuario el 6 de noviembre. Antes de implementarlas se presentarán las opciones de IA, servicio o API para que elija, y hará falta una nueva versión de la política de datos biométricos si la foto sale hacia un tercero.
- [ ] Generar imágenes del cliente con los cortes recomendados.
- [ ] Generar imágenes del cliente con la ropa de su clóset.

---

## Matriz de Avance por Caso de Uso

Estado actualizado al cierre de cada fase. ✅ completo y verificado en vivo. 🟡 hay lógica real, pero incompleta o sin conectar. ❌ falta o está simulada.

| CU | Descripción | Estado | Fase |
| :---: | :--- | :---: | :---: |
| CU-01 | Autenticar usuario (SSO y sesión única) | ✅ (web) | B |
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
| CU-13 | Escaneo capilar y facial | ✅ (web; soporte offline en Fase H) | G, H |
| CU-14 | Recomendaciones | ✅ | G |
| CU-15 | Armario virtual | ✅ | F |
| CU-16 | Asesoría para redes sociales | ✅ | G |
| CU-17 | Métricas por agente (MCP) | ✅ (consultas predefinidas; el modelo aún no elige herramientas) | F |
| CU-18 | Reportes por lenguaje natural | ✅ (texto y voz) | F, G |
| CU-19 | Recordatorios por WhatsApp (n8n) | ❌ | H |
| CU-20 | Publicar look | ✅ | F |
| CU-21 | Reaccionar y comentar | ✅ | F |
| CU-22 | Sincronización offline | 🟡 | H |
