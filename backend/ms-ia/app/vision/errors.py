"""Rechazos del análisis biométrico. Son resultados esperados: nunca se sustituyen por un diagnóstico inventado."""


class BiometricRejection(Exception):
    """El archivo es válido, pero no permite un diagnóstico; corresponde a un 422."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class UnsupportedMedia(Exception):
    """El contenido no es una imagen ni un video admitidos; corresponde a un 415."""
