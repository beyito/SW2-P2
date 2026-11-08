import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

/// Resultado de mostrar el formulario de pago.
enum PaymentOutcome { paid, canceled, failed }

/// Pasarela de pago. Es una interfaz para poder sustituirla en las pruebas: el SDK de Stripe es nativo.
abstract class PaymentGateway {
  /// Muestra el formulario de pago del cobro ya creado por la SAGA.
  Future<PaymentOutcome> pay({required String publishableKey, required String clientSecret});

  /// Mensaje del último fallo, si lo hubo.
  String? get lastError;
}

/// Formulario de pago oficial de Stripe (Payment Sheet). La tarjeta nunca pasa por la aplicación ni por la plataforma.
class StripePaymentGateway implements PaymentGateway {
  String? _configuredKey;
  String? _lastError;

  @override
  String? get lastError => _lastError;

  @override
  Future<PaymentOutcome> pay({required String publishableKey, required String clientSecret}) async {
    _lastError = null;
    try {
      if (_configuredKey != publishableKey) {
        Stripe.publishableKey = publishableKey;
        await Stripe.instance.applySettings();
        _configuredKey = publishableKey;
      }
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: 'Salón & IA Studio',
          style: ThemeMode.dark,
        ),
      );
      await Stripe.instance.presentPaymentSheet();
      return PaymentOutcome.paid;
    } on StripeException catch (error) {
      if (error.error.code == FailureCode.Canceled) return PaymentOutcome.canceled;
      _lastError = error.error.localizedMessage ?? error.error.message;
      return PaymentOutcome.failed;
    }
  }
}
