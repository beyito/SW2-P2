import 'dart:async';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import 'payment_gateway.dart';

/// Estados en los que la reserva se revirtió o se está revirtiendo: ya no se cobra.
const revertedStatuses = {'COMPENSATING_POINTS', 'COMPENSATING_STOCK', 'COMPENSATING_APPOINTMENT', 'COMPENSATED', 'FAILED'};

const _failures = {
  'SLOT_TAKEN': 'El turno ya no está disponible. Elige otro horario.',
  'OUTSIDE_WORKING_HOURS': 'El horario está fuera de la jornada del estilista.',
  'STOCK_INSUFFICIENT': 'Por ahora no hay insumos para este servicio.',
  'SERVICE_NOT_FOUND': 'El servicio ya no está disponible.',
  'INVALID_DATE': 'La fecha del turno no es válida.',
  'PAYMENT_DECLINED': 'El pago fue rechazado. El turno quedó libre.',
  'PAYMENT_TIMEOUT': 'Venció el plazo de 15 minutos para pagar. El turno quedó libre.',
  'PAYMENT_UNAVAILABLE': 'El cobro no está disponible ahora. Inténtalo más tarde.',
  'POINTS_INSUFFICIENT': 'No tienes puntos suficientes. El turno quedó libre.',
  'POINTS_EXCEED_LIMIT': 'Esa cantidad de puntos supera el máximo para este servicio. El turno quedó libre.',
};

/// Tipos de operación en la cola para una cita: "Mis citas" los usa para mostrar lo pendiente.
const cancelKind = 'appointment-cancel';
const rescheduleKind = 'appointment-reschedule';

/// La cancelación sin conexión se envía después: el reembolso llega cuando se procese.
const queuedCancelMessage = 'Sin conexión: la cancelación se enviará al volver la red y entonces se reembolsará tu pago.';

const _cancelRejections = {
  'TOO_LATE': 'La cita ya comenzó o ya pasó: no se puede cancelar.',
  'NOT_CANCELLABLE': 'La cita ya no se puede cancelar.',
  'ALREADY_CHECKED_IN': 'Ya estás registrado en el salón: la cita no se puede cancelar.',
};

/// Mensaje para el usuario cuando el salón rechaza una cancelación.
String cancelRejectionMessage(String? reason) => _cancelRejections[reason] ?? 'La cita ya no se puede cancelar.';

/// Cobro mínimo de la pasarela: el canje no puede dejarlo por debajo (igual que la web y el CRM).
const minimumChargeCents = 50;

/// Puntos que se pueden canjear en un servicio: cada punto vale un centavo.
int maxRedeemablePoints(int balance, num price) {
  final limit = (price * 100).round() - minimumChargeCents;
  return balance.clamp(0, limit < 0 ? 0 : limit);
}

/// Mensaje para el usuario según el motivo que informa la SAGA.
String failureMessage(String? reason) => _failures[reason] ?? 'No se pudo completar la reserva. El turno quedó libre.';

/// Avance de una reserva, tal como lo informa el orquestador SAGA.
class BookingView {
  final String sagaId;
  final String status;
  final int? amountToPayCents;
  final String? clientSecret;
  final String? failureReason;
  final String? serviceName;
  final String? cancelRejectedReason;

  const BookingView({
    required this.sagaId,
    required this.status,
    this.amountToPayCents,
    this.clientSecret,
    this.failureReason,
    this.serviceName,
    this.cancelRejectedReason,
  });

  factory BookingView.fromJson(Map<String, dynamic> json) => BookingView(
        sagaId: json['sagaId'] as String,
        status: json['status'] as String,
        amountToPayCents: json['amountToPayCents'] as int?,
        clientSecret: json['clientSecret'] as String?,
        failureReason: json['failureReason'] as String?,
        serviceName: json['serviceName'] as String?,
        cancelRejectedReason: json['cancelRejectedReason'] as String?,
      );

  bool get awaitingPayment => status == 'AWAITING_PAYMENT';
  bool get completed => status == 'COMPLETED';
  bool get reverted => revertedStatuses.contains(status);
  bool get refunded => status == 'REFUNDED';
}

/// Resultado de un paso del flujo, para que la pantalla sepa qué mostrar.
class BookingStep {
  final BookingView? view;
  final bool queued;
  final bool canceled;
  final String? error;

  const BookingStep({this.view, this.queued = false, this.canceled = false, this.error});
}

/// Reserva y pago desde el móvil (CU-06, CU-10): usa la misma SAGA que la web, con Idempotency-Key (RNF-04).
/// El cobro lo hace Stripe; si el webhook no llega, la consulta de sincronización lo concilia.
class BookingFlow {
  final ApiClient api;
  final PaymentGateway gateway;
  final Duration pollEvery;
  final int maxPolls;

  BookingFlow(this.api, this.gateway, {this.pollEvery = const Duration(milliseconds: 800), this.maxPolls = 40});

  /// Aparta el turno y, si se piden, los puntos. Sin conexión, la solicitud queda en la cola y se envía después.
  Future<BookingStep> start({
    required String serviceId,
    required String stylistId,
    required String appointmentDate,
    required String label,
    int pointsToRedeem = 0,
  }) async {
    final result = await api.write('booking', label, 'POST', '${Config.saga}/bookings', body: {
      'serviceId': serviceId,
      'stylistId': stylistId,
      'appointmentDate': appointmentDate,
      if (pointsToRedeem > 0) 'pointsToRedeem': pointsToRedeem,
    });
    if (result.queued) return const BookingStep(queued: true);
    final started = BookingView.fromJson(result.data as Map<String, dynamic>);
    return _settle(await waitFor(started.sagaId, (view) => view.awaitingPayment || view.completed));
  }

  /// Muestra el formulario de pago de una reserva que espera su cobro, nueva o retomada desde "Mis citas".
  Future<BookingStep> pay(String sagaId) async {
    final current = await view(sagaId);
    if (current.completed || current.reverted) return _settle(current);
    final secret = current.clientSecret;
    if (!current.awaitingPayment || secret == null) return BookingStep(view: current, error: 'La reserva todavía se está preparando.');

    final config = await api.send('GET', '${Config.saga}/payments/config') as Map<String, dynamic>;
    final outcome = await gateway.pay(publishableKey: config['publishableKey'] as String, clientSecret: secret);
    if (outcome == PaymentOutcome.canceled) return BookingStep(view: current, canceled: true);
    if (outcome == PaymentOutcome.failed) {
      return BookingStep(view: current, error: gateway.lastError ?? 'El pago no se completó. Puedes intentarlo de nuevo.');
    }
    // Pagado en Stripe: se concilia por si el aviso de la pasarela tarda, y se espera la confirmación
    await api.send('POST', '${Config.saga}/bookings/$sagaId/sync');
    return _settle(await waitFor(sagaId, (view) => view.completed));
  }

  /// Cancela una reserva pagada y espera el reembolso (CU-07): cita, dinero y nota de crédito, en ese orden.
  /// Devuelve null si se reembolsó, o el motivo para mostrar si no se pudo. Sin conexión, la cancelación
  /// queda en la cola: el orquestador la acepta una sola vez aunque llegue repetida.
  Future<String?> cancel(String sagaId, {String label = 'Cancelar una cita'}) async {
    final result = await api.write(cancelKind, label, 'POST', '${Config.saga}/bookings/$sagaId/cancel');
    if (result.queued) return queuedCancelMessage;
    // El reembolso pasa por Stripe y el CRM: puede tardar varios segundos
    var current = await view(sagaId);
    for (var attempt = 0; attempt < maxPolls * 2 && !current.refunded && current.cancelRejectedReason == null; attempt++) {
      await Future<void>.delayed(pollEvery);
      current = await view(sagaId);
    }
    if (current.refunded) return null;
    if (current.cancelRejectedReason != null) return cancelRejectionMessage(current.cancelRejectedReason);
    return 'El reembolso sigue en proceso; revisa tus facturas en unos minutos.';
  }

  Future<BookingView> view(String sagaId) async =>
      BookingView.fromJson(await api.send('GET', '${Config.saga}/bookings/$sagaId') as Map<String, dynamic>);

  /// Consulta la SAGA hasta que cumple la condición o se revierte.
  Future<BookingView> waitFor(String sagaId, bool Function(BookingView) done) async {
    var current = await view(sagaId);
    for (var attempt = 0; attempt < maxPolls && !done(current) && !current.reverted; attempt++) {
      await Future<void>.delayed(pollEvery);
      current = await view(sagaId);
    }
    return current;
  }

  BookingStep _settle(BookingView view) {
    if (view.reverted) return BookingStep(view: view, error: failureMessage(view.failureReason));
    return BookingStep(view: view);
  }
}
