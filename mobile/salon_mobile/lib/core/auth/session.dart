import 'dart:convert';

/// Identidad leída del token. Solo decide qué mostrar: quien autoriza es cada servicio.
class Session {
  final String userId;
  final String name;

  const Session({required this.userId, required this.name});

  factory Session.fromToken(String token) {
    final payload = base64Url.normalize(token.split('.')[1]);
    final claims = jsonDecode(utf8.decode(base64Url.decode(payload))) as Map<String, dynamic>;
    return Session(
      userId: (claims['salon_id'] ?? claims['sub']) as String,
      name: (claims['name'] ?? claims['preferred_username'] ?? 'Usuario') as String,
    );
  }
}

/// Entrega el token vigente. Es una interfaz para poder sustituirlo en las pruebas.
abstract class TokenProvider {
  Future<String?> token();
}

/// Fecha de vencimiento del token.
DateTime? expiryOf(String token) {
  final payload = base64Url.normalize(token.split('.')[1]);
  final claims = jsonDecode(utf8.decode(base64Url.decode(payload))) as Map<String, dynamic>;
  final exp = claims['exp'];
  return exp is int ? DateTime.fromMillisecondsSinceEpoch(exp * 1000) : null;
}
