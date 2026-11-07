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
import 'package:salon_mobile/features/biometrics/recommendations_section.dart';
import 'package:salon_mobile/features/closet/closet_screen.dart';
import 'package:salon_mobile/features/image_generation/image_preview_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class FakeTokens implements TokenProvider {
  @override
  Future<String?> token() async => 'token-prueba';
}

// Imagen PNG de un píxel: Flutter la decodifica de verdad
const _pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const _result = {'image_base64': _pixel, 'media_type': 'image/png', 'label': 'Simulación generada con IA', 'remaining_today': 4};
final _photo = Uint8List.fromList([1, 2, 3]);

Future<Uint8List?> _pickFixed(ImageSource _) async => _photo;

/// Servidor falso: registra las llamadas y responde como los servicios reales.
class Backend {
  bool granted = false;
  Map<String, dynamic> profile = {'gender': 'MALE', 'ageRange': '18_29'};
  List<Map<String, dynamic>> closet = [];
  final calls = <http.BaseRequest>[];
  final bodies = <String>[];
  http.Response? generation;
  bool offline = false;

  Future<http.Response> handle(http.Request request) async {
    if (offline) throw http.ClientException('sin red');
    calls.add(request);
    bodies.add(request.body);
    final url = request.url.toString();
    if (url.contains('8083/graphql')) return _json({'data': {'getMyProfile': {'styleProfile': profile}}});
    if (url.endsWith('/image-consent')) {
      if (request.method == 'POST') granted = true;
      if (request.method == 'DELETE') granted = false;
      return _json({'granted': granted, 'policyVersion': 'img-v1', 'policyText': 'Mi foto se envía a Replicate'});
    }
    if (url.contains('/image-generation/')) return generation ?? _json(_result, 201);
    if (url.endsWith('/recommendations/styles')) {
      return _json([
        {'style_id': 'cut-undercut', 'style_name': 'Undercut con volumen', 'reason': 'Motivo', 'can_preview': true, 'preview_approximate': false},
        {'style_id': 'trat-keratina', 'style_name': 'Keratina', 'reason': 'Motivo', 'can_preview': false, 'preview_approximate': false},
      ]);
    }
    if (url.endsWith('/media')) return _json({'id': 'x', 'url': '/media/${'a' * 32}'}, 201);
    if (url.contains('/closet/client/')) return _json(closet);
    if (request.method == 'PATCH') {
      closet.first['imageUrl'] = '/media/${'a' * 32}';
      return _json(closet.first);
    }
    return _json({});
  }

  http.Response _json(Object body, [int status = 200]) =>
      http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});
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
    for (var i = 0; i < 6; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
      await tester.pump();
    }
  }

  Future<void> showPreview(WidgetTester tester, {bool approximate = false, PhotoSource pickPhoto = _pickFixed}) async {
    // Pantalla alta: la lista solo construye lo que está cerca de la parte visible
    tester.view.physicalSize = const Size(800, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: ImagePreviewScreen(
        api: api,
        title: 'Undercut',
        photoHint: 'Usa una foto de frente',
        approximate: approximate,
        pickPhoto: pickPhoto,
        generate: (images, photo) => images.haircut(photo, 'cut-undercut'),
      ),
    ));
    await settle(tester);
  }

  group('pantalla de simulación', () {
    testWidgets('sin autorización muestra quién recibe la foto y no deja elegirla', (tester) async {
      await showPreview(tester);
      expect(find.textContaining('Replicate'), findsOneWidget);
      expect(find.byKey(const Key('preview-gallery')), findsNothing);
    });

    testWidgets('exige declarar la mayoría de edad antes de aceptar', (tester) async {
      await showPreview(tester);
      FilledButton accept() => tester.widget<FilledButton>(find.byKey(const Key('preview-accept')));
      expect(accept().onPressed, isNull);
      await tester.tap(find.byKey(const Key('preview-adult')));
      await tester.pump();
      expect(accept().onPressed, isNotNull);
      await tester.tap(find.byKey(const Key('preview-accept')));
      await settle(tester);
      expect(find.byKey(const Key('preview-gallery')), findsOneWidget);
      expect(jsonDecode(backend.bodies[backend.calls.indexWhere((c) => c.method == 'POST' && c.url.path.endsWith('image-consent'))]), {'policyVersion': 'img-v1', 'declaresAdult': true});
    });

    testWidgets('un menor no puede autorizar el envío', (tester) async {
      backend.profile = {'ageRange': 'UNDER_18'};
      await showPreview(tester);
      expect(find.byKey(const Key('preview-minor')), findsOneWidget);
      expect(find.byKey(const Key('preview-accept')), findsNothing);
    });

    testWidgets('genera y muestra la imagen con su etiqueta', (tester) async {
      backend.granted = true;
      await showPreview(tester);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      expect(find.byKey(const Key('preview-image')), findsOneWidget);
      expect(find.textContaining('Simulación'), findsOneWidget);
      expect(find.textContaining('Te quedan 4'), findsOneWidget);
    });

    testWidgets('en una pantalla de teléfono el aviso se ve sin desplazarse', (tester) async {
      backend.granted = true;
      await showPreview(tester);
      tester.view.physicalSize = const Size(390, 800);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      expect(find.byKey(const Key('preview-label')), findsOneWidget);
      expect(tester.getBottomLeft(find.byKey(const Key('preview-label'))).dy, lessThan(800));
    });

    testWidgets('si no se elige foto no llama al generador', (tester) async {
      backend.granted = true;
      await showPreview(tester, pickPhoto: (_) async => null);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      expect(backend.calls.where((c) => c.url.path.contains('image-generation')), isEmpty);
    });

    testWidgets('avisa cuando el estilo es aproximado', (tester) async {
      backend.granted = true;
      await showPreview(tester, approximate: true);
      expect(find.byKey(const Key('preview-approximate')), findsOneWidget);
    });

    testWidgets('muestra el mensaje del servicio al agotar el cupo', (tester) async {
      backend.granted = true;
      backend.generation = http.Response.bytes(utf8.encode(jsonEncode({'detail': {'code': 'IMAGE_QUOTA_EXCEEDED', 'message': 'Alcanzaste el límite'}})), 429);
      await showPreview(tester);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      expect(find.textContaining('Alcanzaste el límite'), findsOneWidget);
      expect(find.byKey(const Key('preview-image')), findsNothing);
    });

    testWidgets('si la autorización ya no vale, vuelve a pedirla', (tester) async {
      backend.granted = true;
      await showPreview(tester);
      backend.granted = false;
      backend.generation = http.Response.bytes(utf8.encode(jsonEncode({'detail': {'code': 'IMAGE_CONSENT_REQUIRED', 'message': 'Se necesita tu autorización'}})), 403);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      expect(find.byKey(const Key('preview-consent-text')), findsOneWidget);
    });

    testWidgets('retirar la autorización quita la imagen', (tester) async {
      backend.granted = true;
      await showPreview(tester);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      await tester.ensureVisible(find.byKey(const Key('preview-revoke')));
      await tester.tap(find.byKey(const Key('preview-revoke')));
      await settle(tester);
      expect(find.byKey(const Key('preview-image')), findsNothing);
      expect(find.byKey(const Key('preview-consent-text')), findsOneWidget);
    });

    testWidgets('sin conexión lo dice y no guarda nada en la cola', (tester) async {
      backend.offline = true;
      await showPreview(tester);
      expect(find.text('Esta función requiere conexión.'), findsOneWidget);
      expect(await tester.runAsync(() => api.queue.list()), isEmpty);
    });

    testWidgets('no conserva la autorización ni el resultado en la copia local', (tester) async {
      backend.granted = true;
      await showPreview(tester);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      final cached = await tester.runAsync(() => db.query('cache'));
      expect(cached!.where((row) => (row['key'] as String).contains('image-consent') || (row['value'] as String).contains('image_base64')), isEmpty);
    });
  });

  group('recomendaciones', () {
    Future<void> showSection(WidgetTester tester, {required bool online, Map<String, dynamic>? diagnosis}) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: SingleChildScrollView(child: RecommendationsSection(api: api, diagnosis: diagnosis, online: online, pickPhoto: _pickFixed))),
      ));
      await settle(tester);
    }

    testWidgets('solo ofrece la simulación en los estilos que se pueden simular', (tester) async {
      await showSection(tester, online: true);
      expect(find.byKey(const Key('preview-cut-undercut')), findsOneWidget);
      expect(find.byKey(const Key('style-trat-keratina')), findsOneWidget);
      expect(find.byKey(const Key('preview-trat-keratina')), findsNothing);
    });

    testWidgets('envía el perfil y el diagnóstico al recomendador', (tester) async {
      await showSection(tester, online: true, diagnosis: {'faceShape': 'OVAL', 'hairType': 'WAVY', 'skinUndertone': 'WARM'});
      final index = backend.calls.indexWhere((call) => call.url.path.endsWith('/recommendations/styles'));
      expect(jsonDecode(backend.bodies[index]), {'gender': 'MALE', 'age_range': '18_29', 'face_shape': 'OVAL', 'hair_type': 'WAVY', 'skin_undertone': 'WARM'});
    });

    testWidgets('un menor no ve la simulación', (tester) async {
      backend.profile = {'ageRange': 'UNDER_18'};
      await showSection(tester, online: true);
      expect(find.byKey(const Key('style-cut-undercut')), findsOneWidget);
      expect(find.byKey(const Key('preview-cut-undercut')), findsNothing);
    });

    testWidgets('sin datos del cliente no llama al recomendador', (tester) async {
      backend.profile = {};
      await showSection(tester, online: true);
      expect(backend.calls.where((call) => call.url.path.endsWith('/recommendations/styles')), isEmpty);
    });

    testWidgets('sin conexión lo indica sin llamar al servidor', (tester) async {
      await showSection(tester, online: false);
      expect(find.byKey(const Key('recommendations-offline')), findsOneWidget);
      expect(backend.calls, isEmpty);
    });

    testWidgets('el botón abre la simulación del estilo', (tester) async {
      await showSection(tester, online: true);
      await tester.tap(find.byKey(const Key('preview-cut-undercut')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);
      expect(find.text('Undercut con volumen'), findsWidgets);
      expect(find.byKey(const Key('preview-consent-text')), findsOneWidget);
    });
  });

  group('clóset', () {
    Future<void> showCloset(WidgetTester tester) async {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: ClosetScreen(api: api, clientId: 'cli-1', pickPhoto: _pickFixed))));
      await settle(tester);
    }

    testWidgets('sin foto propia pide subirla; con foto permite probársela', (tester) async {
      backend.closet = [
        {'id': 'a', 'name': 'Sin foto', 'category': 'TOP', 'color': 'Rojo', 'imageUrl': ''},
        {'id': 'b', 'name': 'Con enlace', 'category': 'TOP', 'color': 'Azul', 'imageUrl': 'https://ejemplo.com/a.jpg'},
      ];
      await showCloset(tester);
      expect(find.byKey(const Key('add-photo-Sin foto')), findsOneWidget);
      expect(find.byKey(const Key('add-photo-Con enlace')), findsOneWidget);
      expect(find.text('Probármela'), findsNothing);
    });

    testWidgets('subir la foto habilita la prueba', (tester) async {
      backend.closet = [
        {'id': 'a', 'name': 'Camisa', 'category': 'TOP', 'color': 'Rojo', 'imageUrl': ''},
      ];
      await showCloset(tester);
      await tester.ensureVisible(find.byKey(const Key('add-photo-Camisa')));
      await tester.tap(find.byKey(const Key('add-photo-Camisa')));
      await settle(tester);
      expect(find.byKey(const Key('try-on-Camisa')), findsOneWidget);
      final patch = backend.calls.indexWhere((call) => call.method == 'PATCH');
      expect(jsonDecode(backend.bodies[patch])['imageUrl'], startsWith('/media/'));
    });

    List<Map<String, dynamic>> armario() => [
          {'id': 'a', 'name': 'Polera', 'category': 'TOP', 'color': 'Verde', 'imageUrl': '/media/${'a' * 32}'},
          {'id': 'b', 'name': 'Otra polera', 'category': 'TOP', 'color': 'Azul', 'imageUrl': '/media/${'b' * 32}'},
          {'id': 'c', 'name': 'Pantalon', 'category': 'BOTTOM', 'color': 'Gris', 'imageUrl': '/media/${'c' * 32}'},
          {'id': 'd', 'name': 'Sin foto', 'category': 'BOTTOM', 'color': 'Negro', 'imageUrl': ''},
        ];

    Future<void> marcar(WidgetTester tester, String nombre) async {
      await tester.ensureVisible(find.byKey(Key('outfit-$nombre')));
      await tester.tap(find.byKey(Key('outfit-$nombre')));
      await tester.pump();
    }

    FilledButton botonConjunto(WidgetTester tester) => tester.widget<FilledButton>(find.byKey(const Key('try-outfit')));

    testWidgets('el conjunto exige dos prendas y una sin foto no se puede marcar', (tester) async {
      backend.closet = armario();
      await showCloset(tester);
      expect(find.byKey(const Key('try-outfit')), findsNothing);
      expect(find.byKey(const Key('outfit-Sin foto')), findsNothing);
      await marcar(tester, 'Polera');
      expect(botonConjunto(tester).onPressed, isNull);
      await marcar(tester, 'Pantalon');
      expect(botonConjunto(tester).onPressed, isNotNull);
      expect(tester.widget<Text>(find.byKey(const Key('outfit-names'))).data, 'Polera + Pantalon');
    });

    testWidgets('otra prenda del mismo tipo reemplaza a la anterior', (tester) async {
      backend.closet = armario();
      await showCloset(tester);
      await marcar(tester, 'Polera');
      await marcar(tester, 'Otra polera');
      expect(tester.widget<Text>(find.byKey(const Key('outfit-names'))).data, 'Otra polera');
      expect(botonConjunto(tester).onPressed, isNull);
    });

    testWidgets('desmarcar quita la prenda del conjunto', (tester) async {
      backend.closet = armario();
      await showCloset(tester);
      await marcar(tester, 'Polera');
      await marcar(tester, 'Polera');
      expect(find.byKey(const Key('try-outfit')), findsNothing);
    });

    testWidgets('prueba el conjunto con todas las prendas en una sola petición', (tester) async {
      backend.closet = armario();
      backend.granted = true;
      await showCloset(tester);
      await marcar(tester, 'Polera');
      await marcar(tester, 'Pantalon');
      await tester.ensureVisible(find.byKey(const Key('try-outfit')));
      await tester.tap(find.byKey(const Key('try-outfit')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);
      await tester.tap(find.byKey(const Key('preview-gallery')));
      await settle(tester);
      expect(find.byKey(const Key('preview-image')), findsOneWidget);
      final peticiones = backend.calls.where((call) => call.url.path.endsWith('/image-generation/try-on-outfit')).toList();
      expect(peticiones.length, 1);
      expect(backend.bodies[backend.calls.indexOf(peticiones.first)], contains('a,c'));
    });

    testWidgets('calzado y accesorios no ofrecen la prueba', (tester) async {
      backend.closet = [
        {'id': 'a', 'name': 'Botas', 'category': 'SHOES', 'color': 'Negro', 'imageUrl': ''},
      ];
      await showCloset(tester);
      expect(find.byKey(const Key('add-photo-Botas')), findsNothing);
      expect(find.byKey(const Key('try-on-Botas')), findsNothing);
    });
  });
}
