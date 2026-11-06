"""Diagnóstico biométrico real a partir de una foto o un video de 3 a 5 segundos (CU-13, RF-04)."""
from collections import Counter
from statistics import median

import numpy as np

from app.vision.errors import BiometricRejection
from app.vision.face import FaceReading, classify_shape, classify_undertone, read_face
from app.vision.hair import read_hair
from app.vision.media import IMAGE, decode_image, detect_kind, read_video

METHOD = "MediaPipe Face Landmarker + TF Lite Multiclass"
_MAX_SHAPE_CONFIDENCE = 0.95
_MIN_VALID_FRAMES = 2
_MIN_VALID_RATIO = 0.5
_MAX_MULTIFACE_RATIO = 0.2
_MAX_HAIR_FRAMES = 3

# Tonos para el cabello y la ropa según el subtono
PALETTES = {
    "WARM": ["Miel", "Caramelo", "Cobre", "Terracota", "Mostaza", "Verde oliva"],
    "COOL": ["Cenizo", "Chocolate frío", "Perla", "Azul marino", "Esmeralda", "Lavanda"],
    "NEUTRAL": ["Avellana", "Rubio beige", "Castaño natural", "Beige", "Verde salvia", "Azul denim"],
}


class BiometricsService:
    @classmethod
    def analyze(cls, content: bytes) -> dict:
        """Analiza los bytes recibidos. No los guarda: el resultado solo contiene atributos derivados."""
        kind = detect_kind(content)
        if kind == IMAGE:
            image = decode_image(content)
            return cls._build(kind, [image], [read_face(image)])
        frames, readings = cls._read_video_frames(read_video(content).frames)
        return cls._build(kind, frames, readings)

    @staticmethod
    def _read_video_frames(frames: list[np.ndarray]) -> tuple[list[np.ndarray], list[FaceReading]]:
        valid_frames, readings, rejections = [], [], []
        for frame in frames:
            try:
                readings.append(read_face(frame))
                valid_frames.append(frame)
            except BiometricRejection as rejection:
                rejections.append(rejection)

        codes = Counter(rejection.code for rejection in rejections)
        if codes["MULTIPLE_FACES"] > _MAX_MULTIFACE_RATIO * len(frames):
            raise next(r for r in rejections if r.code == "MULTIPLE_FACES")
        if len(readings) < max(_MIN_VALID_FRAMES, _MIN_VALID_RATIO * len(frames)):
            if rejections:
                most_common = codes.most_common(1)[0][0]
                raise next(r for r in rejections if r.code == most_common)
            raise BiometricRejection("INVALID_VIDEO", "El video no tiene suficientes fotogramas.")
        return valid_frames, readings

    @classmethod
    def _build(cls, source: str, frames: list[np.ndarray], readings: list[FaceReading]) -> dict:
        shape, probability = classify_shape(
            median(r.length_to_width for r in readings),
            median(r.jaw_to_cheek for r in readings),
            median(r.forehead_to_cheek for r in readings),
        )
        # En un video, la confianza baja si los fotogramas no coinciden entre sí
        votes = [classify_shape(r.length_to_width, r.jaw_to_cheek, r.forehead_to_cheek)[0] for r in readings]
        stability = votes.count(shape) / len(votes)
        undertone, undertone_confidence = classify_undertone(median(r.skin_hue for r in readings))
        hair = cls._read_hair(frames, readings)
        return {
            "source": source,
            "faceShape": shape,
            "faceShapeConfidence": round(min(probability * max(stability, 0.5), _MAX_SHAPE_CONFIDENCE), 2),
            "skinUndertone": undertone,
            "undertoneConfidence": undertone_confidence,
            "recommendedPalette": PALETTES[undertone],
            "hairType": hair["type"],
            "hairTypeConfidence": hair["confidence"],
            "hairTone": hair["tone"],
            "framesAnalyzed": len(readings),
            "method": METHOD,
        }

    @staticmethod
    def _read_hair(frames: list[np.ndarray], readings: list[FaceReading]) -> dict:
        step = max(len(frames) // _MAX_HAIR_FRAMES, 1)
        results = [
            reading
            for frame, face in list(zip(frames, readings))[::step][:_MAX_HAIR_FRAMES]
            if (reading := read_hair(frame, face.face_width_px)) is not None
        ]
        if not results:
            return {"type": None, "confidence": None, "tone": None}
        hair_type = Counter(r.hair_type for r in results).most_common(1)[0][0]
        same_type = [r for r in results if r.hair_type == hair_type]
        return {
            "type": hair_type,
            "confidence": round(median(r.confidence for r in same_type), 2),
            "tone": Counter(r.tone for r in results).most_common(1)[0][0],
        }
