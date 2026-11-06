# Microservicio 1: ms-gestion

- **Tecnología:** Java / Spring Boot
- **Arquitectura:** Domain-Driven Design (DDD)
- **Base de Datos:** PostgreSQL (`salon_gestion`)
- **API:** GraphQL

## Estructura DDD Requerida
- `src/main/java/com/salon/gestion/domain/` (Entidades, Objetos de Valor, Repositorios de Dominio, Eventos)
- `src/main/java/com/salon/gestion/application/` (Casos de Uso, Servicios de Aplicación, DTOs)
- `src/main/java/com/salon/gestion/infrastructure/` (Controladores GraphQL, Adaptadores JPA, RabbitMQ Publisher/Listener)
