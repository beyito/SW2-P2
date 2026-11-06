from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, biometrics, recommendations, personal_brand
from app.core.config import settings
from app.core.security import get_current_user

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Microservicio de Inferencia de Inteligencia Artificial para el Salón de Belleza"
)

# Solo los microfrontends de la plataforma pueden invocar la API desde el navegador
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS.split(","),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# El healthcheck es público; todo lo demás exige un token válido de Keycloak
authenticated = [Depends(get_current_user)]
app.include_router(health.router)
app.include_router(biometrics.router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(recommendations.router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(personal_brand.router, prefix=settings.API_V1_STR, dependencies=authenticated)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
