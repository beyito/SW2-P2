from fastapi import APIRouter, Depends, File, UploadFile

from app.adapters.platform_client import PlatformClient, get_platform
from app.core.config import settings
from app.core.errors import api_error
from app.core.uploads import read_limited
from app.services.biometrics_service import BiometricsService
from app.vision.errors import BiometricRejection, UnsupportedMedia

router = APIRouter(prefix="/biometrics", tags=["Biometrics"])


@router.post("/scan", status_code=201)
def scan_biometrics(file: UploadFile = File(...), platform: PlatformClient = Depends(get_platform)):
    """
    Diagnóstico facial y capilar a partir de una foto o un video de 3 a 5 segundos (CU-13, RF-04).
    Exige consentimiento vigente, descarta el archivo al terminar y solo guarda el resultado.
    """
    platform.require_consent()
    content = read_limited(file, settings.MAX_SCAN_BYTES)
    try:
        diagnosis = BiometricsService.analyze(content)
    except UnsupportedMedia as error:
        raise api_error(415, "UNSUPPORTED_MEDIA", str(error)) from error
    except BiometricRejection as rejection:
        raise api_error(422, rejection.code, rejection.message) from rejection
    return platform.save_diagnosis(diagnosis)
