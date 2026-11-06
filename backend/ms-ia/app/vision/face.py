"""Medición del rostro con MediaPipe Face Landmarker y clasificación de forma y subtono (RF-04)."""
import math
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

from app.core.config import settings
from app.vision.errors import BiometricRejection

# Puntos de la malla facial
_TOP, _CHIN = 10, 152
_CHEEK_L, _CHEEK_R = 234, 454
_JAW_L, _JAW_R = 172, 397
_FOREHEAD_L, _FOREHEAD_R = 54, 284
_SKIN_L, _SKIN_R = 50, 280

_MIN_FACE_WIDTH_PX = 64
_MAX_YAW_DEGREES = 20
_MAX_PITCH_DEGREES = 25
_MIN_LIGHTNESS = 50
_MAX_LIGHTNESS = 240
_MIN_SHARPNESS = 15

# Centroides calibrados con la distribución de 1128 rostros frontales de LFW; la escala es su desviación típica.
# Son una referencia estadística de visagismo, no una verdad clínica: por eso se informa una confianza.
SHAPE_CENTROIDS = {
    "OVAL": (1.19, 0.805, 0.84),
    "ROUND": (1.11, 0.815, 0.835),
    "SQUARE": (1.16, 0.835, 0.85),
    "HEART": (1.19, 0.775, 0.875),
    "OBLONG": (1.27, 0.805, 0.84),
}
_SHAPE_SCALE = np.array([0.06, 0.022, 0.026])

# Cuartiles del ángulo de tono de la piel en la misma muestra. El color depende de la luz de la foto
_COOL_BELOW = 45.0
_WARM_ABOVE = 63.0
_HUE_SPREAD = 10.0
_MAX_UNDERTONE_CONFIDENCE = 0.75


@dataclass
class FaceReading:
    length_to_width: float
    jaw_to_cheek: float
    forehead_to_cheek: float
    skin_hue: float
    face_width_px: float


def classify_shape(length_to_width: float, jaw_to_cheek: float, forehead_to_cheek: float) -> tuple[str, float]:
    """Devuelve la forma más cercana y su probabilidad frente a las demás."""
    names = list(SHAPE_CENTROIDS)
    centroids = np.array([SHAPE_CENTROIDS[name] for name in names])
    point = np.array([length_to_width, jaw_to_cheek, forehead_to_cheek])
    distances = (((point - centroids) / _SHAPE_SCALE) ** 2).sum(axis=1)
    # Se resta el mínimo para que un punto lejano de todos no se quede sin precisión numérica
    weights = np.exp(-(distances - distances.min()) / 2)
    probabilities = weights / weights.sum()
    best = int(probabilities.argmax())
    return names[best], float(probabilities[best])


def classify_undertone(hue: float) -> tuple[str, float]:
    """Clasifica el subtono por el ángulo de tono; un valor cerca de un límite da poca confianza."""
    if hue < _COOL_BELOW:
        name, margin = "COOL", _COOL_BELOW - hue
    elif hue > _WARM_ABOVE:
        name, margin = "WARM", hue - _WARM_ABOVE
    else:
        name, margin = "NEUTRAL", min(hue - _COOL_BELOW, _WARM_ABOVE - hue)
    confidence = 0.4 + (_MAX_UNDERTONE_CONFIDENCE - 0.4) * min(margin / _HUE_SPREAD, 1.0)
    return name, round(confidence, 2)


def head_angles(matrix: np.ndarray) -> tuple[float, float]:
    """Giro horizontal y vertical de la cabeza, en grados, a partir de la matriz de transformación facial."""
    yaw = math.degrees(math.atan2(-matrix[2, 0], math.hypot(matrix[2, 1], matrix[2, 2])))
    pitch = math.degrees(math.atan2(matrix[2, 1], matrix[2, 2]))
    return yaw, pitch


class _Landmarker:
    """Carga única del modelo. Una sola inferencia a la vez, porque la instancia no admite llamadas simultáneas."""

    def __init__(self) -> None:
        self._instance = None
        self._lock = threading.Lock()

    def detect(self, bgr: np.ndarray):
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        with self._lock:
            if self._instance is None:
                self._instance = mp_vision.FaceLandmarker.create_from_options(
                    mp_vision.FaceLandmarkerOptions(
                        base_options=mp_python.BaseOptions(
                            model_asset_path=str(Path(settings.MODELS_DIR) / "face_landmarker.task")
                        ),
                        running_mode=mp_vision.RunningMode.IMAGE,
                        num_faces=2,
                        output_facial_transformation_matrixes=True,
                    )
                )
            return self._instance.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))


landmarker = _Landmarker()


def read_face(bgr: np.ndarray) -> FaceReading:
    """Mide el único rostro de la imagen o rechaza la imagen indicando el motivo."""
    result = landmarker.detect(bgr)
    if not result.face_landmarks:
        raise BiometricRejection("NO_FACE", "No se detectó ningún rostro. Mire de frente a la cámara, con buena luz.")
    if len(result.face_landmarks) > 1:
        raise BiometricRejection("MULTIPLE_FACES", "Hay más de un rostro. Debe aparecer solo una persona.")

    height, width = bgr.shape[:2]
    points = result.face_landmarks[0]

    def at(index: int) -> np.ndarray:
        return np.array([points[index].x * width, points[index].y * height])

    def distance(first: int, second: int) -> float:
        return float(np.linalg.norm(at(first) - at(second)))

    cheek_width = distance(_CHEEK_L, _CHEEK_R)
    if cheek_width < _MIN_FACE_WIDTH_PX:
        raise BiometricRejection("FACE_TOO_SMALL", "El rostro está muy lejos. Acérquese a la cámara.")

    yaw, pitch = head_angles(np.array(result.facial_transformation_matrixes[0]))
    if abs(yaw) > _MAX_YAW_DEGREES or abs(pitch) > _MAX_PITCH_DEGREES:
        raise BiometricRejection("FACE_NOT_FRONTAL", "Mire de frente a la cámara, sin girar ni inclinar la cabeza.")

    skin = _skin_lab(bgr, at(_SKIN_L), at(_SKIN_R), cheek_width)
    lightness = float(skin[0])
    if lightness < _MIN_LIGHTNESS or lightness > _MAX_LIGHTNESS:
        raise BiometricRejection("BAD_LIGHTING", "La iluminación no permite el análisis. Busque una luz frontal y uniforme.")
    if _sharpness(bgr, [at(i) for i in (_TOP, _CHIN, _CHEEK_L, _CHEEK_R)]) < _MIN_SHARPNESS:
        raise BiometricRejection("TOO_BLURRY", "La imagen está borrosa. Mantenga la cámara quieta.")

    return FaceReading(
        length_to_width=distance(_TOP, _CHIN) / cheek_width,
        jaw_to_cheek=distance(_JAW_L, _JAW_R) / cheek_width,
        forehead_to_cheek=distance(_FOREHEAD_L, _FOREHEAD_R) / cheek_width,
        skin_hue=math.degrees(math.atan2(skin[2] - 128, skin[1] - 128)),
        face_width_px=cheek_width,
    )


def _skin_lab(bgr: np.ndarray, left: np.ndarray, right: np.ndarray, face_width: float) -> np.ndarray:
    """Color medio de las dos mejillas en espacio Lab."""
    radius = max(int(face_width * 0.05), 2)
    patches = []
    for center in (left, right):
        x, y = center.astype(int)
        patch = bgr[max(y - radius, 0):y + radius, max(x - radius, 0):x + radius]
        if patch.size:
            patches.append(patch.reshape(-1, 3))
    if not patches:
        raise BiometricRejection("NO_FACE", "El rostro no está completo dentro de la imagen.")
    pixels = np.concatenate(patches).reshape(-1, 1, 3)
    return cv2.cvtColor(pixels, cv2.COLOR_BGR2LAB).reshape(-1, 3).mean(axis=0)


def _sharpness(bgr: np.ndarray, corners: list[np.ndarray]) -> float:
    """Nitidez del rostro a tamaño normalizado, para que no dependa de la resolución de la cámara."""
    stack = np.array(corners)
    x0, y0 = np.maximum(stack.min(axis=0).astype(int), 0)
    x1, y1 = stack.max(axis=0).astype(int)
    crop = bgr[y0:y1, x0:x1]
    if crop.size == 0:
        return 0.0
    gray = cv2.cvtColor(cv2.resize(crop, (128, 128), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())
