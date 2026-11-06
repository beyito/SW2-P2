from typing import Dict, Any

class BrandService:
    """
    Servicio de Asesoramiento de Marca Personal para Redes Sociales (CU-16, RF-06)
    Adapta paleta, peinado y tono de imagen a cada plataforma (LinkedIn, Instagram, TikTok, Facebook).
    """

    @staticmethod
    def generate_strategy(platform: str, client_profile: Dict[str, Any]) -> Dict[str, Any]:
        platform_upper = platform.upper()

        strategies = {
            "LINKEDIN": {
                "vibe": "Profesional, sobrio y de alta credibilidad",
                "recommended_look": "Corte pulido (Lob estructurado o recogido prolijo)",
                "color_palette": ["Azul marino", "Blanco tiza", "Gris carbón"],
                "lighting_tip": "Luz frontal difusa de temperatura neutra (5000K)"
            },
            "INSTAGRAM": {
                "vibe": "Vibrante, aspiracional y dinámico",
                "recommended_look": "Ondas descontracturadas con iluminación Balayage",
                "color_palette": ["Tonos cálidos terracota", "Dorados", "Rosa empolvado"],
                "lighting_tip": "Golden hour o anillo de luz con filtro cálido"
            },
            "TIKTOK": {
                "vibe": "Auténtico, fresco y en tendencia",
                "recommended_look": "Texturizado con movimiento natural y toques de color fantasía suave",
                "color_palette": ["Tonos contrastantes de alto impacto visual"],
                "lighting_tip": "Luz dinámica con contraste lateral suave"
            },
            "FACEBOOK": {
                "vibe": "Cercano, familiar y confiable",
                "recommended_look": "Estilo clásico favorecedor y natural",
                "color_palette": ["Azul cielo", "Verde bosque", "Beige neutro"],
                "lighting_tip": "Luz natural diurna en interiores iluminados"
            }
        }

        return strategies.get(platform_upper, strategies["INSTAGRAM"])
