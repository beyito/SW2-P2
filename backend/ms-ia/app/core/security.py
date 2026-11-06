"""Seguridad de ms-ia: validación de tokens de Keycloak y control de sesiones (RF-01, CU-01, CU-02)."""
from dataclasses import dataclass, field
from typing import Optional, Protocol

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

_TABLE = "ActiveUserSessions"
_CONDITION_FAILED = "ConditionalCheckFailedException"
_EIGHT_HOURS = 28800


@dataclass
class AuthenticatedUser:
    subject: str
    id: str
    name: str
    roles: list[str] = field(default_factory=list)
    session_id: Optional[str] = None


class SessionRegistry(Protocol):
    def is_revoked(self, session_id: str) -> bool: ...

    def find_active(self, user_id: str) -> Optional[tuple[str, int]]: ...

    def claim_active(self, user_id: str, session_id: str, auth_time: int) -> bool: ...


class DynamoSessionRegistry:
    """Registro de sesiones sobre la tabla ActiveUserSessions de DynamoDB."""

    def _call(self, target: str, payload: dict) -> dict:
        response = httpx.post(
            settings.DYNAMODB_ENDPOINT,
            json=payload,
            headers={
                "Content-Type": "application/x-amz-json-1.0",
                "X-Amz-Target": f"DynamoDB_20120810.{target}",
                "Authorization": "AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, "
                                 "SignedHeaders=host, Signature=local",
            },
            timeout=3,
        )
        body = response.json()
        if response.status_code != 200 and _CONDITION_FAILED not in body.get("__type", ""):
            raise RuntimeError(f"DynamoDB respondió {response.status_code}")
        return body

    def _get(self, key: str) -> Optional[dict]:
        return self._call(
            "GetItem",
            {"TableName": _TABLE, "ConsistentRead": True, "Key": {"userId": {"S": key}}},
        ).get("Item")

    def is_revoked(self, session_id: str) -> bool:
        return self._get(f"revoked#{session_id}") is not None

    def find_active(self, user_id: str) -> Optional[tuple[str, int]]:
        item = self._get(user_id)
        if item is None:
            return None
        return item["sessionId"]["S"], int(item["loginTimestamp"]["N"])

    def claim_active(self, user_id: str, session_id: str, auth_time: int) -> bool:
        result = self._call("PutItem", {
            "TableName": _TABLE,
            "Item": {
                "userId": {"S": user_id},
                "sessionId": {"S": session_id},
                "loginTimestamp": {"N": str(auth_time)},
                "ttl": {"N": str(auth_time + _EIGHT_HOURS)},
            },
            "ConditionExpression": "attribute_not_exists(userId) OR loginTimestamp < :t OR sessionId = :s",
            "ExpressionAttributeValues": {":t": {"N": str(auth_time)}, ":s": {"S": session_id}},
        })
        return _CONDITION_FAILED not in result.get("__type", "")


_jwks_client = jwt.PyJWKClient(settings.KEYCLOAK_JWKS_URI, cache_keys=True, lifespan=300)
_session_registry: SessionRegistry = DynamoSessionRegistry()
_bearer = HTTPBearer(auto_error=False)


def _unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": code, "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_token(token: str) -> dict:
    """Verifica firma RS256, emisor, audiencia y vigencia del token."""
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.KEYCLOAK_ISSUER,
            audience=settings.KEYCLOAK_AUDIENCE,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except (jwt.PyJWTError, httpx.HTTPError) as error:
        raise _unauthorized("TOKEN_INVALID", "Token de acceso inválido o vencido.") from error


def _holds_active_session(user: AuthenticatedUser, auth_time: int) -> bool:
    active = _session_registry.find_active(user.subject)
    if active is not None and active[0] == user.session_id:
        return True
    if active is not None and auth_time <= active[1]:
        return False
    return _session_registry.claim_active(user.subject, user.session_id, auth_time)


def assert_session_valid(user: AuthenticatedUser, auth_time: int) -> None:
    """Rechaza sesiones cerradas y aplica sesión única a ADMIN: gana el login más reciente."""
    # Las cuentas de servicio no tienen sesión de usuario
    if user.session_id is None:
        return
    try:
        if _session_registry.is_revoked(user.session_id):
            raise _unauthorized("SESSION_CLOSED", "La sesión fue cerrada.")
        if "ADMIN" in user.roles and not _holds_active_session(user, auth_time):
            raise _unauthorized("SESSION_SUPERSEDED", "Se inició una sesión más reciente en otro dispositivo.")
    except (RuntimeError, httpx.HTTPError, ValueError, KeyError) as error:
        raise _unauthorized("SESSION_UNAVAILABLE", "No se pudo verificar la sesión.") from error


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> AuthenticatedUser:
    """Dependencia de FastAPI que exige un token válido y una sesión vigente."""
    if credentials is None:
        raise _unauthorized("TOKEN_MISSING", "Token de acceso no proporcionado.")
    claims = verify_token(credentials.credentials)
    user = AuthenticatedUser(
        subject=claims["sub"],
        id=claims.get("salon_id", claims["sub"]),
        name=claims.get("name", claims.get("preferred_username", "Usuario")),
        roles=claims.get("realm_access", {}).get("roles", []),
        session_id=claims.get("sid"),
    )
    assert_session_valid(user, int(claims.get("auth_time", 0)))
    return user
