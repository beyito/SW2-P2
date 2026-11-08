import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:salon_mobile/core/auth/session.dart';
import 'package:salon_mobile/core/database/local_database.dart';
import 'package:salon_mobile/core/sync/offline_queue.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class FakeTokens implements TokenProvider {
  @override
  Future<String?> token() async => 'token-prueba';
}

void main() {
  sqfliteFfiInit();

  late Database db;

  setUp(() async {
    db = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(version: 1, onCreate: LocalDatabase.createSchema, singleInstance: false),
    );
  });

  tearDown(() => db.close());

  OfflineQueue queueWith(Future<http.Response> Function(http.Request) handler, {void Function()? onSessionLost}) =>
      OfflineQueue(db, FakeTokens(), MockClient(handler), onSessionLost: onSessionLost);

  Future<void> add(OfflineQueue queue, [String name = 'Blazer', String method = 'POST']) =>
      queue.enqueue(kind: 'CLOSET', label: 'Agregar $name', url: 'http://api/closet', method: method, body: method == 'DELETE' ? null : {'name': name});

  test('guarda sin enviar', () async {
    var calls = 0;
    final queue = queueWith((_) async {
      calls++;
      return http.Response('{}', 201);
    });
    await add(queue);
    expect((await queue.list()).single.status, QueuedOperation.pending);
    expect(calls, 0);
  });

  test('envía token, cuerpo y llave, y retira la operación', () async {
    late http.Request received;
    final queue = queueWith((request) async {
      received = request;
      return http.Response('{}', 201);
    });
    await queue.enqueue(kind: 'CLOSET', label: 'x', url: 'http://api/closet', method: 'POST', body: {'name': 'Blazer'}, idempotencyKey: 'llave-1');
    await queue.sync();
    expect(received.headers['Authorization'], 'Bearer token-prueba');
    expect(received.headers['Idempotency-Key'], 'llave-1');
    expect(received.body, '{"name":"Blazer"}');
    expect(await queue.list(), isEmpty);
  });

  test('respeta el orden', () async {
    final seen = <String>[];
    final queue = queueWith((request) async {
      seen.add(request.body);
      return http.Response('{}', 201);
    });
    await add(queue, 'a');
    await add(queue, 'b');
    await add(queue, 'c');
    await queue.sync();
    expect(seen, ['{"name":"a"}', '{"name":"b"}', '{"name":"c"}']);
  });

  test('sin red conserva la operación y reintenta con la misma llave', () async {
    final keys = <String?>[];
    var fail = true;
    final queue = queueWith((request) async {
      keys.add(request.headers['Idempotency-Key']);
      if (fail) throw http.ClientException('sin red');
      return http.Response('{}', 201);
    });
    await add(queue);
    expect(await queue.sync(), isFalse);
    expect(await queue.list(), hasLength(1));
    fail = false;
    expect(await queue.sync(), isTrue);
    expect(await queue.list(), isEmpty);
    expect(keys[0], keys[1]);
  });

  test('un error del servidor detiene el envío sin saltarse el orden', () async {
    var calls = 0;
    final queue = queueWith((_) async {
      calls++;
      return http.Response('{}', 503);
    });
    await add(queue, 'a');
    await add(queue, 'b');
    await queue.sync();
    expect(calls, 1);
    expect(await queue.list(), hasLength(2));
  });

  test('un rechazo queda como conflicto, no bloquea ni se reenvía', () async {
    final responses = [http.Response('{"message":"Sin consentimiento"}', 403), http.Response('{}', 201)];
    var calls = 0;
    final queue = queueWith((_) async {
      calls++;
      return responses.removeAt(0);
    });
    await add(queue, 'a');
    await add(queue, 'b');
    await queue.sync();
    final items = await queue.list();
    expect(items.single.status, QueuedOperation.conflict);
    expect(items.single.error, 'Sin consentimiento');
    await queue.sync();
    expect(calls, 2);
    await queue.discard(items.single.id);
    expect(await queue.list(), isEmpty);
  });

  test('un rechazo de GraphQL con HTTP 200 queda como conflicto con su mensaje', () async {
    final queue = queueWith((_) async => http.Response.bytes(
        utf8.encode(jsonEncode({'errors': [{'message': 'El turno ya no está disponible'}], 'data': null})), 200,
        headers: {'content-type': 'application/json'}));
    await add(queue);
    await queue.sync();
    final item = (await queue.list()).single;
    expect(item.status, QueuedOperation.conflict);
    expect(item.error, 'El turno ya no está disponible');
  });

  test('borrar algo que ya no existe cuenta como hecho', () async {
    final queue = queueWith((_) async => http.Response('{}', 404));
    await add(queue, 'x', 'DELETE');
    await queue.sync();
    expect(await queue.list(), isEmpty);
  });

  test('una sesión vencida avisa y conserva la cola', () async {
    var lost = false;
    final queue = queueWith((_) async => http.Response('{}', 401), onSessionLost: () => lost = true);
    await add(queue);
    await queue.sync();
    expect(lost, isTrue);
    expect(await queue.list(), hasLength(1));
  });

  test('dos sincronizaciones simultáneas no envían dos veces', () async {
    var calls = 0;
    final queue = queueWith((_) async {
      calls++;
      return http.Response('{}', 201);
    });
    await add(queue);
    await Future.wait([queue.sync(), queue.sync(), queue.sync()]);
    expect(calls, 1);
  });

  test('revocar retira los diagnósticos que no se enviaron', () async {
    final queue = queueWith((_) async => http.Response('{}', 201));
    await queue.enqueue(kind: 'DIAGNOSIS', label: 'd', url: 'http://api/d', method: 'POST', body: {'a': 1});
    await add(queue);
    await queue.discardKind('DIAGNOSIS');
    expect((await queue.list()).single.kind, 'CLOSET');
  });

  test('avisa cuando cambia la cola', () async {
    final queue = queueWith((_) async => http.Response('{}', 201));
    var changes = 0;
    final subscription = queue.changes.listen((_) => changes++);
    await add(queue);
    await queue.sync();
    await Future<void>.delayed(Duration.zero);
    expect(changes, 2);
    await subscription.cancel();
  });
}
