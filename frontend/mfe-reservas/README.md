# Microfrontend: mfe-reservas (Vue.js 3)

Módulo autónomo de agendamiento y checkout transaccional para la plataforma de salón de belleza.

## Arquitectura y Stack
* **Framework:** Vue.js 3 (Composition API con `<script setup>`).
* **Build Tool:** Vite 5.
* **Dominio:**
  * Catálogo de servicios profesionales (CU-06).
  * Selección de estilista asignado y franjas horarias (CU-05).
  * Pasarela transaccional con generación de cabecera `Idempotency-Key` (RNF-04).
  * Visualizador interactivo de eventos del orquestador SAGA en RabbitMQ (CU-10, RF-07, RNF-03) con simulación de rollback.

## Comandos
* `npm install`: Instala las dependencias de Vue 3.
* `npm run dev`: Inicia el servidor de desarrollo en puerto 3002.
* `npm run build`: Genera el bundle de producción en `dist/`.
