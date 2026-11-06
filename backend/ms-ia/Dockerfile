FROM python:3.11-slim

WORKDIR /app

# libglib y libgl son las bibliotecas de sistema que requiere OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# mediapipe declara jax, pero la API de Tasks que se usa aquí no lo necesita: quitarlo ahorra unos 400 MB
RUN pip install --no-cache-dir -r requirements.txt && pip uninstall -y jax jaxlib

# Los modelos quedan dentro de la imagen, verificados por su huella: el servicio nunca descarga nada al ejecutarse
COPY scripts/download_models.py ./scripts/
RUN python scripts/download_models.py /app/models
# Clasificador propio de tipo de cabello: ver training/train_hair_type.py
COPY models/hair_type.tflite ./models/

COPY app/ ./app/

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
