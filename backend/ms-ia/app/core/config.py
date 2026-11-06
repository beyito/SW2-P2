from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    PROJECT_NAME: str = "ms-ia (Motor de Inteligencia Artificial para Salón de Belleza)"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    PORT: int = 8002
    HOST: str = "0.0.0.0"

    # Seguridad: Keycloak y control de sesiones
    KEYCLOAK_ISSUER: str = "http://localhost:8080/realms/salon"
    KEYCLOAK_JWKS_URI: str = "http://localhost:8080/realms/salon/protocol/openid-connect/certs"
    KEYCLOAK_AUDIENCE: str = "salon-api"
    DYNAMODB_ENDPOINT: str = "http://localhost:8000"
    ALLOWED_ORIGINS: str = "http://localhost:3000"


settings = Settings()
