import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/auth/session.dart';
import 'package:salon_mobile/features/biometrics/face_geometry.dart';

void main() {
  // Casos calculados por ms-ia: el cálculo sin conexión debe dar lo mismo que el del servidor
  final contract = jsonDecode(File('test/fixtures/contrato_clasificadores.json').readAsStringSync()) as Map<String, dynamic>;

  test('forma de rostro igual que el servidor', () {
    for (final item in contract['shapes'] as List) {
      final input = (item['input'] as List).cast<num>().map((value) => value.toDouble()).toList();
      final result = classifyShape(input[0], input[1], input[2]);
      expect(result.name, item['name'], reason: '$input');
      expect(result.confidence, closeTo(item['confidence'] as num, 1e-9), reason: '$input');
    }
  });

  test('subtono igual que el servidor', () {
    for (final item in contract['undertones'] as List) {
      final result = classifyUndertone((item['hue'] as num).toDouble());
      expect(result.name, item['name'], reason: '${item['hue']}');
      expect(result.confidence, closeTo(item['confidence'] as num, 0.011), reason: '${item['hue']}');
    }
  });

  test('color Lab igual que OpenCV', () {
    for (final item in contract['lab'] as List) {
      final rgb = (item['rgb'] as List).cast<int>();
      final lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      final expected = (item['lab'] as List).cast<num>();
      for (var c = 0; c < 3; c++) {
        expect(lab[c], closeTo(expected[c].toDouble(), 1.0), reason: '$rgb canal $c');
      }
    }
  });

  test('la paleta es la misma del servidor', () {
    (contract['palettes'] as Map<String, dynamic>).forEach((name, colors) {
      expect(palettes[name], colors);
    });
  });

  test('tono de cabello por luminosidad', () {
    expect(hairToneOf(40), 'DARK');
    expect(hairToneOf(100), 'MEDIUM');
    expect(hairToneOf(200), 'LIGHT');
  });

  test('la sesión sale del token', () {
    String encode(Map<String, Object> value) => base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
    final token = '${encode({'alg': 'none'})}.${encode({'sub': 'abc', 'salon_id': 'cli-001', 'name': 'Camila', 'exp': 2000000000})}.firma';
    final session = Session.fromToken(token);
    expect(session.userId, 'cli-001');
    expect(session.name, 'Camila');
    expect(expiryOf(token)!.millisecondsSinceEpoch, 2000000000000);
  });
}
