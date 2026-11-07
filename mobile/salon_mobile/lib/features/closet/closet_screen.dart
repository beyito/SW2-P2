import 'dart:async';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../image_generation/image_preview_screen.dart';

const _categories = {'TOP': 'Parte superior', 'BOTTOM': 'Parte inferior', 'SHOES': 'Calzado', 'ACCESSORY': 'Accesorio', 'OUTERWEAR': 'Abrigo'};
// El generador viste a la persona con prendas; calzado y accesorios no dan un resultado fiable
const _tryOnCategories = {'TOP', 'BOTTOM', 'OUTERWEAR'};

/// Clóset virtual (CU-15): sin conexión muestra la última copia y guarda las prendas nuevas en la cola.
class ClosetScreen extends StatefulWidget {
  final ApiClient api;
  final String clientId;
  final PhotoSource pickPhoto;

  const ClosetScreen({super.key, required this.api, required this.clientId, this.pickPhoto = pickPhotoFromDevice});

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

  /// Sube la foto y devuelve su ruta interna. Subir requiere conexión, a diferencia de crear la prenda.
  Future<String?> _uploadPhoto() async {
    final photo = await widget.pickPhoto(ImageSource.gallery);
    if (photo == null) return null;
    final uploaded = await widget.api.upload('${Config.asesoria}/media', photo, 'prenda.jpg') as Map<String, dynamic>;
    return uploaded['url'] as String;
  }

  Future<void> _addPhoto(Map<String, dynamic> item) async {
    try {
      final url = await _uploadPhoto();
      if (url == null) return;
      await widget.api.write('CLOSET', 'Agregar foto: ${item['name']}', 'PATCH', '${Config.asesoria}/closet/${item['id']}', body: {'imageUrl': url});
      setState(() => _message = 'Foto agregada.');
      await _reload();
    } on OfflineException {
      setState(() => _message = 'Subir una foto requiere conexión.');
    } on Exception catch (error) {
      setState(() => _message = error.toString());
    }
  }

  void _tryOn(Map<String, dynamic> item) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => ImagePreviewScreen(
        api: widget.api,
        title: item['name'] as String,
        photoHint: 'Usa una foto tuya de cuerpo entero o de la cintura para arriba, sin nadie más.',
        pickPhoto: widget.pickPhoto,
        generate: (images, photo) => images.tryOn(photo, item['id'] as String),
      ),
    ));
  }

  Widget _tile(Map<String, dynamic> item) {
    final image = item['imageUrl'] as String?;
    final hasOwnPhoto = image != null && image.startsWith('/media/');
    final canTryOn = _tryOnCategories.contains(item['category']);
    return ListTile(
      key: Key('closet-item-${item['name']}'),
      contentPadding: EdgeInsets.zero,
      leading: SizedBox(
        width: 48,
        height: 48,
        child: hasOwnPhoto
            ? Image.network('${Config.asesoria}$image', fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.checkroom))
            : const Icon(Icons.checkroom),
      ),
      title: Text(item['name'] as String),
      subtitle: Text('${_categories[item['category']] ?? item['category']} · ${item['color']}'),
      trailing: !canTryOn
          ? null
          : hasOwnPhoto
              ? TextButton(key: Key('try-on-${item['name']}'), onPressed: () => _tryOn(item), child: const Text('Probármela'))
              : IconButton(key: Key('add-photo-${item['name']}'), tooltip: 'Agregar foto de la prenda', onPressed: () => _addPhoto(item), icon: const Icon(Icons.add_a_photo)),
    );
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
      for (final item in _items.cast<Map<String, dynamic>>()) _tile(item),
    ]);
  }
}
