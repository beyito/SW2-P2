"""
Generación de imágenes con un proveedor externo. Solo recibe imágenes y opciones cerradas:
nunca el nombre del cliente ni texto escrito por él. Cambiar de proveedor solo exige otra clase con esta interfaz.
"""
import base64
import logging
import time
from dataclasses import dataclass
from typing import Optional, Protocol
from urllib.parse import urlparse

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)
_API = "https://api.replicate.com/v1"
_POLL_SECONDS = 1.0
_DEADLINE_SECONDS = 100
_MAX_RETRIES_THROTTLED = 2
_MAX_WAIT_THROTTLED = 12
_MAX_OUTPUT_BYTES = 20 * 1024 * 1024
_OUTPUT_HOST = "replicate.delivery"
_REJECTED_WORDS = ("sensitive", "nsfw", "flagged", "safety", "moderation")
# El filtro de la API rechaza el identificador por defecto de algunos clientes HTTP
_USER_AGENT = "salon-ms-ia/2.0"

GARMENT_PLACEMENT = {
    "TOP": "replacing their current top",
    "BOTTOM": "replacing their current pants, shorts or skirt",
    "OUTERWEAR": "worn naturally over their current top",
}
_TRY_ON_PROMPT = (
    "Virtual try-on. The first image shows a person; the second image shows a garment. Dress the person from the first "
    "image with the exact garment from the second image, {placement}, preserving the garment's color, fabric and cut. "
    "Ignore any hanger, mannequin or hand holding the garment. Keep the person's face, identity, skin tone, hair, body "
    "proportions, pose, all other clothing and the background exactly as in the first image."
)
_ORDINALS = ("second", "third", "fourth")
_GARMENT_NOUN = {"TOP": "a top", "BOTTOM": "pants or shorts", "OUTERWEAR": "a jacket or coat"}
# Orden de las prendas en la solicitud: el abrigo va al final porque se describe sobre la parte superior
OUTFIT_ORDER = ("TOP", "BOTTOM", "OUTERWEAR")


def try_on_prompt(categories: list[str]) -> str:
    """Instrucción fija según las categorías: nunca incluye el nombre de la prenda ni texto del cliente."""
    if len(categories) == 1:
        return _TRY_ON_PROMPT.format(placement=GARMENT_PLACEMENT[categories[0]])
    shows = " ".join(f"The {_ORDINALS[i]} image shows {_GARMENT_NOUN[c]}." for i, c in enumerate(categories))
    places = {
        "TOP": "the top from the {ordinal} image replacing their current top",
        "BOTTOM": "the bottoms from the {ordinal} image replacing their current pants, shorts or skirt",
        "OUTERWEAR": "the jacket or coat from the {ordinal} image worn naturally over " + ("the top" if "TOP" in categories else "their current top"),
    }
    placement = ", and ".join(places[c].format(ordinal=_ORDINALS[i]) for i, c in enumerate(categories))
    amount = "both garments" if len(categories) == 2 else "all the garments"
    return (
        f"Virtual try-on. The first image shows a person. {shows} Dress the person from the first image with {amount} "
        f"at the same time: {placement}. Preserve each garment's exact color, fabric, print and cut, and do not mix details "
        "between garments. Ignore any hanger, mannequin or hand holding a garment. Keep the person's face, identity, skin tone, "
        "hair, body proportions, pose, footwear and the background exactly as in the first image."
    )


class ImageGenerationError(Exception):
    """La imagen no se generó; el cupo reservado se devuelve."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _busy() -> ImageGenerationError:
    return ImageGenerationError(503, "IMAGE_SERVICE_BUSY", "El generador está ocupado. Espera unos segundos y vuelve a intentarlo.")


def _failed() -> ImageGenerationError:
    return ImageGenerationError(502, "IMAGE_GENERATION_FAILED", "No se pudo generar la imagen. Inténtalo de nuevo más tarde.")


def data_uri(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")


@dataclass
class GeneratedImage:
    data: bytes
    media_type: str


class ImageGenerator(Protocol):
    def haircut(self, photo: bytes, haircut: str, hair_color: str, gender: str) -> GeneratedImage: ...

    def try_on(self, photo: bytes, garments: list[tuple[bytes, str]], width: int, height: int) -> GeneratedImage: ...


class ReplicateImageGenerator:
    def __init__(self, client: Optional[httpx.Client] = None, sleep=time.sleep):
        self._client = client or httpx.Client(timeout=30)
        self._sleep = sleep

    def _call(self, method: str, url: str, **kwargs) -> httpx.Response:
        headers = {"Authorization": f"Bearer {settings.REPLICATE_API_KEY}", "User-Agent": _USER_AGENT}
        try:
            return self._client.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as error:
            logger.error("Replicate no responde: %s", type(error).__name__)
            raise _failed() from error

    def _create(self, model: str, inputs: dict) -> dict:
        """Con poco crédito la API admite una petición cada pocos segundos: se espera lo que indica antes de desistir."""
        for attempt in range(_MAX_RETRIES_THROTTLED + 1):
            response = self._call("POST", f"{_API}/models/{model}/predictions", json={"input": inputs})
            if response.status_code != 429:
                break
            if attempt == _MAX_RETRIES_THROTTLED:
                raise _busy()
            self._sleep(self._retry_after(response))
        if response.status_code == 402:
            logger.error("Replicate rechazó el cobro: crédito insuficiente")
            raise ImageGenerationError(503, "IMAGE_CREDIT_EXHAUSTED", "La generación de imágenes no está disponible por ahora.")
        if response.status_code != 201:
            logger.error("Replicate respondió %s al crear la predicción", response.status_code)
            raise _failed()
        return response.json()

    @staticmethod
    def _retry_after(response: httpx.Response) -> float:
        try:
            return min(float(response.json().get("retry_after", _MAX_WAIT_THROTTLED)), _MAX_WAIT_THROTTLED)
        except (ValueError, TypeError, AttributeError):
            return _MAX_WAIT_THROTTLED

    def _wait(self, prediction: dict) -> dict:
        waited = 0.0
        while prediction.get("status") not in ("succeeded", "failed", "canceled"):
            if waited >= _DEADLINE_SECONDS:
                # Se cancela para que no siga consumiendo crédito una imagen que nadie va a ver
                self._call("POST", f"{_API}/predictions/{prediction['id']}/cancel")
                logger.error("La predicción superó el tiempo máximo")
                raise _failed()
            self._sleep(_POLL_SECONDS)
            waited += _POLL_SECONDS
            response = self._call("GET", f"{_API}/predictions/{prediction['id']}")
            if response.status_code != 200:
                logger.error("Replicate respondió %s al consultar la predicción", response.status_code)
                raise _failed()
            prediction = response.json()
        return prediction

    def _download(self, url: str) -> GeneratedImage:
        address = urlparse(url)
        host = address.hostname or ""
        # La respuesta de un tercero no debe hacer que este servicio pida direcciones internas
        if address.scheme != "https" or not (host == _OUTPUT_HOST or host.endswith(f".{_OUTPUT_HOST}")):
            logger.error("Replicate devolvió un origen inesperado")
            raise _failed()
        try:
            response = self._client.get(url, headers={"User-Agent": _USER_AGENT}, timeout=60)
        except httpx.HTTPError as error:
            logger.error("No se pudo descargar el resultado: %s", type(error).__name__)
            raise _failed() from error
        data = response.content
        if response.status_code != 200 or not data or len(data) > _MAX_OUTPUT_BYTES:
            logger.error("Resultado no válido: %s", response.status_code)
            raise _failed()
        if data[:3] == b"\xff\xd8\xff":
            return GeneratedImage(data, "image/jpeg")
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return GeneratedImage(data, "image/png")
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return GeneratedImage(data, "image/webp")
        logger.error("El resultado no es una imagen")
        raise _failed()

    def _run(self, model: str, inputs: dict) -> GeneratedImage:
        prediction = self._wait(self._create(model, inputs))
        if prediction.get("status") != "succeeded":
            detail = str(prediction.get("error") or "").lower()
            # Solo se registra el estado: el texto del proveedor podría repetir datos de la solicitud
            logger.error("Predicción terminada en %s", prediction.get("status"))
            if any(word in detail for word in _REJECTED_WORDS):
                raise ImageGenerationError(422, "IMAGE_REJECTED", "El proveedor rechazó esta foto. Prueba con otra foto tuya.")
            raise _failed()
        output = prediction.get("output")
        url = output[0] if isinstance(output, list) and output else output
        if not isinstance(url, str):
            logger.error("La predicción no devolvió una imagen")
            raise _failed()
        logger.info("Imagen generada; uso: %s", prediction.get("metrics"))
        return self._download(url)

    def haircut(self, photo: bytes, haircut: str, hair_color: str, gender: str) -> GeneratedImage:
        return self._run(settings.REPLICATE_HAIRCUT_MODEL, {
            "input_image": data_uri(photo),
            "haircut": haircut,
            "hair_color": hair_color,
            "gender": gender,
            "output_format": "jpg",
        })

    def try_on(self, photo: bytes, garments: list[tuple[bytes, str]], width: int, height: int) -> GeneratedImage:
        return self._run(settings.REPLICATE_TRY_ON_MODEL, {
            "prompt": try_on_prompt([category for _, category in garments]),
            "input_images": [data_uri(photo), *(data_uri(image) for image, _ in garments)],
            "aspect_ratio": "custom",
            "width": width,
            "height": height,
            "output_format": "jpg",
        })


def get_image_generator() -> ImageGenerator:
    return ReplicateImageGenerator()
