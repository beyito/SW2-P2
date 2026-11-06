from fastapi import APIRouter

router = APIRouter()

@router.get("/health")
def health_check():
    return {
        "status": "UP",
        "service": "ms-ia",
        "description": "Motor de Inteligencia Artificial activo"
    }
