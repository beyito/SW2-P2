# Manual de Ejecución
## Plataforma Inteligente para Salón de Belleza y Asesoramiento de Imagen Personal

Guía para poner en marcha el entorno local. El avance real de cada funcionalidad se registra en [ROADMAP.md](ROADMAP.md).

---

## 1. Servicios y Puertos

| Capa | Servicio | Tecnología | Puerto | Verificación |
| :--- | :--- | :--- | :---: | :--- |
| Infraestructura | PostgreSQL 16 | `salon_gestion`, `salon_crm`, `salon_keycloak` | `5432` | `docker exec salon-postgres psql -U salon_admin -l` |
| Infraestructura | MongoDB 7 | `salon_asesoria` | `27017` | `docker exec salon-mongodb mongosh --quiet --eval "db.adminCommand('ping')"` |
| Infraestructura | DynamoDB Local | Sesiones e idempotencia | `8000` | `docker compose ps dynamodb-local` |
| Infraestructura | RabbitMQ 3.13 | Bus de eventos | `5672`, `15672` | http://localhost:15672 |
| Infraestructura | Keycloak 26 | SSO | `8080` | http://localhost:8080 |
| Infraestructura | n8n | Automatización | `5678` | http://localhost:5678/healthz |
| Backend | `ms-gestion` | Spring Boot, GraphQL | `8081` | http://localhost:8081/graphiql |
| Backend | `ms-asesoria` | NestJS, REST | `3100` | http://localhost:3100/community |
| Backend | `ms-crm` | Laravel, GraphQL | `8083` | http://localhost:8083/health |
| Backend | `ms-crm-worker` | Laravel, RabbitMQ | N/A | `docker compose ps ms-crm-worker` |
| Backend | `ms-ia` | FastAPI | `8002` | http://localhost:8002/docs |
| Backend | `mcp-server` | Node.js, SDK oficial de MCP (`POST /mcp`) | `4000` | http://localhost:4000/health |
| Backend | `saga-orchestrator` | Node.js, RabbitMQ, Stripe | `4100` | http://localhost:4100/health |
| Backend | `bi-dashboard` | Python, Streamlit, pandas | `8501` | http://localhost:8501 (solo administración) |
| IA | `ollama` | Modelo de lenguaje local, Qwen 2.5 de 3B | interno | `docker exec salon-ollama ollama list` |
| Frontend | `shell` | React + Vite | `3000` | http://localhost:3000 |
| Frontend | `mfe-estudio-ia` | React | `3001` | http://localhost:3001 |
| Frontend | `mfe-reservas` | Vue | `3002` | http://localhost:3002 |
| Frontend | `mfe-gestion` | Angular | `3003` | http://localhost:3003 |

---

## 2. Requisitos Previos

- Docker Desktop con Docker Compose.
- Node.js 22 o superior, solo para desarrollar los microfrontends o correr sus pruebas (Angular 21 lo exige).
- Flutter SDK, solo para el cliente móvil.

---

## 3. Configurar Variables de Entorno

Si el archivo `.env` **todavía no existe**, créelo a partir de la plantilla:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

> **Atención:** no use `Copy-Item -Force` si ya tiene un `.env`, porque sobrescribiría sus claves de Gemini y Stripe. El archivo `.env` no se versiona.

### Claves de Stripe (obligatorias)

El orquestador no arranca sin las claves de prueba. Cópielas de https://dashboard.stripe.com/test/apikeys a `STRIPE_SECRET_KEY` y `STRIPE_PUBLISHABLE_KEY`. Luego obtenga el secreto de los webhooks y guárdelo en `STRIPE_WEBHOOK_SECRET`:

```powershell
docker run --rm -e STRIPE_API_KEY=<su sk_test> stripe/stripe-cli:v1.21.8 listen --print-secret
```

**Tarjetas de prueba:** `4242 4242 4242 4242` se aprueba y `4000 0000 0000 0002` se rechaza. Use una fecha futura y cualquier CVC.

---

## 4. Inicio Rápido

Desde la raíz del proyecto:

```powershell
.\start-all.ps1
```

El script construye y levanta toda la plataforma con Docker Compose, incluidos los cuatro microfrontends, y espera a que esté `healthy`.

---

## 5. Inicio Manual

### Backend e infraestructura

```powershell
docker compose up -d --build --wait
docker compose ps -a
```

**Resultado esperado:** 17 servicios en estado `healthy`, incluidos los cuatro microfrontends, y `stripe-cli` en ejecución, que no define healthcheck. Las tareas `db-migrate`, `mongo-init` y `dynamodb-init` deben figurar como `Exited (0)`: crean bases, tablas, colecciones y semillas sin duplicarlas, y se ejecutan en cada arranque.

### Microfrontends

Compose los compila y los sirve con nginx en los puertos 3000 a 3003 (`frontend/Dockerfile`). Las direcciones de la API se fijan al compilar: después de cambiar el código, ejecute `docker compose up -d --build shell mfe-estudio-ia mfe-reservas mfe-gestion`.

Para desarrollar uno con recarga en caliente, detenga su contenedor y use el servidor de desarrollo en el mismo puerto. La primera vez, ejecute `npm install` en su carpeta.

```powershell
docker compose stop mfe-reservas
cd frontend\mfe-reservas; npm run dev   # Shell: 3000, Estudio IA: 3001, Reservas: 3002; el ERP usa npm start en el 3003
```

---

## 6. Usuarios de Prueba

Abra http://localhost:3000 e inicie sesión. Estas cuentas son solo para el entorno local.

| Usuario | Contraseña | Rol |
| :--- | :--- | :--- |
| `admin.salon` | `Admin#2026` | ADMIN (sesión única) |
| `recepcion.salon` | `Recepcion#2026` | RECEPTIONIST (sesión única) |
| `valentina.rossi` | `Estilista#2026` | STYLIST |
| `camila.fernandez` | `Cliente#2026` | CLIENT |
| `alejandro.morales` | `Cliente#2026` | CLIENT |

Los clientes nuevos pueden registrarse desde la pantalla de login. La consola de Keycloak está en http://localhost:8080, con las credenciales `KEYCLOAK_ADMIN_USER` y `KEYCLOAK_ADMIN_PASSWORD` del `.env`; si no están en el `.env`, valen los valores por defecto de `docker-compose.yml`.

**En la nube** (https://salon-sw2-app.web.app) son las mismas cuentas, pero con otras contraseñas: `deploy/keycloak/cambiar-claves-demo.sh` las cambió, porque estas son públicas. Están en `deploy/salida/cuentas-demo.env` de quien desplegó; pídalas por un canal privado. La consola de Keycloak de la nube está en https://auth.salon-ai.beauty/admin, con el usuario `admin` y la clave `KEYCLOAK_ADMIN_CLAVE` de `deploy/configuracion.env`.

> **Cambios en el realm:** `docker/keycloak/salon-realm.json` solo se importa si el realm `salon` aún no existe. Para aplicar cambios, elimine el realm desde la consola y ejecute `docker compose restart keycloak`.

> **Instalación anterior a la recepción:** si su Keycloak ya existía, no tiene el rol `RECEPTIONIST` ni el usuario `recepcion.salon`. Créelos sin borrar el realm, con:
>
> ```powershell
> docker cp docker/keycloak/crear-recepcion.sh salon-keycloak:/tmp/crear-recepcion.sh
> docker exec salon-keycloak sh /tmp/crear-recepcion.sh
> ```
>
> El script se puede repetir: lo que ya existe no se duplica.

> **Instalación anterior al diseño del salón (Fase Q):** su realm no tiene el tema de inicio de sesión, el español ni la sesión del móvil que dura hasta cerrarla. Aplíquelos sin borrar el realm, con:
>
> ```powershell
> docker compose up -d keycloak
> docker cp docker/keycloak/actualizar-realm.sh salon-keycloak:/tmp/actualizar-realm.sh
> docker exec salon-keycloak sh /tmp/actualizar-realm.sh
> ```
>
> El primer comando monta el tema. El script también da el rol `offline_access` a las cuentas de prueba: sin él, el móvil no puede iniciar sesión. Se puede repetir.

> **Instalación anterior al tablero de BI (Fase S):** su realm no tiene el cliente `salon-bi`. Créelo, sin borrar el realm, con `python docker/keycloak/cliente_bi.py`. Se puede repetir.

> **Sesión del móvil:** la app pide un token offline, así que no vence con la sesión de 8 horas de la web: dura hasta que la persona cierre sesión en el teléfono. El salón puede cerrarla antes desde la consola de Keycloak (usuario > Sesiones, o "Cerrar sesión" del usuario); entonces la app vuelve a su pantalla de inicio.

---

## 7. Pruebas

```powershell
# ms-gestion (JUnit 5, Mockito y Testcontainers): usa el socket de Docker y las migraciones del proyecto
docker run --rm -v "${PWD}:/workspace" -v maven-repo:/root/.m2 -v //var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -w /workspace/backend/ms-gestion maven:3.9-eclipse-temurin-21 mvn clean test

# ms-crm (PHPUnit y Testcontainers)
docker build --target test -t salon-ms-crm-test backend/ms-crm
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v "${PWD}/docker/postgres/migrations:/migrations:ro" --add-host host.docker.internal:host-gateway -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal salon-ms-crm-test

# ms-asesoria (Jest y Testcontainers)
cd backend\ms-asesoria; npm test

# ms-ia (PyTest): corre dentro de su imagen, porque usa los modelos reales y Python 3.11
docker compose run --rm --no-deps -v "${PWD}/backend/ms-ia/tests:/app/tests" -v "${PWD}/backend/ms-ia/training:/app/training" ms-ia python -m pytest tests

# Servidor MCP y orquestador SAGA (node:test)
cd backend\mcp-server; npm test

# Tablero de BI (PyTest): corre dentro de su imagen, con el dataset real
docker compose run --rm --no-deps bi-dashboard python -m pytest -q test_kpis.py
cd backend\saga-orchestrator; npm test

# Frontends (Vitest): shell, mfe-estudio-ia, mfe-reservas y mfe-gestion
cd frontend\shell; npm test

# Móvil
cd mobile\salon_mobile; flutter test

# Pruebas en vivo y de contrato contra todos los servicios (requieren el entorno levantado)
# El entorno virtual se crea una vez: python -m venv backend\ms-ia\.venv; pip install httpx pyjwt[crypto] pytest graphql-core openpyxl
cd tests\integration; ..\..\backend\ms-ia\.venv\Scripts\python.exe -m pytest .

# Navegador real (requieren además los cuatro microfrontends en ejecución)
cd tests\e2e; npm install; npx playwright install chromium; npm test
```

## 8. Módulos federados

El Shell carga los tres microfrontends con Module Federation, en una sola página. Cada uno debe estar en ejecución, pero uno caído solo afecta a su pestaña. Abrir `http://localhost:3001`, `3002` o `3003` por separado no sirve: el módulo necesita la sesión del Shell.

## 9. Modo sin conexión

- **Web:** con la plataforma abierta, las prendas, los comentarios, las reacciones y las solicitudes de reserva se guardan en IndexedDB y se envían al volver la conexión. Una reserva enviada debe pagarse en 15 minutos. Abrir la plataforma sin conexión no es posible, porque iniciar sesión requiere Keycloak.
- **Móvil:** ver `mobile/salon_mobile/README.md`. Puede abrirse sin conexión si ya se inició sesión.

## 10. WhatsApp

Sin credenciales, los recordatorios y las confirmaciones llegan como avisos dentro de la aplicación. Para enviarlos de verdad, cree una app en [Meta for Developers](https://developers.facebook.com/), defina en `.env` las variables `WHATSAPP_*` de `.env.example` y ejecute `docker compose up -d n8n`. El cliente debe autorizarlo en "Mi perfil" y tener su teléfono en el CRM con código de país, solo dígitos.

| Variable | De dónde sale |
| :--- | :--- |
| `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` | Panel de la app de Meta, en WhatsApp > Configuración de la API. Use un token permanente de un usuario del sistema. |
| `WHATSAPP_APP_SECRET` | Panel de la app, en Configuración > Básica > Clave secreta de la app. Con ella n8n descarta los mensajes entrantes que no firmó Meta. |
| `WHATSAPP_VERIFY_TOKEN` | Una clave que usted inventa; debe coincidir con la del webhook en Meta. |
| `WHATSAPP_ADMIN_PHONE` | Número que recibe las alertas de stock, con código de país, por ejemplo `59170000000`. |
| `WHATSAPP_TEMPLATE_*` | Nombres de las plantillas aprobadas en Meta. |
| `WHATSAPP_API_URL` | Versión de la API de Graph, por ejemplo `https://graph.facebook.com/v23.0`. |

**Plantillas.** Fuera de una conversación abierta en las últimas 24 horas, Meta solo admite plantillas aprobadas. Créelas en categoría "Utilidad" e idioma "Español" (`es`), con las variables en este orden:

| Plantilla | Variables |
| :--- | :--- |
| Confirmación | {{1}} nombre del cliente, {{2}} servicio |
| Recordatorio | {{1}} servicio, {{2}} estilista, {{3}} fecha y hora ("lunes 30 de noviembre a las 10:00") |
| Stock | {{1}} insumos en nivel crítico |

**Recibir respuestas.** Meta envía los mensajes del cliente a `/webhook/whatsapp/entrante`, y para eso necesita una dirección HTTPS pública. En un equipo local, abra un túnel y déjelo abierto:

```powershell
cloudflared tunnel --no-autoupdate --url http://localhost:5678
```

En Meta, en WhatsApp > Configuración > Webhook, ponga la dirección que muestra el túnel con `/webhook/whatsapp/entrante` al final y el mismo `WHATSAPP_VERIFY_TOKEN`; después, suscríbase al campo `messages`. La dirección de este túnel rápido cambia cada vez que se abre: es para pruebas. En producción se usa un túnel con nombre y dominio propio, o un servidor con dirección pública.

**Mientras la app de Meta no esté publicada:** solo se puede escribir a los números agregados en la lista de destinatarios (error 131030 si no está), y solo llegan los mensajes de prueba enviados desde el panel.

## Recepción y mostrador

La recepcionista inicia sesión y entra directo al ERP. Ve **Agenda**, **Mostrador**, **Estilistas** y **Clientes**; no ve inventario, métricas, moderación ni agentes.

- **Agenda:** el día de la cita, **Llegó** registra la llegada. Desde la hora de inicio, **No asistió** marca la ausencia: el turno queda libre y el pago no se devuelve. Un cliente que ya llegó no puede cancelar con reembolso.
- **Mostrador**, para un cliente que llega sin reserva: elija o registre al cliente, el servicio, el estilista y un turno libre, y la forma de pago (efectivo o tarjeta en el terminal). **Apartar turno** reserva el horario y los insumos. Cobre y pulse **Confirmar cobro**: la cita queda confirmada, se descuentan los insumos y se emiten la factura y los puntos. Si el cliente se retira, **Anular** libera todo. Si nadie confirma el cobro en 15 minutos, la reserva vence sola.
- **Estilistas:** puede configurar el horario de cualquier estilista, pero no registrarlos ni editarlos.
- Toda reserva se paga: la recepción no puede agendar sin cobro. El administrador también puede usar el mostrador.

## Historial de demostración

Un año de citas, facturas, puntos, reseñas e inventario, para que las cuentas de demostración y los agentes tengan datos (Fase Y). No pasa por la SAGA: no cobra ni envía WhatsApp. Todo lleva el prefijo `hist-`.

```powershell
# Local: cargar (se rechaza si ya está cargado)
Get-Content docker/historial/historial_gestion.sql | docker exec -i salon-postgres sh -c 'psql -q -U "$POSTGRES_USER" -d salon_gestion'
Get-Content docker/historial/historial_crm.sql | docker exec -i salon-postgres sh -c 'psql -q -U "$POSTGRES_USER" -d salon_crm'
# Prendas con foto en el clóset de Camila (ropa de mujer)
$env:CLAVE='Cliente#2026'; node docker/historial/cargar_prendas.mjs http://localhost:3000 http://localhost:3100 camila.fernandez
# Ropa de hombre en el clóset de Alejandro
$env:LISTA='prendas-hombre.json'; node docker/historial/cargar_prendas.mjs http://localhost:3000 http://localhost:3100 alejandro.morales
# Borrar: limpiar_gestion.sql y limpiar_crm.sql de la misma forma, y cargar_prendas.mjs ... --borrar
```

En la nube: `bash deploy/historial.sh cargar`, `verificar` o `limpiar`.

## IA local (Ollama)

Los agentes, los reportes por prompt y los textos de marca personal usan primero un **modelo de lenguaje local**, Qwen 2.5 de 3B, en el servicio `ollama`. Gemini queda como respaldo si el modelo no responde.

- **Primer arranque:** el modelo (1,9 GB) se descarga al volumen `salon-ollama-data`, una sola vez.
- **Velocidad:** en CPU, la primera respuesta tarda un par de minutos mientras se carga el modelo; las siguientes, entre 20 y 40 segundos.
- **Memoria:** ocupa unos 2,5 GB.
- **Sin modelo local:** sin el servicio `ollama`, todo sigue funcionando con Gemini.
- **En la nube** corre en Cloud Run (`salon-llm`) detrás de un proxy con clave: `deploy/ollama`.

## ERP: solo GraphQL

El ERP habla solo con dos API GraphQL: gestión y CRM. La moderación, el mostrador, el comprobante, la voz y los agentes pasan por la **puerta GraphQL** de `ms-gestion` (`graphql/erp.graphqls`), que los reenvía con el mismo token a la asesoría, al orquestador, al CRM, a `ms-ia` y al Servidor MCP. Las direcciones se configuran con `ASESORIA_URL`, `SAGA_URL`, `IA_URL`, `MCP_URL` y `CRM_BASE_URL`.

## Reportes e inteligencia de negocios

En **ERP > Reportes** (solo administración) se arma un reporte de citas, facturas, inventario, movimientos de inventario, puntos o clientes:

- **Con palabras:** escriba o dicte lo que necesita, por ejemplo «facturas de noviembre agrupadas por servicio, en PDF». Lo interpreta el agente de reportes (Gemini).
- **A mano:** elija la entidad, las columnas, el periodo, los criterios, la agrupación y el formato (Excel o PDF).

El Servidor MCP consulta PostgreSQL con el usuario `salon_reportes`, que solo puede leer las tablas de los reportes (`docker/postgres/migrations/10_reportes_gestion.sql` y `11_reportes_crm.sql`). Al modelo solo le llegan los totales, nunca filas con datos de clientes. Prueba en vivo: `tests/integration/test_fase_r_reportes_live.py`; en el navegador, `tests/e2e/reportes.e2e.mjs`.

El botón **Abrir el tablero** lleva al tablero de inteligencia de negocios en Python (http://localhost:8501): KPI, ventas, agenda, estilistas, clientes, servicios e insumos sobre el dataset histórico de `backend/bi-dashboard/datos` (más de 60 000 registros, de noviembre de 2024 a octubre de 2026). El dataset se regenera igual con `python backend/bi-dashboard/generar_dataset.py`. Prueba en el navegador: `tests/e2e/bi.e2e.mjs`.

## Notificaciones push

La app Android recibe por Firebase Cloud Messaging cada aviso que crea el CRM: pago confirmado, reembolso, stock crítico (a la administración), publicación oculta y recordatorios de n8n. Al iniciar sesión pide el permiso y registra el teléfono; al cerrar sesión lo da de baja.

- Hace falta `mobile/salon_mobile/android/app/google-services.json`, que descarga `deploy/firebase/push.sh` y no está en el repositorio. Sin él, la app compila y funciona igual, sin push.
- El CRM envía solo si tiene la cuenta de servicio en `FCM_CREDENTIALS_JSON`, en base64. En local se puede poner en el `.env`; en la nube la entrega `deploy/azure/desplegar.sh`.
- Para que el aviso flote arriba de la pantalla, el teléfono debe permitir las notificaciones emergentes del canal "Avisos del salón".

## Agentes del ERP

En **ERP > Asistentes** elija **Operación**, **Inventario** o **Agenda**, y escriba o dicte su pregunta. El cuarto agente, **Reportes**, está en la pestaña Reportes.

- Cada agente se define en `backend/mcp-server/skills/<agente>/SKILL.md`. Si cambia un archivo, ejecute `docker compose up -d --build mcp-server`.
- Si un agente propone reponer stock o mover una cita, no se hace ningún cambio hasta pulsar **Confirmar**. La propuesta vence en 30 minutos.
- Reponer stock solo está disponible para el administrador.
- `tests/e2e/agentes.e2e.mjs` consume cupo de Gemini: unas 10 consultas o más por corrida. Si se agota, siga las indicaciones de "Cupo de Gemini".

## Simulación de cortes y ropa

Es opcional y **de pago**. Cree un token en https://replicate.com y agréguelo a `.env`. Luego ejecute `docker compose up -d ms-ia`:

```
REPLICATE_API_KEY=su_token
```

- Sin clave, esas funciones responden que no están disponibles; el resto de la plataforma sigue igual.
- Cada cliente puede generar 5 imágenes al día y el salón 30. Se cambian con `IMAGE_GEN_DAILY_LIMIT_PER_CLIENT` e `IMAGE_GEN_DAILY_LIMIT_TOTAL`.
- Para probarse una prenda, esta debe tener una foto subida en el clóset; un enlace externo no sirve.
- Para un conjunto, marque en el clóset de 2 a 3 prendas de distinto tipo y pulse **Probar conjunto**. Cuenta como una sola imagen del cupo.
- Con menos de 5 dólares de crédito, Replicate admite pocas peticiones por minuto: si está ocupado, espere unos segundos.
- Las pruebas automáticas no gastan crédito, salvo `IMAGENES_REALES=1` en `tests/e2e/generacion_imagenes.e2e.mjs` y `mobile/salon_mobile/integration_test/image_generation_real_test.dart`, que se ejecutan a mano.
- No guarde fotos personales en el repositorio: `ROSTRO.jpeg` y `CUERPO-COMPLETO.jpeg` están excluidas en `.gitignore`.

## Diagnóstico biométrico y voz

- La cámara y el micrófono solo funcionan en `localhost` o por HTTPS, y el navegador pide permiso la primera vez.
- La primera construcción de `ms-ia` descarga unos 1,5 GB entre bibliotecas y modelos. Sus huellas se verifican: si un modelo cambia, la construcción falla.
- El clasificador de cabello ya viene en `backend/ms-ia/models/hair_type.tflite`. Para reentrenarlo, siga las instrucciones de `backend/ms-ia/training/train_hair_type.py`.

### Cupo de Gemini
El plan gratuito permite 20 consultas diarias por modelo, y cada corrida completa de pruebas gasta varias. Si se agota, los reportes y la marca personal siguen funcionando con datos reales y plantillas, y lo indican en pantalla. Para usar otro modelo con su propio cupo, defina en `.env`:

```
GEMINI_MODEL=gemini-3.1-flash-lite
```

y ejecute `docker compose up -d mcp-server ms-ia`.
