"""
Acceso a los demás servicios con el token de quien llama: ms-ia no guarda datos propios
y no puede ver nada que el usuario no pueda ver.
"""
import logging
import re
from typing import Optional

import httpx
from fastapi import Depends

from app.core.config import settings
from app.core.errors import api_error
from app.core.security import AuthenticatedUser, get_bearer_token, get_current_user

logger = logging.getLogger(__name__)
_TIMEOUT = 5
_MEDIA_PATH = re.compile(r"/media/[a-f0-9]{32}")
_MAX_GARMENT_BYTES = 5 * 1024 * 1024


class PlatformClient:
    def __init__(self, token: str, user: AuthenticatedUser):
        self._headers = {"Authorization": f"Bearer {token}"}
        self._user = user

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            return httpx.request(
                method, f"{settings.ASESORIA_URL}{path}", headers=self._headers, timeout=_TIMEOUT, **kwargs
            )
        except httpx.HTTPError as error:
            logger.error("ms-asesoria no responde: %s", type(error).__name__)
            raise api_error(503, "ASESORIA_UNAVAILABLE", "El servicio de asesoría no está disponible.") from error

    def require_consent(self) -> None:
        """Sin una respuesta afirmativa no se analiza nada, tampoco si el servicio de consentimiento falla."""
        response = self._request("GET", "/biometrics/consent")
        if response.status_code != 200:
            raise api_error(503, "CONSENT_UNAVAILABLE", "No se pudo comprobar su consentimiento.")
        if not response.json().get("granted"):
            raise api_error(403, "CONSENT_REQUIRED", "Se necesita su consentimiento biométrico para este diagnóstico.")

    def require_image_consent(self) -> None:
        """Enviar la foto a un tercero exige su propia autorización; ante cualquier duda no se envía."""
        response = self._request("GET", "/biometrics/image-consent")
        if response.status_code != 200:
            raise api_error(503, "CONSENT_UNAVAILABLE", "No se pudo comprobar tu autorización.")
        if not response.json().get("granted"):
            raise api_error(403, "IMAGE_CONSENT_REQUIRED", "Se necesita tu autorización para enviar la foto al generador de imágenes.")

    def closet_garment(self, item_id: str) -> tuple[dict, bytes]:
        """
        Prenda del clóset de quien llama y su foto. Solo se leen imágenes subidas a la plataforma: una URL
        escrita por el usuario haría que este servicio pidiera direcciones internas en su nombre.
        """
        item = next((entry for entry in self.closet() if entry.get("id") == item_id), None)
        if item is None:
            raise api_error(404, "ITEM_NOT_FOUND", "Esa prenda no está en tu clóset.")
        path = item.get("imageUrl") or ""
        if not _MEDIA_PATH.fullmatch(path):
            raise api_error(422, "GARMENT_IMAGE_REQUIRED", "Sube una foto de esta prenda para poder probártela.")
        response = self._request("GET", path)
        if response.status_code != 200 or len(response.content) > _MAX_GARMENT_BYTES:
            raise api_error(503, "ASESORIA_UNAVAILABLE", "No se pudo leer la foto de la prenda.")
        return item, response.content

    def save_diagnosis(self, diagnosis: dict) -> dict:
        response = self._request("POST", "/biometrics/diagnoses", json=diagnosis)
        if response.status_code == 403:
            raise api_error(403, "CONSENT_REQUIRED", "Retiró su consentimiento: el resultado no se guardó.")
        if response.status_code != 201:
            logger.error("ms-asesoria rechazó el diagnóstico: %s", response.status_code)
            raise api_error(503, "DIAGNOSIS_NOT_SAVED", "No se pudo guardar el diagnóstico.")
        return response.json()

    def latest_diagnosis(self) -> Optional[dict]:
        response = self._request("GET", "/biometrics/diagnoses")
        if response.status_code != 200:
            raise api_error(503, "ASESORIA_UNAVAILABLE", "No se pudo leer su diagnóstico.")
        diagnoses = response.json()
        return diagnoses[0] if diagnoses else None

    def closet(self) -> list[dict]:
        response = self._request("GET", f"/closet/client/{self._user.id}")
        if response.status_code != 200:
            raise api_error(503, "ASESORIA_UNAVAILABLE", "No se pudo leer su clóset.")
        return response.json()

    def services(self) -> dict[str, dict]:
        """Catálogo real del salón. Si no responde, las recomendaciones salen sin el enlace para reservar."""
        try:
            response = httpx.post(
                settings.GESTION_GRAPHQL_URL,
                json={"query": "{ getServices { id name price durationMinutes } }"},
                headers=self._headers,
                timeout=_TIMEOUT,
            )
            services = response.json()["data"]["getServices"]
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
            logger.warning("No se pudo leer el catálogo: %s", type(error).__name__)
            return {}
        return {service["id"]: service for service in services}


def get_platform(
    token: str = Depends(get_bearer_token),
    user: AuthenticatedUser = Depends(get_current_user),
) -> PlatformClient:
    return PlatformClient(token, user)
