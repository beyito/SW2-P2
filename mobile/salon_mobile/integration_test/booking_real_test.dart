// Corre en un emulador o teléfono real contra los servicios reales y Stripe en modo prueba:
// flutter test integration_test/booking_real_test.dart -d emulator-5554 --dart-define=STRIPE_TEST_SECRET=sk_test_...
// No usa el formulario nativo de Stripe: confirma el cobro de prueba con la API, como lo haría la tarjeta 4242.
// Reserva un día de 2041; al terminar hay que borrar esa cita y su factura (ver mobile/salon_mobile/README.md).
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:salon_mobile/core/api/api_client.dart';
import 'package:salon_mobile/core/auth/session.dart';
import 'package:salon_mobile/core/config.dart';
import 'package:salon_mobile/core/database/local_database.dart';
import 'package:salon_mobile/core/sync/offline_queue.dart';
import 'package:salon_mobile/features/booking/booking_flow.dart';
import 'package:salon_mobile/features/booking/payment_gateway.dart';

const _agentSecret = String.fromEnvironment('SALON_AGENT_SECRET', defaultValue: 'salon-agent-secret-local');
const _stripeSecret = String.fromEnvironment('STRIPE_TEST_SECRET');

/// Cuenta de servicio real de Keycloak: no requiere el navegador para iniciar sesión.
class ServiceAccount implements TokenProvider {
  @override
  Future<String?> token() async {
    final response = await http.post(
      Uri.parse('${Config.keycloakIssuer}/protocol/openid-connect/token'),
      body: {'grant_type': 'client_credentials', 'client_id': 'salon-agent', 'client_secret': _agentSecret},
    );
    return jsonDecode(response.body)['access_token'] as String;
  }
}

/// Paga el cobro de prueba con la tarjeta de prueba de Stripe, directamente en su API.
class StripeTestCard implements PaymentGateway {
  final String paymentMethod;
  StripeTestCard(this.paymentMethod);

  @override
  String? lastError;

  @override
  Future<PaymentOutcome> pay({required String publishableKey, required String clientSecret}) async {
    expect(publishableKey, startsWith('pk_test_'));
    final intent = clientSecret.split('_secret_').first;
    final response = await http.post(
      Uri.parse('https://api.stripe.com/v1/payment_intents/$intent/confirm'),
      headers: {'Authorization': 'Bearer $_stripeSecret'},
      body: {'payment_method': paymentMethod},
    );
    if (response.statusCode == 200) return PaymentOutcome.paid;
    lastError = 'Stripe respondió ${response.statusCode}';
    return PaymentOutcome.failed;
  }
}

/// Primer lunes de marzo de 2041: un día laborable sin citas reales.
String _slotDay() {
  var day = DateTime.utc(2041, 3, 1);
  while (day.weekday != DateTime.monday) {
    day = day.add(const Duration(days: 1));
  }
  return '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('reserva y paga una cita contra la SAGA real', (tester) async {
    expect(_stripeSecret, startsWith('sk_test_'), reason: 'Pase la clave de prueba de Stripe con --dart-define');
    final tokens = ServiceAccount();
    final client = http.Client();
    final userId = Session.fromToken((await tokens.token())!).userId;
    final database = await LocalDatabase.open('prueba-reserva-$userId');
    final api = ApiClient(database, tokens, client, OfflineQueue(database, tokens, client));
    final flow = BookingFlow(api, StripeTestCard('pm_card_visa'));

    final slots = await api.graphql(
      Config.gestion,
      r'query ($s: String!, $v: String!, $d: String!) { getAvailableSlots(stylistId: $s, serviceId: $v, date: $d) { start } }',
      variables: {'s': 'sty-101', 'v': 'srv-03', 'd': _slotDay()},
    );
    final slot = (slots['getAvailableSlots'] as List).first['start'] as String;

    final started = await flow.start(serviceId: 'srv-03', stylistId: 'sty-101', appointmentDate: slot, label: 'Prueba');
    expect(started.error, isNull);
    expect(started.view!.awaitingPayment, isTrue);
    expect(started.view!.amountToPayCents, 4500);

    final paid = await flow.pay(started.view!.sagaId);
    expect(paid.error, isNull);
    expect(paid.view!.completed, isTrue);
    // ignore: avoid_print
    print('RESERVA_MOVIL ${paid.view!.sagaId} $slot');

    // Un segundo intento sobre el mismo turno queda rechazado sin cobrar
    final again = await flow.start(serviceId: 'srv-03', stylistId: 'sty-101', appointmentDate: slot, label: 'Prueba');
    expect(again.error, contains('ya no está disponible'));
  });
}
