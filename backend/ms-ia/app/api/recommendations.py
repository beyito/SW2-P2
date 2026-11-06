from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.services.recommendation_service import RecommendationService

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])

class RecommendationRequest(BaseModel):
    face_shape: Optional[str] = "OVAL"
    hair_type: Optional[str] = "WAVY_2B"
    skin_undertone: Optional[str] = "WARM"

@router.post("/styles")
def get_recommendations(req: RecommendationRequest):
    """
    Generar recomendaciones inteligentes de cortes, peinados y tratamientos (CU-14, RF-05)
    """
    return RecommendationService.get_style_recommendations(
        face_shape=req.face_shape,
        hair_type=req.hair_type,
        skin_undertone=req.skin_undertone
    )
