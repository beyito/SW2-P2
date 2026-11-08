import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/tab_refresh.dart';
import '../brand/brand_screen.dart';

const _profile = '{ getMyProfile { id fullName loyaltyPoints } }';
const _sync = 'mutation { syncMyProfile { id fullName loyaltyPoints } }';
// Un solo texto: la prueba de contratos lo valida contra el esquema real del CRM
const _history =
    r'query ($c: String!) { getLoyaltyHistory(clientId: $c) { id points type description createdAt } getInvoicesByClient(clientId: $c) { id invoiceNumber serviceName subtotalAmount discountAmount totalAmount taxAmount paymentMethod status issuedAt } }';

const _methods = {'CARD': 'Tarjeta en línea', 'CASH': 'Efectivo en el mostrador', 'CARD_TERMINAL': 'Tarjeta en el mostrador'};
const _invoiceStatus = {'ISSUED': 'Emitida', 'PAID': 'Pagada', 'REFUNDED': 'Reembolsada', 'CANCELLED': 'Anulada'};

String _money(Object? value) => '${((value as num?) ?? 0).toStringAsFixed(2)} USD';

/// Mi cuenta: puntos de fidelidad, su historial y las facturas (CU-11, CU-12). Sin conexión muestra la última copia.
class AccountScreen extends StatefulWidget {
  final ApiClient api;
  final TabRefresh? refresh;

  const AccountScreen({super.key, required this.api, this.refresh});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  Map<String, dynamic>? _client;
  List<dynamic> _movements = [];
  List<dynamic> _invoices = [];
  String? _error;

  VoidCallback? _stopListening;

  @override
  void initState() {
    super.initState();
    _reload();
    _stopListening = widget.refresh?.listen(_reload);
  }

  @override
  void dispose() {
    _stopListening?.call();
    super.dispose();
  }

  Future<void> _reload() async {
    try {
      var client = (await widget.api.graphql(Config.crm, _profile))['getMyProfile'] as Map<String, dynamic>?;
      // La cuenta puede no tener ficha en el CRM todavía: se crea con los datos del token
      client ??= (await widget.api.send('POST', Config.crm, body: {'query': _sync}))['data']['syncMyProfile'] as Map<String, dynamic>;
      final data = await widget.api.graphql(Config.crm, _history, variables: {'c': client['id']});
      if (mounted) {
        setState(() {
          _client = client;
          _movements = data['getLoyaltyHistory'] as List;
          _invoices = data['getInvoicesByClient'] as List;
          _error = null;
        });
      }
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  void _showInvoice(Map<String, dynamic> invoice) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        key: const Key('invoice-detail'),
        title: Text('Comprobante N.º ${invoice['invoiceNumber'] ?? '-'}'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Servicio: ${invoice['serviceName'] ?? '-'}'),
          Text('Fecha: ${(invoice['issuedAt'] as String? ?? '').replaceFirst('T', ' ')}'),
          Text('Subtotal: ${_money(invoice['subtotalAmount'])}'),
          Text('Descuento por puntos: ${_money(invoice['discountAmount'])}'),
          Text('Total pagado: ${_money(invoice['totalAmount'])}', style: const TextStyle(fontWeight: FontWeight.bold)),
          Text('IVA 13 % incluido: ${_money(invoice['taxAmount'])}'),
          Text('Forma de pago: ${_methods[invoice['paymentMethod']] ?? invoice['paymentMethod']}'),
          Text('Estado: ${_invoiceStatus[invoice['status']] ?? invoice['status']}'),
          const SizedBox(height: 8),
          const Text('Documento de demostración, sin validez fiscal.', style: TextStyle(fontSize: 11)),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cerrar'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final client = _client;
    if (_error != null && client == null) return Center(child: Text(_error!));
    if (client == null) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _reload,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        Card(
          child: ListTile(
            leading: const Icon(Icons.stars, color: Color(0xFFD4AF37)),
            title: Text('${client['loyaltyPoints']} puntos', key: const Key('points'), style: const TextStyle(fontSize: 20)),
            subtitle: Text('Equivalen a ${_money((client['loyaltyPoints'] as int) / 100)} de descuento en tu próxima reserva web.'),
          ),
        ),
        Card(
          child: ListTile(
            key: const Key('open-brand'),
            leading: const Icon(Icons.campaign),
            title: const Text('Asesoría de imagen para redes'),
            subtitle: const Text('LinkedIn, Instagram, TikTok o Facebook'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => BrandScreen(api: widget.api))),
          ),
        ),
        const Padding(padding: EdgeInsets.fromLTRB(8, 16, 8, 4), child: Text('Facturas', style: TextStyle(fontWeight: FontWeight.bold))),
        if (_invoices.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('Todavía no tienes facturas.')),
        for (final invoice in _invoices)
          ListTile(
            key: Key('invoice-${invoice['id']}'),
            title: Text('N.º ${invoice['invoiceNumber'] ?? '-'} · ${invoice['serviceName'] ?? ''}'),
            subtitle: Text('${_methods[invoice['paymentMethod']] ?? invoice['paymentMethod']} · ${_invoiceStatus[invoice['status']] ?? invoice['status']}'),
            trailing: Text(_money(invoice['totalAmount'])),
            onTap: () => _showInvoice(invoice as Map<String, dynamic>),
          ),
        const Padding(padding: EdgeInsets.fromLTRB(8, 16, 8, 4), child: Text('Movimientos de puntos', style: TextStyle(fontWeight: FontWeight.bold))),
        if (_movements.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('Sin movimientos.')),
        for (final movement in _movements)
          ListTile(
            dense: true,
            title: Text(movement['description'] as String),
            subtitle: Text((movement['createdAt'] as String).replaceFirst('T', ' ').split('.').first),
            trailing: Text('${(movement['points'] as int) > 0 ? '+' : ''}${movement['points']}'),
          ),
      ]),
    );
  }
}
