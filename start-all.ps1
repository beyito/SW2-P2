# ====================================================================
# Script de Inicio Rápido - Salón & IA Studio
# Infraestructura, microservicios y microfrontends corren en Docker Compose.
# Para desarrollar un microfrontend con recarga en caliente, vea MANUAL_EJECUCION.md.
# ====================================================================

Write-Host ">>> Levantando la plataforma completa (Docker Compose)..." -ForegroundColor Cyan
docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: algun contenedor no llego a estado healthy. Revise 'docker compose ps' y 'docker compose logs'." -ForegroundColor Red
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Plataforma iniciada" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Shell Container:         http://localhost:3000/" -ForegroundColor White
Write-Host "MFE Estudio IA:          http://localhost:3001/" -ForegroundColor White
Write-Host "MFE Reservas:            http://localhost:3002/" -ForegroundColor White
Write-Host "MFE Gestion:             http://localhost:3003/" -ForegroundColor White
Write-Host "ms-asesoria (REST):      http://localhost:3100/community" -ForegroundColor White
Write-Host "ms-ia (Swagger):         http://localhost:8002/docs" -ForegroundColor White
Write-Host "ms-crm:                  http://localhost:8083/health" -ForegroundColor White
Write-Host "ms-gestion (GraphiQL):   http://localhost:8081/graphiql" -ForegroundColor White
Write-Host "Servidor MCP:            http://localhost:4000/health" -ForegroundColor White
Write-Host "Orquestador SAGA:        http://localhost:4100/health" -ForegroundColor White
Write-Host "Keycloak:                http://localhost:8080/" -ForegroundColor White
Write-Host "n8n:                     http://localhost:5678/" -ForegroundColor White
Write-Host "RabbitMQ:                http://localhost:15672/" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
