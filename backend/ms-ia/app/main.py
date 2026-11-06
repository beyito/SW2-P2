from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import biometrics, health, personal_brand, recommendations, speech
from app.core.config import settings
from app.core.security import get_current_user
from app.vision.face import landmarker
from app.vision.hair import segmenter


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Los modelos de visión se cargan al arrancar: si falta uno, el servicio falla de inmediato y no en una consulta
    blank = np.zeros((256, 256, 3), dtype=np.uint8)
    landmarker.detect(blank)
    segmenter.segment(blank)
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Microservicio de Inferencia de Inteligencia Artificial para el Salón de Belleza",
    lifespan=lifespan,
)


@app.middleware("http")
async def reject_oversized_bodies(request: Request, call_next):
    """Rechaza por su tamaño declarado antes de recibir el cuerpo completo."""
    declared = request.headers.get("content-length")
    # El margen cubre los delimitadores del formulario; el archivo se vuelve a medir al leerlo
    if declared and declared.isdigit() and int(declared) > settings.MAX_SCAN_BYTES + 1024 * 1024:
        return JSONResponse(
            status_code=413,
            content={"detail": {"code": "FILE_TOO_LARGE", "message": "El archivo es demasiado grande."}},
        )
    return await call_next(request)


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
app.include_router(speech.router, prefix=settings.API_V1_STR, dependencies=authenticated)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
