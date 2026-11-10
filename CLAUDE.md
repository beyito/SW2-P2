# Contexto para continuar el proyecto

Plataforma para un salón de belleza: reservas y pagos, gestión del negocio, diagnóstico con IA, clóset virtual, comunidad y agentes. Es un proyecto académico con **entrega el martes 10 de noviembre de 2026**.

Este archivo se escribió el 7 de noviembre de 2026, para que otro integrante del equipo continúe el proyecto. Resume lo que falta y lo que no se ve en el código. Puede quedar desactualizado: si contradice al código o a `ROADMAP.md`, créele a estos dos y corrígelo.

**Repositorio público:** https://github.com/beyito/SW2-P2, rama `main`.

## Qué leer y en qué orden

1. [AGENTS.md](AGENTS.md): requisitos (RF, RNF, CU) y reglas obligatorias.
2. [ROADMAP.md](ROADMAP.md): fuente de verdad del avance. Cada fase tiene sus "Limitaciones conocidas".
3. [MANUAL_EJECUCION.md](MANUAL_EJECUCION.md): puertos, arranque, usuarios de prueba y comandos de cada suite.
4. [mobile/salon_mobile/README.md](mobile/salon_mobile/README.md): ejecución de la app móvil.

## Reglas de trabajo

**Del proyecto (AGENTS.md):**
- Responde en español y comenta el código en español. No dejes código a medias ni dependencias sin usar.
- Trabaja por fases: **pide aprobación antes de empezar cada una**. Una fase cierra con pruebas en vivo, `ROADMAP.md` actualizado y un commit.
- Solo marca algo como completo si lo verificaste en vivo. Una versión antigua del ROADMAP declaraba todo terminado y la auditoría encontró 0 de 22 casos de uso completos. Si afirmaste algo que resultó falso, corrígelo de inmediato.

**Del equipo:**
- **No publiques información sensible.** El repositorio es público. Nunca subas `.env`, claves de API, ni `ROSTRO.jpeg` o `CUERPO-COMPLETO.jpeg`, que son fotos personales. Antes de cada push, revisa también el historial. No muestres valores de `.env` en pantalla.
- **No gastes crédito de Replicate sin preguntar.** Es limitado y lo paga un tercero. Las pruebas automáticas no lo gastan, salvo las que se indican más abajo.
- **Haz push solo si te lo pide la persona con quien trabajas.** Coordínense la rama y el momento, porque varias personas pueden trabajar en `main`. No reescribas su historia sin acordarlo con el equipo.
- **Publica con tu dirección privada de GitHub**, no con tu correo personal. Ya se limpió de todo el historial el correo de un integrante.
- **Antes de cerrar procesos en los puertos 3000 a 3003, revisa su línea de comandos.** Pueden ser los `npm run dev` de quien está trabajando.

## Estado actual

Las fases A a X están completadas. La Fase P desplegó la plataforma en AWS, Azure y Google Cloud, como exige el docente, el 9 de noviembre de 2026. Las fases R a V se hicieron después a partir de los modelos de examen de semestres anteriores. Son reportes en Excel y PDF, BI en Python, imágenes en S3, Kubernetes en las tres nubes, notificaciones push, el ERP 100 % GraphQL y la IA con un modelo local (Ollama). [CUMPLIMIENTO_EXAMEN.md](CUMPLIMIENTO_EXAMEN.md) responde cada pregunta con su evidencia. La web está en **https://salon-sw2-app.web.app** y Keycloak en https://auth.salon-ai.beauty. Ver [DESPLIEGUE_MULTICLOUD.md](DESPLIEGUE_MULTICLOUD.md): regiones, direcciones y lo verificado en vivo.

**Las cuentas de demostración en la nube no usan las contraseñas del manual.** Están en `deploy/salida/cuentas-demo.env`, que solo existe en la PC de quien desplegó: pídelas por un canal privado. En Docker Compose local siguen las del manual.

Roles de Keycloak: `ADMIN`, `RECEPTIONIST`, `STYLIST` y `CLIENT`. Las cuentas administrativas (`ADMIN` y `RECEPTIONIST`) tienen sesión única en los seis servicios.

Según la matriz del ROADMAP, los 22 casos de uso están completos, varios con salvedades. CU-19 se cerró con el envío real por WhatsApp en la nube; la app de Meta sigue sin publicar, así que solo escribe a los números de su lista de prueba.

| Parte | Estructura | Dónde |
| :--- | :--- | :--- |
| `ms-gestion` | Spring Boot, DDD, PostgreSQL, GraphQL | `backend/ms-gestion` |
| `ms-asesoria` | NestJS, Hexagonal, MongoDB, REST | `backend/ms-asesoria` |
| `ms-crm` y su worker | Laravel, Clean Architecture, PostgreSQL, GraphQL | `backend/ms-crm` |
| `ms-ia` | FastAPI, MediaPipe, TFLite, Whisper | `backend/ms-ia` |
| Servidor MCP y agentes | Node.js, cuatro Skills en `skills/<agente>/SKILL.md`, reportes en Excel y PDF | `backend/mcp-server` |
| Inteligencia de negocios | Python, Streamlit, pandas; dataset de 62 745 registros | `backend/bi-dashboard` |
| Kubernetes | Kustomize: base de 14 servicios y un overlay por nube | `k8s/` |
| Orquestador SAGA | Node.js, RabbitMQ, Stripe en modo prueba | `backend/saga-orchestrator` |
| Web | Shell (React), Angular (ERP), React (Estudio IA), Vue (Reservas) | `frontend/` |
| Móvil | Flutter, SQLite, TFLite | `mobile/salon_mobile` |
| Automatización | n8n | `docker/n8n/workflows` |

## Qué falta

**Nube:** está desplegada y las cuentas son de un integrante del equipo. Para volver a desplegar tras un cambio, corre de nuevo el guion de la nube que aloja ese servicio (sección 8 de `DESPLIEGUE_MULTICLOUD.md`). Los guiones son idempotentes. Antes de editarlos, corre `bash deploy/simulacion/correr.sh </dev/null`. `deploy/configuracion.env` y `deploy/salida/` tienen claves y están en `.gitignore`: nunca los subas. **Después de la entrega hay que borrar los recursos**, porque cobran aunque nadie use la plataforma.

En la nube falta probar la generación de imágenes (Replicate), para no gastar crédito. Las suites automáticas apuntan a localhost. **Los tres clústeres de Kubernetes, el NAT y el modelo local siempre encendido cuestan unos 20 USD al día**: bórralos primero después de la entrega.

Cualquier fase nueva requiere aprobación del equipo antes de empezar.

**Lo único que depende de terceros:**
- **WhatsApp (CU-19):** funciona en la nube con la app de Meta de un compañero, sin publicar: solo escribe a los números de su lista de prueba. Ver `MANUAL_EJECUCION.md`, sección "WhatsApp".

**Limitaciones declaradas en el ROADMAP:**
- **iOS:** requiere macOS y nunca se compiló.
- **Teléfono físico y cámara del móvil:** sin probar; se usó un emulador con fotos.
- **Video sin conexión en el móvil (CU-13):** sin conexión solo analiza fotos.
- **Conjuntos de ropa con el modelo real:** un integrante del equipo los probará en el móvil. No los ejecutes, porque gastan crédito. El conjunto con abrigo, y por tanto el de 3 prendas, nunca se probó con el modelo real.

## Qué se podría mejorar

Son mejoras, no requisitos. Haz estas solo después de lo anterior y con aprobación.

- **Integración continua:** no hay ningún workflow en GitHub.
- **Reembolsos:** si Stripe falla, la SAGA queda en `REFUNDING_PAYMENT` y requiere intervención manual. Solo hay reembolso total.
- **Cuentas:** registrar un estilista no le crea cuenta en Keycloak. Un cliente registrado por el personal tampoco queda vinculado a una.
- **Sesión:** un cierre hecho desde la consola de Keycloak no revoca el token hasta que vence (máximo 5 minutos).
- **Horarios:** cada estilista tiene un solo bloque por día.
- **Comunidad:** comentarios y reseñas sin paginación; las imágenes subidas y no usadas quedan huérfanas en GridFS.
- **Agentes:** responden cuando se les pregunta, pero no vigilan ni actúan por su cuenta.
- **IA:** la clase "ondulado" acierta un 60%. No se midió el comportamiento por tono de piel o etnia. Trenzas y rastas no se entrenaron.
- **Solo para operar con clientes reales (en Docker Compose local no hace falta):** `php -S` como servidor web, contraseñas de las cuentas de demostración del realm y facturas sin validez fiscal.

## Primer arranque en otro equipo

1. Instala Docker Desktop y Node.js 22 o superior. Para el móvil, Flutter y Android Studio.
2. Crea `.env` con `Copy-Item .env.example .env`. **No uses `-Force`** si ya tienes uno.
3. Agrega las claves. Crea tus propias claves de prueba de Stripe (obligatorias: el orquestador no arranca sin ellas) y de Gemini, según el manual. Replicate es opcional: sin clave, solo se desactiva la simulación de imágenes. Si necesitas la del proyecto, pídela al equipo por un canal privado, nunca por el repositorio.
4. Ejecuta `.\start-all.ps1`. La primera construcción de `ms-ia` descarga unos 1,5 GB.
5. Abre http://localhost:3000. Los usuarios están en el manual, sección 6.

Tu base de datos parte de las semillas del proyecto, no de los datos de otro integrante, así que tu clóset no tendrá sus prendas ni sus fotos.

## Pruebas

Los comandos de cada suite están en el manual, sección 7. Últimos conteos: orquestador 51, `ms-gestion` 88, CRM 67, `ms-asesoria` 99, `ms-ia` 189, `mcp-server` 87, `bi-dashboard` 5, `mfe-gestion` 46, `mfe-estudio-ia` 38, Shell 18, `mfe-reservas` 11, móvil 85, integración en vivo 336 (327 más 9 de reportes) y navegador 193 comprobaciones más `reportes.e2e.mjs` y `bi.e2e.mjs`.

**Gastan dinero o cupo:**
- **Replicate:** `IMAGENES_REALES=1` en `tests/e2e/generacion_imagenes.e2e.mjs` y `integration_test/image_generation_real_test.dart`. Nunca los ejecutes sin permiso. Las pruebas de `TestConjunto` usan una imagen dañada a propósito para detenerse antes del proveedor: mantén ese diseño.
- **Gemini:** `tests/e2e/agentes.e2e.mjs` gasta unas 10 consultas o más, y el plan gratuito da 20 al día por modelo. Para usar otro modelo sin tocar `.env`: `GEMINI_MODEL=gemini-3.1-flash-lite docker compose up -d mcp-server ms-ia`.

**Al verificar:**
- Tras cambiar un microfrontend, repite también sus E2E anteriores, no solo el nuevo.
- Después de cada corrida, revisa que no queden datos de prueba: puntos, stock, citas, Mongo. Hubo pruebas que pasaban y dejaban restos. Comprueba cuántos registros borró cada limpieza.
- Una prueba E2E no debe depender del perfil de `cli-001`: usa `perfilDePruebaVacio()` de `tests/e2e/soporte.mjs`.
- Una `ReadTimeout` con poca memoria no indica un error de código, pero repite la suite para demostrarlo.

## Trampas conocidas

**Keycloak**
- El password grant no incluye `auth_time`, y la sesión única lo necesita: prueba con authorization code + PKCE.
- Sus cookies son `Secure`, así que httpx no las envía solo en localhost.
- El realm solo se importa si no existe.

**Pagos y mensajería**
- La API de Stripe rechaza `payment_method_types`: usa `automatic_payment_methods`.
- En RabbitMQ los mensajes vencen desde la cabeza de la cola, así que la cola de espera exige un plazo único.
- Una SAGA en espera con puntos apartados los devuelve a los 15 minutos, aunque una limpieza ya haya restaurado el saldo. Deja esas SAGAs en estado terminal.
- Borrar movimientos de inventario no devuelve el stock: restitúyelo antes con la suma de `inventory_logs`.
- En `appointments`, `appointment_end` es una columna generada: no se inserta.
- **Las migraciones se ejecutan todas en cada arranque.** La lista de estados de cita y la regla de solapamiento viven en `03_catalogo_y_saga.sql`; un estado nuevo debe agregarse ahí, o el siguiente arranque falla si ya hay citas con ese estado. `panel_appointments_view` se recrea en `06` y `09`. `PersistenceContainerTest` repite las migraciones para detectarlo.
- **Keycloak ya instalado no recibe cambios del realm.** Para la recepción hay un script: `docker/keycloak/crear-recepcion.sh`; para el tema, el español y la sesión del móvil, `docker/keycloak/actualizar-realm.sh` (ver el manual).
- **Sesión del móvil:** usa un token offline (`offline_access`) que dura hasta cerrar sesión. Las cuentas necesitan el rol `offline_access`; no les des `default-roles-salon`, que incluye `CLIENT` y cambiaría al personal. "Cerrar sesión" de un usuario en la consola de Keycloak revoca también el token del teléfono (motivo "Stale token").
- **Scripts escritos desde Python en Windows:** `write_text` guarda con CRLF y `sh` falla con `set: -: invalid option`. Escribe con `newline='\n'` o corrige con `sed -i 's/\r$//'`.
- **Fechas de hoy en pruebas:** las citas se guardan en hora de Bolivia y PostgreSQL usa UTC. Después de las 20:00 en Bolivia, `CURRENT_DATE` ya es el día siguiente: calcula la fecha en hora del salón.

**Backend**
- Las pruebas de `ms-ia` corren dentro de su imagen, porque MediaPipe no existe para Python 3.13. El `.venv` solo sirve para `tests/integration`.
- Las versiones de IA están acopladas: mediapipe 0.10.21 exige numpy<2, por eso se usa opencv-contrib 4.10. No las subas sueltas.
- Un test cuya carpeta no coincide con su paquete deja clases rotas en `target/`: usa `mvn clean test`.
- Testcontainers en Java exige 1.21.4 o superior con Docker 29.
- Laravel se mantiene en la versión 12; Composer bloquea la 11 por avisos de seguridad.
- La colección del clóset en Mongo es `virtual_closet_items`.
- **Firma SigV4:** cada servicio tiene su propio firmador, sin SDK. `aws-sigv4.js` está copiado igual en el orquestador y en `mcp-server`: si cambias uno, cambia el otro. Todos se prueban con los mismos tres vectores de botocore.
- **Realm con variables:** `salon-realm.json` usa `${SALON_PORTAL_URL:...}`, `${SALON_AGENT_SECRET:...}` y `${KC_REALM_SSL_REQUIRED:...}`, con los valores locales por defecto. Los `${username}` del perfil de usuario son de Keycloak; no los toques.

**Replicate**
- Rechaza el User-Agent por defecto de urllib (error 1010): usa uno propio.
- Con menos de 5 dólares de crédito admite 6 peticiones por minuto, con ráfaga de 1.
- `flux-2-max` cobra por megapíxel redondeado hacia arriba en cada imagen: mantén las fotos bajo 1 MP.
- `change-haircut` solo acepta una lista cerrada de cortes y colores.

**Frontend**
- `position: fixed` queda atrapado por el `backdrop-filter` del Shell: las ventanas modales de un microfrontend van con portal a `document.body`.
- Ya no hay iframes: las pruebas E2E usan `page.locator('#mfe-root')`.
- **Frontends en Docker:** Compose los sirve compilados en los puertos 3000 a 3003. Para desarrollar uno, detén su contenedor (`docker compose stop shell`) antes de `npm run dev`, o el puerto estará ocupado. Tras cambiar su código, reconstrúyelo con `docker compose up -d --build <servicio>`.
- **Mutaciones sin conexión en el móvil:** usa `ApiClient.mutate`, no `send`: deja la operación en la cola si no hay red y revisa los errores de GraphQL, que llegan con HTTP 200.
- **Consultas GraphQL:** escribe cada consulta en un solo texto literal. `test_contratos_frontend.py` las extrae del código, también de los `.dart`, y las valida contra el esquema real; una consulta armada por partes la rompe.
- `route.fulfill` de Playwright no sirve aquí, porque Chrome bloquea el acceso a localhost desde esa respuesta: usa `route.continue` hacia un servidor local.

**Windows**
- Dos procesos pueden escuchar en el mismo puerto: un `ng serve` puede arrancar "bien" y no saberse cuál responde.
- En scripts de Bash, un heredoc muy largo puede fallar: escribe los archivos con la herramienta de escritura.
- Una expresión regular con barras no sobrevive a `docker exec` desde Node: un borrado devolvió 0 sin error.

**Nube**
- `aws.exe` y `az.cmd` terminan sus líneas con `\r\n`. Un `\r` pegado a una clave hace que AWS rechace la firma sin pista clara: quítalo con `tr -d '\r'`.
- Git Bash convierte en ruta de Windows los argumentos que empiezan con `/`. Los guiones lo desactivan en `comun.sh`. Si llamas a `docker run ... /script.sh` a mano, usa `MSYS_NO_PATHCONV=1`.
- La cuenta de AWS del plan gratuito solo opera en `us-east-2` y no registra dominios. Azure for Students no permite `eastus`.
- El entorno de Container Apps es *Express*: no admite `revision restart`.
- `MONGO_URI` en `configuracion.env` va entre comillas simples, por el `&`.
- Porkbun crea un CNAME comodín `*` hacia su página de estacionamiento, que tapa los subdominios.
- El entorno *Express* de Container Apps reutiliza la imagen guardada de una etiqueta repetida: `azure/desplegar.sh` etiqueta cada despliegue con una marca de tiempo. Sin eso, el CRM seguía sirviendo el esquema GraphQL viejo.
- Azure for Students en `canadacentral`: todos los tamaños x86 permitidos tienen cuota 0, y AKS queda en "Creating" sin error visible. El nodo es ARM64 (`Standard_B2pls_v2`). El error real está en el registro de actividad del grupo `MC_salon-rg_salon-aks_canadacentral`.
- El Servidor MCP corre en una subred privada con NAT (IP fija), porque Azure PostgreSQL solo admite esa IP para los reportes. No abras esa base a todo internet: el clasificador de seguridad lo bloquea, y con razón.
- La credencial de RabbitMQ de n8n necesita `"passwordless": false`: con TLS, n8n usa por defecto un certificado de cliente (SASL EXTERNAL), CloudAMQP lo rechaza y ningún flujo se activa. En local no se nota, porque va sin TLS.
- El cliente HTTP de Java (puerta del ERP en `ms-gestion`) va en HTTP/1.1: si intenta subir a HTTP/2, uvicorn (`ms-ia`) rechaza la petición cuando lleva cuerpo.
- El modelo local en la nube (`salon-llm`) está detrás de un proxy con clave: no lo publiques sin ella.
- Crear cuentas de servicio, roles o claves en la nube (por ejemplo, `deploy/firebase/cuenta-envio.sh`) lo hace a mano la persona dueña de la cuenta.
- Un heredoc dentro de un comando de Bash puede convertir una barra invertida doble en una sola, y romper el código que se edita así. Para editar archivos con barras invertidas (PHP, Bash), usa la herramienta de edición o un script en un archivo aparte.

**Android**
- `sdkmanager` y `avdmanager` parten los `;` de los paquetes: usa `--package_file`.
- `JAVA_HOME` debe ser el JBR de Android Studio.
- `adb reverse` sigue funcionando sin wifi: para simular falta de red, quita el túnel.
- `android:taskAffinity=""` rompe la vuelta del login con AppAuth.
- `flutter test` en emulador desinstala la app al terminar. Las fotos de prueba se sirven por `adb reverse`, nunca dentro de la app.
- Gradle suma cerca de 1 GB y queda activo después de compilar.
- `adb shell input text` no escribe `#`: escribe la contraseña en partes y el `#` con `input keyevent 18`.
- El emulador usa UTC: después de las 20:00 en Bolivia ya es el día siguiente.
- El formulario de pago de Stripe exige `FlutterFragmentActivity` y un tema AppCompat; están en `android/app/src/main`.

## Decisiones que no se deben revertir sin preguntar

- **Pago real en modo prueba:** Stripe, no un simulador.
- **Toda reserva se paga:** en línea con Stripe, o en el mostrador. El cobro del mostrador pasa por la misma SAGA (canal `COUNTER`), con idempotencia y compensaciones; la recepción confirma el cobro y ese es el paso pivote. No hay reservas sin pago.
- **Agentes:** nunca tocan una base de datos; todo pasa por MCP con token y rol (RNF-02). Cualquier cambio de datos requiere que una persona pulse **Confirmar**. `confirmar_accion` y `rechazar_accion` no pueden estar en una Skill.
- **Fotos:** no se guardan ni la foto ni el resultado de la simulación. Requiere autorización propia (`image_generation_consents`), distinta de la biométrica. Al proveedor solo se envían imágenes y opciones cerradas, nunca el nombre ni texto del cliente.
- **Cupo de imágenes:** 5 por cliente y 30 por salón al día, en DynamoDB. Si el cupo no se puede comprobar, no se genera.
- **Puntos:** 10 por dólar, y cada punto vale 0,01 dólares.

## Avisos sobre el repositorio

- El equipo podría borrar y recrear el repositorio en GitHub para eliminar un commit antiguo. Si tu clon deja de coincidir con `main`, vuelve a clonarlo, y antes guarda tu trabajo como parche.
- Los identificadores de commit anteriores al 7 de noviembre cambiaron al limpiar el correo. El código y las fechas son los mismos.
