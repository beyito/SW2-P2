"""Decodificación de imágenes y videos a partir de sus bytes. Nada queda en disco al terminar."""
import os
import tempfile
from dataclasses import dataclass

# Debe definirse antes de importar OpenCV: una imagen gigante comprimida no debe agotar la memoria
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(40_000_000))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from app.vision.errors import BiometricRejection, UnsupportedMedia  # noqa: E402

IMAGE = "IMAGE"
VIDEO = "VIDEO"

MIN_VIDEO_SECONDS = 3.0
MAX_VIDEO_SECONDS = 5.0
# Una grabación del navegador no dura exactamente lo pedido
_DURATION_TOLERANCE = 0.5
_SAMPLE_EVERY_SECONDS = 0.5
_MAX_LONG_SIDE = 1280
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"mif1", b"msf1"}


def detect_kind(content: bytes) -> str:
    """Identifica el tipo por su contenido; el nombre y el Content-Type los controla quien sube el archivo."""
    if content[:3] == b"\xff\xd8\xff" or content[:8] == b"\x89PNG\r\n\x1a\n":
        return IMAGE
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return IMAGE
    if content[:4] == b"\x1a\x45\xdf\xa3":
        return VIDEO
    if content[4:8] == b"ftyp" and content[8:12] not in _HEIF_BRANDS:
        return VIDEO
    raise UnsupportedMedia("Use una foto JPEG, PNG o WebP, o un video MP4 o WebM.")


def _fit(frame: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    scale = _MAX_LONG_SIDE / max(height, width)
    if scale >= 1:
        return frame
    return cv2.resize(frame, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)


def decode_image(content: bytes) -> np.ndarray:
    # IMREAD_COLOR respeta la orientación EXIF de las fotos de un teléfono
    image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise BiometricRejection("INVALID_IMAGE", "No se pudo leer la imagen. Puede estar dañada o ser demasiado grande.")
    return _fit(image)


@dataclass
class VideoSample:
    frames: list[np.ndarray]
    seconds: float


def _read_samples(path: str) -> VideoSample:
    capture = cv2.VideoCapture(path)
    try:
        if not capture.isOpened():
            raise BiometricRejection("INVALID_VIDEO", "No se pudo leer el video.")
        fps = capture.get(cv2.CAP_PROP_FPS) or 0
        limit = MAX_VIDEO_SECONDS + _DURATION_TOLERANCE
        frames: list[np.ndarray] = []
        count = 0
        seconds = 0.0
        next_sample = 0.0
        while capture.grab():
            count += 1
            # Una grabación WebM del navegador no declara duración: se mide con cada fotograma
            stamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
            seconds = stamp if stamp > 0 else (count / fps if fps > 0 else 0.0)
            if seconds > limit:
                break
            if seconds >= next_sample:
                ok, frame = capture.retrieve()
                if ok:
                    frames.append(_fit(frame))
                    next_sample += _SAMPLE_EVERY_SECONDS
        return VideoSample(frames, seconds)
    finally:
        capture.release()


def read_video(content: bytes) -> VideoSample:
    """Toma un fotograma cada medio segundo y exige la duración de 3 a 5 segundos (RF-04)."""
    # OpenCV solo lee videos desde un archivo: el temporal se borra al salir de este bloque
    with tempfile.NamedTemporaryFile(suffix=".video") as temporary:
        temporary.write(content)
        temporary.flush()
        sample = _read_samples(temporary.name)
    if not sample.frames:
        raise BiometricRejection("INVALID_VIDEO", "No se pudo leer el video.")
    if not MIN_VIDEO_SECONDS - _DURATION_TOLERANCE <= sample.seconds <= MAX_VIDEO_SECONDS + _DURATION_TOLERANCE:
        raise BiometricRejection("VIDEO_DURATION", "El video debe durar de 3 a 5 segundos.")
    return sample
