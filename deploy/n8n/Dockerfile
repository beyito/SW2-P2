# n8n con los flujos y la credencial del salón incluidos, para la nube (sin volúmenes).
# Se construye desde la raíz del repositorio: docker build -f deploy/n8n/Dockerfile .
FROM docker.n8n.io/n8nio/n8n:1.70.3
COPY docker/n8n/start.sh docker/n8n/credentials.template.json /seed/
COPY docker/n8n/workflows /seed/workflows
ENTRYPOINT ["sh", "/seed/start.sh"]
