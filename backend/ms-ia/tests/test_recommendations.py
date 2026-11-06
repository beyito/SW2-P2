import pytest
from app.services.recommendation_service import RecommendationService
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_recommendation_scoring_algorithm():
    """Valida el cálculo de afinidad estética multidimensional (CU-14, RF-05)"""
    recommendations = RecommendationService.get_style_recommendations(
        face_shape="OVAL",
        hair_type="WAVY_2B",
        skin_undertone="WARM"
    )
    
    assert len(recommendations) >= 3
    # Debe estar ordenado descendentemente por match_score
    scores = [r["match_score"] for r in recommendations]
    assert scores == sorted(scores, reverse=True)
    
    # El primer resultado para OVAL y WAVY_2B debe tener alta afinidad (> 0.90)
    assert recommendations[0]["match_score"] >= 0.90
    assert "compatibility_factors" in recommendations[0]

def test_recommendation_endpoint():
    """Valida el endpoint de recomendación REST"""
    payload = {
        "face_shape": "OVAL",
        "hair_type": "WAVY_2B",
        "skin_undertone": "WARM"
    }
    response = client.post("/api/v1/recommendations/styles", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "style_name" in data[0]
