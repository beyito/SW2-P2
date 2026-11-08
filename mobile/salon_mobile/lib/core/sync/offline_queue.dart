import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../auth/session.dart';

/// Operación guardada en el dispositivo.
class QueuedOperation {
  static const pending = 'PENDING';
  static const conflict = 'CONFLICT';

  final String id;
  final String kind;
  final String label;
  final String url;
  final String method;
  final String? body;
  final String idempotencyKey;
  final String status;
  final String? error;

  QueuedOperation.fromRow(Map<String, Object?> row)
      : id = row['id'] as String,
        kind = row['kind'] as String,
        label = row['label'] as String,
        url = row['url'] as String,
        method = row['method'] as String,
        body = row['body'] as String?,
        idempotencyKey = row['idempotency_key'] as String,
        status = row['status'] as String,
        error = row['error'] as String?;
}

/// Cola de operaciones en SQLite (RF-10, CU-22). Sigue las mismas reglas que la de la web:
/// conserva el orden y reenviar no duplica, porque cada operación conserva su Idempotency-Key (RNF-04).
class OfflineQueue {
  final Database _db;
  final TokenProvider _tokens;
  final http.Client _http;
  final void Function()? onSessionLost;
  final _changes = StreamController<void>.broadcast();
  final _uuid = const Uuid();
  Future<bool>? _running;

  OfflineQueue(this._db, this._tokens, this._http, {this.onSessionLost});

  /// Avisa cada vez que cambia la cola.
  Stream<void> get changes => _changes.stream;

  Future<QueuedOperation> enqueue({
    required String kind,
    required String label,
    required String url,
    required String method,
    Object? body,
    String? idempotencyKey,
  }) async {
    final id = _uuid.v4();
    await _db.insert('queue', {
      'id': id,
      'kind': kind,
      'label': label,
      'url': url,
      'method': method,
      'body': body == null ? null : jsonEncode(body),
      'idempotency_key': idempotencyKey ?? _uuid.v4(),
      'status': QueuedOperation.pending,
      'created_at': DateTime.now().microsecondsSinceEpoch,
    });
    _changes.add(null);
    return (await list()).firstWhere((item) => item.id == id);
  }

  Future<List<QueuedOperation>> list() async {
    final rows = await _db.query('queue', orderBy: 'created_at ASC');
    return rows.map(QueuedOperation.fromRow).toList();
  }

  Future<void> discard(String id) async {
    await _db.delete('queue', where: 'id = ?', whereArgs: [id]);
    _changes.add(null);
  }

  /// Operaciones de un tipo que siguen pendientes de envío.
  Future<List<QueuedOperation>> pendingOf(String kind) async =>
      (await list()).where((item) => item.kind == kind && item.status == QueuedOperation.pending).toList();

  /// Retira de la cola las operaciones de un tipo; por ejemplo, los diagnósticos al revocar el consentimiento.
  Future<void> discardKind(String kind) async {
    await _db.delete('queue', where: 'kind = ?', whereArgs: [kind]);
    _changes.add(null);
  }

  /// Vacía la cola en orden; varias llamadas simultáneas comparten el mismo envío.
  Future<bool> sync() {
    return _running ??= _run().whenComplete(() => _running = null);
  }

  Future<bool> _run() async {
    for (final item in await list()) {
      if (item.status != QueuedOperation.pending) continue;
      final proceed = await _send(item);
      _changes.add(null);
      if (!proceed) return false;
    }
    return true;
  }

  /// Devuelve falso si conviene detenerse y volver a intentar más tarde.
  Future<bool> _send(QueuedOperation item) async {
    http.Response response;
    try {
      final request = http.Request(item.method, Uri.parse(item.url))
        ..headers['Idempotency-Key'] = item.idempotencyKey
        ..headers['Authorization'] = 'Bearer ${await _tokens.token()}';
      if (item.body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = item.body!;
      }
      response = await http.Response.fromStream(await _http.send(request));
    } catch (_) {
      return false;
    }
    if (response.statusCode == 401) {
      onSessionLost?.call();
      return false;
    }
    // Un error del servidor puede ser pasajero: se conserva el orden y se reintenta después
    if (response.statusCode >= 500) return false;
    final ok = response.statusCode >= 200 && response.statusCode < 300 && _graphqlError(response) == null;
    if (ok || (item.method == 'DELETE' && response.statusCode == 404)) {
      await _db.delete('queue', where: 'id = ?', whereArgs: [item.id]);
      return true;
    }
    // Rechazo definitivo: decide el usuario, nunca se pierde en silencio
    await _db.update(
      'queue',
      {'status': QueuedOperation.conflict, 'error': _messageOf(response)},
      where: 'id = ?',
      whereArgs: [item.id],
    );
    return true;
  }

  /// GraphQL informa los rechazos con HTTP 200 y una lista de errores: sin esto se perderían en silencio.
  String? _graphqlError(http.Response response) {
    try {
      // Tolerante con bytes mal codificados: un rechazo nunca debe confundirse con un éxito
      final body = jsonDecode(utf8.decode(response.bodyBytes, allowMalformed: true));
      final errors = body is Map ? body['errors'] : null;
      return errors is List && errors.isNotEmpty ? '${errors.first['message']}' : null;
    } catch (_) {
      return null;
    }
  }

  String _messageOf(http.Response response) {
    final graphql = _graphqlError(response);
    if (graphql != null) return graphql;
    try {
      final body = jsonDecode(utf8.decode(response.bodyBytes));
      final detail = body['detail'];
      return (detail is Map ? detail['message'] : detail) ?? body['message'] ?? 'El servicio respondió ${response.statusCode}.';
    } catch (_) {
      return 'El servicio respondió ${response.statusCode}.';
    }
  }

  void dispose() => _changes.close();
}
