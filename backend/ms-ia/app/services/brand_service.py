"""Asesoría de marca personal adaptada a cada red y al perfil real del cliente (CU-16, RF-06)."""
import unicodedata
from typing import Callable, Optional

from app.services.biometrics_service import PALETTES
from app.services.recommendation_service import COLOR, CUT, RecommendationService

_MAX_CLOSET_MATCHES = 6

PLATFORMS = {
    "LINKEDIN": {
        "tone": "profesional, sobrio y de alta credibilidad",
        "vibe": "PROFESSIONAL",
        "lighting_tip": "Luz frontal difusa y neutra, con un fondo liso.",
        "framing_tip": "Encuadre de hombros hacia arriba, con mirada a la cámara.",
    },
    "INSTAGRAM": {
        "tone": "aspiracional, cuidado y visual",
        "vibe": "TRENDY",
        "lighting_tip": "Luz natural de la tarde o un aro de luz cálido.",
        "framing_tip": "Vertical 4:5, con el look como protagonista.",
    },
    "TIKTOK": {
        "tone": "auténtico, fresco y cercano",
        "vibe": "BOLD",
        "lighting_tip": "Luz lateral suave que dé relieve al movimiento del cabello.",
        "framing_tip": "Vertical 9:16, con un gancho en los primeros 3 segundos.",
    },
    "FACEBOOK": {
        "tone": "cercano, familiar y confiable",
        "vibe": "NATURAL",
        "lighting_tip": "Luz natural de día, en un interior bien iluminado.",
        "framing_tip": "Fotos naturales, en contextos cotidianos.",
    },
}

_DEFAULT_UNDERTONE = "NEUTRAL"


def _normalize(text: str) -> str:
    plain = unicodedata.normalize("NFD", text.lower())
    return "".join(char for char in plain if unicodedata.category(char) != "Mn").strip()


def match_closet(items: list[dict], palette: list[str]) -> list[dict]:
    """Prendas del clóset cuyo color pertenece a la paleta."""
    colors = [_normalize(color) for color in palette]
    matches = []
    for item in items:
        color = _normalize(item.get("color", ""))
        if color and any(color in candidate or candidate in color for candidate in colors):
            matches.append({key: item.get(key) for key in ("id", "name", "color", "category")})
    return matches[:_MAX_CLOSET_MATCHES]


def _fallback_copy(platform: str, look: str, goal: Optional[str], sector: Optional[str]) -> dict:
    who = f"Profesional de {sector}" if sector else "Marca personal"
    aim = f" | {goal}" if goal else ""
    return {
        "bio": f"{who}{aim}"[:160],
        "content_ideas": [
            f"Antes y después de tu nuevo look: {look}.",
            f"Tres combinaciones de tu paleta para {platform.capitalize()}.",
            "Tu rutina de preparación antes de un día importante.",
        ],
        "generated_by": "Plantilla sin modelo de lenguaje",
    }


class BrandService:
    @staticmethod
    def generate_strategy(
        platform: str,
        diagnosis: Optional[dict],
        closet: list[dict],
        goal: Optional[str],
        sector: Optional[str],
        generate_copy: Callable[[dict], Optional[dict]],
        gender: Optional[str] = None,
        age_range: Optional[str] = None,
    ) -> dict:
        rules = PLATFORMS[platform]
        undertone = (diagnosis or {}).get("skinUndertone") or _DEFAULT_UNDERTONE
        palette = PALETTES[undertone]
        attributes = {"vibe": rules["vibe"], "age": age_range}
        if diagnosis:
            attributes |= {
                "face": diagnosis.get("faceShape"),
                "hair": diagnosis.get("hairType"),
                "tone": diagnosis.get("hairTone"),
                "undertone": undertone,
            }
        styles = RecommendationService.recommend(attributes, limits={CUT: 1, COLOR: 1}, gender=gender)
        by_category = {style["category"]: style for style in styles}
        look = by_category[CUT]["style_name"]
        color = by_category[COLOR]["style_name"]

        # Al modelo solo le llega lo que el cliente escribió y el look elegido, no sus rasgos
        copy = generate_copy({
            "red": platform, "tono": rules["tone"], "objetivo": goal, "sector": sector,
            "look": look, "color": color, "colores": palette,
        }) or _fallback_copy(platform, look, goal, sector)

        return {
            "platform": platform,
            "personalized": diagnosis is not None,
            "tone": rules["tone"],
            "recommended_look": look,
            "recommended_color": color,
            "color_palette": palette,
            "lighting_tip": rules["lighting_tip"],
            "framing_tip": rules["framing_tip"],
            "closet_matches": match_closet(closet, palette),
            **copy,
        }
