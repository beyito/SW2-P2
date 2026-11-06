"""Segmentación del cabello y clasificación de su tipo con redes de TensorFlow Lite (RF-04)."""
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import tensorflow as tf

from app.core.config import settings

_SEGMENTER_SIZE = 256
_HAIR_CLASS = 1
_MIN_HAIR_TO_FACE_AREA = 0.25

CROP_SIZE = 224
_CROP_MARGIN = 0.1
_BACKGROUND = 128
# Orden de salida de la red entrenada con training/train_hair_type.py
HAIR_TYPES = ("STRAIGHT", "WAVY", "CURLY")

_DARK_BELOW = 70
_LIGHT_ABOVE = 130


@dataclass
class HairReading:
    hair_type: str
    confidence: float
    tone: str


class _TfLiteModel:
    """Intérprete de carga única. Una inferencia a la vez, porque la instancia no admite llamadas simultáneas."""

    def __init__(self, filename: str) -> None:
        self._filename = filename
        self._interpreter = None
        self._lock = threading.Lock()

    def run(self, tensor: np.ndarray) -> np.ndarray:
        with self._lock:
            if self._interpreter is None:
                self._interpreter = tf.lite.Interpreter(model_path=str(Path(settings.MODELS_DIR) / self._filename))
                self._interpreter.allocate_tensors()
            interpreter = self._interpreter
            interpreter.set_tensor(interpreter.get_input_details()[0]["index"], tensor[None])
            interpreter.invoke()
            return interpreter.get_tensor(interpreter.get_output_details()[0]["index"])[0]


class _Segmenter:
    """Modelo multiclase de MediaPipe sobre el intérprete de TensorFlow Lite."""

    def __init__(self) -> None:
        self._model = _TfLiteModel("selfie_multiclass.tflite")

    def segment(self, bgr: np.ndarray) -> np.ndarray:
        """Devuelve una máscara booleana del cabello, del tamaño de la imagen."""
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        tensor = cv2.resize(rgb, (_SEGMENTER_SIZE, _SEGMENTER_SIZE), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
        mask = (self._model.run(tensor).argmax(axis=-1) == _HAIR_CLASS).astype(np.uint8)
        height, width = bgr.shape[:2]
        return cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST).astype(bool)


segmenter = _Segmenter()
_classifier = _TfLiteModel("hair_type.tflite")


def hair_crop(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Recorte RGB cuadrado que solo conserva el cabello. El entrenamiento usa esta misma función."""
    ys, xs = np.nonzero(mask)
    top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    margin = int(max(bottom - top, right - left) * _CROP_MARGIN)
    height, width = bgr.shape[:2]
    top, bottom = max(top - margin, 0), min(bottom + margin, height)
    left, right = max(left - margin, 0), min(right + margin, width)

    crop = bgr[top:bottom, left:right].copy()
    crop[~mask[top:bottom, left:right]] = _BACKGROUND
    side = max(crop.shape[:2])
    square = np.full((side, side, 3), _BACKGROUND, dtype=np.uint8)
    y = (side - crop.shape[0]) // 2
    x = (side - crop.shape[1]) // 2
    square[y:y + crop.shape[0], x:x + crop.shape[1]] = crop
    return cv2.cvtColor(cv2.resize(square, (CROP_SIZE, CROP_SIZE), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)


def classify_crop(crop: np.ndarray) -> tuple[str, float]:
    """Tipo de cabello más probable y su probabilidad según la red."""
    probabilities = _classifier.run(crop.astype(np.float32))
    best = int(probabilities.argmax())
    return HAIR_TYPES[best], round(float(probabilities[best]), 2)


def read_hair(bgr: np.ndarray, face_width: float) -> HairReading | None:
    """Estima el cabello; devuelve None si no se ve lo suficiente (cubierto, muy corto o sin pelo)."""
    mask = segmenter.segment(bgr)
    if mask.sum() < _MIN_HAIR_TO_FACE_AREA * face_width ** 2:
        return None
    hair_type, confidence = classify_crop(hair_crop(bgr, mask))
    lightness = float(np.median(cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[:, :, 0][mask]))
    tone = "DARK" if lightness < _DARK_BELOW else "LIGHT" if lightness > _LIGHT_ABOVE else "MEDIUM"
    return HairReading(hair_type, confidence, tone)
