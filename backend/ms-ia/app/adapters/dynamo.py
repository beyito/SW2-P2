"""Llamadas a DynamoDB con su API JSON, sin depender de un SDK."""
import httpx

from app.core.config import settings

CONDITION_FAILED = "ConditionalCheckFailedException"


def dynamo_call(target: str, payload: dict, timeout: float = 3) -> dict:
    """Devuelve la respuesta; una condición no cumplida no es un error, y quien llama decide qué significa."""
    response = httpx.post(
        settings.DYNAMODB_ENDPOINT,
        json=payload,
        headers={
            "Content-Type": "application/x-amz-json-1.0",
            "X-Amz-Target": f"DynamoDB_20120810.{target}",
            "Authorization": "AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, "
                             "SignedHeaders=host, Signature=local",
        },
        timeout=timeout,
    )
    body = response.json()
    if response.status_code != 200 and CONDITION_FAILED not in body.get("__type", ""):
        raise RuntimeError(f"DynamoDB respondió {response.status_code}")
    return body
