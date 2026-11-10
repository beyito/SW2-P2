# Modelo de lenguaje local para la nube: Ollama con el modelo ya incluido en la imagen (no lo descarga al
# arrancar) y un proxy nginx delante que exige una clave, porque Ollama no trae autenticación propia.
FROM ollama/ollama:0.12.6

ARG OLLAMA_MODEL=qwen2.5:3b
RUN apt-get update && apt-get install -y --no-install-recommends nginx gettext-base && rm -rf /var/lib/apt/lists/*

# El modelo se descarga una sola vez, al construir la imagen
RUN ollama serve & until ollama list >/dev/null 2>&1; do sleep 1; done; ollama pull "$OLLAMA_MODEL"

COPY nginx.conf.template /etc/nginx/salon.conf.template
COPY iniciar.sh /iniciar.sh
RUN sed -i 's/\r$//' /iniciar.sh && chmod +x /iniciar.sh

ENV OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=24h PORT=8080
EXPOSE 8080
ENTRYPOINT ["/iniciar.sh"]
