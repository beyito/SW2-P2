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

Los clientes nuevos pueden registrarse desde la pantalla de login. La consola de Keycloak está en http://localhost:8080, con las credenciales `KEYCLOAK_ADMIN_USER` y `KEYCLOAK_ADMIN_PASSWORD` del `.env`.

> **Cambios en el realm:** `docker/keycloak/salon-realm.json` solo se importa si el realm `salon` aún no existe. Para aplicar cambios, elimine el realm desde la consola y ejecute `docker compose restart keycloak`.

> **Instalación anterior a la recepción:** si su Keycloak ya existía, no tiene el rol `RECEPTIONIST` ni el usuario `recepcion.salon`. Créelos sin borrar el realm, con:
>
> ```powershell
> docker cp docker/keycloak/crear-recepcion.sh salon-keycloak:/tmp/crear-recepcion.sh
> docker exec salon-keycloak sh /tmp/crear-recepcion.sh
> ```
>
> El script se puede repetir: lo que ya existe no se duplica.

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
cd backend\saga-orchestrator; npm test

# Frontends (Vitest): shell, mfe-estudio-ia, mfe-reservas y mfe-gestion
cd frontend\shell; npm test

# Móvil
cd mobile\salon_mobile; flutter test

# Pruebas en vivo y de contrato contra todos los servicios (requieren el entorno levantado)
# El entorno virtual se crea una vez: python -m venv backend\ms-ia\.venv; pip install httpx pyjwt[crypto] pytest graphql-core
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

Sin credenciales, los recordatorios y las confirmaciones llegan como avisos dentro de la aplicación. Para enviarlos de verdad, cree una app en [Meta for Developers](https://developers.facebook.com/), defina en `.env` las variables `WHATSAPP_*` de `.env.example` y ejecute `docker compose up -d n8n`. El cliente debe autorizarlo en "Mi perfil". Para recibir respuestas, Meta debe poder llegar a `/webhook/whatsapp/entrante`, lo que requiere una dirección pública. Fuera de una conversación abierta, Meta solo admite plantillas aprobadas.

## Recepción y mostrador

La recepcionista inicia sesión y entra directo al ERP. Ve **Agenda**, **Mostrador**, **Estilistas** y **Clientes**; no ve inventario, métricas, moderación ni agentes.

- **Agenda:** el día de la cita, **Llegó** registra la llegada. Desde la hora de inicio, **No asistió** marca la ausencia: el turno queda libre y el pago no se devuelve. Un cliente que ya llegó no puede cancelar con reembolso.
- **Mostrador**, para un cliente que llega sin reserva: elija o registre al cliente, el servicio, el estilista y un turno libre, y la forma de pago (efectivo o tarjeta en el terminal). **Apartar turno** reserva el horario y los insumos. Cobre y pulse **Confirmar cobro**: la cita queda confirmada, se descuentan los insumos y se emiten la factura y los puntos. Si el cliente se retira, **Anular** libera todo. Si nadie confirma el cobro en 15 minutos, la reserva vence sola.
- **Estilistas:** puede configurar el horario de cualquier estilista, pero no registrarlos ni editarlos.
- Toda reserva se paga: la recepción no puede agendar sin cobro. El administrador también puede usar el mostrador.

## Agentes del ERP

En **ERP > Agente** elija **Operación**, **Inventario** o **Agenda**, y escriba o dicte su pregunta.

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
