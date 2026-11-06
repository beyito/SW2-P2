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
| **C** | Catálogo, receta de insumos, estilistas, horarios y stock mínimo | Sáb 7 | Pendiente de aprobación |
| **D** | Reserva y pago real: SAGA, Stripe e idempotencia | Sáb 7 - Dom 8 | Pendiente |
| **E** | CRM: Laravel, GraphQL, factura, puntos, canje y reembolso | Dom 8 | Pendiente |
| **F** | Frontends y MCP con datos reales, perfil, reseñas, avisos y moderación | Dom 8 - Lun 9 | Pendiente |
| **G** | IA real y consentimiento biométrico | Lun 9 | Pendiente |
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

## Fase C: Catálogo e Inventario (CU-04, CU-05, CU-08, CU-09, RF-02, RF-03)
- [ ] Catálogo de servicios con precio y duración definidos en el servidor.
- [ ] Receta de insumos por servicio y registro de movimientos en `inventory_logs`.
- [ ] Estilistas y horarios: CRUD y resolvers faltantes (`getStylistAvailability`, `getStylistSchedules`).
- [ ] Validar horario laboral, fechas pasadas y solapes (también al reprogramar); evitar doble reserva concurrente.
- [ ] Mutación para cambiar el stock mínimo y errores GraphQL semánticos.

**Aceptación:** una cita calcula en el backend su precio y sus insumos; dos reservas simultáneas no pueden ocupar el mismo turno.

## Fase D: Reserva y Pago Real (CU-06, CU-07, CU-10, RF-07, RNF-03, RNF-04)
- [ ] Orquestador SAGA como servicio con estado persistente y consumidores RabbitMQ reales.
- [ ] Stripe en modo prueba como paso pivote, detrás de un adaptador, con webhooks.
- [ ] Compensaciones reales de turno e inventario.
- [ ] Idempotencia atómica en DynamoDB con verificación del hash del payload (422 si difiere).
- [ ] Checkout Vue conectado, sin simulaciones.

**Aceptación:** un pago rechazado libera el turno y el stock; un reintento con la misma llave no cobra dos veces.

## Fase E: CRM (CU-03, CU-11, CU-12, RF-08)
- [ ] `ms-crm` sobre Laravel real con API GraphQL, conservando Clean Architecture.
- [ ] Factura y puntos disparados por el evento de pago, con registro en `loyalty_transactions`.
- [ ] Canje de puntos, reembolso y nota de crédito.

**Aceptación:** un pago genera factura y puntos; un reembolso los revierte.

## Fase F: Frontends y MCP (CU-15, CU-17, CU-20, CU-21, RF-09, RF-11)
- [ ] Angular real para el ERP; React conectado a `ms-asesoria`.
- [ ] Portal "Mis citas / Mis facturas", reseñas de estilistas y avisos en la aplicación.
- [ ] Comunidad: subida de imágenes, comentarios en cascada, like atómico y moderación.
- [ ] Servidor MCP con el protocolo estándar y herramientas que consultan los servicios reales.
- [ ] DataLoader y Read Model para el panel empresarial (RNF-01).

**Aceptación:** ninguna pantalla ni herramienta MCP usa datos fijos.

## Fase G: IA Real (CU-13, CU-14, CU-16, CU-18, RF-04, RF-05, RF-06)
- [ ] Consentimiento biométrico, política de retención y borrado de datos.
- [ ] Análisis real de imagen y video de 3 a 5 segundos con MediaPipe y TensorFlow; error 422 si no hay rostro.
- [ ] Recomendador con Scikit-Learn; marca personal que use el perfil del cliente.
- [ ] Reportes por voz con Whisper y modelo de Gemini vigente.

**Aceptación:** una imagen sin rostro se rechaza; los datos biométricos se pueden borrar.

## Fase H: Cierre (CU-19, CU-22, RF-10, RF-12)
- [ ] Flujos n8n desplegados y disparados por eventos reales.
- [ ] Offline web (IndexedDB) y móvil (plataformas Android/iOS, TFLite, sincronización automática e idempotente).
- [ ] Module Federation en el Shell.
- [ ] Testcontainers, pruebas de frontend y de contrato, y certificación final.

---

## Matriz de Avance por Caso de Uso

Estado actualizado al cierre de cada fase. ✅ completo y verificado en vivo. 🟡 hay lógica real, pero incompleta o sin conectar. ❌ falta o está simulada.

| CU | Descripción | Estado | Fase |
| :---: | :--- | :---: | :---: |
| CU-01 | Autenticar usuario (SSO y sesión única) | ✅ (web) | B |
| CU-02 | Cerrar sesión activa | ✅ (web) | B |
| CU-03 | Registrar cliente | 🟡 | E |
| CU-04 | Registrar o modificar estilista | ❌ | C |
| CU-05 | Horarios y disponibilidad | ❌ | C |
| CU-06 | Agendar cita | 🟡 | C, D |
| CU-07 | Reprogramar o cancelar cita | 🟡 | C, D |
| CU-08 | Registrar inventario | 🟡 | C |
| CU-09 | Actualizar stock mínimo | ❌ | C |
| CU-10 | Reserva y pago (SAGA e idempotencia) | ❌ | D |
| CU-11 | Emitir factura | 🟡 | E |
| CU-12 | Puntos de fidelidad | 🟡 | E |
| CU-13 | Escaneo capilar y facial | ❌ | G |
| CU-14 | Recomendaciones | 🟡 | G |
| CU-15 | Armario virtual | 🟡 | F |
| CU-16 | Asesoría para redes sociales | 🟡 | G |
| CU-17 | Métricas por agente (MCP) | ❌ | F |
| CU-18 | Reportes por lenguaje natural | ❌ | G |
| CU-19 | Recordatorios por WhatsApp (n8n) | ❌ | H |
| CU-20 | Publicar look | 🟡 | F |
| CU-21 | Reaccionar y comentar | 🟡 | F |
| CU-22 | Sincronización offline | 🟡 | H |
