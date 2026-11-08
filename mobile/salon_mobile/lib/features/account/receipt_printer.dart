import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

/// Etiquetas de la forma de pago, iguales a las del comprobante de la web.
const paymentMethodLabels = {'CARD': 'Tarjeta en línea', 'CASH': 'Efectivo en el mostrador', 'CARD_TERMINAL': 'Tarjeta en el mostrador'};

String _money(Object? value) => '${((value as num?) ?? 0).toStringAsFixed(2)} USD';

/// Comprobante en PDF con los mismos datos que el de la web (CU-11). Los datos vienen del CRM:
/// la aplicación no calcula importes.
Future<Uint8List> buildReceiptPdf(Map<String, dynamic> invoice) {
  final document = pw.Document(title: 'Comprobante ${invoice['invoiceNumber'] ?? ''}', author: 'Salón & IA Studio');
  final refunded = invoice['status'] == 'REFUNDED';
  pw.Widget line(String label, String value, {bool bold = false}) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 3),
        child: pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
          pw.Text(label),
          pw.Text(value, style: bold ? pw.TextStyle(fontWeight: pw.FontWeight.bold) : null),
        ]),
      );
  document.addPage(pw.Page(
    pageFormat: PdfPageFormat.a5,
    build: (_) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
      pw.Text('Salón & IA Studio', style: pw.TextStyle(fontSize: 20, fontWeight: pw.FontWeight.bold)),
      pw.SizedBox(height: 4),
      pw.Text('Comprobante N.º ${invoice['invoiceNumber'] ?? '-'}', style: const pw.TextStyle(fontSize: 14)),
      if (refunded)
        pw.Padding(
          padding: const pw.EdgeInsets.only(top: 6),
          child: pw.Text('ANULADA: reembolsada con nota de crédito.', style: pw.TextStyle(fontWeight: pw.FontWeight.bold)),
        ),
      pw.Divider(),
      line('Cliente', '${invoice['clientName'] ?? '-'}'),
      line('Fecha', (invoice['issuedAt'] as String? ?? '').replaceFirst('T', ' ').split('.').first),
      line('Servicio', '${invoice['serviceName'] ?? '-'}'),
      pw.Divider(),
      line('Subtotal', _money(invoice['subtotalAmount'])),
      line('Descuento por puntos', _money(invoice['discountAmount'])),
      line('Total pagado', _money(invoice['totalAmount']), bold: true),
      line('IVA 13 % incluido', _money(invoice['taxAmount'])),
      line('Forma de pago', paymentMethodLabels[invoice['paymentMethod']] ?? '${invoice['paymentMethod']}'),
      pw.Spacer(),
      pw.Text('Documento de demostración, sin validez fiscal.', style: const pw.TextStyle(fontSize: 9)),
    ]),
  ));
  return document.save();
}

/// Imprime o guarda un PDF. Es una interfaz para sustituirla en las pruebas: el diálogo de impresión es nativo.
abstract class ReceiptPrinter {
  Future<void> print(Uint8List pdf, {required String name});
}

/// Diálogo de impresión del sistema: desde ahí también se guarda el PDF o se comparte.
class SystemReceiptPrinter implements ReceiptPrinter {
  const SystemReceiptPrinter();

  @override
  Future<void> print(Uint8List pdf, {required String name}) => Printing.layoutPdf(name: name, onLayout: (_) async => pdf);
}
