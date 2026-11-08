import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../config.dart';
import 'session.dart';
import 'session_revoker.dart';

/// Keycloak rechazó la renovación: la sesión terminó en el servidor (cierre manual o revocada).
/// Un fallo de red no cuenta: sin conexión la sesión sigue en el teléfono.
bool isSessionEndedError(Object error) => error.toString().contains('invalid_grant');

/// Inicio de sesión con Keycloak por authorization code + PKCE (CU-01).
/// Los tokens se guardan cifrados por el sistema: la app puede abrir sin conexión.
/// Se pide un token offline: la sesión del teléfono no vence con la de la web (8 horas)
/// y dura hasta que la persona cierre sesión.
class AuthService implements TokenProvider {
  static const _access = 'access_token';
  static const _refresh = 'refresh_token';
  static const _id = 'id_token';
  static const _margin = Duration(seconds: 30);

  final FlutterAppAuth _appAuth = const FlutterAppAuth();
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  /// Se llama cuando la sesión terminó en el servidor, para volver a la pantalla de inicio.
  void Function()? onSessionEnded;

  Future<Session?> restore() async {
    final token = await _storage.read(key: _access);
    return token == null ? null : Session.fromToken(token);
  }

  Future<Session> login() async {
    final result = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        Config.clientId,
        Config.redirectUrl,
        issuer: Config.keycloakIssuer,
        // offline_access: el refresh token no depende de la sesión de 8 horas de la web
        scopes: const ['openid', 'profile', 'offline_access'],
        // Keycloak local no usa HTTPS: solo aplica en desarrollo
        allowInsecureConnections: Config.keycloakIssuer.startsWith('http://'),
      ),
    );
    await _save(result.accessToken!, result.refreshToken, result.idToken);
    return Session.fromToken(result.accessToken!);
  }

  /// La sesión ya terminó en el servidor (cerrada en otro lugar o desplazada): solo se olvida aquí.
  Future<void> forget() => _storage.deleteAll();

  /// Cierra la sesión en el servidor y borra los tokens del teléfono, aunque no haya conexión (CU-02).
  /// Devuelve falso si el servidor no pudo confirmar el cierre.
  Future<bool> logout() async {
    final refresh = await _storage.read(key: _refresh);
    final access = await token();
    final client = http.Client();
    try {
      return await SessionRevoker(client).revoke(accessToken: access, refreshToken: refresh);
    } finally {
      client.close();
      await _storage.deleteAll();
    }
  }

  /// Renovación en curso: las pestañas piden el token a la vez al abrir la app, y AppAuth
  /// no admite dos renovaciones simultáneas. Todas esperan la misma.
  Future<String?>? _renewing;

  /// Token vigente; si no se puede renovar, por ejemplo sin red, entrega el que tiene:
  /// la petición fallará por la red y la operación pasará a la cola local.
  @override
  Future<String?> token() async {
    final access = await _storage.read(key: _access);
    if (access == null || !_expiresSoon(access)) return access;
    return _renewing ??= _renew(access).whenComplete(() => _renewing = null);
  }

  Future<String?> _renew(String access) async {
    final refresh = await _storage.read(key: _refresh);
    if (refresh == null) return access;
    try {
      final result = await _appAuth.token(
        TokenRequest(
          Config.clientId,
          Config.redirectUrl,
          issuer: Config.keycloakIssuer,
          refreshToken: refresh,
          allowInsecureConnections: Config.keycloakIssuer.startsWith('http://'),
        ),
      );
      await _save(result.accessToken!, result.refreshToken ?? refresh, result.idToken);
      return result.accessToken;
    } catch (error) {
      if (isSessionEndedError(error)) {
        await _storage.deleteAll();
        onSessionEnded?.call();
        return null;
      }
      // Sin red u otro fallo pasajero: se entrega el token que hay y la operación pasa a la cola
      return access;
    }
  }

  bool _expiresSoon(String token) {
    final expiry = expiryOf(token);
    return expiry == null || DateTime.now().add(_margin).isAfter(expiry);
  }

  Future<void> _save(String access, String? refresh, String? id) async {
    await _storage.write(key: _access, value: access);
    if (refresh != null) await _storage.write(key: _refresh, value: refresh);
    if (id != null) await _storage.write(key: _id, value: id);
  }
}
