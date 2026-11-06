# Frontend Shell (Contenedor Microfrontends)

- **Tecnología:** React + Webpack Module Federation
- **Propósito:** Contenedor anfitrión unificado para SSO (Keycloak), navegación global, diseño responsive y orquestación de los 3 microfrontends remotos:
  - `mfe-gestion` (Angular) -> ERP / Agenda / Inventario
  - `mfe-estudio-ia` (React) -> Diagnóstico IA / Clóset / Comunidad
  - `mfe-reservas` (Vue.js) -> Catálogo / Checkout / SAGA
