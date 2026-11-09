# ====================================================================
# Imagen de los microfrontends (Shell, Estudio IA, Reservas y ERP).
# Se compila cada aplicación con Node y se sirve el resultado estático con nginx.
# Argumentos: APP (carpeta), PORT (puerto) y DIST (carpeta compilada dentro de APP).
# Las direcciones de los servicios se fijan al compilar, porque el navegador del usuario es quien
# llama a la API. Sin argumentos VITE_* apuntan a localhost; en la nube se pasan las públicas.
# ====================================================================
FROM node:22-alpine AS build
ARG APP
ARG DIST=dist
WORKDIR /app
# Primero las dependencias: se reutilizan mientras no cambie package-lock.json
COPY ${APP}/package.json ${APP}/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ${APP}/ ./
# Un argumento vacío equivale a no definirlo: cada aplicación usa entonces su valor local
ARG VITE_KEYCLOAK_URL
ARG VITE_GESTION_URL
ARG VITE_CRM_URL
ARG VITE_CRM_BASE_URL
ARG VITE_ASESORIA_URL
ARG VITE_IA_URL
ARG VITE_SAGA_URL
ARG VITE_MCP_URL
ARG VITE_BI_URL
ARG VITE_MFE_ESTUDIO_URL
ARG VITE_MFE_RESERVAS_URL
ARG VITE_MFE_GESTION_URL
RUN npm run build && mkdir /out && cp -r ${DIST}/. /out/

FROM nginx:1.27-alpine
ARG PORT
ENV PORT=${PORT}
# La imagen de nginx reemplaza ${PORT} en las plantillas al arrancar
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /out /usr/share/nginx/html
EXPOSE ${PORT}
