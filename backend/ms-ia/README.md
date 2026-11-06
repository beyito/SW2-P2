# Microservicio 4: ms-ia

Inferencia de IA en FastAPI. No tiene base de datos: lee y guarda en `ms-asesoria` y `ms-gestion` con el token de quien llama.

| Función | Tecnología | Endpoint |
| :--- | :--- | :--- |
| Diagnóstico de rostro (CU-13) | MediaPipe Face Landmarker, OpenCV | `POST /api/v1/biometrics/scan` |
| Segmentación y tipo de cabello (CU-13) | TensorFlow Lite | Parte del anterior |
| Recomendador (CU-14) | Scikit-Learn | `POST /api/v1/recommendations/styles` |
| Marca personal (CU-16) | Reglas y Gemini | `POST /api/v1/brand/strategy` |
| Voz a texto (CU-18) | Whisper local (`faster-whisper`) | `POST /api/v1/speech/transcribe` |

## Estructura
- `app/api/`: endpoints.
- `app/services/`: casos de uso.
- `app/vision/`: decodificación de archivos y modelos de visión.
- `app/adapters/`: acceso a otros servicios y a Gemini.
- `app/core/`: configuración y seguridad.
- `models/`: clasificador propio. Los demás modelos se descargan al construir la imagen.
- `training/`: entrenamiento del clasificador y sus métricas.
