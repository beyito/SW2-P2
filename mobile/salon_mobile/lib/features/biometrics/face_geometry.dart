import 'dart:math' as math;

/// Clasificación de rostro y subtono: el mismo cálculo y los mismos valores calibrados que ms-ia,
/// para que un diagnóstico sin conexión sea comparable con uno del servidor.
const shapeCentroids = <String, List<double>>{
  'OVAL': [1.19, 0.805, 0.84],
  'ROUND': [1.11, 0.815, 0.835],
  'SQUARE': [1.16, 0.835, 0.85],
  'HEART': [1.19, 0.775, 0.875],
  'OBLONG': [1.27, 0.805, 0.84],
};
const _shapeScale = [0.06, 0.022, 0.026];

const _coolBelow = 45.0;
const _warmAbove = 63.0;
const _hueSpread = 10.0;
const _maxUndertoneConfidence = 0.75;
const maxShapeConfidence = 0.95;

const palettes = <String, List<String>>{
  'WARM': ['Miel', 'Caramelo', 'Cobre', 'Terracota', 'Mostaza', 'Verde oliva'],
  'COOL': ['Cenizo', 'Chocolate frío', 'Perla', 'Azul marino', 'Esmeralda', 'Lavanda'],
  'NEUTRAL': ['Avellana', 'Rubio beige', 'Castaño natural', 'Beige', 'Verde salvia', 'Azul denim'],
};

class Classification {
  final String name;
  final double confidence;
  const Classification(this.name, this.confidence);
}

double _round2(double value) => (value * 100).round() / 100;

/// Forma más cercana y su probabilidad frente a las demás.
Classification classifyShape(double lengthToWidth, double jawToCheek, double foreheadToCheek) {
  final point = [lengthToWidth, jawToCheek, foreheadToCheek];
  final distances = <String, double>{};
  shapeCentroids.forEach((name, centroid) {
    var total = 0.0;
    for (var i = 0; i < 3; i++) {
      final z = (point[i] - centroid[i]) / _shapeScale[i];
      total += z * z;
    }
    distances[name] = total;
  });
  final minimum = distances.values.reduce(math.min);
  final weights = distances.map((name, distance) => MapEntry(name, math.exp(-(distance - minimum) / 2)));
  final sum = weights.values.reduce((a, b) => a + b);
  final best = weights.entries.reduce((a, b) => b.value > a.value ? b : a);
  return Classification(best.key, best.value / sum);
}

/// Subtono por el ángulo de tono de la piel; cerca de un límite, la confianza es baja.
Classification classifyUndertone(double hue) {
  String name;
  double margin;
  if (hue < _coolBelow) {
    name = 'COOL';
    margin = _coolBelow - hue;
  } else if (hue > _warmAbove) {
    name = 'WARM';
    margin = hue - _warmAbove;
  } else {
    name = 'NEUTRAL';
    margin = math.min(hue - _coolBelow, _warmAbove - hue);
  }
  final confidence = 0.4 + (_maxUndertoneConfidence - 0.4) * math.min(margin / _hueSpread, 1.0);
  return Classification(name, _round2(confidence));
}

/// Conversión de sRGB a Lab con la escala de 8 bits de OpenCV, que es la que usan los umbrales.
List<double> rgbToLab(int r, int g, int b) {
  double linear(int channel) {
    final c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
  }

  final lr = linear(r), lg = linear(g), lb = linear(b);
  final x = (0.412453 * lr + 0.357580 * lg + 0.180423 * lb) / 0.950456;
  final y = 0.212671 * lr + 0.715160 * lg + 0.072169 * lb;
  final z = (0.019334 * lr + 0.119193 * lg + 0.950227 * lb) / 1.088754;
  double f(double t) => t > 0.008856 ? math.pow(t, 1 / 3).toDouble() : 7.787 * t + 16 / 116;
  final l = y > 0.008856 ? 116 * math.pow(y, 1 / 3) - 16 : 903.3 * y;
  return [l * 255 / 100, 500 * (f(x) - f(y)) + 128, 200 * (f(y) - f(z)) + 128];
}

/// Tono del cabello según su luminosidad mediana.
String hairToneOf(double lightness) => lightness < 70 ? 'DARK' : (lightness > 130 ? 'LIGHT' : 'MEDIUM');
