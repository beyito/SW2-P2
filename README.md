# Salón & IA Studio

Plataforma para un salón de belleza que une la experiencia del cliente con la gestión del negocio:
- **Para el cliente:** diagnóstico facial y capilar con IA, reservas pagadas, clóset virtual y comunidad.
- **Para el negocio:** agenda, recepción, inventario, CRM, facturación y agentes inteligentes.

Proyecto académico (Software 2, segundo parcial). El enunciado está en [AGENTS.md](AGENTS.md) y el avance verificado de cada caso de uso, en [ROADMAP.md](ROADMAP.md).

## Arquitectura

| Parte | Tecnología | Arquitectura y API |
| :--- | :--- | :--- |
| `ms-gestion` | Spring Boot, PostgreSQL | DDD, GraphQL con DataLoader y Read Model |
| `ms-asesoria` | NestJS, MongoDB | Hexagonal, REST |
| `ms-crm` | Laravel, PostgreSQL | Clean Architecture, GraphQL |
| `ms-ia` | FastAPI, MediaPipe, TFLite, Whisper | Diagnóstico, recomendaciones, voz y simulación de imágenes |
| `saga-orchestrator` | Node.js, RabbitMQ, Stripe | SAGA de reserva y pago con idempotencia en DynamoDB |
| `mcp-server` | Node.js, SDK de MCP | Tres agentes con Skills; los agentes nunca tocan una base de datos |
| Web | React (Shell y Estudio IA), Vue (Reservas), Angular (ERP) | Microfrontends con Module Federation |
| Móvil | Flutter | Android, con SQLite y TFLite para el modo sin conexión |
| Transversal | Keycloak, RabbitMQ, DynamoDB, n8n | Inicio de sesión único, eventos, sesiones y automatización |

Roles: `CLIENT`, `STYLIST`, `RECEPTIONIST` y `ADMIN`. Las cuentas administrativas tienen sesión única.

## Puesta en marcha

Requisitos: Docker Desktop. Para desarrollar los frontends, Node.js 22 o superior; para el móvil, Flutter y Android Studio.

```powershell
Copy-Item .env.example .env       # solo la primera vez
# Complete en .env las claves de prueba de Stripe (obligatorias) y de Gemini
docker compose up -d --build --wait
```

Abra http://localhost:3000. Todo corre en Docker Compose: infraestructura, microservicios y los cuatro microfrontends.

| Usuario | Contraseña | Rol |
| :--- | :--- | :--- |
| `camila.fernandez` | `Cliente#2026` | Cliente |
| `recepcion.salon` | `Recepcion#2026` | Recepción |
| `valentina.rossi` | `Estilista#2026` | Estilista |
| `admin.salon` | `Admin#2026` | Administración |

Para pagar, use la tarjeta de prueba `4242 4242 4242 4242`, con una fecha futura y cualquier CVC. Las cuentas y contraseñas son solo para el entorno local.

Puertos, variables, modo de desarrollo, app móvil y solución de problemas: [MANUAL_EJECUCION.md](MANUAL_EJECUCION.md).

## Funcionalidades principales

- **Reserva y pago:** el turno se aparta con una SAGA y se cobra con Stripe en línea o en el mostrador de recepción. Si algo falla, se compensa, y un reintento nunca cobra dos veces.
- **Inventario:** cada cita pagada descuenta sus insumos. El stock crítico avisa a la administración.
- **CRM:** registro de clientes, factura con IVA y forma de pago, puntos de fidelidad, canje y reembolso con nota de crédito.
- **IA:** diagnóstico facial y capilar por foto o video, recomendaciones, asesoría para redes sociales, reportes por voz y simulación de cortes y ropa.
- **Comunidad:** publicaciones, reacciones y comentarios en cascada, con moderación.
- **Sin conexión:** en la web y en el móvil, las operaciones se guardan en una cola local y se envían al volver la red.
- **Agentes:** operación, inventario y agenda responden preguntas por MCP. Cualquier cambio necesita la confirmación de una persona.
- **Automatización:** n8n envía recordatorios 24 horas antes y confirmaciones de reserva.

## Pruebas

Cada servicio tiene pruebas unitarias y de integración con Testcontainers. Además hay pruebas en vivo contra todos los servicios (`tests/integration`) y en navegador real (`tests/e2e`). Los comandos están en el manual, sección 7.

## Limitaciones conocidas

- **WhatsApp:** los flujos están hechos, pero el envío real depende de una cuenta de Meta.
- **Móvil:** iOS no se compiló, porque requiere macOS. La app se probó en un emulador Android, no en un teléfono físico. El comprobante imprimible y la cancelación con reembolso siguen solo en la web.
- **Sin conexión en el móvil:** solo se analizan fotos, no video.
- **Facturas:** son comprobantes de demostración, sin validez fiscal.

El detalle de cada fase está en [ROADMAP.md](ROADMAP.md).
