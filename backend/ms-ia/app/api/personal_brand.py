from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any, Optional
from app.services.brand_service import BrandService

router = APIRouter(prefix="/brand", tags=["Personal Brand"])

class BrandStrategyRequest(BaseModel):
    platform: str # LINKEDIN, INSTAGRAM, TIKTOK, FACEBOOK
    client_profile: Optional[Dict[str, Any]] = None

@router.post("/strategy")
def get_brand_strategy(req: BrandStrategyRequest):
    """
    Asesoramiento de marca personal adaptado a redes sociales (CU-16, RF-06)
    """
    return BrandService.generate_strategy(
        platform=req.platform,
        client_profile=req.client_profile or {}
    )
