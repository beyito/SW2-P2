import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/auth/auth_service.dart';

void main() {
  group('sesión terminada en el servidor', () {
    test('Keycloak rechaza la renovación con invalid_grant: hay que volver a iniciar sesión', () {
      final error = PlatformException(
        code: 'token_failed',
        message: 'Failed to get token: [error: invalid_grant, description: Offline session not active]',
      );
      expect(isSessionEndedError(error), isTrue);
    });

    test('sin red la sesión sigue en el teléfono', () {
      final error = PlatformException(code: 'token_failed', message: 'Network error: Unable to resolve host');
      expect(isSessionEndedError(error), isFalse);
    });
  });
}
