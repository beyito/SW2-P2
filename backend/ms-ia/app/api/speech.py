from fastapi import APIRouter, Depends, File, UploadFile

from app.core.config import settings
from app.core.errors import api_error
from app.core.security import require_roles
from app.core.uploads import read_limited
from app.services.speech_service import SpeechService
from app.vision.errors import BiometricRejection, UnsupportedMedia

router = APIRouter(prefix="/speech", tags=["Speech"])


@router.post("/transcribe", dependencies=[Depends(require_roles("ADMIN"))])
def transcribe(file: UploadFile = File(...)):
    """Convierte en texto la pregunta hablada del administrador; el reporte lo genera el Servidor MCP (CU-18)."""
    content = read_limited(file, settings.MAX_AUDIO_BYTES)
    try:
        return SpeechService.transcribe(content)
    except UnsupportedMedia as error:
        raise api_error(415, "UNSUPPORTED_MEDIA", str(error)) from error
    except BiometricRejection as rejection:
        raise api_error(422, rejection.code, rejection.message) from rejection
