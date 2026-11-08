# Despliegue en tres nubes: AWS, Azure y Google Cloud

Diseño de producción pedido por el docente. Cada nube aloja un dominio del negocio con su base de datos, y las tres se comunican por HTTPS y por RabbitMQ con TLS. Ninguna base de datos se usa desde otra nube, salvo DynamoDB, que es transversal por diseño (RF-07, RNF-04).

**Estado (8 de noviembre de 2026):** los cambios de código están hechos y probados en local; los guiones de despliegue están escritos y probados con las CLI simuladas. **Todavía no se desplegó en ninguna nube**, porque faltan las cuentas. Ver la sección 9.

## 1. Región: las tres en Virginia (EE. UU.)

| Nube | Región |
| :--- | :--- |
| AWS | `us-east-1` (Virginia del Norte) |
| Azure | `East US` (Virginia) |
| Google Cloud | `us-east4` (Virginia del Norte) |
| MongoDB Atlas | GCP `us-east4`; si el plan gratuito no la ofrece, la región de GCP más cercana en EE. UU. |
| CloudAMQP | Azure `East US` |

Las tres regiones están en la misma zona geográfica. Entre nubes hay entre 1 y 3 ms de latencia, en lugar de 30 a 80 ms entre continentes, así que validar la sesión en DynamoDB desde Google o Azure no pone en riesgo RNF-01 (panel en menos de 200 ms).

## 2. Distribución

### AWS: transacciones, identidad y datos transversales

| Componente | Servicio | Configuración |
| :--- | :--- | :--- |
| `ms-gestion` (Spring Boot) | **ECS Fargate** | 1 vCPU, 2 GiB |
| Keycloak | **ECS Fargate** | 1 vCPU, 2 GiB, modo producción con caché local (una instancia) |
| `mcp-server` | **ECS Fargate** | 0,25 vCPU, 0,5 GiB. Junto a gestión, porque los agentes la consultan más. |
| Entrada HTTPS | **Application Load Balancer** + certificado de **ACM** para `*.dominio` | Reparte por subdominio: `auth.`, `gestion.` y `mcp.` |
| PostgreSQL | **Amazon RDS** (db.t4g.micro) | Bases `salon_gestion` y `salon_keycloak` |
| Sesiones, idempotencia, cupos y acciones de agentes | **Amazon DynamoDB** (bajo demanda, con TTL en `ttl`) | `ActiveUserSessions`, `IdempotencyKeys`, `SagaInstances`, `ImageGenerationQuota` y `AgentPendingActions` |
| Secretos | **SSM Parameter Store** | Inyectados en las tareas de Fargate |
| Imágenes | **Amazon ECR** | Solo las de AWS |

### Azure: clientes, facturación, mensajería y automatización

| Componente | Servicio | Configuración |
| :--- | :--- | :--- |
| `ms-crm` (Laravel) | **Azure Container Apps** | Con HTTPS incluido en `*.azurecontainerapps.io` |
| `ms-crm-worker` | **Azure Container Apps** | Sin entrada pública, siempre 1 réplica |
| Orquestador SAGA | **Azure Container Apps** | Recibe el webhook de Stripe y las reservas |
| n8n | **Azure Container Apps** | Flujos incluidos en la imagen y datos en PostgreSQL. Dirección fija para el webhook de WhatsApp: **ya no hace falta el túnel**. |
| PostgreSQL | **Azure Database for PostgreSQL Flexible** (B1ms) | Bases `salon_crm` y `n8n` |
| Imágenes | **Azure Container Registry** (Basic) | Solo las de Azure |
| RabbitMQ | **CloudAMQP alojado en Azure `East US`** | Con TLS (`amqps`, puerto 5671), compartido por las tres nubes |

### Google Cloud: asesoría, IA y frontends

| Componente | Servicio | Configuración |
| :--- | :--- | :--- |
| `ms-asesoria` (NestJS) | **Cloud Run** | 1 vCPU, 1 GiB, de 1 a 3 instancias |
| `ms-ia` (FastAPI) | **Cloud Run** | 2 vCPU, 4 GiB, **mínimo 1 instancia** y CPU siempre asignada. Sin GPU: MediaPipe, TFLite y Whisper corren en CPU. |
| MongoDB | **MongoDB Atlas** | Comunidad, clóset, diagnósticos y fotos (GridFS) |
| Shell, Estudio IA, Reservas y ERP | **Firebase Hosting**, 4 sitios `*.web.app` | Con CORS y `remoteEntry.js` sin caché, como el nginx local |
| Secretos | **Secret Manager** | |
| Imágenes | **Artifact Registry** | Solo las de Google Cloud |

## 3. Correcciones a la recomendación original

1. **Faltaban siete componentes:** Keycloak, orquestador SAGA, MCP, n8n, worker del CRM, los cuatro frontends y el webhook de Stripe. Sin Keycloak y el orquestador no hay inicio de sesión ni pago.
2. **Azure Service Bus no es compatible.** Usa AMQP 1.0 y los servicios hablan AMQP 0-9-1 (RabbitMQ). Se mantiene RabbitMQ.
3. **RabbitMQ gestionado en lugar de un contenedor.** Container Apps no ofrece TCP público ni disco persistente sin configuración avanzada de red. CloudAMQP corre en la infraestructura de Azure, en la misma región, con TLS.
4. **Sin S3.** Las fotos ya se guardan en MongoDB (GridFS) dentro de `ms-asesoria`. Mandarlas a S3 haría que un servicio de Google escriba en AWS, y obligaría a cambiar código sin beneficio para la entrega.
5. **Sin GPU para `ms-ia`.** Encarece mucho y no acelera estos modelos. Lo que importa es tener una instancia siempre encendida: la imagen pesa 3,9 GB y el primer análisis tardaría en arrancar.
6. **Las tres regiones en Virginia,** para que la latencia entre nubes no afecte RNF-01.
7. **DynamoDB real exige firmar las llamadas con SigV4** en los seis servicios que la usan. DynamoDB Local acepta cualquier firma; AWS no.
8. **Un registro de imágenes por nube.** Azure y Google no pueden leer ECR de forma estable: su clave de acceso vence a las 12 horas.

## 4. Seguridad entre nubes

- **Todo cifrado:** HTTPS para usuarios y entre servicios; `amqps` para RabbitMQ; TLS en RDS (`sslmode=require`), Azure PostgreSQL (lo exige el servidor) y Atlas.
- **Credenciales mínimas en DynamoDB:** un usuario de IAM por servicio, con permiso solo sobre sus tablas:

  | Servicio | Tablas |
  | :--- | :--- |
  | `ms-gestion`, `ms-asesoria` | `ActiveUserSessions`, `IdempotencyKeys` |
  | `ms-crm` y su worker | `ActiveUserSessions` |
  | `ms-ia` | `ActiveUserSessions`, `ImageGenerationQuota` |
  | `mcp-server` | `ActiveUserSessions`, `AgentPendingActions` |
  | Orquestador | `ActiveUserSessions`, `IdempotencyKeys`, `SagaInstances` |

  Sus claves van al gestor de secretos de cada nube (Parameter Store, Container Apps y Secret Manager), nunca al repositorio.
- **Bases de datos:** RDS solo acepta a Fargate y la IP de quien despliega; Azure PostgreSQL, a los servicios de Azure y esa IP. Atlas debe permitir las salidas de Cloud Run: sin Cloud NAT con IP fija, queda abierto (`0.0.0.0/0`) con TLS y contraseña fuerte.
- **Keycloak:** el realm toma de variables la dirección del portal, el secreto del agente y `sslRequired=external`. Importa las **cuentas de demostración** del manual para poder presentar: **cambie sus contraseñas** en la consola de Keycloak apenas termine el despliegue.
- **Stripe:** el webhook se registra en el panel de Stripe apuntando al orquestador en Azure. `stripe-cli` es solo para desarrollo.
- **WhatsApp:** n8n con dirección fija y firma de Meta comprobada (ya implementada).

## 5. Dominio

Se necesita **un dominio propio** (unos 10 USD al año) **solo para AWS**:
- El balanceador solo tiene HTTPS con un certificado de ACM, y ACM solo emite certificados para dominios propios.
- El emisor de los tokens de Keycloak debe ser una dirección fija; si cambia, todos los servicios rechazan los tokens.

Subdominios: `auth.` (Keycloak), `gestion.` (panel) y `mcp.` (agentes). Basta con agregar registros CNAME en el proveedor del dominio; no hace falta Route 53.

Azure y Google ya dan HTTPS con direcciones fijas (`*.azurecontainerapps.io`, `*.run.app` y `*.web.app`), así que no necesitan el dominio.

## 6. Costo aproximado

Son estimaciones; hay que confirmarlas al crear los recursos.

| Nube | Mensual, encendido todo el mes | Créditos disponibles |
| :--- | :--- | :--- |
| AWS | 80 a 110 USD (Fargate, ALB y RDS) | Capa gratuita de 12 meses para RDS y DynamoDB; Fargate y ALB se cobran |
| Azure | 35 a 55 USD (Container Apps, PostgreSQL y ACR) | Azure for Students: 100 USD sin tarjeta |
| Google Cloud | 60 a 90 USD (`ms-ia` siempre encendido) | Prueba gratuita: 300 USD |
| MongoDB Atlas y CloudAMQP | 0 USD en sus planes gratuitos | — |

Para la entrega basta con unos días encendido: entre 5 y 10 USD diarios en total, casi todo cubierto por los créditos. **Hay que apagar o borrar los recursos al terminar.**

## 7. Cambios de código (hechos y probados en local)

| Cambio | Dónde | Prueba |
| :--- | :--- | :--- |
| Firma SigV4 en DynamoDB, sin SDK: credenciales de `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` y `AWS_REGION`; sin ellas, las de relleno de DynamoDB Local | Orquestador y MCP (`aws-sigv4.js`), `ms-asesoria` (`aws-sigv4.ts`), `ms-crm` (`AwsSigV4.php`), `ms-gestion` (`AwsSigV4.java`), `ms-ia` (`aws_sigv4.py`) | Los seis comparan su firma con tres vectores calculados con botocore, el SDK oficial; uno es el ejemplo de la documentación de AWS. Las suites en vivo pasan contra DynamoDB Local. |
| RabbitMQ con TLS y vhost | Worker del CRM: `RABBITMQ_SSL` y `RABBITMQ_VHOST`. n8n: `RABBIT_HOST`, `RABBIT_PORT`, `RABBIT_VHOST` y `RABBIT_SSL`. `ms-gestion` usa `SPRING_RABBITMQ_SSL_ENABLED`; el orquestador y asesoría, una URL `amqps://`. | Suites en vivo del CRM, la SAGA y n8n |
| Direcciones de los frontends al compilar | Argumentos `VITE_*` del `frontend/Dockerfile`. El ERP en Angular las recibe con `scripts/build.mjs`. | Compilación con una dirección de prueba; sin argumentos sigue en localhost |
| Una dirección por servicio en el móvil | `--dart-define` `GESTION_URL`, `CRM_URL`, `ASESORIA_URL`, `IA_URL`, `SAGA_URL` y `KEYCLOAK_ISSUER` | Análisis de Flutter |
| Realm con variables | `${SALON_PORTAL_URL}`, `${SALON_AGENT_SECRET}` y `${KC_REALM_SSL_REQUIRED}`, con los valores locales por defecto | Keycloak desechable con y sin variables |
| Keycloak de producción | `deploy/keycloak/Dockerfile`: `start --optimized`, detrás de proxy, caché local | Arranque contra una base desechable con emisor `https://auth...` |
| Migraciones en dos servidores | `docker/postgres/migrate.sh`: `GESTION_PG*` y `CRM_PG*`, y `N8N_PGDATABASE` | Corrida local con ambos grupos |

## 8. Cómo desplegar

**Requisitos en la PC:** Bash (Git Bash en Windows), Docker, Node.js 22, AWS CLI v2, Azure CLI, Google Cloud CLI y Firebase CLI (`npm i -g firebase-tools`).

**Cuentas a crear:**
1. **AWS** (con tarjeta). Iniciar sesión con `aws configure` usando un usuario administrador, no la cuenta raíz.
2. **Azure for Students** (sin tarjeta). `az login`.
3. **Google Cloud** con la prueba gratuita; crear un proyecto. `gcloud auth login` y `firebase login`.
4. **MongoDB Atlas** (plan gratuito M0): crear el clúster y el usuario, y permitir `0.0.0.0/0` en "Network Access".
5. **CloudAMQP** (plan gratuito) en Azure `East US`.
6. **Un dominio**, en cualquier proveedor.

**Pasos:**
1. `Copy-Item deploy\configuracion.example.env deploy\configuracion.env` y completar los valores. El archivo está en `.gitignore`.
2. `bash deploy/aws/desplegar.sh datos`: DynamoDB, usuarios de IAM, RDS y ECR. Las claves generadas quedan en `deploy/salida/`, también ignorada.
3. `bash deploy/azure/desplegar.sh`: PostgreSQL, ACR, CRM, worker, orquestador y n8n.
4. `bash deploy/base-de-datos.sh`: migraciones en RDS y Azure, y colecciones en Atlas.
5. `bash deploy/aws/desplegar.sh servicios`: Keycloak, `ms-gestion` y MCP. Pide crear un CNAME para validar el certificado y, al final, los CNAME de `auth.`, `gestion.` y `mcp.`.
6. `bash deploy/gcp/desplegar.sh`: asesoría, IA y los cuatro frontends. Al final muestra la dirección de la plataforma y el comando para compilar la app móvil contra la nube.
7. A mano: registrar el webhook de Stripe y volver a correr el paso 3 con `STRIPE_WEBHOOK_SECRET`; cambiar la URL del webhook de WhatsApp en Meta; cambiar las contraseñas de las cuentas de demostración en Keycloak.
8. Pruebas en vivo contra las direcciones reales, y la app móvil apuntando a ellas.

Los guiones son idempotentes: si un paso falla, se corrige y se vuelve a correr.

**Antes de editarlos:** `bash deploy/simulacion/correr.sh` ejecuta los cinco pasos con CLI simuladas. Detecta errores de Bash, variables faltantes y tareas de Fargate con JSON inválido, sin cuentas ni costo. No prueba que la nube acepte los comandos.

## 9. Qué no se verificó

- **Ningún guion corrió contra una nube real.** Solo se probaron con CLI simuladas. Es probable que el primer despliegue pida ajustes: nombres ya ocupados, cupos de la cuenta nueva o una opción que cambió en alguna CLI.
- **Planes gratuitos:** hay que confirmar que Atlas M0 y CloudAMQP gratuito existan en las regiones elegidas, y que CloudAMQP gratuito admita las conexiones de los seis servicios.
- **Rendimiento de `php -S`** en el CRM con usuarios reales concurrentes (limitación ya declarada).
- **Firma SigV4 contra AWS real:** coincide con el SDK oficial, pero solo se probó contra DynamoDB Local.
