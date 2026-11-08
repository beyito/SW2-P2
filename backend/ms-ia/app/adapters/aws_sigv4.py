"""Firma de peticiones a AWS con Signature Version 4.

DynamoDB real la exige; DynamoDB Local acepta cualquier firma, así que el mismo código sirve en ambos.
"""
import hashlib
import hmac
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import parse_qsl, quote, urlsplit


@dataclass(frozen=True)
class Credentials:
    access_key_id: str
    secret_access_key: str
    session_token: str | None
    region: str


def credentials_from_env(env=None) -> Credentials:
    """Sin credenciales en el entorno se usan unas de relleno, válidas solo para DynamoDB Local."""
    env = os.environ if env is None else env
    return Credentials(
        access_key_id=env.get("AWS_ACCESS_KEY_ID") or "local",
        secret_access_key=env.get("AWS_SECRET_ACCESS_KEY") or "local",
        session_token=env.get("AWS_SESSION_TOKEN") or None,
        region=env.get("AWS_REGION") or env.get("AWS_DEFAULT_REGION") or "us-east-1",
    )


def _hmac(key: bytes, data: str) -> bytes:
    return hmac.new(key, data.encode("utf-8"), hashlib.sha256).digest()


def sign_request(method: str, url: str, headers: dict, body: bytes, service: str,
                 credentials: Credentials, now: datetime | None = None) -> dict:
    """Devuelve las cabeceras firmadas. Las cabeceras recibidas deben ser todas las que se enviarán."""
    address = urlsplit(url)
    amz_date = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    day = amz_date[:8]
    extra = {"X-Amz-Date": amz_date}
    if credentials.session_token:
        extra["X-Amz-Security-Token"] = credentials.session_token

    normalized = {
        name.lower(): re.sub(r"\s+", " ", str(value).strip())
        for name, value in {**headers, **extra, "Host": address.netloc}.items()
    }
    names = sorted(normalized)
    signed_headers = ";".join(names)
    canonical_headers = "".join(f"{name}:{normalized[name]}\n" for name in names)
    # Consulta canónica: cada par codificado según RFC 3986 y ordenado
    query = "&".join(
        f"{key}={value}" for key, value in sorted(
            (quote(k, safe="-_.~"), quote(v, safe="-_.~"))
            for k, v in parse_qsl(address.query, keep_blank_values=True)
        )
    )

    canonical = "\n".join([
        method, address.path or "/", query, canonical_headers, signed_headers, hashlib.sha256(body).hexdigest(),
    ])
    scope = f"{day}/{credentials.region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    ])
    key = _hmac(("AWS4" + credentials.secret_access_key).encode("utf-8"), day)
    for part in (credentials.region, service, "aws4_request"):
        key = _hmac(key, part)
    signature = hmac.new(key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    return {
        **headers,
        **extra,
        "Authorization": f"AWS4-HMAC-SHA256 Credential={credentials.access_key_id}/{scope}, "
                         f"SignedHeaders={signed_headers}, Signature={signature}",
    }
