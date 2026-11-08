import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';

const _slots = r'query ($s: String!, $v: String!, $d: String!) { getAvailableSlots(stylistId: $s, serviceId: $v, date: $d) { start end } }';
const _reschedule = r'mutation ($id: ID!, $d: String!) { rescheduleAppointment(id: $id, newDate: $d) { id } }';

String _isoDate(DateTime date) =>
    '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

/// Reprogramar una cita (CU-07): mismo estilista y servicio, en otro turno libre. No cambia el cobro.
class RescheduleScreen extends StatefulWidget {
  final ApiClient api;
  final Map<String, dynamic> appointment;
  /// Reloj sustituible en las pruebas.
  final DateTime Function()? now;

  const RescheduleScreen({super.key, required this.api, required this.appointment, this.now});

  @override
  State<RescheduleScreen> createState() => _RescheduleScreenState();
}

class _RescheduleScreenState extends State<RescheduleScreen> {
  /// Empieza en el día actual de la cita: lo más común es moverla unas horas. Si ya pasó, hoy.
  late DateTime _date = _initialDate();
  List<dynamic>? _available;
  String? _slot;
  bool _busy = false;
  String? _error;
  int _request = 0;

  DateTime _now() => (widget.now ?? DateTime.now)();

  DateTime _initialDate() {
    final current = DateTime.parse(widget.appointment['appointmentDate'] as String);
    final now = _now();
    return current.isAfter(now) ? DateTime(current.year, current.month, current.day) : now;
  }

  @override
  void initState() {
    super.initState();
    _loadSlots();
  }

  Future<void> _loadSlots() async {
    // Solo vale la consulta más reciente: una respuesta tardía movería la cita a otro día
    final request = ++_request;
    setState(() {
      _available = null;
      _slot = null;
      _error = null;
    });
    try {
      final data = await widget.api.graphql(Config.gestion, _slots, variables: {
        's': widget.appointment['stylistId'],
        'v': widget.appointment['serviceId'],
        'd': _isoDate(_date),
      });
      final now = _now();
      final slots = (data['getAvailableSlots'] as List).where((slot) => DateTime.parse(slot['start'] as String).isAfter(now)).toList();
      if (mounted && request == _request) setState(() => _available = slots);
    } on Exception catch (error) {
      if (mounted && request == _request) setState(() => _error = error.toString());
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

  Future<void> _confirm() async {
    final slot = _slot;
    if (slot == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await widget.api.send('POST', Config.gestion, body: {
        'query': _reschedule,
        'variables': {'id': widget.appointment['id'], 'd': slot},
      }) as Map<String, dynamic>;
      final errors = response['errors'] as List?;
      if (errors != null && errors.isNotEmpty) throw ApiException(errors.first['message'] as String);
      if (mounted) Navigator.of(context).pop(true);
    } on OfflineException {
      setState(() => _error = 'Reprogramar requiere conexión.');
    } on Exception catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = (widget.appointment['appointmentDate'] as String).replaceFirst('T', ' ').substring(0, 16);
    return Scaffold(
      appBar: AppBar(title: const Text('Reprogramar cita')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('${widget.appointment['serviceName']} con ${widget.appointment['stylistName']}'),
        Text('Ahora: $current', style: const TextStyle(fontSize: 12)),
        const SizedBox(height: 12),
        OutlinedButton.icon(key: const Key('reschedule-date'), onPressed: _pickDate, icon: const Icon(Icons.calendar_month), label: Text('Fecha: ${_isoDate(_date)}')),
        const SizedBox(height: 8),
        if (_available != null && _available!.isEmpty) const Text('No quedan turnos libres ese día.'),
        if (_available != null)
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final slot in _available!)
              ChoiceChip(
                key: Key('reslot-${(slot['start'] as String).substring(11, 16)}'),
                label: Text((slot['start'] as String).substring(11, 16)),
                selected: _slot == slot['start'],
                onSelected: (_) => setState(() => _slot = slot['start'] as String),
              ),
          ]),
        const SizedBox(height: 16),
        FilledButton(key: const Key('reschedule-confirm'), onPressed: _busy || _slot == null ? null : _confirm, child: const Text('Confirmar el nuevo horario')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, key: const Key('reschedule-error'))),
      ]),
    );
  }
}
