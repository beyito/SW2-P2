"""
Cuota diaria de imágenes generadas, porque cada una cuesta dinero real.
Vive en DynamoDB y no en ms-asesoria: el cliente no puede llamar a esta tabla para devolverse cupos.
"""
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Protocol

import httpx

from app.adapters.dynamo import CONDITION_FAILED, dynamo_call
from app.core.config import settings
from app.core.errors import api_error

logger = logging.getLogger(__name__)
_TABLE = "ImageGenerationQuota"
_TWO_DAYS = 172800
_TOTAL = "total"
# Un cupo vale dinero: conviene esperar a la base de datos antes que rechazar al cliente
_TIMEOUT = 10


class ImageQuota(Protocol):
    def reserve(self, client_id: str) -> int: ...

    def release(self, client_id: str) -> None: ...


def _day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class DynamoImageQuota:
    def _take(self, owner: str, limit: int) -> Optional[int]:
        """Suma uno solo si queda cupo: la condición es atómica, así que dos peticiones a la vez no lo rebasan."""
        result = dynamo_call("UpdateItem", {
            "TableName": _TABLE,
            "Key": {"quotaKey": {"S": f"{owner}#{_day()}"}},
            "UpdateExpression": "ADD used :one SET #ttl = :ttl",
            "ConditionExpression": "attribute_not_exists(used) OR used < :limit",
            "ExpressionAttributeNames": {"#ttl": "ttl"},
            "ExpressionAttributeValues": {
                ":one": {"N": "1"},
                ":limit": {"N": str(limit)},
                ":ttl": {"N": str(int(time.time()) + _TWO_DAYS)},
            },
            "ReturnValues": "UPDATED_NEW",
        }, timeout=_TIMEOUT)
        if CONDITION_FAILED in result.get("__type", ""):
            return None
        return int(result["Attributes"]["used"]["N"])

    def _give_back(self, owner: str) -> None:
        dynamo_call("UpdateItem", {
            "TableName": _TABLE,
            "Key": {"quotaKey": {"S": f"{owner}#{_day()}"}},
            "UpdateExpression": "ADD used :minus",
            "ConditionExpression": "used > :zero",
            "ExpressionAttributeValues": {":minus": {"N": "-1"}, ":zero": {"N": "0"}},
        }, timeout=_TIMEOUT)

    def reserve(self, client_id: str) -> int:
        """Aparta un cupo y devuelve los que le quedan hoy. Si no se puede comprobar, no se gasta."""
        try:
            used = self._take(f"client#{client_id}", settings.IMAGE_GEN_DAILY_LIMIT_PER_CLIENT)
            if used is None:
                raise api_error(
                    429, "IMAGE_QUOTA_EXCEEDED",
                    f"Alcanzaste el límite de {settings.IMAGE_GEN_DAILY_LIMIT_PER_CLIENT} imágenes por día. Vuelve a intentarlo mañana.",
                )
            if self._take(_TOTAL, settings.IMAGE_GEN_DAILY_LIMIT_TOTAL) is None:
                self._give_back(f"client#{client_id}")
                raise api_error(429, "IMAGE_QUOTA_EXCEEDED", "El salón alcanzó su límite de imágenes de hoy. Vuelve a intentarlo mañana.")
        except (RuntimeError, httpx.HTTPError, KeyError, ValueError) as error:
            logger.error("No se pudo comprobar la cuota: %s", type(error).__name__)
            raise api_error(503, "QUOTA_UNAVAILABLE", "No se pudo comprobar tu cupo de imágenes.") from error
        return settings.IMAGE_GEN_DAILY_LIMIT_PER_CLIENT - used

    def release(self, client_id: str) -> None:
        """Devuelve el cupo de una imagen que no llegó a generarse."""
        try:
            self._give_back(f"client#{client_id}")
            self._give_back(_TOTAL)
        except (RuntimeError, httpx.HTTPError, ValueError) as error:
            # El cliente pierde un cupo de hoy; no justifica ocultarle el error original
            logger.error("No se pudo devolver el cupo: %s", type(error).__name__)


def get_image_quota() -> ImageQuota:
    return DynamoImageQuota()
