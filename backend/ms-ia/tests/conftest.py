from pathlib import Path

import cv2
import numpy as np
import pytest

from app.adapters.platform_client import PlatformClient, get_platform
from app.core.security import AuthenticatedUser, get_bearer_token, get_current_user
from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"


class FakePlatform(PlatformClient):
    """Sustituye a ms-asesoria y ms-gestion, y registra lo que se les envió."""

    def __init__(self):
        self.consent = True
        self.saved = []
        self.diagnosis = None
        self.items = []
        self.catalog = {"srv-03": {"id": "srv-03", "name": "Corte", "price": 45.0, "durationMinutes": 45}}
        self.consent_checks = 0
        self.image_consent = False
        self.garments = {}

    def require_consent(self):
        from app.core.errors import api_error
        self.consent_checks += 1
        if not self.consent:
            raise api_error(403, "CONSENT_REQUIRED", "Se necesita su consentimiento.")

    def require_image_consent(self):
        from app.core.errors import api_error
        if not self.image_consent:
            raise api_error(403, "IMAGE_CONSENT_REQUIRED", "Se necesita su autorización.")

    def closet_garment(self, item_id):
        from app.core.errors import api_error
        if item_id not in self.garments:
            raise api_error(404, "ITEM_NOT_FOUND", "Esa prenda no está en su clóset.")
        return self.garments[item_id]

    def closet_items(self, item_ids):
        from app.core.errors import api_error
        if any(item_id not in self.garments for item_id in item_ids):
            raise api_error(404, "ITEM_NOT_FOUND", "Esa prenda no está en su clóset.")
        return [self.garments[item_id][0] for item_id in item_ids]

    def garment_photo(self, item):
        return self.garments[item["id"]][1]

    def save_diagnosis(self, diagnosis):
        self.saved.append(diagnosis)
        return {"id": "diag-1", **diagnosis}

    def latest_diagnosis(self):
        return self.diagnosis

    def closet(self):
        return self.items

    def services(self):
        return self.catalog


@pytest.fixture(autouse=True)
def usuario_autenticado():
    """Las pruebas funcionales corren como un cliente autenticado; test_security valida la autenticación real."""
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        subject="usuario-prueba", id="cli-001", name="Camila", roles=["CLIENT"]
    )
    app.dependency_overrides[get_bearer_token] = lambda: "token-de-prueba"
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def plataforma():
    fake = FakePlatform()
    app.dependency_overrides[get_platform] = lambda: fake
    return fake


@pytest.fixture(scope="session")
def retrato():
    """Foto real de dominio público (NASA, Eileen Collins), recortada a la cabeza y los hombros."""
    image = cv2.imread(str(FIXTURES / "retrato.png"), cv2.IMREAD_COLOR)
    assert image is not None
    return image[0:300, 100:360]


def png(image: np.ndarray) -> bytes:
    return cv2.imencode(".png", image)[1].tobytes()


def jpeg(image: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", image)[1].tobytes()


def video(frames: list[np.ndarray], seconds: float, tmp_path: Path, fps: int = 10) -> bytes:
    """Video MP4 real con los fotogramas dados, repetidos hasta completar la duración."""
    path = str(tmp_path / "video.mp4")
    height, width = frames[0].shape[:2]
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    assert writer.isOpened()
    for index in range(int(seconds * fps)):
        writer.write(frames[index % len(frames)])
    writer.release()
    return Path(path).read_bytes()
