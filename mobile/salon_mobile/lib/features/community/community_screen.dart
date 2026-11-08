import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/tab_refresh.dart';
import '../image_generation/image_preview_screen.dart';
import '../../core/salon_theme.dart';

/// Muro de la comunidad (CU-20, CU-21, RF-09): publicar un look, reaccionar y comentar en cascada.
/// Sin conexión se ve lo último que se cargó, y las reacciones y los comentarios quedan en la cola.
class CommunityScreen extends StatefulWidget {
  final ApiClient api;
  final PhotoSource pickPhoto;
  final TabRefresh? refresh;

  const CommunityScreen({super.key, required this.api, this.pickPhoto = pickPhotoFromDevice, this.refresh});

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  static final _wall = '${Config.asesoria}/community';
  List<dynamic>? _posts;
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
      final posts = await widget.api.read(_wall) as List;
      if (mounted) {
        setState(() {
          _posts = posts.where((post) => post['status'] != 'HIDDEN').toList();
          _error = null;
        });
      }
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  void _notify(String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

  /// Escribe en el servidor o, sin conexión, deja la operación en la cola.
  Future<void> _write(String label, String path, {Object? body}) async {
    try {
      final result = await widget.api.write('community', label, 'POST', '$_wall$path', body: body);
      if (result.queued) _notify('Sin conexión: se enviará al volver la red.');
      await _reload();
    } on Exception catch (error) {
      _notify(error.toString());
    }
  }

  Future<void> _toggleLike(Map<String, dynamic> post) async {
    // Se refleja de inmediato; al recargar, el muro trae el valor real
    setState(() {
      final liked = post['likedByMe'] == true;
      post['likedByMe'] = !liked;
      post['totalLikes'] = (post['totalLikes'] as int) + (liked ? -1 : 1);
    });
    await _write('Reaccionar a ${post['title']}', '/${post['id']}/like');
  }

  Future<void> _comment(Map<String, dynamic> post, {String? parentId}) async {
    final text = await _ask(parentId == null ? 'Comentar' : 'Responder');
    if (text == null || text.trim().isEmpty) return;
    await _write('Comentar: ${text.length > 40 ? text.substring(0, 40) : text}', '/${post['id']}/comment',
        body: {'content': text.trim(), 'parentId': ?parentId});
  }

  Future<String?> _ask(String title) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(key: const Key('comment-text'), controller: controller, maxLength: 500, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(key: const Key('comment-send'), onPressed: () => Navigator.pop(context, controller.text), child: const Text('Enviar')),
        ],
      ),
    );
  }

  Future<void> _publish() async {
    final published = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _PublishScreen(api: widget.api, pickPhoto: widget.pickPhoto)),
    );
    if (published == true) await _reload();
  }

  @override
  Widget build(BuildContext context) {
    final posts = _posts;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('publish'),
        onPressed: _publish,
        icon: const Icon(Icons.add_a_photo),
        label: const Text('Publicar look'),
      ),
      body: () {
        if (_error != null && posts == null) return Center(child: Text(_error!));
        if (posts == null) return const Center(child: CircularProgressIndicator());
        if (posts.isEmpty) return const Center(child: Text('Todavía no hay publicaciones.'));
        return RefreshIndicator(
          onRefresh: _reload,
          child: ListView(padding: const EdgeInsets.only(bottom: 88), children: [for (final post in posts) _post(post as Map<String, dynamic>)]),
        );
      }(),
    );
  }

  Widget _post(Map<String, dynamic> post) {
    final image = post['imageUrl'] as String?;
    final comments = (post['comments'] as List? ?? []).cast<Map<String, dynamic>>();
    return Card(
      key: Key('post-${post['id']}'),
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(post['title'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          Text('por ${post['authorName']}', style: const TextStyle(fontSize: 12)),
          if (image != null && image.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Image.network(
                image.startsWith('/media/') ? '${Config.asesoria}$image' : image,
                height: 220,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const SizedBox(height: 40, child: Center(child: Text('Imagen no disponible sin conexión'))),
              ),
            ),
          Text(post['description'] as String? ?? ''),
          Row(children: [
            IconButton(
              key: Key('like-${post['id']}'),
              onPressed: () => _toggleLike(post),
              icon: Icon(post['likedByMe'] == true ? Icons.favorite : Icons.favorite_border, color: SalonColors.roseDeep),
            ),
            Text('${post['totalLikes']}'),
            const Spacer(),
            TextButton.icon(key: Key('comment-${post['id']}'), onPressed: () => _comment(post), icon: const Icon(Icons.chat_bubble_outline), label: const Text('Comentar')),
          ]),
          ..._thread(post, comments, null, 0),
        ]),
      ),
    );
  }

  /// Comentarios en cascada: cada respuesta cuelga de su comentario.
  List<Widget> _thread(Map<String, dynamic> post, List<Map<String, dynamic>> all, String? parentId, int depth) {
    return [
      for (final comment in all.where((comment) => comment['parentId'] == parentId)) ...[
        Padding(
          key: Key('c-${comment['id']}'),
          padding: EdgeInsets.only(left: 16.0 * depth, top: 4),
          child: Row(children: [
            Expanded(
              child: Text(
                comment['deleted'] == true ? 'Comentario eliminado' : '${comment['authorName']}: ${comment['content']}',
                style: TextStyle(fontSize: 13, fontStyle: comment['deleted'] == true ? FontStyle.italic : FontStyle.normal),
              ),
            ),
            if (comment['deleted'] != true && depth < 3)
              TextButton(key: Key('reply-${comment['id']}'), onPressed: () => _comment(post, parentId: comment['id'] as String), child: const Text('Responder')),
          ]),
        ),
        ..._thread(post, all, comment['id'] as String, depth + 1),
      ],
    ];
  }
}

/// Publicar un look: la foto se sube primero, porque una imagen requiere conexión.
class _PublishScreen extends StatefulWidget {
  final ApiClient api;
  final PhotoSource pickPhoto;

  const _PublishScreen({required this.api, required this.pickPhoto});

  @override
  State<_PublishScreen> createState() => _PublishScreenState();
}

class _PublishScreenState extends State<_PublishScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  List<int>? _photo;
  bool _busy = false;
  String? _error;

  Future<void> _pick() async {
    final photo = await widget.pickPhoto(ImageSource.gallery);
    if (photo != null) setState(() => _photo = photo);
  }

  Future<void> _send() async {
    if (_title.text.trim().isEmpty || _photo == null) {
      setState(() => _error = 'Agrega un título y una foto.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final uploaded = await widget.api.upload('${Config.asesoria}/media', _photo!, 'look.jpg') as Map<String, dynamic>;
      await widget.api.write('community', 'Publicar: ${_title.text.trim()}', 'POST', '${Config.asesoria}/community', body: {
        'title': _title.text.trim(),
        'description': _description.text.trim(),
        'imageUrl': uploaded['url'],
      });
      if (mounted) Navigator.of(context).pop(true);
    } on OfflineException {
      setState(() => _error = 'Subir una foto requiere conexión.');
    } on Exception catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Publicar look')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(key: const Key('publish-title'), controller: _title, maxLength: 100, decoration: const InputDecoration(labelText: 'Título')),
        TextField(key: const Key('publish-description'), controller: _description, maxLength: 500, decoration: const InputDecoration(labelText: 'Descripción')),
        OutlinedButton.icon(
          key: const Key('publish-photo'),
          onPressed: _pick,
          icon: const Icon(Icons.photo),
          label: Text(_photo == null ? 'Elegir foto' : 'Foto elegida'),
        ),
        const SizedBox(height: 12),
        FilledButton(key: const Key('publish-send'), onPressed: _busy ? null : _send, child: const Text('Publicar')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, key: const Key('publish-error'))),
      ]),
    );
  }
}
