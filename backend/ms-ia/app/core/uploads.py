"""Lectura segura de archivos subidos."""
from fastapi import UploadFile

from app.core.errors import api_error


def read_limited(file: UploadFile, limit: int) -> bytes:
    """Lee el archivo en memoria sin pasar del límite; los bytes solo viven durante la petición."""
    content = file.file.read(limit + 1)
    if len(content) > limit:
        raise api_error(413, "FILE_TOO_LARGE", f"El archivo supera los {limit // (1024 * 1024)} MB permitidos.")
    if not content:
        raise api_error(422, "EMPTY_FILE", "El archivo está vacío.")
    return content
