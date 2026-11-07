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

Las fases A a K están completadas y la Fase L está aprobada, sin empezar. Último cambio: prueba de conjuntos de ropa (Fase K).

Según la matriz del ROADMAP, 21 de 22 casos de uso están completos, varios con salvedades. El único incompleto es CU-19, porque el envío real por WhatsApp no se probó.

| Parte | Estructura | Dónde |
| :--- | :--- | :--- |
| `ms-gestion` | Spring Boot, DDD, PostgreSQL, GraphQL | `backend/ms-gestion` |
| `ms-asesoria` | NestJS, Hexagonal, MongoDB, REST | `backend/ms-asesoria` |
| `ms-crm` y su worker | Laravel, Clean Architecture, PostgreSQL, GraphQL | `backend/ms-crm` |
| `ms-ia` | FastAPI, MediaPipe, TFLite, Whisper | `backend/ms-ia` |
| Servidor MCP y agentes | Node.js, Skills en `skills/<agente>/SKILL.md` | `backend/mcp-server` |
| Orquestador SAGA | Node.js, RabbitMQ, Stripe en modo prueba | `backend/saga-orchestrator` |
| Web | Shell (React), Angular (ERP), React (Estudio IA), Vue (Reservas) | `frontend/` |
| Móvil | Flutter, SQLite, TFLite | `mobile/salon_mobile` |
| Automatización | n8n | `docker/n8n/workflows` |

## Qué falta

**Tu tarea es la Fase L de [ROADMAP.md](ROADMAP.md).** El equipo ya la aprobó completa, así que puedes empezarla sin volver a pedir aprobación. Nada de ella se ha implementado todavía. Las fases siguientes sí requieren aprobación.

- **L1:** regresión completa, `README.md` y frontends en Docker Compose.
- **L2:** reservar y pagar desde el móvil (CU-06, CU-10). Es lo más importante del móvil, porque es el flujo central.
- **L3:** comunidad, facturas y puntos, y asesoría para redes en el móvil.

El detalle y los criterios de aceptación están en el ROADMAP. Hazla en ese orden. Si no alcanza el tiempo, recorta L3 y avisa con antelación.

**Queda fuera, y se declara como limitación:**
- **WhatsApp real (CU-19):** requiere cuenta de Meta, dirección pública y plantillas aprobadas. Hoy se prueba con un servidor local que imita a Meta.
- **iOS:** requiere macOS y nunca se compiló.
- **Teléfono físico y captura con cámara del móvil:** sin probar; se usó un emulador con fotos.
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
- **Solo para operar con clientes reales (en Docker Compose local no hace falta):** `php -S` como servidor web, llamadas a DynamoDB sin firma SigV4, secretos de desarrollo en el realm y facturas sin validez fiscal.

## Primer arranque en otro equipo

1. Instala Docker Desktop y Node.js 22 o superior. Para el móvil, Flutter y Android Studio.
2. Crea `.env` con `Copy-Item .env.example .env`. **No uses `-Force`** si ya tienes uno.
3. Agrega las claves. Crea tus propias claves de prueba de Stripe (obligatorias: el orquestador no arranca sin ellas) y de Gemini, según el manual. Replicate es opcional: sin clave, solo se desactiva la simulación de imágenes. Si necesitas la del proyecto, pídela al equipo por un canal privado, nunca por el repositorio.
4. Ejecuta `.\start-all.ps1`. La primera construcción de `ms-ia` descarga unos 1,5 GB.
5. Abre http://localhost:3000. Los usuarios están en el manual, sección 6.

Tu base de datos parte de las semillas del proyecto, no de los datos de otro integrante, así que tu clóset no tendrá sus prendas ni sus fotos.

## Pruebas

Los comandos de cada suite están en el manual, sección 7. Últimos conteos: `ms-ia` 179, `mfe-estudio-ia` 38, móvil 42, `mcp-server` 64, `mfe-gestion` 20.

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

**Backend**
- Las pruebas de `ms-ia` corren dentro de su imagen, porque MediaPipe no existe para Python 3.13. El `.venv` solo sirve para `tests/integration`.
- Las versiones de IA están acopladas: mediapipe 0.10.21 exige numpy<2, por eso se usa opencv-contrib 4.10. No las subas sueltas.
- Un test cuya carpeta no coincide con su paquete deja clases rotas en `target/`: usa `mvn clean test`.
- Testcontainers en Java exige 1.21.4 o superior con Docker 29.
- Laravel se mantiene en la versión 12; Composer bloquea la 11 por avisos de seguridad.
- La colección del clóset en Mongo es `virtual_closet_items`.

**Replicate**
- Rechaza el User-Agent por defecto de urllib (error 1010): usa uno propio.
- Con menos de 5 dólares de crédito admite 6 peticiones por minuto, con ráfaga de 1.
- `flux-2-max` cobra por megapíxel redondeado hacia arriba en cada imagen: mantén las fotos bajo 1 MP.
- `change-haircut` solo acepta una lista cerrada de cortes y colores.

**Frontend**
- `position: fixed` queda atrapado por el `backdrop-filter` del Shell: las ventanas modales de un microfrontend van con portal a `document.body`.
- Ya no hay iframes: las pruebas E2E usan `page.locator('#mfe-root')`.
- `route.fulfill` de Playwright no sirve aquí, porque Chrome bloquea el acceso a localhost desde esa respuesta: usa `route.continue` hacia un servidor local.

**Windows**
- Dos procesos pueden escuchar en el mismo puerto: un `ng serve` puede arrancar "bien" y no saberse cuál responde.
- En scripts de Bash, un heredoc muy largo puede fallar: escribe los archivos con la herramienta de escritura.
- Una expresión regular con barras no sobrevive a `docker exec` desde Node: un borrado devolvió 0 sin error.

**Android**
- `sdkmanager` y `avdmanager` parten los `;` de los paquetes: usa `--package_file`.
- `JAVA_HOME` debe ser el JBR de Android Studio.
- `adb reverse` sigue funcionando sin wifi: para simular falta de red, quita el túnel.
- `android:taskAffinity=""` rompe la vuelta del login con AppAuth.
- `flutter test` en emulador desinstala la app al terminar. Las fotos de prueba se sirven por `adb reverse`, nunca dentro de la app.
- Gradle suma cerca de 1 GB y queda activo después de compilar.

## Decisiones que no se deben revertir sin preguntar

- **Pago real en modo prueba:** Stripe, no un simulador.
- **Agentes:** nunca tocan una base de datos; todo pasa por MCP con token y rol (RNF-02). Cualquier cambio de datos requiere que una persona pulse **Confirmar**. `confirmar_accion` y `rechazar_accion` no pueden estar en una Skill.
- **Fotos:** no se guardan ni la foto ni el resultado de la simulación. Requiere autorización propia (`image_generation_consents`), distinta de la biométrica. Al proveedor solo se envían imágenes y opciones cerradas, nunca el nombre ni texto del cliente.
- **Cupo de imágenes:** 5 por cliente y 30 por salón al día, en DynamoDB. Si el cupo no se puede comprobar, no se genera.
- **Puntos:** 10 por dólar, y cada punto vale 0,01 dólares.

## Avisos sobre el repositorio

- El equipo podría borrar y recrear el repositorio en GitHub para eliminar un commit antiguo. Si tu clon deja de coincidir con `main`, vuelve a clonarlo, y antes guarda tu trabajo como parche.
- Los identificadores de commit anteriores al 7 de noviembre cambiaron al limpiar el correo. El código y las fechas son los mismos.
