// Descarga los modelos de visión, verifica su huella y deja en assets/models los que usa la app.
// Son los mismos del servidor: así los puntos del rostro y los umbrales calibrados coinciden.
import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:crypto/crypto.dart';

const _base = 'https://storage.googleapis.com/mediapipe-models';
const _faceTask = '$_base/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const _faceHash = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const _segmenter = '$_base/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const _segmenterHash = 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0';

Future<List<int>> _download(String url, String expected) async {
  final client = HttpClient();
  final response = await (await client.getUrl(Uri.parse(url))).close();
  final bytes = <int>[];
  await response.forEach(bytes.addAll);
  client.close();
  final digest = sha256.convert(bytes).toString();
  if (digest != expected) throw StateError('La huella de $url no coincide: $digest');
  return bytes;
}

Future<void> main() async {
  final target = Directory('assets/models')..createSync(recursive: true);

  final archive = ZipDecoder().decodeBytes(await _download(_faceTask, _faceHash));
  for (final name in ['face_detector.tflite', 'face_landmarks_detector.tflite']) {
    File('${target.path}/$name').writeAsBytesSync(archive.findFile(name)!.content);
  }
  File('${target.path}/selfie_multiclass.tflite').writeAsBytesSync(await _download(_segmenter, _segmenterHash));
  File('../../backend/ms-ia/models/hair_type.tflite').copySync('${target.path}/hair_type.tflite');
  stdout.writeln('Modelos listos en ${target.path}');
}
