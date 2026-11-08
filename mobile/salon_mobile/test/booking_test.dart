import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:salon_mobile/core/api/api_client.dart';
import 'package:salon_mobile/core/auth/session.dart';
import 'package:salon_mobile/core/database/local_database.dart';
import 'package:salon_mobile/core/sync/offline_queue.dart';
import 'package:salon_mobile/features/appointments/appointments_screen.dart';
import 'package:salon_mobile/features/booking/booking_flow.dart';
import 'package:salon_mobile/features/booking/booking_screen.dart';
import 'package:salon_mobile/features/booking/payment_gateway.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class FakeTokens implements TokenProvider {
  @override
  Future<String?> token() async => 'token-prueba';
}

/// Formulario de pago falso: el de Stripe es nativo y no corre en estas pruebas.
class FakeGateway implements PaymentGateway {
  PaymentOutcome outcome = PaymentOutcome.paid;
  final secrets = <String>[];
  String? keyUsed;

  @override
  String? lastError;

  @override
  Future<PaymentOutcome> pay({required String publishableKey, required String clientSecret}) async {
    keyUsed = publishableKey;
    secrets.add(clientSecret);
    if (outcome == PaymentOutcome.failed) lastError = 'Tarjeta rechazada';
    return outcome;
  }
}

/// Servicios falsos: la SAGA avanza un estado por consulta, como el orquestador real.
class Backend {
  final calls = <http.Request>[];
  List<String> states = ['RESERVING_APPOINTMENT', 'AWAITING_PAYMENT'];
  String? failure;
  String? cancelReason;
  bool offline = false;
  int points = 0;
  List<Map<String, dynamic>> appointments = [];

  Future<http.Response> handle(http.Request request) async {
    if (offline) throw http.ClientException('sin red');
    calls.add(request);
    final url = request.url.toString();
    if (url.endsWith('/payments/config')) return _json({'publishableKey': 'pk_test_x'});
    if (url.endsWith('/bookings') && request.method == 'POST') return _json(_view('RESERVING_APPOINTMENT'), 202);
    if (url.endsWith('/sync')) return _json(_view('AWAITING_PAYMENT'), 202);
    if (url.endsWith('/cancel')) return _json(_view('COMPLETED'), 202);
    if (url.contains('/bookings/')) {
      final state = states.length > 1 ? states.removeAt(0) : states.first;
      return _json(_view(state));
    }
    if (url.contains('8083/graphql')) return _json({'data': {'getMyProfile': {'loyaltyPoints': points}}});
    if (url.contains('8081/graphql')) {
      final query = jsonDecode(request.body)['query'] as String;
      if (query.contains('getAvailableSlots')) {
        return _json({'data': {'getAvailableSlots': [
          {'start': '2030-01-01T09:00:00', 'end': '2030-01-01T09:45:00'},
          {'start': '2031-05-05T10:00:00', 'end': '2031-05-05T10:45:00'},
        ]}});
      }
      if (query.contains('getMyAppointments')) return _json({'data': {'getMyAppointments': appointments}});
      if (query.contains('rescheduleAppointment') || query.contains('cancelAppointment')) return _json({'data': {'ok': {'id': 'apt-1'}}});
      return _json({'data': {
        'getServices': [{'id': 'srv-03', 'name': 'Corte', 'durationMinutes': 45, 'price': 45}],
        'getStylists': [{'id': 'sty-101', 'name': 'Valentina'}],
      }});
    }
    return _json({});
  }

  Map<String, dynamic> _view(String status) => {
        'sagaId': 'saga-1',
        'status': status,
        'amountToPayCents': 4500,
        'clientSecret': status == 'AWAITING_PAYMENT' ? 'pi_1_secret_x' : null,
        'failureReason': failure,
        'serviceName': 'Corte',
        'cancelRejectedReason': cancelReason,
      };

  http.Response _json(Object body, [int status = 200]) =>
      http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

  Iterable<String> get paths => calls.map((call) => '${call.method} ${call.url.path}');
}

void main() {
  sqfliteFfiInit();

  late Database db;
  late Backend backend;
  late ApiClient api;
  late FakeGateway gateway;
  late BookingFlow flow;

  setUp(() async {
    db = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(version: 1, onCreate: LocalDatabase.createSchema, singleInstance: false),
    );
    backend = Backend();
    final client = MockClient(backend.handle);
    api = ApiClient(db, FakeTokens(), client, OfflineQueue(db, FakeTokens(), client));
    gateway = FakeGateway();
    flow = BookingFlow(api, gateway, pollEvery: Duration.zero);
  });

  tearDown(() => db.close());

  Map<String, dynamic> cuerpoDeLaReserva() =>
      jsonDecode(backend.calls.firstWhere((call) => call.method == 'POST' && call.url.path == '/bookings').body) as Map<String, dynamic>;

  Future<BookingStep> reservar() => flow.start(serviceId: 'srv-03', stylistId: 'sty-101', appointmentDate: '2031-05-05T10:00:00', label: 'Reservar');

  group('flujo de reserva y pago', () {
    test('aparta el turno con Idempotency-Key y espera el cobro', () async {
      final step = await reservar();
      expect(step.view!.awaitingPayment, isTrue);
      final post = backend.calls.firstWhere((call) => call.method == 'POST');
      expect(post.headers['Idempotency-Key'], isNotEmpty);
      expect(jsonDecode(post.body), {'serviceId': 'srv-03', 'stylistId': 'sty-101', 'appointmentDate': '2031-05-05T10:00:00'});
    });

    test('pagar usa el cobro de la SAGA, concilia y espera la confirmación', () async {
      await reservar();
      backend.states = ['AWAITING_PAYMENT', 'CONFIRMING_APPOINTMENT', 'COMPLETED'];
      final step = await flow.pay('saga-1');

      expect(step.view!.completed, isTrue);
      expect(gateway.keyUsed, 'pk_test_x');
      expect(gateway.secrets, ['pi_1_secret_x']);
      expect(backend.paths, contains('POST /bookings/saga-1/sync'));
    });

    test('cancelar el formulario no concilia ni libera el turno', () async {
      await reservar();
      gateway.outcome = PaymentOutcome.canceled;
      final step = await flow.pay('saga-1');
      expect(step.canceled, isTrue);
      expect(backend.paths.where((path) => path.endsWith('/sync')), isEmpty);
    });

    test('un pago fallido informa el motivo de Stripe', () async {
      await reservar();
      gateway.outcome = PaymentOutcome.failed;
      expect((await flow.pay('saga-1')).error, 'Tarjeta rechazada');
    });

    test('un turno ocupado se informa sin mostrar el formulario de pago', () async {
      backend.states = ['FAILED'];
      backend.failure = 'SLOT_TAKEN';
      final step = await reservar();
      expect(step.error, contains('ya no está disponible'));
      expect(gateway.secrets, isEmpty);
    });

    test('el canje no deja el cobro por debajo del mínimo de la pasarela', () {
      expect(maxRedeemablePoints(10000, 45), 4450);
      expect(maxRedeemablePoints(300, 45), 300);
      expect(maxRedeemablePoints(300, 0.40), 0);
    });

    test('los puntos solo viajan si se piden', () async {
      await flow.start(serviceId: 'srv-03', stylistId: 'sty-101', appointmentDate: '2031-05-05T10:00:00', label: 'Reservar', pointsToRedeem: 300);
      expect(cuerpoDeLaReserva()['pointsToRedeem'], 300);
      backend.calls.clear();
      await reservar();
      expect(cuerpoDeLaReserva().containsKey('pointsToRedeem'), isFalse);
    });

    test('un canje rechazado por saldo se explica', () async {
      backend.states = ['FAILED'];
      backend.failure = 'POINTS_INSUFFICIENT';
      expect((await reservar()).error, contains('No tienes puntos suficientes'));
    });

    test('sin conexión la reserva queda en la cola con su llave', () async {
      backend.offline = true;
      final step = await reservar();
      expect(step.queued, isTrue);
      final queued = await api.queue.list();
      expect(queued.single.kind, 'booking');
      expect(queued.single.idempotencyKey, isNotEmpty);
    });
  });

  // La base de datos real usa FFI y hace espera real: se avanza fuera del reloj falso de la prueba
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 20; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
      // Las esperas entre consultas a la SAGA corren con el reloj falso: hay que avanzarlo
      await tester.pump(const Duration(milliseconds: 10));
    }
  }

  group('pantalla de reserva', () {
    Future<void> abrir(WidgetTester tester) async {
      tester.view.physicalSize = const Size(800, 2000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: BookingScreen(api: api, flow: flow, now: () => DateTime(2031, 5, 5, 8))));
      await settle(tester);
      await tester.tap(find.byKey(const Key('booking-service')));
      await settle(tester);
      await tester.tap(find.textContaining('Corte').last);
      await settle(tester);
      await tester.tap(find.byKey(const Key('booking-stylist')));
      await settle(tester);
      await tester.tap(find.text('Valentina').last);
      await settle(tester);
    }

    testWidgets('no ofrece turnos que ya pasaron', (tester) async {
      await abrir(tester);
      expect(find.byKey(const Key('slot-10:00')), findsOneWidget);
      expect(find.byKey(const Key('slot-09:00')), findsNothing);
    });

    testWidgets('sin puntos no ofrece canje', (tester) async {
      await abrir(tester);
      expect(find.byKey(const Key('booking-points')), findsNothing);
    });

    testWidgets('con puntos ofrece usar hasta el máximo y envía lo elegido', (tester) async {
      backend.points = 10000;
      await abrir(tester);
      expect(find.textContaining('Puedes usar hasta 4450'), findsOneWidget);
      await tester.tap(find.byKey(const Key('booking-points-max')));
      await tester.pump();
      expect(find.text('Total a pagar: 0.50 USD'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('booking-points')), '99999');
      await tester.pump();
      expect(find.text('Total a pagar: 0.50 USD'), findsOneWidget, reason: 'lo que supera el máximo se ajusta');
      await tester.enterText(find.byKey(const Key('booking-points')), '500');
      await tester.pump();
      expect(find.text('Total a pagar: 40.00 USD'), findsOneWidget);

      await tester.tap(find.byKey(const Key('slot-10:00')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('booking-reserve')));
      await settle(tester);
      expect(cuerpoDeLaReserva()['pointsToRedeem'], 500);
    });

    testWidgets('reserva, muestra el total, paga y confirma', (tester) async {
      await abrir(tester);
      await tester.tap(find.byKey(const Key('slot-10:00')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('booking-reserve')));
      await settle(tester);
      expect(find.byKey(const Key('booking-total')), findsOneWidget);
      expect(find.textContaining('45.00 USD'), findsOneWidget);

      backend.states = ['AWAITING_PAYMENT', 'COMPLETED'];
      await tester.tap(find.byKey(const Key('booking-pay')));
      await settle(tester);
      expect(find.byKey(const Key('booking-done')), findsOneWidget);
    });
  });

  testWidgets('"Mis citas" ofrece pagar una reserva pendiente', (tester) async {
    backend.appointments = [
      {'id': 'apt-1', 'serviceName': 'Corte', 'stylistName': 'Valentina', 'appointmentDate': '2031-05-05T10:00:00',
       'status': 'PENDING_PAYMENT', 'totalPrice': 45, 'sagaId': 'saga-1'},
      {'id': 'apt-2', 'serviceName': 'Keratina', 'stylistName': 'Valentina', 'appointmentDate': '2031-05-06T10:00:00',
       'status': 'NO_SHOW', 'totalPrice': 95, 'sagaId': 'saga-2'},
    ];
    await tester.pumpWidget(MaterialApp(home: AppointmentsScreen(api: api, flow: flow)));
    await settle(tester);
    expect(find.byKey(const Key('pay-apt-1')), findsOneWidget);
    expect(find.byKey(const Key('pay-apt-2')), findsNothing);
    expect(find.text('No asistió'), findsOneWidget);

    backend.states = ['AWAITING_PAYMENT', 'COMPLETED'];
    await tester.tap(find.byKey(const Key('pay-apt-1')));
    await settle(tester);
    expect(gateway.secrets, ['pi_1_secret_x']);
    expect(find.textContaining('quedó confirmada'), findsOneWidget);
  });

  group('cancelar y reprogramar', () {
    Map<String, dynamic> cita(String id, String status, String date, {String? sagaId}) => {
          'id': id, 'stylistId': 'sty-101', 'serviceId': 'srv-03', 'serviceName': 'Corte', 'stylistName': 'Valentina',
          'appointmentDate': date, 'status': status, 'totalPrice': 45, 'sagaId': sagaId,
        };

    Future<void> abrirCitas(WidgetTester tester) async {
      tester.view.physicalSize = const Size(800, 2000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: AppointmentsScreen(api: api, flow: flow, now: () => DateTime(2031, 5, 5, 8))));
      await settle(tester);
    }

    test('cancelar una reserva pagada espera el reembolso', () async {
      backend.states = ['COMPLETED', 'CANCELLING_APPOINTMENT', 'REFUNDING_PAYMENT', 'REFUNDED'];
      expect(await flow.cancel('saga-1'), isNull);
      expect(backend.paths, contains('POST /bookings/saga-1/cancel'));
    });

    test('una cancelación rechazada por el salón se explica', () async {
      backend.states = ['COMPLETED'];
      backend.cancelReason = 'ALREADY_CHECKED_IN';
      expect(await flow.cancel('saga-1'), contains('Ya estás registrado en el salón'));
    });

    testWidgets('solo las citas vigentes que no empezaron ofrecen cancelar o reprogramar', (tester) async {
      backend.appointments = [
        cita('futura', 'CONFIRMED', '2031-05-06T10:00:00', sagaId: 'saga-1'),
        cita('pasada', 'CONFIRMED', '2031-05-01T10:00:00', sagaId: 'saga-2'),
        cita('cancelada', 'CANCELLED', '2031-05-07T10:00:00', sagaId: 'saga-3'),
      ];
      await abrirCitas(tester);
      expect(find.byKey(const Key('manage-futura')), findsOneWidget);
      expect(find.byKey(const Key('manage-pasada')), findsNothing);
      expect(find.byKey(const Key('manage-cancelada')), findsNothing);
    });

    testWidgets('cancelar una cita pagada pasa por la SAGA y avisa el reembolso', (tester) async {
      backend.appointments = [cita('futura', 'CONFIRMED', '2031-05-06T10:00:00', sagaId: 'saga-1')];
      backend.states = ['COMPLETED', 'REFUNDED'];
      await abrirCitas(tester);
      await tester.tap(find.byKey(const Key('manage-futura')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('action-cancel')));
      await settle(tester);
      expect(find.textContaining('Se reembolsará tu pago'), findsOneWidget);
      await tester.tap(find.byKey(const Key('cancel-yes')));
      await settle(tester);
      expect(backend.paths, contains('POST /bookings/saga-1/cancel'));
      expect(find.text('Cita cancelada y pago reembolsado.'), findsOneWidget);
    });

    testWidgets('una cita sin pago en línea se cancela en ms-gestion, sin reembolso', (tester) async {
      backend.appointments = [cita('agendada', 'SCHEDULED', '2031-05-06T10:00:00')];
      await abrirCitas(tester);
      await tester.tap(find.byKey(const Key('manage-agendada')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('action-cancel')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('cancel-yes')));
      await settle(tester);
      final mutation = backend.calls.where((call) => call.body.contains('cancelAppointment')).single;
      expect(jsonDecode(mutation.body)['variables'], {'id': 'agendada'});
      expect(backend.paths.where((path) => path.endsWith('/cancel')), isEmpty);
    });

    testWidgets('reprogramar envía el turno elegido del mismo estilista y servicio', (tester) async {
      backend.appointments = [cita('futura', 'CONFIRMED', '2031-05-06T10:00:00', sagaId: 'saga-1')];
      await abrirCitas(tester);
      await tester.tap(find.byKey(const Key('manage-futura')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('action-reschedule')));
      await settle(tester);
      final consulta = backend.calls.lastWhere((call) => call.body.contains('getAvailableSlots'));
      expect(jsonDecode(consulta.body)['variables'], {'s': 'sty-101', 'v': 'srv-03', 'd': '2031-05-06'}, reason: 'empieza en el día de la cita');
      expect(find.byKey(const Key('reslot-09:00')), findsNothing, reason: 'un turno pasado no se ofrece');
      await tester.tap(find.byKey(const Key('reslot-10:00')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('reschedule-confirm')));
      await settle(tester);
      final mutation = backend.calls.where((call) => call.body.contains('rescheduleAppointment')).single;
      expect(jsonDecode(mutation.body)['variables'], {'id': 'futura', 'd': '2031-05-05T10:00:00'});
      expect(find.text('Cita reprogramada.'), findsOneWidget);
    });
  });
}
