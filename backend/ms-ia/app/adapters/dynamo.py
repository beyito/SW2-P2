"""Llamadas a DynamoDB con su API JSON y firma SigV4, sin depender de un SDK."""
import json

import httpx

from app.adapters.aws_sigv4 import credentials_from_env, sign_request
from app.core.config import settings

CONDITION_FAILED = "ConditionalCheckFailedException"


def dynamo_call(target: str, payload: dict, timeout: float = 3) -> dict:
    """Devuelve la respuesta; una condición no cumplida no es un error, y quien llama decide qué significa."""
    # El cuerpo se serializa aquí para firmar exactamente los bytes que se envían
    body = json.dumps(payload).encode("utf-8")
    headers = sign_request(
        "POST",
        settings.DYNAMODB_ENDPOINT,
        {"Content-Type": "application/x-amz-json-1.0", "X-Amz-Target": f"DynamoDB_20120810.{target}"},
        body,
        "dynamodb",
        credentials_from_env(),
    )
    response = httpx.post(settings.DYNAMODB_ENDPOINT, content=body, headers=headers, timeout=timeout)
    result = response.json()
    if response.status_code != 200 and CONDITION_FAILED not in result.get("__type", ""):
        raise RuntimeError(f"DynamoDB respondió {response.status_code}")
    return result
