import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../auth/session.dart';
import '../sync/offline_queue.dart';

/// Error que entiende el usuario, con el código del servicio si lo hay.
class ApiException implements Exception {
  final String message;
  final String? code;
  final int? status;
  const ApiException(this.message, {this.code, this.status});

  @override
  String toString() => message;
}

/// La petición no llegó al servidor.
class OfflineException extends ApiException {
  const OfflineException([super.message = 'Sin conexión.']);
}

/// Resultado de una escritura.
class WriteResult {
  final bool queued;
  final dynamic data;
  const WriteResult({required this.queued, this.data});
}

const _timeout = Duration(seconds: 12);

/// Cliente de los servicios: las lecturas guardan una copia local y las escrituras
/// sin conexión pasan a la cola, con la misma llave de idempotencia del primer intento.
class ApiClient {
  final Database _db;
  final TokenProvider _tokens;
  final http.Client _http;
  final OfflineQueue queue;
  final _uuid = const Uuid();

  ApiClient(this._db, this._tokens, this._http, this.queue);

  Future<Map<String, String>> _auth() async => {'Authorization': 'Bearer ${await _tokens.token()}'};

  dynamic _parse(http.Response response) {
    final text = utf8.decode(response.bodyBytes);
    final body = text.isEmpty ? null : _tryDecode(text);
    if (response.statusCode >= 200 && response.statusCode < 300) return body;
    final detail = body is Map ? body['detail'] : null;
    throw ApiException(
      (detail is Map ? detail['message'] : null) ?? (body is Map ? body['message'] : null) ?? 'El servicio respondió ${response.statusCode}.',
      code: detail is Map ? detail['code'] as String? : (body is Map ? body['code'] as String? : null),
      status: response.statusCode,
    );
  }

  dynamic _tryDecode(String text) {
    try {
      return jsonDecode(text);
    } catch (_) {
      return text;
    }
  }

  Future<void> _cachePut(String key, Object? value) =>
      _db.insert('cache', {'key': key, 'value': jsonEncode(value)}, conflictAlgorithm: ConflictAlgorithm.replace);

  Future<dynamic> _cacheGet(String key) async {
    final rows = await _db.query('cache', where: 'key = ?', whereArgs: [key]);
    return rows.isEmpty ? null : jsonDecode(rows.first['value'] as String);
  }

  Future<void> clearCacheEntry(String key) => _db.delete('cache', where: 'key = ?', whereArgs: [key]);

  /// Lectura con copia local: sin conexión devuelve lo último que se vio.
  Future<dynamic> read(String url) async {
    try {
      final response = await _http.get(Uri.parse(url), headers: await _auth()).timeout(_timeout);
      final data = _parse(response);
      await _cachePut(url, data);
      return data;
    } on ApiException {
      rethrow;
    } catch (_) {
      final saved = await _cacheGet(url);
      if (saved == null) throw const OfflineException();
      return saved;
    }
  }

  /// Consulta GraphQL con copia local.
  Future<dynamic> graphql(String url, String query) async {
    final key = '$url#$query';
    try {
      final response = await _http
          .post(Uri.parse(url), headers: {...await _auth(), 'Content-Type': 'application/json'}, body: jsonEncode({'query': query}))
          .timeout(_timeout);
      final body = _parse(response) as Map<String, dynamic>;
      final errors = body['errors'] as List?;
      if (errors != null && errors.isNotEmpty) throw ApiException(errors.first['message'] as String);
      await _cachePut(key, body['data']);
      return body['data'];
    } on ApiException {
      rethrow;
    } catch (_) {
      final saved = await _cacheGet(key);
      if (saved == null) throw const OfflineException();
      return saved;
    }
  }

  /// Escritura que requiere conexión, como aceptar el consentimiento.
  Future<dynamic> send(String method, String url, {Object? body}) async {
    try {
      final request = http.Request(method, Uri.parse(url))..headers.addAll(await _auth());
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      return _parse(await http.Response.fromStream(await _http.send(request).timeout(_timeout)));
    } on ApiException {
      rethrow;
    } catch (_) {
      throw const OfflineException();
    }
  }

  /// Escritura que no se pierde: la llave existe desde antes del primer intento.
  Future<WriteResult> write(String kind, String label, String method, String url, {Object? body}) async {
    final key = _uuid.v4();
    try {
      final request = http.Request(method, Uri.parse(url))
        ..headers.addAll(await _auth())
        ..headers['Idempotency-Key'] = key;
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      return WriteResult(queued: false, data: _parse(await http.Response.fromStream(await _http.send(request).timeout(_timeout))));
    } on ApiException {
      rethrow;
    } catch (_) {
      await queue.enqueue(kind: kind, label: label, url: url, method: method, body: body, idempotencyKey: key);
      return const WriteResult(queued: true);
    }
  }

  /// Sube un archivo a ms-ia para analizarlo en el servidor.
  Future<dynamic> upload(String url, List<int> bytes, String filename) async {
    try {
      final request = http.MultipartRequest('POST', Uri.parse(url))
        ..headers.addAll(await _auth())
        ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
      final streamed = await _http.send(request).timeout(const Duration(seconds: 90));
      return _parse(await http.Response.fromStream(streamed));
    } on ApiException {
      rethrow;
    } catch (_) {
      throw const OfflineException();
    }
  }
}
