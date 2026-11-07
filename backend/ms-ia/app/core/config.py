from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    PROJECT_NAME: str = "ms-ia (Motor de Inteligencia Artificial para Salón de Belleza)"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    PORT: int = 8002
    HOST: str = "0.0.0.0"

    # Seguridad: Keycloak y control de sesiones
    KEYCLOAK_ISSUER: str = "http://localhost:8080/realms/salon"
    KEYCLOAK_JWKS_URI: str = "http://localhost:8080/realms/salon/protocol/openid-connect/certs"
    KEYCLOAK_AUDIENCE: str = "salon-api"
    DYNAMODB_ENDPOINT: str = "http://localhost:8000"
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # Servicios de la plataforma
    ASESORIA_URL: str = "http://localhost:3100"
    GESTION_GRAPHQL_URL: str = "http://localhost:8081/graphql"

    # Modelos locales, incluidos en la imagen
    MODELS_DIR: str = "/app/models"

    # Límites de los archivos recibidos
    MAX_SCAN_BYTES: int = 30 * 1024 * 1024
    MAX_AUDIO_BYTES: int = 10 * 1024 * 1024

    # Gemini es opcional: sin clave, los textos de marca personal salen de plantillas
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Replicate es opcional: sin clave, la generación de imágenes responde que no está disponible
    REPLICATE_API_KEY: str = ""
    REPLICATE_HAIRCUT_MODEL: str = "flux-kontext-apps/change-haircut"
    REPLICATE_TRY_ON_MODEL: str = "black-forest-labs/flux-2-max"
    # Cada imagen cuesta dinero real: un cliente no debe poder agotar el saldo del salón
    IMAGE_GEN_DAILY_LIMIT_PER_CLIENT: int = 5
    IMAGE_GEN_DAILY_LIMIT_TOTAL: int = 30
    MAX_IMAGE_GEN_BYTES: int = 15 * 1024 * 1024


settings = Settings()
