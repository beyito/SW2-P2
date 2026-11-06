from fastapi import APIRouter, UploadFile, File
from app.services.biometrics_service import BiometricsService

router = APIRouter(prefix="/biometrics", tags=["Biometrics"])

@router.post("/scan")
async def scan_biometrics(file: UploadFile = File(None)):
    """
    Diagnóstico biométrico facial y capilar a partir de foto o video (CU-13, RF-04)
    """
    filename = file.filename if file else "sample_input.jpg"
    result = BiometricsService.analyze_scan(filename=filename)
    return result
