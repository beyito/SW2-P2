import pytest
from app.services.brand_service import BrandService
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_personal_brand_platforms():
    """Valida el asesoramiento de marca adaptado a redes (CU-16, RF-06)"""
    for platform in ["LINKEDIN", "INSTAGRAM", "TIKTOK", "FACEBOOK"]:
        strategy = BrandService.generate_strategy(
            platform=platform,
            client_profile={"style": "Natural Chic"}
        )
        assert "vibe" in strategy
        assert "recommended_look" in strategy
        assert "color_palette" in strategy
        assert "lighting_tip" in strategy
        assert len(strategy["color_palette"]) > 0

def test_brand_endpoint_strategy():
    """Valida el endpoint de asesoría de imagen y marca personal /api/brand/strategy"""
    payload = {
        "platform": "INSTAGRAM",
        "client_profile": {
            "style": "Glamour Moderno"
        }
    }
    response = client.post("/api/v1/brand/strategy", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "vibe" in data
    assert "recommended_look" in data
    assert "Vibrante" in data["vibe"]
