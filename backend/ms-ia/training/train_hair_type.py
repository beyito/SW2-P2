"""
Entrena el clasificador de tipo de cabello (RF-04) y lo exporta a TensorFlow Lite.

Datos: Figaro-1k (espejo nobg/figaro1k de Hugging Face), con la partición original de entrenamiento y prueba.
Las fotos no se incluyen en el repositorio: solo el modelo resultante y sus métricas.
Red: MobileNetV2 preentrenada con ImageNet como extractor de rasgos, más una capa final entrenada aquí.

Se ejecuta dentro de la imagen de ms-ia, con pyarrow instalado aparte:
    python training/train_hair_type.py --data <carpeta con train.parquet y test.parquet> --out models
"""
import argparse
import io
import json
import random
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import pyarrow.parquet as pq
import tensorflow as tf

from app.vision.hair import CROP_SIZE, HAIR_TYPES, hair_crop, segmenter

# Etiquetas de Figaro-1k. Las trenzas, las rastas y el corte corto describen un peinado, no la textura del pelo
LABELS = {"straight": "STRAIGHT", "wavy": "WAVY", "curly": "CURLY", "kinky": "CURLY"}
NAMES = ["straight", "wavy", "curly", "kinky", "braids", "dreadlocks", "short-men"]
AUGMENTED_COPIES = 4
SEED = 7
MIN_MASK_PIXELS = 500


def rows(path: Path):
    """Lee por partes: el archivo completo, ya decodificado, no cabe en la memoria del contenedor."""
    for batch in pq.ParquetFile(path).iter_batches(batch_size=16):
        for row in batch.to_pylist():
            name = NAMES[row["hairstyle"]]
            if name not in LABELS:
                continue
            image = cv2.imdecode(np.frombuffer(row["image"]["bytes"], np.uint8), cv2.IMREAD_COLOR)
            mask = cv2.imdecode(np.frombuffer(row["mask"]["bytes"], np.uint8), cv2.IMREAD_GRAYSCALE) > 127
            yield image, mask, HAIR_TYPES.index(LABELS[name])


def augment(image: np.ndarray, mask: np.ndarray, rng: random.Random) -> tuple[np.ndarray, np.ndarray]:
    """Variaciones plausibles de una foto de cliente: espejo, giro leve, escala, exposición y color."""
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), rng.uniform(-15, 15), rng.uniform(0.9, 1.1))
    image = cv2.warpAffine(image, matrix, (width, height), borderMode=cv2.BORDER_REFLECT)
    mask = cv2.warpAffine(mask.astype(np.uint8), matrix, (width, height), flags=cv2.INTER_NEAREST) > 0
    if rng.random() < 0.5:
        image, mask = cv2.flip(image, 1), cv2.flip(mask.astype(np.uint8), 1) > 0
    image = np.clip(image.astype(np.float32) * rng.uniform(0.75, 1.25) + rng.uniform(-15, 15), 0, 255).astype(np.uint8)
    return image, mask


def build_extractor() -> tf.keras.Model:
    inputs = tf.keras.Input((CROP_SIZE, CROP_SIZE, 3))
    scaled = tf.keras.layers.Rescaling(1 / 127.5, offset=-1)(inputs)
    backbone = tf.keras.applications.MobileNetV2(input_shape=(CROP_SIZE, CROP_SIZE, 3), include_top=False, pooling="avg")
    backbone.trainable = False
    return tf.keras.Model(inputs, backbone(scaled, training=False))


def embed(extractor: tf.keras.Model, crops: list[np.ndarray]) -> np.ndarray:
    return extractor.predict(np.stack(crops).astype(np.float32), batch_size=16, verbose=0)


def report(truth: list[int], predicted: list[int]) -> dict:
    matrix = np.zeros((3, 3), dtype=int)
    for real, guess in zip(truth, predicted):
        matrix[real, guess] += 1
    return {
        "images": len(truth),
        "accuracy": round(float(np.trace(matrix) / max(matrix.sum(), 1)), 3),
        "recall_per_class": {
            name: round(float(matrix[i, i] / max(matrix[i].sum(), 1)), 3) for i, name in enumerate(HAIR_TYPES)
        },
        "confusion_matrix_rows_real": matrix.tolist(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    rng = random.Random(SEED)
    tf.keras.utils.set_random_seed(SEED)
    extractor = build_extractor()

    features, labels = [], []
    pending, pending_labels = [], []
    for image, mask, label in rows(args.data / "train.parquet"):
        for copy in range(AUGMENTED_COPIES + 1):
            varied_image, varied_mask = (image, mask) if copy == 0 else augment(image, mask, rng)
            if varied_mask.sum() < MIN_MASK_PIXELS:
                continue
            pending.append(hair_crop(varied_image, varied_mask))
            pending_labels.append(label)
        if len(pending) >= 64:
            features.append(embed(extractor, pending))
            labels += pending_labels
            pending, pending_labels = [], []
    if pending:
        features.append(embed(extractor, pending))
        labels += pending_labels
    x_train, y_train = np.concatenate(features), np.array(labels)
    print("Muestras de entrenamiento:", Counter(y_train.tolist()))

    # El equilibrio de clases compensa que "rizado" reúne dos etiquetas de Figaro-1k
    counts = Counter(y_train.tolist())
    weights = {label: len(y_train) / (3 * count) for label, count in counts.items()}
    head = tf.keras.Sequential([
        tf.keras.layers.Input((x_train.shape[1],)),
        tf.keras.layers.Dropout(0.4),
        tf.keras.layers.Dense(3, activation="softmax", kernel_regularizer=tf.keras.regularizers.l2(1e-3)),
    ])
    head.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    head.fit(x_train, y_train, epochs=40, batch_size=64, class_weight=weights, verbose=2)

    model = tf.keras.Sequential([extractor, head])
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "hair_type.tflite").write_bytes(converter.convert())

    # Evaluación con el modelo ya exportado, sobre fotos que nunca vio y con el segmentador que se usa en producción
    interpreter = tf.lite.Interpreter(model_path=str(args.out / "hair_type.tflite"))
    interpreter.allocate_tensors()

    def predict(crop: np.ndarray) -> int:
        interpreter.set_tensor(interpreter.get_input_details()[0]["index"], crop.astype(np.float32)[None])
        interpreter.invoke()
        return int(interpreter.get_tensor(interpreter.get_output_details()[0]["index"])[0].argmax())

    truth_real, guess_real, truth_ideal, guess_ideal = [], [], [], []
    for image, mask, label in rows(args.data / "test.parquet"):
        truth_ideal.append(label)
        guess_ideal.append(predict(hair_crop(image, mask)))
        segmented = segmenter.segment(image)
        if segmented.sum() >= MIN_MASK_PIXELS:
            truth_real.append(label)
            guess_real.append(predict(hair_crop(image, segmented)))

    metrics = {
        "dataset": "Figaro-1k (partición de prueba original)",
        "with_production_segmenter": report(truth_real, guess_real),
        "with_ground_truth_masks": report(truth_ideal, guess_ideal),
        "classes": HAIR_TYPES,
    }
    (args.out.parent / "training" / "hair_type_metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False))
    print(json.dumps(metrics, indent=2, ensure_ascii=False))
    print("Tamaño del modelo (MB):", round((args.out / "hair_type.tflite").stat().st_size / 1e6, 1))


if __name__ == "__main__":
    main()
