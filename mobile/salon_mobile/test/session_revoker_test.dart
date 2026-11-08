import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:salon_mobile/core/auth/session_revoker.dart';

void main() {
  group('cierre de sesión en el servidor', () {
    test('revoca en los servicios con el token y luego cierra en Keycloak con el refresh token', () async {
      final calls = <http.Request>[];
      final revoker = SessionRevoker(MockClient((request) async {
        calls.add(request);
        return http.Response(request.url.path.endsWith('/auth/logout') ? '{"closed":true}' : '', request.url.path.endsWith('/auth/logout') ? 201 : 204);
      }));

      expect(await revoker.revoke(accessToken: 'acceso', refreshToken: 'renovacion'), isTrue);

      expect(calls.map((call) => call.url.path), ['/auth/logout', '/realms/salon/protocol/openid-connect/logout']);
      expect(calls.first.headers['Authorization'], 'Bearer acceso');
      expect(calls.last.bodyFields, {'client_id': 'salon-mobile', 'refresh_token': 'renovacion'});
    });

    test('una sesión que ya estaba cerrada en los servicios cuenta como cerrada', () async {
      final revoker = SessionRevoker(MockClient((request) async =>
          http.Response('', request.url.path.endsWith('/auth/logout') ? 401 : 204)));
      expect(await revoker.revoke(accessToken: 'vencido', refreshToken: 'renovacion'), isTrue);
    });

    test('si Keycloak rechaza el cierre, se informa', () async {
      final revoker = SessionRevoker(MockClient((request) async =>
          http.Response('', request.url.path.endsWith('/auth/logout') ? 201 : 400)));
      expect(await revoker.revoke(accessToken: 'acceso', refreshToken: 'invalido'), isFalse);
    });

    test('sin conexión no falla: informa que no se pudo cerrar en el servidor', () async {
      final revoker = SessionRevoker(MockClient((_) async => throw http.ClientException('sin red')));
      expect(await revoker.revoke(accessToken: 'acceso', refreshToken: 'renovacion'), isFalse);
    });
  });
}
