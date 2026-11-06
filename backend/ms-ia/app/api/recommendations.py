from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, model_validator

from app.adapters.platform_client import PlatformClient, get_platform
from app.services.recommendation_service import RecommendationService

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])


class RecommendationRequest(BaseModel):
    face_shape: Optional[Literal["OVAL", "ROUND", "SQUARE", "HEART", "OBLONG"]] = None
    hair_type: Optional[Literal["STRAIGHT", "WAVY", "CURLY"]] = None
    hair_tone: Optional[Literal["DARK", "MEDIUM", "LIGHT"]] = None
    skin_undertone: Optional[Literal["WARM", "COOL", "NEUTRAL"]] = None
    length: Optional[Literal["SHORT", "MEDIUM", "LONG"]] = None
    maintenance: Optional[Literal["LOW", "MEDIUM", "HIGH"]] = None
    vibe: Optional[Literal["NATURAL", "PROFESSIONAL", "TRENDY", "BOLD"]] = None
    age_range: Optional[Literal["UNDER_18", "18_29", "30_44", "45_59", "60_PLUS"]] = None
    gender: Optional[Literal["FEMALE", "MALE", "NON_BINARY", "UNDISCLOSED"]] = None

    @model_validator(mode="after")
    def requires_attribute(self):
        if not any(self.model_dump().values()):
            raise ValueError("Indique al menos un rasgo o una preferencia.")
        return self


@router.post("/styles")
def get_recommendations(req: RecommendationRequest, platform: PlatformClient = Depends(get_platform)):
    """Recomienda cortes, color y tratamientos unidos al catálogo real del salón (CU-14, RF-05)."""
    return RecommendationService.recommend(
        {
            "face": req.face_shape,
            "hair": req.hair_type,
            "tone": req.hair_tone,
            "undertone": req.skin_undertone,
            "length": req.length,
            "maintenance": req.maintenance,
            "vibe": req.vibe,
            "age": req.age_range,
        },
        services=platform.services(),
        gender=req.gender,
    )
