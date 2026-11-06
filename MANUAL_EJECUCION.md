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
| Backend | `ms-crm` | PHP | `8083` | http://localhost:8083/health |
| Backend | `ms-ia` | FastAPI | `8002` | http://localhost:8002/docs |
| Backend | `mcp-server` | Node.js, JSON-RPC | `4000` | http://localhost:4000/mcp/tools |
| Frontend | `shell` | React + Vite | `3000` | http://localhost:3000 |
| Frontend | `mfe-estudio-ia` | React | `3001` | http://localhost:3001 |
| Frontend | `mfe-reservas` | Vue | `3002` | http://localhost:3002 |
| Frontend | `mfe-gestion` | ERP | `3003` | http://localhost:3003 |

---

## 2. Requisitos Previos

- Docker Desktop con Docker Compose.
- Node.js 20 o superior, para los microfrontends.
- Python 3.11 o superior, para servir `mfe-gestion`.
- Flutter SDK, solo para el cliente móvil.

---

## 3. Configurar Variables de Entorno

Si el archivo `.env` **todavía no existe**, créelo a partir de la plantilla:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

> **Atención:** no use `Copy-Item -Force` si ya tiene un `.env`, porque sobrescribiría sus claves de Gemini y Stripe. El archivo `.env` no se versiona.

---

## 4. Inicio Rápido

Desde la raíz del proyecto:

```powershell
.\start-all.ps1
```

El script construye y levanta el backend con Docker Compose, espera a que esté `healthy` y abre una ventana por cada microfrontend.

---

## 5. Inicio Manual

### Backend e infraestructura

```powershell
docker compose up -d --build --wait
docker compose ps -a
```

**Resultado esperado:** 11 servicios en estado `healthy`. Las tareas `db-migrate`, `mongo-init` y `dynamodb-init` deben figurar como `Exited (0)`: crean bases, tablas, colecciones y semillas sin duplicarlas, y se ejecutan en cada arranque.

### Microfrontends

La primera vez, ejecute `npm install` en cada carpeta.

```powershell
cd frontend\shell;          npm run dev   # Puerto 3000
cd frontend\mfe-estudio-ia; npm run dev   # Puerto 3001
cd frontend\mfe-reservas;   npm run dev   # Puerto 3002
cd frontend\mfe-gestion;    python -m http.server 3003 --directory src
```

---

## 6. Usuarios de Prueba

Abra http://localhost:3000 e inicie sesión. Estas cuentas son solo para el entorno local.

| Usuario | Contraseña | Rol |
| :--- | :--- | :--- |
| `admin.salon` | `Admin#2026` | ADMIN (sesión única) |
| `valentina.rossi` | `Estilista#2026` | STYLIST |
| `camila.fernandez` | `Cliente#2026` | CLIENT |
| `alejandro.morales` | `Cliente#2026` | CLIENT |

Los clientes nuevos pueden registrarse desde la pantalla de login. La consola de Keycloak está en http://localhost:8080, con las credenciales `KEYCLOAK_ADMIN_USER` y `KEYCLOAK_ADMIN_PASSWORD` del `.env`.

> **Cambios en el realm:** `docker/keycloak/salon-realm.json` solo se importa si el realm `salon` aún no existe. Para aplicar cambios, elimine el realm desde la consola y ejecute `docker compose restart keycloak`.

---

## 7. Pruebas

```powershell
# ms-gestion (JUnit 5 + Mockito)
docker run --rm -v "${PWD}/backend/ms-gestion:/app" -v maven-repo:/root/.m2 -w /app maven:3.9-eclipse-temurin-21 mvn clean test

# ms-crm (PHPUnit)
docker run --rm -v "${PWD}/backend/ms-crm:/app" -w /app php:8.3-cli-alpine php phpunit.phar

# ms-asesoria (Jest)
cd backend\ms-asesoria; npm test

# ms-ia (PyTest): crea el entorno virtual la primera vez con python -m venv .venv
cd backend\ms-ia; .\.venv\Scripts\python.exe -m pytest tests

# Servidor MCP (node:test)
cd backend\mcp-server; npm test

# Seguridad y rendimiento en vivo: requiere el entorno levantado
cd tests\integration; ..\..\backend\ms-ia\.venv\Scripts\python.exe -m pytest .

# Navegador real: requiere además los microfrontends en ejecución
cd tests\e2e; npm install; npx playwright install chromium; npm test
```

---

## 8. Cliente Móvil

El proyecto aún no incluye las carpetas de plataforma `android/` e `ios/`, por lo que no se puede ejecutar en un dispositivo; se agregarán en la Fase H. Hoy solo admite análisis estático:

```powershell
cd mobile\salon_mobile
flutter pub get
flutter analyze
```

---

## 9. Detener el Entorno

```powershell
docker compose stop      # Detiene los contenedores y conserva los datos
docker compose down      # Elimina los contenedores y conserva los volúmenes
```

> **Atención:** `docker compose down -v` borra también todos los datos de las bases.
