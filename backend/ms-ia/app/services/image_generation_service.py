"""
Simulación de cortes, color y ropa sobre la foto del propio cliente.
La foto solo vive durante la petición: se reduce, se comprueba aquí y se envía. No se guarda ni la foto ni el resultado.
"""
import base64
from typing import Callable

import cv2
import numpy as np

from app.adapters.image_generator import GARMENT_PLACEMENT, OUTFIT_ORDER, GeneratedImage, ImageGenerationError, ImageGenerator
from app.adapters.image_quota import ImageQuota
from app.core.errors import api_error
from app.services.recommendation_service import CATALOG_BY_ID, PREVIEWS
from app.vision.errors import BiometricRejection
from app.vision.face import landmarker
from app.vision.media import IMAGE, decode_image, detect_kind

SIMULATION_LABEL = "Simulación generada con IA: el resultado real puede variar."
# El proveedor cobra por megapíxel redondeado hacia arriba: mantenerse bajo 1 MP evita pagar el doble
_MAX_PIXELS = 1_000_000
_GRID = 16
_MIN_SIDE = 256
# El proveedor recomienda datos en línea solo hasta este tamaño
_MAX_INLINE_BYTES = 256 * 1024
_JPEG_QUALITIES = (88, 80, 72, 64, 56)
# Si el rostro ocupa más que esto de la altura, la foto no muestra el cuerpo y la prenda no tendría dónde ir
_MAX_FACE_HEIGHT_FOR_TRY_ON = 0.30
_HAIR_GENDERS = {"FEMALE": "female", "MALE": "male"}
_MIN_OUTFIT = 2
_MAX_OUTFIT = len(OUTFIT_ORDER)


def reduce_to_one_megapixel(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, (_MAX_PIXELS / (height * width)) ** 0.5)
    if scale == 1.0:
        return image
    return cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)


def encode_jpeg(image: np.ndarray) -> bytes:
    encoded = b""
    for quality in _JPEG_QUALITIES:
        encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])[1].tobytes()
        if len(encoded) <= _MAX_INLINE_BYTES:
            break
    return encoded


def output_size(image: np.ndarray) -> tuple[int, int]:
    """Tamaño de salida con la proporción de la foto, en múltiplos de 16 y sin pasar de 1 MP."""
    height, width = image.shape[:2]
    scale = (_MAX_PIXELS / (height * width)) ** 0.5
    return (
        max(_MIN_SIDE, min(int(width * scale) // _GRID * _GRID, 2048)),
        max(_MIN_SIDE, min(int(height * scale) // _GRID * _GRID, 2048)),
    )


def read_person_photo(content: bytes, require_body: bool = False) -> np.ndarray:
    """Comprueba aquí mismo que hay una sola persona, para no enviar ni pagar por una foto que no sirve."""
    if detect_kind(content) != IMAGE:
        raise BiometricRejection("IMAGE_REQUIRED", "Usa una foto, no un video.")
    image = decode_image(content)
    faces = landmarker.detect(image).face_landmarks
    # El detector está pensado para rostros cercanos: en una foto de cuerpo entero la cabeza puede quedar muy pequeña
    distant = require_body and not faces and _has_distant_face(image)
    if not faces and not distant:
        raise BiometricRejection("NO_FACE", "No se detectó ningún rostro. Usa una foto donde se te vea de frente, con buena luz.")
    if len(faces) > 1:
        raise BiometricRejection("MULTIPLE_FACES", "Hay más de un rostro. Debe aparecer solo una persona.")
    if require_body and faces:
        heights = [point.y for point in faces[0]]
        if max(heights) - min(heights) > _MAX_FACE_HEIGHT_FOR_TRY_ON:
            raise BiometricRejection("FULL_BODY_REQUIRED", "Para probar ropa usa una foto de cuerpo entero o de la cintura para arriba.")
    return reduce_to_one_megapixel(image)


def _has_distant_face(image: np.ndarray) -> bool:
    """Busca en tres zonas de la mitad superior, donde una persona de pie tiene la cabeza."""
    height, width = image.shape[:2]
    side = min(height // 2, width)
    starts = {0, (width - side) // 2, width - side}
    return any(landmarker.detect(image[0:side, start:start + side]).face_landmarks for start in starts)


def _read_garment(content: bytes) -> np.ndarray:
    decoded = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise BiometricRejection("INVALID_GARMENT_IMAGE", "No se pudo leer la foto de la prenda. Vuelve a subirla.")
    return reduce_to_one_megapixel(decoded)


def check_outfit(items: list[dict]) -> list[dict]:
    """Valida el conjunto antes de leer fotos o gastar, y lo ordena como lo espera la instrucción al modelo."""
    if not _MIN_OUTFIT <= len(items) <= _MAX_OUTFIT:
        raise api_error(422, "OUTFIT_SIZE", f"Elige de {_MIN_OUTFIT} a {_MAX_OUTFIT} prendas para probarte el conjunto.")
    categories = [item.get("category") for item in items]
    if any(category not in GARMENT_PLACEMENT for category in categories):
        raise api_error(422, "GARMENT_NOT_SUPPORTED", "Solo se pueden probar prendas superiores, inferiores y abrigos.")
    if len(set(categories)) != len(categories):
        raise api_error(422, "OUTFIT_DUPLICATE_CATEGORY", "Elige una sola prenda de cada tipo: superior, inferior y abrigo.")
    return sorted(items, key=lambda item: OUTFIT_ORDER.index(item["category"]))


def _response(image: GeneratedImage, remaining: int, **extra) -> dict:
    return {
        "image_base64": base64.b64encode(image.data).decode("ascii"),
        "media_type": image.media_type,
        "label": SIMULATION_LABEL,
        "remaining_today": remaining,
        **extra,
    }


class ImageGenerationService:
    def __init__(self, generator: ImageGenerator, quota: ImageQuota):
        self._generator = generator
        self._quota = quota

    def _spend(self, client_id: str, generate: Callable[[], GeneratedImage]) -> tuple[GeneratedImage, int]:
        """Aparta el cupo antes de gastar y lo devuelve si la imagen no llegó a generarse."""
        remaining = self._quota.reserve(client_id)
        try:
            return generate(), remaining
        except ImageGenerationError as error:
            self._quota.release(client_id)
            raise api_error(error.status, error.code, error.message) from error
        except Exception:
            self._quota.release(client_id)
            raise

    def haircut(self, client_id: str, photo: bytes, style_id: str) -> dict:
        preview = PREVIEWS.get(style_id)
        if preview is None:
            raise api_error(422, "STYLE_NOT_PREVIEWABLE", "Este estilo no se puede simular en una imagen.")
        image = read_person_photo(photo)
        gender = _HAIR_GENDERS.get(CATALOG_BY_ID[style_id].get("audience"), "none")
        result, remaining = self._spend(client_id, lambda: self._generator.haircut(
            encode_jpeg(image), preview["haircut"], preview["hair_color"], gender,
        ))
        return _response(result, remaining, style_id=style_id, approximate=preview["approximate"])

    def try_on(self, client_id: str, photo: bytes, item: dict, garment: bytes) -> dict:
        if item.get("category") not in GARMENT_PLACEMENT:
            raise api_error(422, "GARMENT_NOT_SUPPORTED", "Solo se pueden probar prendas superiores, inferiores y abrigos.")
        result, remaining = self._dress(client_id, photo, [(item, garment)])
        return _response(result, remaining, item_id=item["id"], approximate=False)

    def try_on_outfit(self, client_id: str, photo: bytes, garments: list[tuple[dict, bytes]]) -> dict:
        """Varias prendas en una sola imagen: cuenta como un solo cupo."""
        result, remaining = self._dress(client_id, photo, garments)
        return _response(result, remaining, item_ids=[item["id"] for item, _ in garments], approximate=False)

    def _dress(self, client_id: str, photo: bytes, garments: list[tuple[dict, bytes]]) -> tuple[GeneratedImage, int]:
        image = read_person_photo(photo, require_body=True)
        prepared = [(encode_jpeg(_read_garment(content)), item["category"]) for item, content in garments]
        width, height = output_size(image)
        return self._spend(client_id, lambda: self._generator.try_on(encode_jpeg(image), prepared, width, height))
