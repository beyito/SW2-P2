# Microfrontend: mfe-gestion (Angular 17)

Módulo autónomo de gestión operativa, ERP y asistente inteligente MCP.

## Arquitectura y Stack
* **Framework:** Angular 17 (Standalone Components, RxJS y TypeScript).
* **Dominio:**
  * Panel ERP de control de inventario cosmético y detección automática de stock crítico (CU-08, CU-09, RF-03).
  * Agenda de estilistas y ocupación de turnos (CU-05).
  * Chat en lenguaje natural con el Servidor MCP sobre JSON-RPC 2.0 (CU-17, CU-18, RNF-02).
* **Conexión:** `ms-gestion` (Spring Boot / GraphQL) y Servidor MCP (Puerto 4000).

## Comandos
* `npm install`: Instala las dependencias de Angular.
* `npm run build`: Valida el tipado y compila el código TypeScript (`tsc --noEmit`).
