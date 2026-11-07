from fastapi import APIRouter, Depends, File, Form, Response, UploadFile

from app.adapters.image_generator import ImageGenerator, get_image_generator
from app.adapters.image_quota import ImageQuota, get_image_quota
from app.adapters.platform_client import PlatformClient, get_platform
from app.core.config import settings
from app.core.errors import api_error
from app.core.security import AuthenticatedUser, get_current_user
from app.core.uploads import read_limited
from app.services.image_generation_service import ImageGenerationService, check_outfit
from app.vision.errors import BiometricRejection, UnsupportedMedia

router = APIRouter(prefix="/image-generation", tags=["Image Generation"])


def _service(
    generator: ImageGenerator = Depends(get_image_generator),
    quota: ImageQuota = Depends(get_image_quota),
) -> ImageGenerationService:
    return ImageGenerationService(generator, quota)


def _require_ready(platform: PlatformClient) -> None:
    if not settings.REPLICATE_API_KEY:
        raise api_error(503, "IMAGE_GENERATION_DISABLED", "La generación de imágenes no está configurada.")
    platform.require_image_consent()


def _with_rejections(action):
    try:
        return action()
    except UnsupportedMedia as error:
        raise api_error(415, "UNSUPPORTED_MEDIA", str(error)) from error
    except BiometricRejection as rejection:
        raise api_error(422, rejection.code, rejection.message) from rejection


@router.post("/haircut", status_code=201)
def preview_haircut(
    response: Response,
    file: UploadFile = File(...),
    style_id: str = Form(..., max_length=40),
    user: AuthenticatedUser = Depends(get_current_user),
    platform: PlatformClient = Depends(get_platform),
    service: ImageGenerationService = Depends(_service),
):
    """Simula un corte o color del catálogo sobre la foto del cliente; requiere su autorización expresa."""
    _require_ready(platform)
    response.headers["Cache-Control"] = "no-store"
    content = read_limited(file, settings.MAX_IMAGE_GEN_BYTES)
    return _with_rejections(lambda: service.haircut(user.id, content, style_id))


@router.post("/try-on", status_code=201)
def preview_garment(
    response: Response,
    file: UploadFile = File(...),
    item_id: str = Form(..., max_length=64),
    user: AuthenticatedUser = Depends(get_current_user),
    platform: PlatformClient = Depends(get_platform),
    service: ImageGenerationService = Depends(_service),
):
    """Simula una prenda del clóset del propio cliente sobre su foto; requiere su autorización expresa."""
    _require_ready(platform)
    response.headers["Cache-Control"] = "no-store"
    content = read_limited(file, settings.MAX_IMAGE_GEN_BYTES)
    item, garment = platform.closet_garment(item_id)
    return _with_rejections(lambda: service.try_on(user.id, content, item, garment))


@router.post("/try-on-outfit", status_code=201)
def preview_outfit(
    response: Response,
    file: UploadFile = File(...),
    item_ids: str = Form(..., max_length=300, description="Identificadores de las prendas, separados por comas."),
    user: AuthenticatedUser = Depends(get_current_user),
    platform: PlatformClient = Depends(get_platform),
    service: ImageGenerationService = Depends(_service),
):
    """Simula un conjunto de prendas del clóset del propio cliente en una sola imagen; requiere su autorización expresa."""
    _require_ready(platform)
    response.headers["Cache-Control"] = "no-store"
    content = read_limited(file, settings.MAX_IMAGE_GEN_BYTES)
    ids = [item_id.strip() for item_id in item_ids.split(",") if item_id.strip()]
    items = check_outfit(platform.closet_items(ids))
    garments = [(item, platform.garment_photo(item)) for item in items]
    return _with_rejections(lambda: service.try_on_outfit(user.id, content, garments))
