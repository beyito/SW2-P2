import pytest

from app.core.security import AuthenticatedUser, get_current_user
from app.main import app


@pytest.fixture(autouse=True)
def usuario_autenticado():
    """Las pruebas funcionales corren como un cliente autenticado; test_security valida la autenticación real."""
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        subject="usuario-prueba", id="cli-001", name="Camila", roles=["CLIENT"]
    )
    yield
    app.dependency_overrides.clear()
