# Servidor MCP (Model Context Protocol)

Intermediario entre los agentes de IA y la plataforma (RNF-02). Usa el SDK oficial con el transporte Streamable HTTP, sin estado, en `POST /mcp`.

- **Seguridad:** cada petición valida el token de Keycloak y la sesión. El token se reenvía a los microservicios, que vuelven a comprobar el rol. El servidor no accede a ninguna base de datos.
- **Errores:** sin token, 401; rol insuficiente, 403. Si falla un servicio, la herramienta responde `isError: true` y nunca inventa datos.
- **Herramientas:** `listar_estilistas`, `consultar_disponibilidad_estilista`, `consultar_stock_critico`, `obtener_metricas_negocio` y `generar_reporte_lenguaje_natural`.
- **Reportes:** usan Gemini (`GEMINI_API_KEY`, `GEMINI_MODEL`) con cifras agregadas, sin datos personales de clientes. Sin clave, o si la API falla, se arma un resumen con los mismos datos reales.

Conexión con un cliente MCP:

```json
{ "url": "http://localhost:4000/mcp", "headers": { "Authorization": "Bearer <token de Keycloak>" } }
```
