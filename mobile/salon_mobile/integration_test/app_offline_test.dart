// Corre en un emulador o teléfono real, con los modelos reales y contra los servicios reales:
// flutter test integration_test/app_offline_test.dart -d emulator-5554 --dart-define=SALON_AGENT_SECRET=...
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:salon_mobile/core/api/api_client.dart';
import 'package:salon_mobile/core/auth/session.dart';
import 'package:salon_mobile/core/config.dart';
import 'package:salon_mobile/core/database/local_database.dart';
import 'package:salon_mobile/core/sync/offline_queue.dart';
import 'package:salon_mobile/features/biometrics/on_device_analyzer.dart';

import 'retrato_data.dart';

const _secret = String.fromEnvironment('SALON_AGENT_SECRET', defaultValue: 'salon-agent-secret-local');

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

/// Cliente HTTP con la red "cortada", para simular el modo avión de forma determinista.
class SwitchableClient extends http.BaseClient {
  final http.Client _inner = http.Client();
  bool offline = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (offline) throw http.ClientException('sin red');
    return _inner.send(request);
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  final analyzer = OnDeviceAnalyzer();
  final foto = base64Decode(retratoBase64);

  group('modelos reales en el dispositivo', () {
    testWidgets('analiza un rostro real como el servidor', (tester) async {
      final result = await analyzer.analyze(foto);
      // ignore: avoid_print
      print('DIAGNOSTICO_MOVIL ${jsonEncode(result)}');
      expect(result['source'], 'OFFLINE');
      expect(result['faceShape'], 'SQUARE');
      expect(result['skinUndertone'], 'WARM');
      expect(result['hairType'], 'WAVY');
      expect(result['hairTone'], 'MEDIUM');
      expect(result['faceShapeConfidence'], greaterThan(0.3));
    });

    testWidgets('rechaza una imagen sin rostro', (tester) async {
      await expectLater(analyzer.analyze(base64Decode(blancoBase64)), throwsA(isA<BiometricRejection>().having((e) => e.code, 'code', 'NO_FACE')));
    });

    testWidgets('rechaza un archivo que no es imagen', (tester) async {
      await expectLater(analyzer.analyze(Uint8List.fromList(utf8.encode('no es imagen'))), throwsA(isA<BiometricRejection>()));
    });
  });

  testWidgets('sin conexión analiza, guarda el resultado y lo envía al volver', (tester) async {
    final tokens = ServiceAccount();
    final client = SwitchableClient();
    final userId = Session.fromToken((await tokens.token())!).userId;
    final database = await LocalDatabase.open('prueba-$userId');
    await database.delete('queue');
    final queue = OfflineQueue(database, tokens, client);
    final api = ApiClient(database, tokens, client, queue);
    final diagnoses = '${Config.asesoria}/biometrics/diagnoses';
    final consentUrl = '${Config.asesoria}/biometrics/consent';

    // Consentimiento real con conexión
    final consent = await api.read(consentUrl) as Map<String, dynamic>;
    await api.send('POST', consentUrl, body: {'policyVersion': consent['policyVersion'], 'declaresAdult': true});
    await api.read(consentUrl);
    expect(await api.read(diagnoses), isEmpty);

    client.offline = true;
    // Sin red, las lecturas salen de la copia local
    expect((await api.read(consentUrl) as Map<String, dynamic>)['granted'], isTrue);
    final result = await analyzer.analyze(foto);
    await queue.enqueue(kind: 'DIAGNOSIS', label: 'Diagnóstico', url: diagnoses, method: 'POST', body: result);
    final write = await api.write('CLOSET', 'Agregar prenda', 'POST', '${Config.asesoria}/closet', body: {
      'name': '[prueba-movil] Blazer',
      'color': 'Negro',
      'category': 'OUTERWEAR',
      'season': 'ALL_SEASON',
    });
    expect(write.queued, isTrue);
    expect(await queue.list(), hasLength(2));
    expect(await queue.sync(), isFalse);
    expect(await queue.list(), hasLength(2));

    // Vuelve la red: llega al servidor real una sola vez
    client.offline = false;
    expect(await queue.sync(), isTrue);
    expect(await queue.list(), isEmpty);
    final saved = await api.read(diagnoses) as List;
    expect(saved, hasLength(1));
    expect(saved.first['source'], 'OFFLINE');
    expect(saved.first['faceShape'], result['faceShape']);

    final closet = await api.read('${Config.asesoria}/closet/client/$userId') as List;
    final mine = closet.where((item) => item['name'] == '[prueba-movil] Blazer').toList();
    expect(mine, hasLength(1));

    // Revocar borra lo que se envió, y un resultado guardado después se rechaza
    await api.send('DELETE', '${Config.asesoria}/closet/${mine.first['id']}');
    await queue.enqueue(kind: 'DIAGNOSIS', label: 'Diagnóstico tardío', url: diagnoses, method: 'POST', body: result);
    final revoked = await api.send('DELETE', consentUrl) as Map<String, dynamic>;
    expect(revoked['deletedDiagnoses'], 1);
    await queue.sync();
    final items = await queue.list();
    expect(items.single.status, QueuedOperation.conflict);
    expect(await api.read(diagnoses), isEmpty);

    await queue.discard(items.single.id);
    await database.close();
  });
}
