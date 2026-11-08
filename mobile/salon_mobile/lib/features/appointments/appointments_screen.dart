import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/tab_refresh.dart';
import '../booking/booking_flow.dart';
import '../booking/booking_screen.dart';
import 'reschedule_screen.dart';

const _status = {
  'PENDING_PAYMENT': 'Pendiente de pago',
  'SCHEDULED': 'Agendada',
  'CONFIRMED': 'Confirmada',
  'RESCHEDULED': 'Reprogramada',
  'COMPLETED': 'Atendida',
  'CANCELLED': 'Cancelada',
  'NO_SHOW': 'No asistió',
};

const _openStatuses = {'SCHEDULED', 'CONFIRMED', 'RESCHEDULED'};
const _cancelUnpaid = r'mutation ($id: ID!) { cancelAppointment(id: $id, reason: "Cancelada por el cliente") { id } }';

/// Mis citas: se pueden consultar sin conexión con la última copia. Desde aquí se reserva, se paga
/// una reserva pendiente (por ejemplo, una que se envió sin conexión), se reprograma y se cancela (CU-07).
class AppointmentsScreen extends StatefulWidget {
  final ApiClient api;
  final BookingFlow flow;
  final TabRefresh? refresh;
  /// Reloj sustituible en las pruebas.
  final DateTime Function()? now;

  const AppointmentsScreen({super.key, required this.api, required this.flow, this.refresh, this.now});

  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  static const _query = '{ getMyAppointments { id stylistId serviceId serviceName stylistName appointmentDate status totalPrice sagaId } }';
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

  /// Como en la web: se puede reprogramar o cancelar una cita vigente que todavía no empezó.
  bool _isOpen(Map<String, dynamic> item) =>
      _openStatuses.contains(item['status']) && DateTime.parse(item['appointmentDate'] as String).isAfter((widget.now ?? DateTime.now)());

  void _notify(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _manage(Map<String, dynamic> item) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(key: const Key('action-reschedule'), leading: const Icon(Icons.schedule), title: const Text('Reprogramar'), onTap: () => Navigator.pop(context, 'reschedule')),
          ListTile(
            key: const Key('action-cancel'),
            leading: const Icon(Icons.cancel_outlined),
            title: const Text('Cancelar cita'),
            subtitle: Text(item['sagaId'] != null ? 'Se reembolsará tu pago' : 'La cita queda libre'),
            onTap: () => Navigator.pop(context, 'cancel'),
          ),
        ]),
      ),
    );
    if (action == 'reschedule') await _reschedule(item);
    if (action == 'cancel') await _cancel(item);
  }

  Future<void> _reschedule(Map<String, dynamic> item) async {
    final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => RescheduleScreen(api: widget.api, appointment: item, now: widget.now)));
    if (done == true) _notify('Cita reprogramada.');
    await _reload();
  }

  Future<void> _cancel(Map<String, dynamic> item) async {
    final paid = item['sagaId'] != null;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Cancelar la cita?'),
        content: Text(paid ? 'Se reembolsará tu pago a la tarjeta y se emitirá una nota de crédito.' : 'El turno quedará libre.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('No')),
          FilledButton(key: const Key('cancel-yes'), onPressed: () => Navigator.pop(context, true), child: const Text('Sí, cancelar')),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _paying = item['id'] as String);
    try {
      if (paid) {
        final problem = await widget.flow.cancel(item['sagaId'] as String);
        _notify(problem ?? 'Cita cancelada y pago reembolsado.');
      } else {
        final response = await widget.api.send('POST', Config.gestion, body: {'query': _cancelUnpaid, 'variables': {'id': item['id']}}) as Map<String, dynamic>;
        final errors = response['errors'] as List?;
        _notify(errors != null && errors.isNotEmpty ? errors.first['message'] as String : 'Cita cancelada.');
      }
    } on OfflineException {
      _notify('Cancelar requiere conexión.');
    } on Exception catch (error) {
      _notify(error.toString());
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
                    : _isOpen(item as Map<String, dynamic>)
                        ? TextButton(
                            key: Key('manage-${item['id']}'),
                            onPressed: _paying == null ? () => _manage(item) : null,
                            child: Text(_paying == item['id'] ? 'Cancelando...' : '${_status[item['status']]} ▾'),
                          )
                        : Text(_status[item['status']] ?? item['status'] as String),
              ),
          ]),
        );
      }(),
    );
  }
}
