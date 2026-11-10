from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.adapters.gemini import generate_brand_copy
from app.adapters.ollama import first_available, generate_brand_copy_local
from app.adapters.platform_client import PlatformClient, get_platform
from app.services.brand_service import BrandService

router = APIRouter(prefix="/brand", tags=["Personal Brand"])


class BrandStrategyRequest(BaseModel):
    platform: Literal["LINKEDIN", "INSTAGRAM", "TIKTOK", "FACEBOOK"]
    goal: Optional[str] = Field(default=None, max_length=200)
    sector: Optional[str] = Field(default=None, max_length=80)
    gender: Optional[Literal["FEMALE", "MALE", "NON_BINARY", "UNDISCLOSED"]] = None
    age_range: Optional[Literal["UNDER_18", "18_29", "30_44", "45_59", "60_PLUS"]] = None


@router.post("/strategy")
def get_brand_strategy(req: BrandStrategyRequest, platform: PlatformClient = Depends(get_platform)):
    """Asesoría de imagen para redes sociales con el diagnóstico y el clóset del cliente (CU-16, RF-06)."""
    return BrandService.generate_strategy(
        platform=req.platform,
        diagnosis=platform.latest_diagnosis(),
        closet=platform.closet(),
        goal=req.goal,
        sector=req.sector,
        gender=req.gender,
        age_range=req.age_range,
        # IA local primero; Gemini como respaldo, y plantillas si ninguno responde
        generate_copy=first_available(generate_brand_copy_local, generate_brand_copy),
    )
