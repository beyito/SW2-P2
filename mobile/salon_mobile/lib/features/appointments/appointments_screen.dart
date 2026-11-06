import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';

const _status = {'PENDING': 'Pendiente de pago', 'CONFIRMED': 'Confirmada', 'COMPLETED': 'Atendida', 'CANCELLED': 'Cancelada'};

/// Mis citas: se pueden consultar sin conexión con la última copia.
class AppointmentsScreen extends StatefulWidget {
  final ApiClient api;

  const AppointmentsScreen({super.key, required this.api});

  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  static const _query = '{ getMyAppointments { id serviceName stylistName appointmentDate status totalPrice } }';
  List<dynamic>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    try {
      final data = await widget.api.graphql(Config.gestion, _query);
      if (mounted) setState(() => _items = data['getMyAppointments'] as List);
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    if (_error != null && items == null) return Center(child: Text(_error!));
    if (items == null) return const Center(child: CircularProgressIndicator());
    if (items.isEmpty) return const Center(child: Text('Todavía no tienes citas.'));
    return RefreshIndicator(
      onRefresh: _reload,
      child: ListView(children: [
        for (final item in items)
          ListTile(
            title: Text(item['serviceName'] as String),
            subtitle: Text('${(item['appointmentDate'] as String).replaceFirst('T', ' ').substring(0, 16)} · ${item['stylistName']}'),
            trailing: Text(_status[item['status']] ?? item['status'] as String),
          ),
      ]),
    );
  }
}
