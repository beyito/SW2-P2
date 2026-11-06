import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

import 'face_geometry.dart';

/// La foto no permite un diagnóstico. Nunca se sustituye por un resultado inventado.
class BiometricRejection implements Exception {
  final String code;
  final String message;
  const BiometricRejection(this.code, this.message);

  @override
  String toString() => message;
}

const _detectorSize = 128;
const _landmarkSize = 256;
const _segmenterSize = 256;
const _cropSize = 224;
const _hairClass = 1;
const _hairTypes = ['STRAIGHT', 'WAVY', 'CURLY'];
const _minHairToFaceArea = 0.25;
const _scoreThreshold = 0.5;
const _overlapThreshold = 0.3;
const _faceScale = 1.5;
const _background = 128;
const _maxSide = 1280;

const _top = 10, _chin = 152, _cheekL = 234, _cheekR = 454, _jawL = 172, _jawR = 397;
const _foreheadL = 54, _foreheadR = 284, _skinL = 50, _skinR = 280;
const _minFaceWidth = 64.0;
const _maxYaw = 20.0, _maxPitch = 25.0;
const _minLightness = 50.0, _maxLightness = 240.0, _minSharpness = 15.0;

class _Box {
  final double x0, y0, x1, y1, score;
  final List<double> eyes;
  _Box(this.x0, this.y0, this.x1, this.y1, this.score, this.eyes);

  double overlap(_Box other) {
    final w = math.max(0.0, math.min(x1, other.x1) - math.max(x0, other.x0));
    final h = math.max(0.0, math.min(y1, other.y1) - math.max(y0, other.y0));
    final intersection = w * h;
    final union = (x1 - x0) * (y1 - y0) + (other.x1 - other.x0) * (other.y1 - other.y0) - intersection;
    return union > 0 ? intersection / union : 0;
  }
}

/// Diagnóstico en el dispositivo, sin red (CU-13). Usa los mismos modelos que ms-ia.
/// La foto solo vive en memoria durante el análisis: el resultado son atributos derivados.
class OnDeviceAnalyzer {
  static const method = 'TFLite en el dispositivo';

  late final Interpreter _detector;
  late final Interpreter _landmarks;
  late final Interpreter _segmenter;
  late final Interpreter _hairClassifier;
  late final List<List<double>> _anchors;
  bool _loaded = false;

  Future<void> load() async {
    if (_loaded) return;
    _detector = await Interpreter.fromAsset('assets/models/face_detector.tflite');
    _landmarks = await Interpreter.fromAsset('assets/models/face_landmarks_detector.tflite');
    _segmenter = await Interpreter.fromAsset('assets/models/selfie_multiclass.tflite');
    _hairClassifier = await Interpreter.fromAsset('assets/models/hair_type.tflite');
    _anchors = [];
    for (final (stride, count) in const [(8, 2), (16, 6)]) {
      final grid = _detectorSize ~/ stride;
      for (var y = 0; y < grid; y++) {
        for (var x = 0; x < grid; x++) {
          for (var i = 0; i < count; i++) {
            _anchors.add([(x + 0.5) / grid, (y + 0.5) / grid]);
          }
        }
      }
    }
    _loaded = true;
  }

  Float32List _run(Interpreter interpreter, Float32List input, int outputIndex) {
    interpreter.getInputTensor(0).data = input.buffer.asUint8List();
    interpreter.invoke();
    return interpreter.getOutputTensor(outputIndex).data.buffer.asFloat32List();
  }

  /// Analiza una foto y devuelve el diagnóstico con el contrato de ms-asesoria.
  Future<Map<String, dynamic>> analyze(Uint8List bytes) async {
    await load();
    final decoded = img.decodeImage(bytes);
    if (decoded == null) {
      throw const BiometricRejection('INVALID_IMAGE', 'No se pudo leer la imagen.');
    }
    var image = img.bakeOrientation(decoded).convert(format: img.Format.uint8, numChannels: 3);
    final longest = math.max(image.width, image.height);
    if (longest > _maxSide) {
      final scale = _maxSide / longest;
      image = img.copyResize(image, width: (image.width * scale).round(), height: (image.height * scale).round(), interpolation: img.Interpolation.average);
    }

    final boxes = _detectFaces(image);
    if (boxes.isEmpty) {
      throw const BiometricRejection('NO_FACE', 'No se detectó ningún rostro. Mira de frente a la cámara, con buena luz.');
    }
    if (boxes.length > 1) {
      throw const BiometricRejection('MULTIPLE_FACES', 'Hay más de un rostro. Debe aparecer solo una persona.');
    }

    final points = _detectLandmarks(image, boxes.first);
    double distance(int a, int b) {
      final dx = points[a][0] - points[b][0], dy = points[a][1] - points[b][1];
      return math.sqrt(dx * dx + dy * dy);
    }

    final cheekWidth = distance(_cheekL, _cheekR);
    if (cheekWidth < _minFaceWidth) {
      throw const BiometricRejection('FACE_TOO_SMALL', 'El rostro está muy lejos. Acércate a la cámara.');
    }
    // La profundidad relativa de cada lado del rostro indica cuánto está girada la cabeza
    final yaw = _degrees(math.atan2(points[_cheekL][2] - points[_cheekR][2], cheekWidth));
    final pitch = _degrees(math.atan2(points[_chin][2] - points[_top][2], distance(_top, _chin)));
    if (yaw.abs() > _maxYaw || pitch.abs() > _maxPitch) {
      throw const BiometricRejection('FACE_NOT_FRONTAL', 'Mira de frente a la cámara, sin girar ni inclinar la cabeza.');
    }

    final skin = _skinLab(image, points[_skinL], points[_skinR], cheekWidth);
    if (skin[0] < _minLightness || skin[0] > _maxLightness) {
      throw const BiometricRejection('BAD_LIGHTING', 'La iluminación no permite el análisis. Busca una luz frontal y uniforme.');
    }
    if (_sharpness(image, [points[_top], points[_chin], points[_cheekL], points[_cheekR]]) < _minSharpness) {
      throw const BiometricRejection('TOO_BLURRY', 'La imagen está borrosa. Mantén la cámara quieta.');
    }

    final shape = classifyShape(distance(_top, _chin) / cheekWidth, distance(_jawL, _jawR) / cheekWidth, distance(_foreheadL, _foreheadR) / cheekWidth);
    final undertone = classifyUndertone(_degrees(math.atan2(skin[2] - 128, skin[1] - 128)));
    final hair = _readHair(image, cheekWidth);

    return {
      'source': 'OFFLINE',
      'faceShape': shape.name,
      'faceShapeConfidence': (math.min(shape.confidence, maxShapeConfidence) * 100).round() / 100,
      'skinUndertone': undertone.name,
      'undertoneConfidence': undertone.confidence,
      'recommendedPalette': palettes[undertone.name],
      'hairType': hair?['type'],
      'hairTypeConfidence': hair?['confidence'],
      'hairTone': hair?['tone'],
      'framesAnalyzed': 1,
      'method': method,
    };
  }

  double _degrees(double radians) => radians * 180 / math.pi;

  /// BlazeFace sobre la imagen con márgenes hasta ser cuadrada.
  List<_Box> _detectFaces(img.Image image) {
    final side = math.max(image.width, image.height);
    final offsetX = (side - image.width) ~/ 2, offsetY = (side - image.height) ~/ 2;
    final input = Float32List(_detectorSize * _detectorSize * 3);
    final square = img.Image(width: side, height: side);
    img.compositeImage(square, image, dstX: offsetX, dstY: offsetY);
    final small = img.copyResize(square, width: _detectorSize, height: _detectorSize, interpolation: img.Interpolation.linear);
    var i = 0;
    for (final pixel in small) {
      input[i++] = pixel.r / 127.5 - 1;
      input[i++] = pixel.g / 127.5 - 1;
      input[i++] = pixel.b / 127.5 - 1;
    }
    _detector.getInputTensor(0).data = input.buffer.asUint8List();
    _detector.invoke();
    final outputs = [_detector.getOutputTensor(0), _detector.getOutputTensor(1)];
    final regressors = outputs.firstWhere((tensor) => tensor.shape.last == 16).data.buffer.asFloat32List();
    final scores = outputs.firstWhere((tensor) => tensor.shape.last == 1).data.buffer.asFloat32List();

    final candidates = <_Box>[];
    for (var n = 0; n < _anchors.length; n++) {
      final score = 1 / (1 + math.exp(-scores[n].clamp(-100.0, 100.0)));
      if (score <= _scoreThreshold) continue;
      final at = n * 16;
      final cx = regressors[at] / _detectorSize + _anchors[n][0];
      final cy = regressors[at + 1] / _detectorSize + _anchors[n][1];
      final w = regressors[at + 2] / _detectorSize, h = regressors[at + 3] / _detectorSize;
      // Se convierte a píxeles de la foto original
      double px(double value) => value * side - offsetX;
      double py(double value) => value * side - offsetY;
      candidates.add(_Box(
        px(cx - w / 2), py(cy - h / 2), px(cx + w / 2), py(cy + h / 2), score,
        [
          px(regressors[at + 4] / _detectorSize + _anchors[n][0]),
          py(regressors[at + 5] / _detectorSize + _anchors[n][1]),
          px(regressors[at + 6] / _detectorSize + _anchors[n][0]),
          py(regressors[at + 7] / _detectorSize + _anchors[n][1]),
        ],
      ));
    }
    candidates.sort((a, b) => b.score.compareTo(a.score));
    final kept = <_Box>[];
    for (final box in candidates) {
      if (kept.every((other) => box.overlap(other) < _overlapThreshold)) kept.add(box);
    }
    return kept;
  }

  /// Malla de 478 puntos, en píxeles de la foto. Recorta el rostro enderezado por la línea de los ojos.
  List<List<double>> _detectLandmarks(img.Image image, _Box box) {
    final cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    final span = math.max(box.x1 - box.x0, box.y1 - box.y0) * _faceScale;
    final angle = math.atan2(box.eyes[3] - box.eyes[1], box.eyes[2] - box.eyes[0]);
    final scale = span / _landmarkSize;
    final cosA = math.cos(angle) * scale, sinA = math.sin(angle) * scale;

    final input = Float32List(_landmarkSize * _landmarkSize * 3);
    var i = 0;
    for (var y = 0; y < _landmarkSize; y++) {
      for (var x = 0; x < _landmarkSize; x++) {
        final u = x - _landmarkSize / 2 + 0.5, v = y - _landmarkSize / 2 + 0.5;
        final pixel = image.getPixelInterpolate(cx + cosA * u - sinA * v, cy + sinA * u + cosA * v, interpolation: img.Interpolation.linear);
        input[i++] = pixel.r / 255;
        input[i++] = pixel.g / 255;
        input[i++] = pixel.b / 255;
      }
    }
    final raw = _run(_landmarks, input, 0);
    return List.generate(478, (n) {
      final u = raw[n * 3] - _landmarkSize / 2, v = raw[n * 3 + 1] - _landmarkSize / 2;
      return [cx + cosA * u - sinA * v, cy + sinA * u + cosA * v, raw[n * 3 + 2] * scale];
    });
  }

  List<double> _skinLab(img.Image image, List<double> left, List<double> right, double faceWidth) {
    final radius = math.max((faceWidth * 0.05).toInt(), 2);
    final total = [0.0, 0.0, 0.0];
    var count = 0;
    for (final center in [left, right]) {
      final cx = center[0].toInt(), cy = center[1].toInt();
      for (var y = math.max(cy - radius, 0); y < math.min(cy + radius, image.height); y++) {
        for (var x = math.max(cx - radius, 0); x < math.min(cx + radius, image.width); x++) {
          final pixel = image.getPixel(x, y);
          final lab = rgbToLab(pixel.r.toInt(), pixel.g.toInt(), pixel.b.toInt());
          for (var c = 0; c < 3; c++) {
            total[c] += lab[c];
          }
          count++;
        }
      }
    }
    if (count == 0) {
      throw const BiometricRejection('NO_FACE', 'El rostro no está completo dentro de la imagen.');
    }
    return total.map((value) => value / count).toList();
  }

  double _sharpness(img.Image image, List<List<double>> corners) {
    final xs = corners.map((point) => point[0]), ys = corners.map((point) => point[1]);
    final x0 = math.max(xs.reduce(math.min).toInt(), 0), y0 = math.max(ys.reduce(math.min).toInt(), 0);
    final x1 = math.min(xs.reduce(math.max).toInt(), image.width), y1 = math.min(ys.reduce(math.max).toInt(), image.height);
    if (x1 <= x0 || y1 <= y0) return 0;
    final crop = img.copyResize(img.copyCrop(image, x: x0, y: y0, width: x1 - x0, height: y1 - y0), width: 128, height: 128, interpolation: img.Interpolation.average);
    final gray = List.generate(128, (y) => List.generate(128, (x) {
          final p = crop.getPixel(x, y);
          return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
        }));
    var sum = 0.0, squares = 0.0, n = 0;
    for (var y = 1; y < 127; y++) {
      for (var x = 1; x < 127; x++) {
        final value = gray[y - 1][x] + gray[y + 1][x] + gray[y][x - 1] + gray[y][x + 1] - 4 * gray[y][x];
        sum += value;
        squares += value * value;
        n++;
      }
    }
    final mean = sum / n;
    return squares / n - mean * mean;
  }

  /// Tipo y tono del cabello; nulo si no se ve lo suficiente.
  Map<String, dynamic>? _readHair(img.Image image, double faceWidth) {
    final small = img.copyResize(image, width: _segmenterSize, height: _segmenterSize, interpolation: img.Interpolation.average);
    final input = Float32List(_segmenterSize * _segmenterSize * 3);
    var i = 0;
    for (final pixel in small) {
      input[i++] = pixel.r / 255;
      input[i++] = pixel.g / 255;
      input[i++] = pixel.b / 255;
    }
    final scores = _run(_segmenter, input, 0);
    bool isHairAt(int x, int y) {
      final sx = x * _segmenterSize ~/ image.width, sy = y * _segmenterSize ~/ image.height;
      final at = (sy * _segmenterSize + sx) * 6;
      var best = 0;
      for (var c = 1; c < 6; c++) {
        if (scores[at + c] > scores[at + best]) best = c;
      }
      return best == _hairClass;
    }

    var minX = image.width, minY = image.height, maxX = -1, maxY = -1, area = 0;
    final lightness = <double>[];
    final mask = List.generate(image.height, (_) => List.filled(image.width, false));
    for (var y = 0; y < image.height; y++) {
      for (var x = 0; x < image.width; x++) {
        if (!isHairAt(x, y)) continue;
        mask[y][x] = true;
        area++;
        minX = math.min(minX, x);
        minY = math.min(minY, y);
        maxX = math.max(maxX, x);
        maxY = math.max(maxY, y);
        final p = image.getPixel(x, y);
        lightness.add(rgbToLab(p.r.toInt(), p.g.toInt(), p.b.toInt())[0]);
      }
    }
    if (area < _minHairToFaceArea * faceWidth * faceWidth) return null;

    final margin = (math.max(maxY - minY + 1, maxX - minX + 1) * 0.1).toInt();
    final left = math.max(minX - margin, 0), top = math.max(minY - margin, 0);
    final right = math.min(maxX + 1 + margin, image.width), bottom = math.min(maxY + 1 + margin, image.height);
    final width = right - left, height = bottom - top;
    final side = math.max(width, height);
    final square = img.Image(width: side, height: side);
    img.fill(square, color: img.ColorRgb8(_background, _background, _background));
    final dx = (side - width) ~/ 2, dy = (side - height) ~/ 2;
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (mask[top + y][left + x]) square.setPixel(dx + x, dy + y, image.getPixel(left + x, top + y));
      }
    }
    final crop = img.copyResize(square, width: _cropSize, height: _cropSize, interpolation: img.Interpolation.average);
    final tensor = Float32List(_cropSize * _cropSize * 3);
    i = 0;
    for (final pixel in crop) {
      tensor[i++] = pixel.r.toDouble();
      tensor[i++] = pixel.g.toDouble();
      tensor[i++] = pixel.b.toDouble();
    }
    final probabilities = _run(_hairClassifier, tensor, 0);
    var best = 0;
    for (var c = 1; c < _hairTypes.length; c++) {
      if (probabilities[c] > probabilities[best]) best = c;
    }
    lightness.sort();
    return {
      'type': _hairTypes[best],
      'confidence': (probabilities[best] * 100).round() / 100,
      'tone': hairToneOf(lightness[lightness.length ~/ 2]),
    };
  }

  void dispose() {
    if (!_loaded) return;
    _detector.close();
    _landmarks.close();
    _segmenter.close();
    _hairClassifier.close();
  }
}
