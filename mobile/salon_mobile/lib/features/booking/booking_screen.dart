import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import 'booking_flow.dart';

const _catalog = '{ getServices { id name durationMinutes price } getStylists { id name } }';
const _slots = r'query ($s: String!, $v: String!, $d: String!) { getAvailableSlots(stylistId: $s, serviceId: $v, date: $d) { start end } }';

String _isoDate(DateTime date) =>
    '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

/// Reservar y pagar una cita (CU-06, CU-10). El turno se aparta antes de cobrar y vuelve a quedar libre si el pago falla.
class BookingScreen extends StatefulWidget {
  final ApiClient api;
  final BookingFlow flow;
  /// Reloj sustituible en las pruebas.
  final DateTime Function()? now;

  const BookingScreen({super.key, required this.api, required this.flow, this.now});

  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen> {
  List<dynamic> _services = [];
  List<dynamic> _stylists = [];
  List<dynamic>? _available;
  String? _serviceId;
  String? _stylistId;
  late DateTime _date = _now();
  String? _slot;
  bool _busy = false;
  String? _error;
  String? _notice;
  BookingView? _pending;
  BookingView? _done;

  DateTime _now() => (widget.now ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    try {
      final data = await widget.api.graphql(Config.gestion, _catalog);
      if (mounted) {
        setState(() {
          _services = data['getServices'] as List;
          _stylists = data['getStylists'] as List;
        });
      }
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _loadSlots() async {
    if (_serviceId == null || _stylistId == null) return;
    setState(() {
      _available = null;
      _slot = null;
      _error = null;
    });
    try {
      final data = await widget.api.graphql(Config.gestion, _slots, variables: {'s': _stylistId, 'v': _serviceId, 'd': _isoDate(_date)});
      final now = _now();
      // Un turno que ya pasó no se puede reservar
      final slots = (data['getAvailableSlots'] as List).where((slot) => DateTime.parse(slot['start'] as String).isAfter(now)).toList();
      if (mounted) setState(() => _available = slots);
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _pickDate() async {
    final today = _now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(today.year, today.month, today.day),
      lastDate: today.add(const Duration(days: 90)),
    );
    if (picked != null) {
      setState(() => _date = picked);
      await _loadSlots();
    }
  }

  String _serviceName() => (_services.firstWhere((service) => service['id'] == _serviceId, orElse: () => {'name': 'Servicio'})['name']) as String;

  Future<void> _reserve() async {
    final slot = _slot;
    if (slot == null) return;
    await _run(() => widget.flow.start(
          serviceId: _serviceId!,
          stylistId: _stylistId!,
          appointmentDate: slot,
          label: 'Reservar ${_serviceName()} ${slot.replaceFirst('T', ' ').substring(0, 16)}',
        ));
  }

  Future<void> _pay() async {
    final pending = _pending;
    if (pending != null) await _run(() => widget.flow.pay(pending.sagaId));
  }

  Future<void> _run(Future<BookingStep> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final step = await action();
      if (!mounted) return;
      setState(() {
        if (step.queued) {
          _notice = 'Sin conexión: la reserva se enviará al volver la red. Después págala en "Mis citas" dentro de 15 minutos.';
        } else if (step.error != null) {
          _error = step.error;
          if (step.view?.reverted ?? false) {
            _pending = null;
            _available = null;
            _slot = null;
          }
        } else if (step.canceled) {
          _notice = 'Pago cancelado. El turno sigue apartado unos minutos: puedes pagar ahora o desde "Mis citas".';
        } else if (step.view?.completed ?? false) {
          _done = step.view;
          _pending = null;
        } else if (step.view?.awaitingPayment ?? false) {
          _pending = step.view;
        } else {
          _notice = 'La reserva sigue procesándose. Revisa "Mis citas" en unos segundos.';
        }
      });
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reservar cita')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_done != null) ...[
          Card(
            key: const Key('booking-done'),
            child: ListTile(
              leading: const Icon(Icons.check_circle, color: Color(0xFF4ADE80)),
              title: const Text('Reserva confirmada y pagada'),
              subtitle: Text('${_done!.serviceName ?? _serviceName()} · ${(_slot ?? '').replaceFirst('T', ' ')}\nLa factura y tus puntos aparecen en "Cuenta".'),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Listo')),
        ] else if (_pending != null) ...[
          Text('Turno apartado: ${_serviceName()}, ${_slot?.replaceFirst('T', ' ').substring(0, 16)}', key: const Key('booking-held')),
          const SizedBox(height: 8),
          Text('Total: ${((_pending!.amountToPayCents ?? 0) / 100).toStringAsFixed(2)} USD', key: const Key('booking-total'), style: const TextStyle(fontSize: 18)),
          const Text('Paga en 15 minutos o el turno se libera.', style: TextStyle(fontSize: 12)),
          const SizedBox(height: 12),
          FilledButton.icon(key: const Key('booking-pay'), onPressed: _busy ? null : _pay, icon: const Icon(Icons.credit_card), label: const Text('Pagar con tarjeta')),
        ] else ...[
          DropdownButtonFormField<String>(
            key: const Key('booking-service'),
            initialValue: _serviceId,
            decoration: const InputDecoration(labelText: 'Servicio'),
            items: [
              for (final service in _services)
                DropdownMenuItem(
                  value: service['id'] as String,
                  child: Text('${service['name']} · ${(service['price'] as num).toStringAsFixed(2)} USD', overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (value) {
              setState(() => _serviceId = value);
              _loadSlots();
            },
          ),
          DropdownButtonFormField<String>(
            key: const Key('booking-stylist'),
            initialValue: _stylistId,
            decoration: const InputDecoration(labelText: 'Estilista'),
            items: [for (final stylist in _stylists) DropdownMenuItem(value: stylist['id'] as String, child: Text(stylist['name'] as String))],
            onChanged: (value) {
              setState(() => _stylistId = value);
              _loadSlots();
            },
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(key: const Key('booking-date'), onPressed: _pickDate, icon: const Icon(Icons.calendar_month), label: Text('Fecha: ${_isoDate(_date)}')),
          const SizedBox(height: 8),
          if (_available != null && _available!.isEmpty) const Text('No quedan turnos libres ese día.', key: Key('booking-no-slots')),
          if (_available != null)
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final slot in _available!)
                ChoiceChip(
                  key: Key('slot-${(slot['start'] as String).substring(11, 16)}'),
                  label: Text((slot['start'] as String).substring(11, 16)),
                  selected: _slot == slot['start'],
                  onSelected: (_) => setState(() => _slot = slot['start'] as String),
                ),
            ]),
          const SizedBox(height: 16),
          FilledButton(key: const Key('booking-reserve'), onPressed: _busy || _slot == null ? null : _reserve, child: const Text('Apartar turno')),
        ],
        if (_busy) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, key: const Key('booking-error'), style: const TextStyle(color: Color(0xFFFCA5A5)))),
        if (_notice != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_notice!, key: const Key('booking-notice'))),
      ]),
    );
  }
}
