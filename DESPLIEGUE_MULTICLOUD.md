# Despliegue en tres nubes: AWS, Azure y Google Cloud

Diseño de producción pedido por el docente. Cada nube aloja un dominio del negocio con su base de datos, y las tres se comunican por HTTPS y por RabbitMQ con TLS. Ninguna base de datos se usa desde otra nube, salvo DynamoDB, que es transversal por diseño (RF-07, RNF-04).

**Estado (9 de noviembre de 2026): desplegado y funcionando en las tres nubes.** La plataforma está en **https://salon-sw2-app.web.app**. Lo verificado en vivo y lo que falta está en la sección 9.

## 1. Regiones: noreste de EE. UU. y Canadá

Se planeó todo en Virginia, pero las cuentas lo impidieron:
- **La cuenta de AWS del plan gratuito solo permite `us-east-2`.** Rechaza cualquier operación en `us-east-1`, y tampoco puede registrar dominios en Route 53.
- **Azure for Students no permite `eastus`.** Su política solo acepta `spaincentral`, `southafricanorth`, `canadacentral`, `westus` y `brazilsouth`.

| Nube | Región |
| :--- | :--- |
| AWS | `us-east-2` (Ohio) |
| Azure | `canadacentral` (Toronto) |
| Google Cloud | `us-east4` (Virginia del Norte) |
| MongoDB Atlas | AWS `us-east-1` (Virginia): el plan gratuito M0 no existe en GCP `us-east4` |
| CloudAMQP | Azure `East US` (Virginia): es otra cuenta, sin la restricción de Azure for Students |

Entre estas regiones hay de 10 a 20 ms de latencia, en lugar de 30 a 80 ms entre continentes. Validar la sesión en DynamoDB desde Google o Azure no pone en riesgo RNF-01 (panel en menos de 200 ms).

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

El entorno de Container Apps que crea Azure for Students es de tipo *Express*: no permite reiniciar revisiones. Por eso cada aplicación lleva `SECRETOS_HUELLA`, un resumen SHA-256 de sus secretos que cambia con ellos y obliga a crear una revisión nueva.

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
6. **Regiones cercanas entre sí** (Ohio, Toronto y Virginia), para que la latencia entre nubes no afecte RNF-01.
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
- **Keycloak:** el realm toma de variables la dirección del portal, el secreto del agente y `sslRequired=external`. Importa las **cuentas de demostración** del manual para poder presentar. Sus contraseñas del manual son públicas, así que `bash deploy/keycloak/cambiar-claves-demo.sh` las reemplaza en la nube y guarda las nuevas en `deploy/salida/cuentas-demo.env`, que Git ignora. Se comparten con el equipo por un canal privado.
- **Stripe:** el webhook se registra en el panel de Stripe apuntando al orquestador en Azure. `stripe-cli` es solo para desarrollo.
- **WhatsApp:** n8n con dirección fija y firma de Meta comprobada (ya implementada).

## 5. Dominio

Se usa **`salon-ai.beauty`**, comprado en Porkbun (1,54 USD el primer año, sin renovación automática). Route 53 no sirvió: la cuenta del plan gratuito no puede registrar dominios, y los créditos de AWS no pagan registros.

Porkbun crea por defecto un registro comodín (`*`) hacia su página de estacionamiento: hay que borrarlo para que los subdominios lleguen a AWS.

Se necesita **un dominio propio solo para AWS**:
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
1. **AWS** (con tarjeta). Crear un usuario de IAM `salon-despliegue` con `AdministratorAccess`, sin acceso a la consola, y una clave de acceso para la CLI. Luego `aws configure`, con la región `us-east-2`. AWS CLI ofrece instalar "skills" y un servidor MCP para asistentes de IA: no hace falta.
2. **Azure for Students** (sin tarjeta). `az login`.
3. **Google Cloud** con la prueba gratuita: un proyecto con la facturación vinculada. Si el límite de proyectos no deja crear uno, sirve reutilizar uno vacío; el que vale es su **ID**, no el nombre. Luego `gcloud auth login`, `gcloud config set project <ID>` y `firebase login`. Gemini en Firebase no hace falta.
4. **MongoDB Atlas** (plan gratuito M0, en AWS `us-east-1`): crear el clúster y el usuario, y permitir `0.0.0.0/0` en "Network Access". En `configuracion.env`, `MONGO_URI` va **entre comillas simples**, porque sin ellas Bash corta el valor en el `&`.
5. **CloudAMQP** (plan gratuito) en Azure `East US`. Al tratamiento de datos de la UE (GDPR) se responde que no.
6. **Un dominio**, en un proveedor que permita crear registros CNAME.

**Pasos:**
1. `Copy-Item deploy\configuracion.example.env deploy\configuracion.env` y completar los valores. El archivo está en `.gitignore`.
2. `bash deploy/aws/desplegar.sh datos`: DynamoDB, usuarios de IAM, RDS y ECR. Las claves generadas quedan en `deploy/salida/`, también ignorada.
3. `bash deploy/azure/desplegar.sh`: PostgreSQL, ACR, CRM, worker, orquestador y n8n.
4. `bash deploy/base-de-datos.sh`: migraciones en RDS y Azure, y colecciones en Atlas.
5. `bash deploy/aws/desplegar.sh servicios`: Keycloak, `ms-gestion` y MCP. Pide crear un CNAME para validar el certificado y, al final, los CNAME de `auth.`, `gestion.` y `mcp.`. En Porkbun, el campo "Host" lleva solo el subdominio y "Target" el valor sin el punto final.
6. `bash deploy/gcp/desplegar.sh`: asesoría, IA y los cuatro frontends. Al final muestra la dirección de la plataforma y el comando para compilar la app móvil contra la nube.
7. **Webhook de Stripe** (modo prueba): en Desarrolladores → Webhooks, agregar un destino de tipo "Punto de conexión de webhook" hacia `<SAGA_URL>/webhooks/stripe`, con los eventos `payment_intent.succeeded` y `payment_intent.payment_failed`. Copiar su secreto de firma en `STRIPE_WEBHOOK_SECRET` y volver a correr el paso 3.
8. `bash deploy/keycloak/cambiar-claves-demo.sh`: contraseñas nuevas para las cuentas de demostración.
9. Cambiar la URL del webhook de WhatsApp en Meta a `<N8N_URL>/webhook/whatsapp/entrante`.

Los guiones son idempotentes: si un paso falla, se corrige y se vuelve a correr.

**Antes de editarlos:** `bash deploy/simulacion/correr.sh </dev/null` ejecuta los cinco pasos con CLI simuladas. Detecta errores de Bash, variables faltantes y tareas de Fargate con JSON inválido, sin cuentas ni costo. No prueba que la nube acepte los comandos. Sin `</dev/null`, dentro de otro comando que tenga su propia entrada, el `aws` simulado se queda esperando.

### Ajustes que solo aparecieron contra las nubes reales

| Problema | Corrección |
| :--- | :--- |
| Una suscripción nueva de Azure no tiene registrados `Microsoft.DBforPostgreSQL` ni `Microsoft.ContainerRegistry` | El guion registra los cuatro proveedores que usa |
| Azure CLI cambió los parámetros de `firewall-rule create`: `-n` es ahora el nombre de la regla | `--server-name` para el servidor y `--name` para la regla |
| Git Bash convierte en ruta de Windows todo argumento que empieza con `/` (`/migrate.sh`, `/ecs/salon`) | `comun.sh` exporta `MSYS_NO_PATHCONV=1` y escribe las rutas propias como `C:/...`, que entienden Bash, Docker Desktop y `aws.exe` |
| Sin esa conversión, el `gcloud` de Git Bash le pasa a Python una ruta `/c/...` que no existe | `comun.sh` llama a `gcloud` con el Python que trae el SDK |
| `aws.exe` y `az.cmd` terminan sus líneas con `\r\n`: el `\r` se quedó pegado a las seis claves de DynamoDB y AWS rechazaba la firma | `guardar()` borra los `\r` y la lectura de las claves los quita |
| Los entornos *Express* de Container Apps no permiten reiniciar una revisión para aplicar un secreto nuevo | Variable `SECRETOS_HUELLA` (ver la sección 2) |

## 9. Verificación en vivo (9 de noviembre de 2026)

**Direcciones:**

| Qué | Dirección |
| :--- | :--- |
| Plataforma web | https://salon-sw2-app.web.app |
| Keycloak | https://auth.salon-ai.beauty |
| `ms-gestion` | https://gestion.salon-ai.beauty/graphql |
| MCP | https://mcp.salon-ai.beauty/mcp |
| CRM | https://salon-crm.thankfulsmoke-2167cdc2.canadacentral.azurecontainerapps.io/graphql |
| Orquestador SAGA | https://salon-saga.thankfulsmoke-2167cdc2.canadacentral.azurecontainerapps.io |
| n8n | https://salon-n8n.thankfulsmoke-2167cdc2.canadacentral.azurecontainerapps.io |
| Asesoría | https://salon-asesoria-qfdwhthkma-uk.a.run.app |
| IA | https://salon-ia-qfdwhthkma-uk.a.run.app |

**Comprobado:**
- Todos los servicios con entrada pública y los cuatro frontends responden con HTTPS válido: su ruta de salud da 200, y el CRM pide token.
- **Inicio de sesión** con el administrador (sesión única en los seis servicios) y con una clienta. Los tres microfrontends cargan con datos reales y sin ningún error de red ni de consola; la clienta ve solo sus dos pestañas. La sesión única consulta DynamoDB desde Azure y Google con firma SigV4: **la firma funciona contra AWS real**.
- **Reserva con pago de Stripe** en modo prueba, hecha por una persona en el navegador. La SAGA recorrió todos sus pasos hasta `COMPLETED`, en las tres nubes. El CRM emitió la factura de 120 USD y acreditó 1200 puntos. El aviso de pago repetido se ignoró.
- **App móvil** compilada contra la nube (APK debug), en el emulador:
  - el inicio de sesión abre el Keycloak de la nube;
  - "Mis citas" muestra las reservas confirmadas, desde AWS;
  - "Cuenta" muestra los puntos y las facturas, desde Azure.
- **RNF-01:** la consulta del resumen del panel, repetida 30 veces desde Bolivia, dio un p95 de 170 ms, red incluida.
- **Webhook de Stripe:** el orquestador rechaza una firma falsa (`INVALID_SIGNATURE`).
- **Contraseñas de demostración:** la del manual ya no entra y la nueva sí.
- **Atlas M0 y CloudAMQP gratuito** funcionan en sus regiones con las conexiones de todos los servicios.

**No verificado en la nube:**
- **Agentes (MCP con Gemini):** el servicio responde, pero no se probó una conversación, por el cupo diario de Gemini.
- **n8n y WhatsApp:** n8n arranca con sus flujos; el webhook de Meta sigue apuntando al túnel local, y el envío real (CU-19) sigue pendiente de Meta.
- **Generación de imágenes con Replicate:** no se probó, para no gastar crédito.
- **Suites automáticas contra la nube:** las suites de integración y E2E están escritas para localhost.
- **APK release:** `flutter build apk --release` falló en Gradle tras 8 minutos y no se investigó. Por eso `gcp/desplegar.sh` imprime el comando con `--debug`.
- **Rendimiento de `php -S`** en el CRM con usuarios reales concurrentes (limitación ya declarada).

**Costo:** `ms-ia` siempre encendido, el balanceador y Fargate cobran aunque nadie use la plataforma. Después de la entrega hay que borrar los recursos: el grupo `salon-rg` en Azure; el proyecto o los servicios de Cloud Run en Google; y en AWS, los servicios de ECS, el balanceador, RDS y las tablas.
