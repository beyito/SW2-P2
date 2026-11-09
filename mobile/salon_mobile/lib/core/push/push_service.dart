import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../config.dart';

const _register = r'mutation ($token: String!) { registerPushToken(token: $token) }';
const _unregister = r'mutation ($token: String!) { unregisterPushToken(token: $token) }';

/// Notificaciones push con Firebase Cloud Messaging.
///
/// Al iniciar sesión pide el permiso, obtiene el token del teléfono y lo registra en el CRM, que envía
/// un push cada vez que crea un aviso para esa persona. Con la app cerrada o en segundo plano, Android
/// muestra la notificación; con la app abierta se avisa en pantalla. Sin la configuración de Firebase
/// (google-services.json) o sin permiso, la app funciona igual y los avisos se ven en Cuenta.
///
/// Se usa el token de registro de FCM (getToken), que es el destino documentado de la API HTTP v1 con la
/// que envía el CRM. firebase_messaging 17 lo marca como obsoleto a favor del identificador de
/// instalación (register/onRegistered), que usa otro modo de envío.
// ignore_for_file: deprecated_member_use
class PushService {
  PushService();

  FirebaseMessaging? _messaging;
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _foreground;
  String? _token;

  /// Activa las notificaciones de la sesión. No falla nunca: un error solo deja la app sin push.
  Future<void> start(ApiClient api, {required void Function(String title, String body) onForeground}) async {
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      final messaging = _messaging ??= FirebaseMessaging.instance;
      final permission = await messaging.requestPermission();
      if (permission.authorizationStatus == AuthorizationStatus.denied) return;

      _token = await messaging.getToken();
      if (_token != null) await _send(api, _register, _token!);
      // Firebase puede renovar el token: el CRM debe tener siempre el vigente
      _refresh = messaging.onTokenRefresh.listen((token) {
        _token = token;
        unawaited(_send(api, _register, token));
      });
      _foreground = FirebaseMessaging.onMessage.listen((message) {
        final notification = message.notification;
        if (notification != null) onForeground(notification.title ?? 'Aviso', notification.body ?? '');
      });
    } catch (error) {
      debugPrint('Notificaciones push no disponibles: $error');
    }
  }

  /// Al cerrar sesión, el teléfono deja de recibir los avisos de esa cuenta.
  Future<void> stop(ApiClient? api) async {
    await _refresh?.cancel();
    await _foreground?.cancel();
    final token = _token;
    _token = null;
    if (token == null) return;
    try {
      if (api != null) await _send(api, _unregister, token);
      await _messaging?.deleteToken();
    } catch (error) {
      debugPrint('No se pudo dar de baja el teléfono: $error');
    }
  }

  Future<void> _send(ApiClient api, String query, String token) async {
    final body = await api.send('POST', Config.crm, body: {'query': query, 'variables': {'token': token}});
    final errors = body is Map ? body['errors'] : null;
    if (errors is List && errors.isNotEmpty) throw ApiException('${errors.first['message']}');
  }
}
