#!/bin/sh
# Escribe la configuración de inicio de sesión de Streamlit (OIDC con Keycloak) a partir del entorno
# y arranca el tablero. Ninguna clave queda en la imagen ni en el repositorio.
set -eu

mkdir -p /app/.streamlit
cat > /app/.streamlit/secrets.toml <<TOML
[auth]
redirect_uri = "${BI_URL}/oauth2callback"
cookie_secret = "${BI_COOKIE_SECRET}"

[auth.keycloak]
client_id = "salon-bi"
client_secret = "${BI_CLIENT_SECRET}"
server_metadata_url = "${BI_KEYCLOAK_METADATA_URL}"
client_kwargs = { scope = "openid profile email" }
TOML

exec streamlit run app.py --server.port "${PORT:-8501}" --server.address 0.0.0.0 \
  --server.headless true --browser.gatherUsageStats false --client.toolbarMode minimal --theme.primaryColor "#9E6066"
