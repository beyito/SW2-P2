import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image_picker/image_picker.dart';
import 'package:salon_mobile/core/api/api_client.dart';
import 'package:salon_mobile/core/auth/session.dart';
import 'package:salon_mobile/core/database/local_database.dart';
import 'package:salon_mobile/core/sync/offline_queue.dart';
import 'package:salon_mobile/core/tab_refresh.dart';
import 'package:salon_mobile/features/account/account_screen.dart';
import 'package:salon_mobile/features/brand/brand_screen.dart';
import 'package:salon_mobile/features/community/community_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class FakeTokens implements TokenProvider {
  @override
  Future<String?> token() async => 'token-prueba';
}

Future<Uint8List?> _pickFixed(ImageSource _) async => Uint8List.fromList([1, 2, 3]);

/// Servicios falsos: registran las llamadas y responden como los reales.
class Backend {
  final calls = <http.Request>[];
  bool offline = false;
  Map<String, dynamic>? profile = {'id': 'cli-001', 'fullName': 'Camila', 'loyaltyPoints': 450};
  final posts = [
    {
      'id': 'p1', 'authorId': 'cli-002', 'authorName': 'Ana', 'title': 'Balayage', 'description': 'Me encantó', 'imageUrl': null,
      'totalLikes': 2, 'likedByMe': false, 'status': 'VISIBLE',
      'comments': [
        {'id': 'c1', 'authorName': 'Luis', 'content': 'Precioso', 'parentId': null, 'deleted': false},
        {'id': 'c2', 'authorName': 'Ana', 'content': 'Gracias', 'parentId': 'c1', 'deleted': false},
      ],
    },
    {'id': 'p2', 'authorName': 'Oculto', 'title': 'Oculta', 'description': '', 'totalLikes': 0, 'likedByMe': false, 'status': 'HIDDEN', 'comments': []},
  ];

  Future<http.Response> handle(http.Request request) async {
    if (offline) throw http.ClientException('sin red');
    calls.add(request);
    final url = request.url.toString();
    if (url.endsWith('/community') && request.method == 'GET') return _json(posts);
    if (url.endsWith('/media')) return _json({'id': 'm', 'url': '/media/${'a' * 32}'}, 201);
    if (url.contains('/community')) return _json({'ok': true}, 201);
    if (url.endsWith('/brand/strategy')) {
      return _json({
        'platform': 'INSTAGRAM', 'personalized': true, 'tone': 'Cercano', 'recommended_look': 'Bob', 'recommended_color': 'Cobre',
        'color_palette': ['Terracota'], 'closet_matches': [{'id': 'x', 'name': 'Blazer', 'color': 'Beige'}],
        'bio': 'Bio sugerida', 'content_ideas': ['Antes y después'], 'framing_tip': 'Plano medio', 'lighting_tip': 'Luz natural',
        'generated_by': 'Plantilla',
      });
    }
    if (url.contains('8083/graphql')) {
      final query = jsonDecode(request.body)['query'] as String;
      if (query.contains('styleProfile')) return _json({'data': {'getMyProfile': {'styleProfile': {'gender': 'FEMALE', 'ageRange': '18_29'}}}});
      if (query.contains('syncMyProfile')) return _json({'data': {'syncMyProfile': {'id': 'cli-001', 'fullName': 'Camila', 'loyaltyPoints': 0}}});
      if (query.contains('getMyProfile')) return _json({'data': {'getMyProfile': profile}});
      return _json({'data': {
        'getLoyaltyHistory': [{'id': 't1', 'points': 450, 'type': 'ACCUMULATION', 'description': 'Puntos por Corte', 'createdAt': '2026-11-07T10:00:00'}],
        'getInvoicesByClient': [{
          'id': 'inv-1', 'invoiceNumber': 17, 'serviceName': 'Corte', 'subtotalAmount': 45, 'discountAmount': 0, 'totalAmount': 45,
          'taxAmount': 5.85, 'paymentMethod': 'CASH', 'status': 'PAID', 'issuedAt': '2026-11-07T10:00:00',
        }],
      }});
    }
    return _json({});
  }

  http.Response _json(Object body, [int status = 200]) =>
      http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

  Iterable<http.Request> posting(String suffix) => calls.where((call) => call.method == 'POST' && call.url.path.endsWith(suffix));
}

void main() {
  sqfliteFfiInit();

  late Database db;
  late Backend backend;
  late ApiClient api;

  setUp(() async {
    db = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(version: 1, onCreate: LocalDatabase.createSchema, singleInstance: false),
    );
    backend = Backend();
    final client = MockClient(backend.handle);
    api = ApiClient(db, FakeTokens(), client, OfflineQueue(db, FakeTokens(), client));
  });

  tearDown(() => db.close());

  // La base de datos real usa FFI y hace espera real: se avanza fuera del reloj falso de la prueba
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
      await tester.pump(const Duration(milliseconds: 10));
    }
  }

  Future<void> abrir(WidgetTester tester, Widget screen) async {
    tester.view.physicalSize = const Size(900, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: screen)));
    await settle(tester);
  }

  group('comunidad', () {
    testWidgets('muestra el muro sin publicaciones ocultas y los comentarios en cascada', (tester) async {
      await abrir(tester, CommunityScreen(api: api));
      expect(find.byKey(const Key('post-p1')), findsOneWidget);
      expect(find.byKey(const Key('post-p2')), findsNothing);
      final padre = tester.widget<Padding>(find.byKey(const Key('c-c1')));
      final respuesta = tester.widget<Padding>(find.byKey(const Key('c-c2')));
      expect((respuesta.padding as EdgeInsets).left, greaterThan((padre.padding as EdgeInsets).left));
    });

    testWidgets('la reacción cambia al instante y se envía', (tester) async {
      await abrir(tester, CommunityScreen(api: api));
      await tester.tap(find.byKey(const Key('like-p1')));
      await tester.pump();
      expect(find.text('3'), findsOneWidget);
      await settle(tester);
      expect(backend.posting('/community/p1/like'), hasLength(1));
    });

    testWidgets('responder un comentario envía su padre', (tester) async {
      await abrir(tester, CommunityScreen(api: api));
      await tester.tap(find.byKey(const Key('reply-c1')));
      await settle(tester);
      await tester.enterText(find.byKey(const Key('comment-text')), 'Coincido');
      await tester.tap(find.byKey(const Key('comment-send')));
      await settle(tester);
      expect(jsonDecode(backend.posting('/community/p1/comment').single.body), {'content': 'Coincido', 'parentId': 'c1'});
    });

    testWidgets('sin conexión la reacción queda en la cola', (tester) async {
      await abrir(tester, CommunityScreen(api: api));
      backend.offline = true;
      await tester.tap(find.byKey(const Key('like-p1')));
      await settle(tester);
      expect((await tester.runAsync(() => api.queue.list()))!.single.url, endsWith('/community/p1/like'));
    });

    testWidgets('publicar un look sube la foto y luego crea la publicación', (tester) async {
      await abrir(tester, CommunityScreen(api: api, pickPhoto: _pickFixed));
      await tester.tap(find.byKey(const Key('publish')));
      await settle(tester);
      await tester.enterText(find.byKey(const Key('publish-title')), 'Mi corte');
      await tester.tap(find.byKey(const Key('publish-photo')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('publish-send')));
      await settle(tester);
      final paths = backend.calls.where((call) => call.method == 'POST').map((call) => call.url.path).toList();
      expect(paths, ['/media', '/community']);
      expect(jsonDecode(backend.posting('/community').single.body)['imageUrl'], startsWith('/media/'));
    });
  });

  group('cuenta', () {
    testWidgets('muestra puntos, facturas con su forma de pago y el detalle', (tester) async {
      await abrir(tester, AccountScreen(api: api));
      expect(find.text('450 puntos'), findsOneWidget);
      expect(find.textContaining('Efectivo en el mostrador'), findsOneWidget);
      expect(find.text('Puntos por Corte'), findsOneWidget);
      await tester.tap(find.byKey(const Key('invoice-inv-1')));
      await settle(tester);
      expect(find.byKey(const Key('invoice-detail')), findsOneWidget);
      expect(find.textContaining('5.85 USD'), findsOneWidget);
    });

    testWidgets('vuelve a cargar al abrir su pestaña, para mostrar lo pagado después', (tester) async {
      final selected = ValueNotifier<int>(4);
      await abrir(tester, AccountScreen(api: api, refresh: TabRefresh(selected, 4)));
      expect(find.text('450 puntos'), findsOneWidget);

      backend.profile = {'id': 'cli-001', 'fullName': 'Camila', 'loyaltyPoints': 1400};
      selected.value = 2;
      await settle(tester);
      expect(find.text('450 puntos'), findsOneWidget, reason: 'otra pestaña no la recarga');
      selected.value = 4;
      await settle(tester);
      expect(find.text('1400 puntos'), findsOneWidget);
    });

    testWidgets('una cuenta sin ficha en el CRM la crea', (tester) async {
      backend.profile = null;
      await abrir(tester, AccountScreen(api: api));
      expect(find.text('0 puntos'), findsOneWidget);
    });
  });

  testWidgets('la asesoría para redes envía la red y el perfil, y muestra el resultado', (tester) async {
    await abrir(tester, BrandScreen(api: api));
    await tester.tap(find.byKey(const Key('brand-platform')));
    await settle(tester);
    await tester.tap(find.text('Instagram').last);
    await settle(tester);
    await tester.enterText(find.byKey(const Key('brand-sector')), 'Diseño');
    await tester.tap(find.byKey(const Key('brand-submit')));
    await settle(tester);
    final body = jsonDecode(backend.posting('/brand/strategy').single.body);
    expect(body, {'platform': 'INSTAGRAM', 'sector': 'Diseño', 'goal': null, 'gender': 'FEMALE', 'age_range': '18_29'});
    expect(find.byKey(const Key('brand-result')), findsOneWidget);
    expect(find.text('Bio sugerida'), findsOneWidget);
    expect(find.textContaining('Blazer'), findsOneWidget);
  });
}
