import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';

const _categories = {'TOP': 'Parte superior', 'BOTTOM': 'Parte inferior', 'SHOES': 'Calzado', 'ACCESSORY': 'Accesorio', 'OUTERWEAR': 'Abrigo'};

/// Clóset virtual (CU-15): sin conexión muestra la última copia y guarda las prendas nuevas en la cola.
class ClosetScreen extends StatefulWidget {
  final ApiClient api;
  final String clientId;

  const ClosetScreen({super.key, required this.api, required this.clientId});

  @override
  State<ClosetScreen> createState() => _ClosetScreenState();
}

class _ClosetScreenState extends State<ClosetScreen> {
  final _name = TextEditingController();
  final _color = TextEditingController();
  String _category = 'TOP';
  List<dynamic> _items = [];
  String? _message;
  StreamSubscription<void>? _changes;

  String get _url => '${Config.asesoria}/closet/client/${widget.clientId}';

  @override
  void initState() {
    super.initState();
    _reload();
    // Cuando la cola termina de enviar, la lista debe mostrar lo que quedó en el servidor
    _changes = widget.api.queue.changes.listen((_) => _reload());
  }

  Future<void> _reload() async {
    try {
      final items = await widget.api.read(_url) as List;
      if (mounted) setState(() => _items = items);
    } on Exception catch (error) {
      if (mounted) setState(() => _message = error.toString());
    }
  }

  Future<void> _add() async {
    final name = _name.text.trim(), color = _color.text.trim();
    if (name.isEmpty || color.isEmpty) {
      setState(() => _message = 'Indica el nombre y el color.');
      return;
    }
    try {
      final result = await widget.api.write('CLOSET', 'Agregar prenda: $name', 'POST', '${Config.asesoria}/closet', body: {'name': name, 'color': color, 'category': _category, 'season': 'ALL_SEASON'});
      _name.clear();
      _color.clear();
      setState(() => _message = result.queued ? 'Guardada en el dispositivo: se enviará al volver la conexión.' : 'Prenda agregada.');
      await _reload();
    } on Exception catch (error) {
      setState(() => _message = error.toString());
    }
  }

  @override
  void dispose() {
    _changes?.cancel();
    _name.dispose();
    _color.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(16), children: [
      TextField(key: const Key('closet-name'), controller: _name, maxLength: 80, decoration: const InputDecoration(labelText: 'Nombre')),
      TextField(key: const Key('closet-color'), controller: _color, maxLength: 80, decoration: const InputDecoration(labelText: 'Color')),
      DropdownButton<String>(
        value: _category,
        isExpanded: true,
        items: _categories.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
        onChanged: (value) => setState(() => _category = value!),
      ),
      FilledButton(key: const Key('closet-add'), onPressed: _add, child: const Text('Agregar prenda')),
      if (_message != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_message!, key: const Key('closet-message'))),
      const Divider(),
      if (_items.isEmpty) const Text('Aún no tienes prendas.'),
      for (final item in _items) ListTile(title: Text(item['name'] as String), subtitle: Text('${_categories[item['category']] ?? item['category']} · ${item['color']}')),
    ]);
  }
}
