"""
Recomendador de cortes, color y tratamientos con Scikit-Learn (CU-14, RF-05).
Es un filtrado por contenido: compara por similitud de coseno los rasgos y preferencias del cliente con los atributos
del catálogo. No hay historial de elecciones con el que entrenar un modelo colaborativo.
"""
from typing import Optional

import numpy as np
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import MultiLabelBinarizer

ALL_FACES = ["OVAL", "ROUND", "SQUARE", "HEART", "OBLONG"]
ALL_HAIR = ["STRAIGHT", "WAVY", "CURLY"]

CUT, COLOR, TREATMENT = "HAIRCUT", "COLORATION", "TREATMENT"
_RESULTS_PER_CATEGORY = {CUT: 3, COLOR: 2, TREATMENT: 1}

# Cada estilo apunta a un servicio real del catálogo de ms-gestion
_SERVICE_FOR = {CUT: "srv-03", COLOR: "srv-01", TREATMENT: "srv-02"}

CATALOG = [
    {"id": "cut-capas", "name": "Capas largas con movimiento", "category": CUT,
     "face": ["OVAL", "SQUARE", "HEART", "OBLONG"], "hair": ["STRAIGHT", "WAVY"], "length": ["LONG"],
     "maintenance": ["LOW"], "vibe": ["NATURAL"],
     "reason": "Las capas suaves aportan movimiento y estilizan las facciones."},
    {"id": "cut-bob", "name": "Bob francés con flequillo cortina", "category": CUT,
     "face": ["OVAL", "OBLONG", "HEART"], "hair": ["STRAIGHT", "WAVY"], "length": ["SHORT"],
     "maintenance": ["MEDIUM"], "vibe": ["TRENDY"],
     "reason": "Enmarca la mandíbula y acorta visualmente el tercio medio del rostro."},
    {"id": "cut-lob", "name": "Lob estructurado", "category": CUT,
     "face": ["ROUND", "SQUARE", "OVAL"], "hair": ["STRAIGHT", "WAVY"], "length": ["MEDIUM"],
     "maintenance": ["MEDIUM"], "vibe": ["PROFESSIONAL"],
     "reason": "Las líneas que pasan la mandíbula alargan el rostro y dan una imagen pulida."},
    {"id": "cut-pixie", "name": "Pixie texturizado", "category": CUT,
     "face": ["OVAL", "HEART"], "hair": ["STRAIGHT", "WAVY"], "length": ["SHORT"],
     "maintenance": ["HIGH"], "vibe": ["BOLD"],
     "reason": "Despeja el rostro y resalta pómulos y mirada."},
    {"id": "cut-shag", "name": "Shag moderno", "category": CUT,
     "face": ["SQUARE", "OBLONG", "OVAL"], "hair": ["WAVY", "CURLY"], "length": ["MEDIUM"],
     "maintenance": ["LOW"], "vibe": ["TRENDY"],
     "reason": "Su textura en capas suaviza los ángulos y aprovecha la onda natural."},
    {"id": "cut-rizos", "name": "Rizos definidos en capas redondeadas", "category": CUT,
     "face": ["OVAL", "SQUARE", "OBLONG", "HEART"], "hair": ["CURLY"], "length": ["MEDIUM", "LONG"],
     "maintenance": ["MEDIUM"], "vibe": ["NATURAL", "BOLD"],
     "reason": "Reparte el volumen del rizo sin que se concentre en las puntas."},
    {"id": "cut-fade", "name": "Degradado clásico con textura superior", "category": CUT,
     "face": ["ROUND", "OVAL", "SQUARE", "OBLONG"], "hair": ALL_HAIR, "length": ["SHORT"],
     "maintenance": ["HIGH"], "vibe": ["PROFESSIONAL"],
     "reason": "Los lados cortos dan altura visual y una imagen limpia."},
    {"id": "color-miel", "name": "Balayage miel y avellana", "category": COLOR,
     "undertone": ["WARM", "NEUTRAL"], "tone": ["DARK", "MEDIUM"],
     "maintenance": ["LOW"], "vibe": ["NATURAL", "TRENDY"],
     "reason": "Los reflejos cálidos iluminan el rostro y crecen sin marcar la raíz."},
    {"id": "color-cenizo", "name": "Balayage cenizo y perla", "category": COLOR,
     "undertone": ["COOL", "NEUTRAL"], "tone": ["MEDIUM", "LIGHT"],
     "maintenance": ["MEDIUM"], "vibe": ["TRENDY", "PROFESSIONAL"],
     "reason": "Los tonos fríos armonizan con el subtono de la piel y neutralizan los amarillos."},
    {"id": "color-cobre", "name": "Reflejos cobrizos", "category": COLOR,
     "undertone": ["WARM"], "tone": ["MEDIUM", "LIGHT"],
     "maintenance": ["HIGH"], "vibe": ["BOLD"],
     "reason": "El cobre intensifica la calidez de la piel y da un color de alto impacto."},
    {"id": "color-espresso", "name": "Matiz chocolate frío", "category": COLOR,
     "undertone": ["COOL", "NEUTRAL"], "tone": ["DARK"],
     "maintenance": ["LOW"], "vibe": ["PROFESSIONAL", "NATURAL"],
     "reason": "Da profundidad y brillo al cabello oscuro sin aclararlo."},
    {"id": "trat-keratina", "name": "Keratina hidronutritiva", "category": TREATMENT,
     "hair": ["WAVY", "CURLY"], "maintenance": ["LOW", "MEDIUM"], "vibe": ["PROFESSIONAL", "NATURAL"],
     "reason": "Sella la cutícula y controla el frizz sin perder la forma natural."},
    {"id": "trat-brillo", "name": "Keratina de brillo", "category": TREATMENT,
     "hair": ["STRAIGHT"], "maintenance": ["LOW", "MEDIUM"], "vibe": ["PROFESSIONAL", "NATURAL", "TRENDY"],
     "reason": "Fortalece la fibra y devuelve el brillo al cabello liso."},
]

_ATTRIBUTES = ["face", "hair", "tone", "undertone", "length", "maintenance", "vibe"]
_FACTOR_LABELS = {
    "face": "tu forma de rostro",
    "hair": "tu tipo de cabello",
    "tone": "el tono de tu cabello",
    "undertone": "tu subtono de piel",
    "length": "el largo que prefieres",
    "maintenance": "el mantenimiento que buscas",
    "vibe": "el estilo que buscas",
}


def _tokens(style: dict) -> list[str]:
    return [f"{attribute}:{value}" for attribute in _ATTRIBUTES for value in style.get(attribute, [])]


class _Index:
    """Índice de vecinos sobre el catálogo. Cada atributo pesa igual, aunque un estilo admita muchos valores."""

    def __init__(self) -> None:
        self.binarizer = MultiLabelBinarizer()
        matrix = self.binarizer.fit_transform([_tokens(style) for style in CATALOG]).astype(float)
        for row, style in enumerate(CATALOG):
            for attribute in _ATTRIBUTES:
                values = style.get(attribute, [])
                for value in values:
                    column = self.binarizer.classes_.tolist().index(f"{attribute}:{value}")
                    matrix[row, column] = 1 / np.sqrt(len(values))
        self.model = NearestNeighbors(metric="cosine", algorithm="brute").fit(matrix)

    def rank(self, tokens: list[str]) -> list[tuple[dict, float]]:
        known = [token for token in tokens if token in self.binarizer.classes_]
        query = self.binarizer.transform([known]).astype(float)
        distances, positions = self.model.kneighbors(query, n_neighbors=len(CATALOG))
        return [(CATALOG[position], 1 - float(distance)) for distance, position in zip(distances[0], positions[0])]


_index = _Index()


class RecommendationService:
    @staticmethod
    def recommend(
        attributes: dict[str, Optional[str]],
        services: Optional[dict[str, dict]] = None,
        limits: Optional[dict[str, int]] = None,
    ) -> list[dict]:
        """Devuelve los mejores estilos por categoría, explicando qué coincidió con el cliente."""
        given = {name: value for name, value in attributes.items() if value}
        ranked = _index.rank([f"{name}:{value}" for name, value in given.items()])
        remaining = dict(limits or _RESULTS_PER_CATEGORY)
        results = []
        for style, score in ranked:
            if remaining.get(style["category"], 0) <= 0:
                continue
            remaining[style["category"]] -= 1
            matched = [name for name, value in given.items() if value in style.get(name, [])]
            results.append({
                "style_id": style["id"],
                "style_name": style["name"],
                "category": style["category"],
                "match_score": round(score, 2),
                "reason": style["reason"],
                "matched_factors": [_FACTOR_LABELS[name] for name in matched],
                "service": (services or {}).get(_SERVICE_FOR[style["category"]]),
            })
        return results
