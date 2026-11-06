"""Transcripción de voz a texto con Whisper, local y sin enviar el audio a terceros (CU-18, RF-11)."""
import io
import threading
from pathlib import Path

from faster_whisper import WhisperModel

from app.core.config import settings
from app.vision.errors import BiometricRejection, UnsupportedMedia

MAX_AUDIO_SECONDS = 60
# Orienta al modelo hacia el vocabulario del negocio
_PROMPT = "Consulta sobre un salón de belleza: citas, ingresos, facturas, puntos, estilistas, insumos y stock."


def _is_audio(content: bytes) -> bool:
    return (
        content[:4] == b"\x1a\x45\xdf\xa3"
        or content[:4] == b"OggS"
        or (content[:4] == b"RIFF" and content[8:12] == b"WAVE")
        or content[:3] == b"ID3"
        or content[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")
        or content[4:8] == b"ftyp"
    )


class _Whisper:
    """Se carga con la primera consulta: solo el administrador la usa y ocupa memoria."""

    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def transcribe(self, content: bytes) -> dict:
        with self._lock:
            if self._model is None:
                self._model = WhisperModel(
                    str(Path(settings.MODELS_DIR) / "whisper-base"), device="cpu", compute_type="int8"
                )
            try:
                segments, info = self._model.transcribe(
                    io.BytesIO(content), language="es", vad_filter=True, initial_prompt=_PROMPT
                )
                if info.duration > MAX_AUDIO_SECONDS:
                    raise BiometricRejection("AUDIO_TOO_LONG", f"El audio no puede pasar de {MAX_AUDIO_SECONDS} segundos.")
                # Los segmentos se generan al recorrerlos: aquí ocurre la transcripción
                text = "".join(segment.text for segment in segments).strip()
            except BiometricRejection:
                raise
            except Exception as error:
                # El decodificador lanza sus propias excepciones según el formato dañado
                raise BiometricRejection("INVALID_AUDIO", "No se pudo leer el audio.") from error
        return {"text": text, "duration_seconds": round(info.duration, 1)}


_whisper = _Whisper()


class SpeechService:
    @staticmethod
    def transcribe(content: bytes) -> dict:
        if not _is_audio(content):
            raise UnsupportedMedia("Use audio WebM, Ogg, WAV, MP3 o M4A.")
        result = _whisper.transcribe(content)
        if not result["text"]:
            raise BiometricRejection("NO_SPEECH", "No se entendió ninguna frase. Hable más cerca del micrófono.")
        return result
