# Microfrontend: mfe-estudio-ia (React 18)

Módulo autónomo de estudio de imagen con IA, clóset virtual y comunidad social.

## Arquitectura y Stack
* **Framework:** React 18 + Vite.
* **Dominio:**
  * Diagnóstico biométrico facial y capilar en tiempo real (CU-13, RF-04) conectado con `ms-ia` (FastAPI).
  * Recomendador multi-criterio de cortes y colorimetría (CU-14, RF-05).
  * Armario virtual inteligente con filtrado y persistencia en MongoDB (CU-15).
  * Muro social de comunidad con contador y toggle-like reactivo y comentarios en cascada (CU-20, CU-21).

## Comandos
* `npm install`: Instala las dependencias de React y Lucide.
* `npm run dev`: Inicia el servidor de desarrollo en puerto 3001.
* `npm run build`: Genera el bundle de producción en `dist/`.
