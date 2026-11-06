# Servidor MCP (Model Context Protocol)

- **Propósito:** Intermediario estricto y seguro entre agentes autónomos de IA y los microservicios de la plataforma.
- **RNF-02:** Los agentes IA nunca interactúan directamente con las bases de datos. Toda consulta o acción pasa obligatoriamente por el servidor MCP validando tokens de Keycloak y roles de usuario.
- **Herramientas (Tools / Resources):**
  - Consultar disponibilidad de estilistas
  - Consultar inventario crítico
  - Consultar métricas de negocio
  - Ejecución de reportes en lenguaje natural (CU-17, CU-18)
