# Microservicio 3: ms-crm

- **Tecnología:** PHP / Laravel
- **Arquitectura:** Clean Architecture
- **Base de Datos:** PostgreSQL (`salon_crm`)
- **API:** GraphQL

## Estructura Clean Architecture Requerida
- `app/Core/Entities/` (Entidades de negocio y reglas empresariales críticas)
- `app/Core/UseCases/` (Casos de uso: Fidelización, Registro de clientes, Puntos)
- `app/InterfaceAdapters/` (GraphQL Resolvers, Presenters, Gateways de Repositorio)
- `app/FrameworksDrivers/` (Configuración de Laravel, Eloquent ORM, Lighthouse GraphQL, RabbitMQ)
