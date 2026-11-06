"""Descarga los modelos durante la construcción de la imagen y verifica su huella SHA-256."""
import hashlib
import sys
import urllib.request
from pathlib import Path

from huggingface_hub import snapshot_download

MEDIAPIPE = "https://storage.googleapis.com/mediapipe-models"
MODELS = {
    "face_landmarker.task": (
        f"{MEDIAPIPE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    ),
    "selfie_multiclass.tflite": (
        f"{MEDIAPIPE}/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
        "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0",
    ),
}
WHISPER_REPO = "Systran/faster-whisper-base"
WHISPER_REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"


def main(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in MODELS.items():
        path = target / name
        urllib.request.urlretrieve(url, path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected:
            raise SystemExit(f"La huella de {name} no coincide: {digest}")
    snapshot_download(
        WHISPER_REPO,
        revision=WHISPER_REVISION,
        local_dir=target / "whisper-base",
        allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*"],
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]))
