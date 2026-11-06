from typing import List, Dict, Any
import numpy as np

class RecommendationService:
    """
    Motor de Recomendación de Estilos, Cortes y Tratamientos (CU-14, RF-05)
    Utiliza coincidencia vectorial de atributos y clasificación de afinidad estética.
    """

    STYLES_CATALOG = [
        {
            "id": "style-01",
            "name": "Long Layered Waves",
            "category": "HAIRCUT",
            "best_for_faces": ["OVAL", "SQUARE", "HEART"],
            "best_for_hair": ["WAVY_2B", "WAVY_2A", "STRAIGHT_1B"],
            "base_score": 0.95,
            "reason": "Capas suaves que estilizan las facciones y aportan movimiento natural."
        },
        {
            "id": "style-02",
            "name": "French Bob con Flequillo Cortina",
            "category": "HAIRCUT",
            "best_for_faces": ["OVAL", "OBLONG", "HEART"],
            "best_for_hair": ["STRAIGHT_1A", "STRAIGHT_1B", "WAVY_2A"],
            "base_score": 0.93,
            "reason": "Enmarca la mandíbula y acorta ópticamente el tercio medio facial."
        },
        {
            "id": "style-03",
            "name": "Balayage Miel & Avellana Multidimensional",
            "category": "COLORATION",
            "best_for_faces": ["ALL"],
            "best_for_undertones": ["WARM", "NEUTRAL"],
            "base_score": 0.94,
            "reason": "Contraste gradual que ilumina los puntos de luz faciales."
        },
        {
            "id": "style-04",
            "name": "Tratamiento de Keratina Hidronutritiva y Cauterización",
            "category": "TREATMENT",
            "best_for_hair": ["CURLY_3A", "CURLY_3B", "WAVY_2B", "WAVY_2C"],
            "base_score": 0.91,
            "reason": "Sella la cutícula porosa y elimina el frizz ante humedad ambiental."
        }
    ]

    @classmethod
    def get_style_recommendations(
        cls,
        face_shape: str = "OVAL",
        hair_type: str = "WAVY_2B",
        skin_undertone: str = "WARM"
    ) -> List[Dict[str, Any]]:
        face_shape_upper = (face_shape or "OVAL").upper()
        hair_type_upper = (hair_type or "WAVY_2B").upper()
        skin_undertone_upper = (skin_undertone or "WARM").upper()

        scored_styles = []

        for item in cls.STYLES_CATALOG:
            score = item["base_score"]

            # Bonificación geométrica facial
            if "best_for_faces" in item:
                if face_shape_upper in item["best_for_faces"] or "ALL" in item["best_for_faces"]:
                    score += 0.03
                else:
                    score -= 0.10

            # Bonificación textura capilar
            if "best_for_hair" in item:
                if hair_type_upper in item["best_for_hair"]:
                    score += 0.03

            # Bonificación colorimétrica
            if "best_for_undertones" in item:
                if skin_undertone_upper in item["best_for_undertones"]:
                    score += 0.03

            final_score = round(min(score, 0.99), 2)

            scored_styles.append({
                "style_id": item["id"],
                "style_name": item["name"],
                "category": item["category"],
                "match_score": final_score,
                "reason": item["reason"],
                "compatibility_factors": {
                    "face_shape_match": face_shape_upper in item.get("best_for_faces", ["ALL"]) or "ALL" in item.get("best_for_faces", []),
                    "hair_texture_match": hair_type_upper in item.get("best_for_hair", []),
                    "color_harmony": skin_undertone_upper in item.get("best_for_undertones", ["ALL"])
                }
            })

        # Ordenar por afinidad descendente
        scored_styles.sort(key=lambda x: x["match_score"], reverse=True)
        return scored_styles
