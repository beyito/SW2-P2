import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/tab_refresh.dart';
import '../booking/booking_flow.dart';
import '../booking/booking_screen.dart';

const _status = {
  'PENDING_PAYMENT': 'Pendiente de pago',
  'SCHEDULED': 'Agendada',
  'CONFIRMED': 'Confirmada',
  'RESCHEDULED': 'Reprogramada',
  'COMPLETED': 'Atendida',
  'CANCELLED': 'Cancelada',
  'NO_SHOW': 'No asistió',
};

/// Mis citas: se pueden consultar sin conexión con la última copia. Desde aquí se reserva y se paga
/// una reserva pendiente, por ejemplo una que se envió sin conexión.
class AppointmentsScreen extends StatefulWidget {
  final ApiClient api;
  final BookingFlow flow;
  final TabRefresh? refresh;

  const AppointmentsScreen({super.key, required this.api, required this.flow, this.refresh});

  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  static const _query = '{ getMyAppointments { id serviceName stylistName appointmentDate status totalPrice sagaId } }';
  List<dynamic>? _items;
  String? _error;
  String? _paying;

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
      final data = await widget.api.graphql(Config.gestion, _query);
      if (mounted) {
        setState(() {
          _items = data['getMyAppointments'] as List;
          _error = null;
        });
      }
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _book() async {
    await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => BookingScreen(api: widget.api, flow: widget.flow)));
    await _reload();
  }

  Future<void> _pay(String sagaId) async {
    setState(() => _paying = sagaId);
    try {
      final step = await widget.flow.pay(sagaId);
      if (!mounted) return;
      final message = step.error ??
          (step.canceled
              ? 'Pago cancelado. Puedes intentarlo de nuevo antes de que venza el plazo.'
              : step.view?.completed ?? false
                  ? 'Pago recibido: la cita quedó confirmada.'
                  : 'El pago sigue procesándose.');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    } on Exception catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _paying = null);
      await _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('book'),
        onPressed: _book,
        icon: const Icon(Icons.add),
        label: const Text('Reservar'),
      ),
      body: () {
        if (_error != null && items == null) return Center(child: Text(_error!));
        if (items == null) return const Center(child: CircularProgressIndicator());
        if (items.isEmpty) return const Center(child: Text('Todavía no tienes citas.'));
        return RefreshIndicator(
          onRefresh: _reload,
          child: ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            for (final item in items)
              ListTile(
                title: Text(item['serviceName'] as String),
                subtitle: Text('${(item['appointmentDate'] as String).replaceFirst('T', ' ').substring(0, 16)} · ${item['stylistName']}'),
                trailing: item['status'] == 'PENDING_PAYMENT' && item['sagaId'] != null
                    ? FilledButton(
                        key: Key('pay-${item['id']}'),
                        onPressed: _paying == null ? () => _pay(item['sagaId'] as String) : null,
                        child: Text(_paying == item['sagaId'] ? 'Pagando...' : 'Pagar'),
                      )
                    : Text(_status[item['status']] ?? item['status'] as String),
              ),
          ]),
        );
      }(),
    );
  }
}
