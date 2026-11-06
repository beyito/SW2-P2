# Microfrontend: mfe-gestion (Angular 21)

ERP del salón para el personal. Todos sus datos vienen de los servicios; recibe el token del Shell por `postMessage`.

| Pestaña | Roles | Casos de uso | Servicio |
| :--- | :--- | :--- | :--- |
| Panel | ADMIN: indicadores; personal: avisos | CU-17 | `ms-gestion`, `ms-crm` |
| Agenda | ADMIN, STYLIST | CU-05, CU-07 | `ms-gestion` (Read Model) |
| Inventario | ADMIN edita; STYLIST consulta | CU-08, CU-09 | `ms-gestion` |
| Estilistas | ADMIN; STYLIST edita su horario | CU-04, CU-05 | `ms-gestion` |
| Clientes | ADMIN, STYLIST | CU-03, CU-12 | `ms-crm` |
| Moderación | ADMIN, STYLIST | CU-20, CU-21 | `ms-asesoria` |
| Agente | Según las herramientas del rol | CU-17, CU-18 | Servidor MCP |

```bash
npm install
npm start       # http://localhost:3003
npm run build
```
