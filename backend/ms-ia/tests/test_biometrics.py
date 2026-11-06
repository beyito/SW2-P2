import pytest
from app.services.biometrics_service import BiometricsService
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_biometrics_service_analysis():
    """Valida el análisis biométrico facial y capilar (CU-13, RF-04)"""
    result = BiometricsService.analyze_scan(image_bytes=b"dummy_data", filename="face_test.jpg")
    
    assert result["status"] == "ANALYZED_SUCCESSFULLY"
    assert result["face_shape"] in ["OVAL", "ROUND", "SQUARE", "HEART", "OBLONG"]
    assert result["confidence_face"] >= 0.80
    assert "hair_type" in result
    assert "skin_undertone" in result
    assert isinstance(result["recommended_palette"], list)
    assert len(result["recommended_palette"]) > 0

def test_biometrics_endpoint_scan():
    """Valida el contrato HTTP semántico del endpoint /api/biometrics/scan"""
    response = client.post(
        "/api/v1/biometrics/scan",
        files={"file": ("test.jpg", b"fake_image_content", "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ANALYZED_SUCCESSFULLY"
    assert data["face_shape"] == "OVAL"
