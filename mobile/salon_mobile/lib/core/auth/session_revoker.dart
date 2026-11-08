import 'package:http/http.dart' as http;

import '../config.dart';

/// Cierra la sesión en el servidor, igual que la web (CU-02): primero la revoca en los servicios,
/// que desde ese momento rechazan el token, y después la termina en Keycloak, que invalida el refresh token.
/// Sin conexión no se puede revocar: la sesión se borra igual del teléfono y el token vence solo en minutos.
class SessionRevoker {
  final http.Client _http;
  static const _timeout = Duration(seconds: 8);

  SessionRevoker(this._http);

  /// Devuelve verdadero si el servidor confirmó el cierre en ambos pasos.
  Future<bool> revoke({String? accessToken, String? refreshToken}) async {
    var closed = true;
    try {
      if (accessToken != null) {
        final services = await _http
            .post(Uri.parse('${Config.asesoria}/auth/logout'), headers: {'Authorization': 'Bearer $accessToken'})
            .timeout(_timeout);
        // 401: la sesión ya estaba cerrada o vencida, que es el resultado buscado
        closed = services.statusCode < 300 || services.statusCode == 401;
      }
    } catch (_) {
      closed = false;
    }
    try {
      if (refreshToken != null) {
        // Cierre por canal directo: no abre el navegador, como haría el cierre por redirección
        final keycloak = await _http.post(
          Uri.parse('${Config.keycloakIssuer}/protocol/openid-connect/logout'),
          body: {'client_id': Config.clientId, 'refresh_token': refreshToken},
        ).timeout(_timeout);
        closed = closed && keycloak.statusCode < 300;
      }
    } catch (_) {
      closed = false;
    }
    return closed;
  }
}
