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

# Cada categoría apunta a un servicio real de ms-gestion; un estilo con "service": None se consulta en el salón,
# porque el catálogo todavía no tiene un servicio que le corresponda
_SERVICE_FOR = {CUT: "srv-03", COLOR: "srv-01", TREATMENT: "srv-02"}

# "audience" limita un estilo a un público; sin esa clave se ofrece a todas las personas
FEMALE, MALE = "FEMALE", "MALE"
MATURE = ["45_59", "60_PLUS"]
YOUNG = ["UNDER_18", "18_29"]

CATALOG = [
    {"id": "cut-capas", "name": "Capas largas con movimiento", "category": CUT, "audience": FEMALE,
     "face": ["OVAL", "SQUARE", "HEART", "OBLONG"], "hair": ["STRAIGHT", "WAVY"], "length": ["LONG"],
     "maintenance": ["LOW"], "vibe": ["NATURAL"], "age": YOUNG + ["30_44"],
     "reason": "Las capas suaves aportan movimiento y estilizan las facciones."},
    {"id": "cut-bob", "name": "Bob francés con flequillo cortina", "category": CUT, "audience": FEMALE,
     "face": ["OVAL", "OBLONG", "HEART"], "hair": ["STRAIGHT", "WAVY"], "length": ["SHORT"],
     "maintenance": ["MEDIUM"], "vibe": ["TRENDY"],
     "reason": "Enmarca la mandíbula y acorta visualmente el tercio medio del rostro."},
    {"id": "cut-lob", "name": "Lob estructurado", "category": CUT, "audience": FEMALE,
     "face": ["ROUND", "SQUARE", "OVAL"], "hair": ["STRAIGHT", "WAVY"], "length": ["MEDIUM"],
     "maintenance": ["MEDIUM"], "vibe": ["PROFESSIONAL"], "age": ["30_44"] + MATURE,
     "reason": "Las líneas que pasan la mandíbula alargan el rostro y dan una imagen pulida."},
    {"id": "cut-pixie", "name": "Pixie texturizado", "category": CUT, "audience": FEMALE,
     "face": ["OVAL", "HEART"], "hair": ["STRAIGHT", "WAVY"], "length": ["SHORT"],
     "maintenance": ["HIGH"], "vibe": ["BOLD"],
     "reason": "Despeja el rostro y resalta pómulos y mirada."},
    {"id": "cut-hombros", "name": "Melena a los hombros con capas suaves", "category": CUT, "audience": FEMALE,
     "face": ALL_FACES, "hair": ALL_HAIR, "length": ["MEDIUM"],
     "maintenance": ["LOW"], "vibe": ["NATURAL", "PROFESSIONAL"], "age": MATURE,
     "reason": "Da volumen en la raíz y suaviza el contorno, con un peinado fácil de mantener."},
    {"id": "cut-rizos", "name": "Rizos definidos en capas redondeadas", "category": CUT, "audience": FEMALE,
     "face": ["OVAL", "SQUARE", "OBLONG", "HEART"], "hair": ["CURLY"], "length": ["MEDIUM", "LONG"],
     "maintenance": ["MEDIUM"], "vibe": ["NATURAL", "BOLD"],
     "reason": "Reparte el volumen del rizo sin que se concentre en las puntas."},
    {"id": "cut-shag", "name": "Shag moderno", "category": CUT,
     "face": ["SQUARE", "OBLONG", "OVAL"], "hair": ["WAVY", "CURLY"], "length": ["MEDIUM"],
     "maintenance": ["LOW"], "vibe": ["TRENDY"], "age": YOUNG + ["30_44"],
     "reason": "Su textura en capas suaviza los ángulos y aprovecha la onda natural."},
    {"id": "cut-fade", "name": "Degradado clásico con textura superior", "category": CUT, "audience": MALE,
     "face": ["ROUND", "OVAL", "SQUARE", "OBLONG"], "hair": ALL_HAIR, "length": ["SHORT"],
     "maintenance": ["HIGH"], "vibe": ["PROFESSIONAL", "TRENDY"], "age": YOUNG + ["30_44"],
     "reason": "Los lados cortos dan altura visual y una imagen limpia."},
    {"id": "cut-crop", "name": "Crop texturizado con flequillo", "category": CUT, "audience": MALE,
     "face": ["OVAL", "SQUARE", "OBLONG", "HEART"], "hair": ["STRAIGHT", "WAVY"], "length": ["SHORT"],
     "maintenance": ["MEDIUM"], "vibe": ["TRENDY"], "age": YOUNG,
     "reason": "La textura en la parte superior da movimiento y acorta las frentes amplias."},
    {"id": "cut-undercut", "name": "Undercut con volumen", "category": CUT, "audience": MALE,
     "face": ["OVAL", "ROUND", "SQUARE"], "hair": ["STRAIGHT", "WAVY"], "length": ["SHORT", "MEDIUM"],
     "maintenance": ["HIGH"], "vibe": ["BOLD"],
     "reason": "El contraste entre los lados y la parte superior da una imagen marcada."},
    {"id": "cut-raya", "name": "Clásico con raya al costado", "category": CUT, "audience": MALE,
     "face": ALL_FACES, "hair": ["STRAIGHT", "WAVY"], "length": ["SHORT"],
     "maintenance": ["LOW"], "vibe": ["PROFESSIONAL"], "age": ["30_44"] + MATURE,
     "reason": "Una línea ordenada y atemporal, fácil de peinar cada día."},
    {"id": "cut-taper-rizos", "name": "Rizos con degradado bajo", "category": CUT, "audience": MALE,
     "face": ALL_FACES, "hair": ["CURLY"], "length": ["SHORT"],
     "maintenance": ["MEDIUM"], "vibe": ["NATURAL", "TRENDY"],
     "reason": "Conserva el rizo arriba y limpia los lados sin perder la forma natural."},
    {"id": "cut-melena-h", "name": "Melena media con capas", "category": CUT, "audience": MALE,
     "face": ["OVAL", "SQUARE", "HEART", "OBLONG"], "hair": ALL_HAIR, "length": ["MEDIUM", "LONG"],
     "maintenance": ["LOW"], "vibe": ["NATURAL"],
     "reason": "Las capas quitan peso y dejan caer el cabello con naturalidad."},
    {"id": "color-miel", "name": "Balayage miel y avellana", "category": COLOR, "audience": FEMALE,
     "undertone": ["WARM", "NEUTRAL"], "tone": ["DARK", "MEDIUM"],
     "maintenance": ["LOW"], "vibe": ["NATURAL", "TRENDY"],
     "reason": "Los reflejos cálidos iluminan el rostro y crecen sin marcar la raíz."},
    {"id": "color-cenizo", "name": "Balayage cenizo y perla", "category": COLOR, "audience": FEMALE,
     "undertone": ["COOL", "NEUTRAL"], "tone": ["MEDIUM", "LIGHT"],
     "maintenance": ["MEDIUM"], "vibe": ["TRENDY", "PROFESSIONAL"], "age": MATURE,
     "reason": "Los tonos fríos armonizan con el subtono de la piel y disimulan las canas."},
    {"id": "color-cobre", "name": "Reflejos cobrizos", "category": COLOR, "audience": FEMALE,
     "undertone": ["WARM"], "tone": ["MEDIUM", "LIGHT"],
     "maintenance": ["HIGH"], "vibe": ["BOLD"],
     "reason": "El cobre intensifica la calidez de la piel y da un color de alto impacto."},
    {"id": "color-espresso", "name": "Matiz chocolate frío", "category": COLOR,
     "undertone": ["COOL", "NEUTRAL"], "tone": ["DARK"],
     "maintenance": ["LOW"], "vibe": ["PROFESSIONAL", "NATURAL"],
     "reason": "Da profundidad y brillo al cabello oscuro sin aclararlo."},
    {"id": "color-canas", "name": "Camuflaje natural de canas", "category": COLOR, "audience": MALE, "service": None,
     "undertone": ["WARM", "COOL", "NEUTRAL"], "tone": ["DARK", "MEDIUM", "LIGHT"],
     "maintenance": ["LOW"], "vibe": ["NATURAL", "PROFESSIONAL"], "age": ["30_44"] + MATURE,
     "reason": "Reduce el contraste de las canas sin que se note un cambio de color."},
    {"id": "color-reflejos-h", "name": "Reflejos sutiles en la parte superior", "category": COLOR, "audience": MALE, "service": None,
     "undertone": ["WARM", "NEUTRAL"], "tone": ["DARK", "MEDIUM"],
     "maintenance": ["MEDIUM"], "vibe": ["TRENDY", "BOLD"], "age": YOUNG + ["30_44"],
     "reason": "Aporta relieve al peinado con un color discreto."},
    {"id": "trat-keratina", "name": "Keratina hidronutritiva", "category": TREATMENT,
     "hair": ["WAVY", "CURLY"], "maintenance": ["LOW", "MEDIUM"], "vibe": ["PROFESSIONAL", "NATURAL"],
     "reason": "Sella la cutícula y controla el frizz sin perder la forma natural."},
    {"id": "trat-brillo", "name": "Keratina de brillo", "category": TREATMENT,
     "hair": ["STRAIGHT"], "maintenance": ["LOW", "MEDIUM"], "vibe": ["PROFESSIONAL", "NATURAL", "TRENDY"],
     "reason": "Fortalece la fibra y devuelve el brillo al cabello liso."},
]

CATALOG_BY_ID = {style["id"]: style for style in CATALOG}


def _preview(haircut: str = "No change", hair_color: str = "No change", approximate: bool = False) -> dict:
    return {"haircut": haircut, "hair_color": hair_color, "approximate": approximate}


# Equivalencia con las opciones cerradas del generador de imágenes. "approximate" avisa al cliente de que muestra lo
# más parecido disponible; los estilos que no están aquí, como tratamientos o canas, no cambian lo suficiente a la vista
PREVIEWS = {
    "cut-capas": _preview("Layered"),
    "cut-bob": _preview("Bob", approximate=True),
    "cut-lob": _preview("Lob"),
    "cut-pixie": _preview("Pixie Cut"),
    "cut-hombros": _preview("Layered", approximate=True),
    "cut-rizos": _preview("Curly", approximate=True),
    "cut-shag": _preview("Shag"),
    "cut-fade": _preview("Crew Cut", approximate=True),
    "cut-crop": _preview("Tousled", approximate=True),
    "cut-undercut": _preview("Undercut"),
    "cut-raya": _preview("Side-Parted"),
    "cut-taper-rizos": _preview("Curly", approximate=True),
    "cut-melena-h": _preview("Layered", approximate=True),
    "color-miel": _preview(hair_color="Honey Blonde", approximate=True),
    "color-cenizo": _preview(hair_color="Ash Blonde", approximate=True),
    "color-cobre": _preview(hair_color="Copper"),
    "color-espresso": _preview(hair_color="Dark Brown", approximate=True),
    "color-reflejos-h": _preview(hair_color="Caramel", approximate=True),
}


_ATTRIBUTES = ["face", "hair", "tone", "undertone", "length", "maintenance", "vibe", "age"]
_FACTOR_LABELS = {
    "face": "tu forma de rostro",
    "hair": "tu tipo de cabello",
    "tone": "el tono de tu cabello",
    "undertone": "tu subtono de piel",
    "length": "el largo que prefieres",
    "maintenance": "el mantenimiento que buscas",
    "vibe": "el estilo que buscas",
    "age": "tu rango de edad",
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
        gender: Optional[str] = None,
    ) -> list[dict]:
        """
        Devuelve los mejores estilos por categoría, explicando qué coincidió con el cliente.
        El género filtra el catálogo y no puntúa; sin indicarlo, se ofrecen todos los estilos.
        """
        given = {name: value for name, value in attributes.items() if value}
        ranked = _index.rank([f"{name}:{value}" for name, value in given.items()])
        remaining = dict(limits or _RESULTS_PER_CATEGORY)
        results = []
        for style, score in ranked:
            if remaining.get(style["category"], 0) <= 0:
                continue
            if gender in (FEMALE, MALE) and style.get("audience", gender) != gender:
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
                "service": (services or {}).get(style.get("service", _SERVICE_FOR[style["category"]])),
                "can_preview": style["id"] in PREVIEWS,
                "preview_approximate": PREVIEWS.get(style["id"], {}).get("approximate", False),
            })
        return results
