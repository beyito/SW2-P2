// Corre en un emulador o teléfono contra los servicios reales y Replicate: GASTA CRÉDITO REAL, unos 0,17 dólares.
// No usa fotos del repositorio: las descarga de un servidor temporal del equipo, con rostro.jpg, cuerpo.jpg y prenda.jpg.
//   python -m http.server 8765 --bind 127.0.0.1 --directory carpeta_con_las_fotos
//   adb reverse tcp:8765 tcp:8765
//   flutter test integration_test/image_generation_real_test.dart -d emulator-5554
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:salon_mobile/core/api/api_client.dart';
import 'package:salon_mobile/core/auth/session.dart';
import 'package:salon_mobile/core/config.dart';
import 'package:salon_mobile/core/database/local_database.dart';
import 'package:salon_mobile/core/sync/offline_queue.dart';
import 'package:salon_mobile/features/biometrics/recommendations_section.dart';
import 'package:salon_mobile/features/closet/closet_screen.dart';

const _secret = String.fromEnvironment('SALON_AGENT_SECRET', defaultValue: 'salon-agent-secret-local');
const _photos = 'http://localhost:8765';
const _diagnosis = {'faceShape': 'OVAL', 'hairType': 'STRAIGHT', 'skinUndertone': 'WARM'};
const _garment = 'Prueba móvil de chaqueta';
const _generationLimit = Duration(minutes: 3);

/// Cuenta de servicio real de Keycloak: no requiere el navegador para iniciar sesión.
class ServiceAccount implements TokenProvider {
  @override
  Future<String?> token() async {
    final response = await http.post(
      Uri.parse('${Config.keycloakIssuer}/protocol/openid-connect/token'),
      body: {'grant_type': 'client_credentials', 'client_id': 'salon-agent', 'client_secret': _secret},
    );
    return jsonDecode(response.body)['access_token'] as String;
  }
}

/// Avanza en tiempo real hasta que aparezca el elemento, o falla mostrando el error de la pantalla.
Future<void> waitFor(WidgetTester tester, Finder finder, {Duration limit = const Duration(seconds: 30)}) async {
  final deadline = DateTime.now().add(limit);
  while (finder.evaluate().isEmpty) {
    if (DateTime.now().isAfter(deadline)) {
      final error = find.byKey(const Key('preview-error'));
      final shown = error.evaluate().isEmpty ? 'sin error visible' : tester.widget<Text>(error).data;
      fail('No apareció $finder: $shown');
    }
    await tester.pump(const Duration(milliseconds: 200));
  }
  await tester.pump();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late ApiClient api;
  late String userId;
  late Uint8List face, body, garment;

  setUpAll(() async {
    Future<Uint8List> photo(String name) async => (await http.get(Uri.parse('$_photos/$name'))).bodyBytes;
    face = await photo('rostro.jpg');
    body = await photo('cuerpo.jpg');
    garment = await photo('prenda.jpg');
    final tokens = ServiceAccount();
    final client = http.Client();
    userId = Session.fromToken((await tokens.token())!).userId;
    final database = await LocalDatabase.open('prueba-imagenes');
    await database.delete('cache');
    api = ApiClient(database, tokens, client, OfflineQueue(database, tokens, client));
  });

  tearDownAll(() async => api.send('DELETE', '${Config.asesoria}/biometrics/image-consent'));

  testWidgets('desde una recomendación autoriza y genera el corte', (tester) async {
    await api.send('DELETE', '${Config.asesoria}/biometrics/image-consent');
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: RecommendationsSection(api: api, diagnosis: _diagnosis, online: true, pickPhoto: (_) async => face)),
      ),
    ));

    final button = find.byWidgetPredicate((widget) => widget.key is ValueKey<String> && (widget.key as ValueKey<String>).value.startsWith('preview-cut-'));
    await waitFor(tester, button);
    await tester.ensureVisible(button.first);
    await tester.tap(button.first);

    await waitFor(tester, find.byKey(const Key('preview-consent-text')));
    expect(tester.widget<Text>(find.byKey(const Key('preview-consent-text'))).data, contains('Replicate'));
    await tester.tap(find.byKey(const Key('preview-adult')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('preview-accept')));

    await waitFor(tester, find.byKey(const Key('preview-gallery')));
    await tester.tap(find.byKey(const Key('preview-gallery')));
    await waitFor(tester, find.byKey(const Key('preview-image')), limit: _generationLimit);

    expect(tester.widget<Text>(find.byKey(const Key('preview-label'))).data, contains('Simulación'));
    // La imagen la decodifica el motor real del teléfono, con un tamaño razonable
    final image = tester.widget<Image>(find.byKey(const Key('preview-image')));
    final bytes = (image.image as MemoryImage).bytes;
    expect(bytes.length, greaterThan(10000));
  });

  testWidgets('en el clóset sube la foto de la prenda y se la prueba', (tester) async {
    final created = await api.write('CLOSET', 'Prueba', 'POST', '${Config.asesoria}/closet', body: {'name': _garment, 'color': 'Terracota', 'category': 'OUTERWEAR', 'season': 'ALL_SEASON'});
    final id = created.data['id'] as String;
    addTearDown(() => api.write('CLOSET', 'Prueba', 'DELETE', '${Config.asesoria}/closet/$id'));

    var next = garment;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ClosetScreen(api: api, clientId: userId, pickPhoto: (_) async => next))));

    final addPhoto = find.byKey(const Key('add-photo-$_garment'));
    await waitFor(tester, addPhoto);
    await tester.ensureVisible(addPhoto);
    await tester.tap(addPhoto);

    final tryOn = find.byKey(const Key('try-on-$_garment'));
    await waitFor(tester, tryOn);
    next = body;
    await tester.ensureVisible(tryOn);
    await tester.tap(tryOn);

    // La autorización de la prueba anterior sigue vigente
    await waitFor(tester, find.byKey(const Key('preview-gallery')));
    await tester.tap(find.byKey(const Key('preview-gallery')));
    await waitFor(tester, find.byKey(const Key('preview-image')), limit: _generationLimit);
    expect(tester.widget<Text>(find.byKey(const Key('preview-label'))).data, contains('Simulación'));
  });
}
