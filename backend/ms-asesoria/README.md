# Microservicio 2: ms-asesoria

- **Tecnología:** TypeScript / NestJS
- **Arquitectura:** Hexagonal (Ports & Adapters)
- **Base de Datos:** MongoDB (`salon_asesoria`)
- **API:** REST

## Estructura Hexagonal Requerida
- `src/domain/` (Entidades del núcleo, Agregados, Reglas de negocio del Clóset y Asesoría)
- `src/ports/` (Puertos de entrada: Use Cases Interfaces / Puertos de salida: Repository Interfaces, Event Bus Interfaces)
- `src/adapters/` 
  - `inbound/` (Controladores REST HTTP)
  - `outbound/` (Mongoose/MongoDB Repositories, RabbitMQ Producers)
