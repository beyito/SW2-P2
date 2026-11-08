import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/salon_theme.dart';

/// Obtiene la foto del cliente; en las pruebas se sustituye por una foto fija.
typedef PhotoSource = Future<Uint8List?> Function(ImageSource source);

Future<Uint8List?> pickPhotoFromDevice(ImageSource source) async {
  final file = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 90);
  return file?.readAsBytes();
}

/// Generar una imagen envía la foto a un tercero: siempre en línea, sin cola y sin copia local.
class ImageGenerationApi {
  static const _consentUrl = '${Config.asesoria}/biometrics/image-consent';
  static const _baseUrl = '${Config.ia}/image-generation';
  static const profileQuery = '{ getMyProfile { styleProfile { gender ageRange preferredLength maintenance vibe } } }';

  final ApiClient _api;
  const ImageGenerationApi(this._api);

  Future<Map<String, dynamic>> consent() async => await _api.send('GET', _consentUrl) as Map<String, dynamic>;

  Future<void> grant(String policyVersion) => _api.send('POST', _consentUrl, body: {'policyVersion': policyVersion, 'declaresAdult': true});

  Future<void> revoke() => _api.send('DELETE', _consentUrl);

  Future<Map<String, dynamic>> haircut(Uint8List photo, String styleId) async =>
      await _api.upload('$_baseUrl/haircut', photo, 'foto.jpg', fields: {'style_id': styleId}) as Map<String, dynamic>;

  Future<Map<String, dynamic>> tryOn(Uint8List photo, String itemId) async =>
      await _api.upload('$_baseUrl/try-on', photo, 'foto.jpg', fields: {'item_id': itemId}) as Map<String, dynamic>;

  Future<Map<String, dynamic>> tryOnOutfit(Uint8List photo, List<String> itemIds) async =>
      await _api.upload('$_baseUrl/try-on-outfit', photo, 'foto.jpg', fields: {'item_ids': itemIds.join(',')}) as Map<String, dynamic>;

  /// Preferencias declaradas; si el CRM no responde, se continúa sin ellas.
  Future<Map<String, dynamic>> styleProfile() async {
    try {
      final data = await _api.graphql(Config.crm, profileQuery) as Map<String, dynamic>;
      return (data['getMyProfile']?['styleProfile'] as Map<String, dynamic>?) ?? const {};
    } on Exception {
      return const {};
    }
  }
}

/// Simulación de un corte, un color o una prenda. La autorización va aparte del diagnóstico,
/// y la imagen solo vive en esta pantalla: al salir no queda copia.
class ImagePreviewScreen extends StatefulWidget {
  final ApiClient api;
  final String title;
  final String photoHint;
  final bool approximate;
  final Future<Map<String, dynamic>> Function(ImageGenerationApi api, Uint8List photo) generate;
  final PhotoSource pickPhoto;

  const ImagePreviewScreen({
    super.key,
    required this.api,
    required this.title,
    required this.photoHint,
    required this.generate,
    this.approximate = false,
    this.pickPhoto = pickPhotoFromDevice,
  });

  @override
  State<ImagePreviewScreen> createState() => _ImagePreviewScreenState();
}

class _ImagePreviewScreenState extends State<ImagePreviewScreen> {
  late final ImageGenerationApi _images = ImageGenerationApi(widget.api);
  Map<String, dynamic>? _consent;
  Map<String, dynamic>? _result;
  bool _minor = false;
  bool _adult = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => _guard(() async {
        final profile = await _images.styleProfile();
        final consent = await _images.consent();
        if (!mounted) return;
        setState(() {
          _minor = profile['ageRange'] == 'UNDER_18';
          _consent = consent;
        });
      });

  Future<void> _guard(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on OfflineException {
      if (mounted) setState(() => _error = 'Esta función requiere conexión.');
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept() => _guard(() async {
        await _images.grant(_consent!['policyVersion'] as String);
        final consent = await _images.consent();
        if (mounted) setState(() => _consent = consent);
      });

  Future<void> _revoke() => _guard(() async {
        await _images.revoke();
        final consent = await _images.consent();
        if (mounted) {
          setState(() {
            _consent = consent;
            _result = null;
            _adult = false;
          });
        }
      });

  Future<void> _generate(ImageSource source) async {
    final photo = await widget.pickPhoto(source);
    if (photo == null) return;
    setState(() => _result = null);
    await _guard(() async {
      try {
        final result = await widget.generate(_images, photo);
        if (mounted) setState(() => _result = result);
      } on ApiException catch (error) {
        if (error.code == 'IMAGE_CONSENT_REQUIRED') {
          final consent = await _images.consent();
          if (mounted) setState(() => _consent = consent);
        }
        rethrow;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final consent = _consent, result = _result;
    final granted = consent?['granted'] == true;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_busy) ...[
          const LinearProgressIndicator(),
          const SizedBox(height: 8),
          if (consent != null && granted) const Text('Generando la imagen, puede tardar hasta un minuto...', key: Key('preview-busy')),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error!, key: const Key('preview-error'), style: const TextStyle(color: SalonColors.danger))),
        if (consent != null && !granted && _minor) const Text('La simulación con foto es solo para mayores de 18 años.', key: Key('preview-minor')),
        if (consent != null && !granted && !_minor) ...[
          Text(consent['policyText'] as String, key: const Key('preview-consent-text')),
          CheckboxListTile(
            key: const Key('preview-adult'),
            contentPadding: EdgeInsets.zero,
            value: _adult,
            title: const Text('Soy mayor de 18 años y la foto es mía'),
            onChanged: (value) => setState(() => _adult = value ?? false),
          ),
          FilledButton(key: const Key('preview-accept'), onPressed: _adult && !_busy ? _accept : null, child: const Text('Acepto')),
        ],
        if (granted) ...[
          Text(widget.photoHint),
          if (widget.approximate)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Se muestra lo más parecido que ofrece el generador: el estilo real puede tener otros detalles.', key: Key('preview-approximate'), style: TextStyle(fontSize: 12)),
            ),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            FilledButton.icon(key: const Key('preview-camera'), onPressed: _busy ? null : () => _generate(ImageSource.camera), icon: const Icon(Icons.camera_alt), label: const Text('Tomar foto')),
            OutlinedButton.icon(key: const Key('preview-gallery'), onPressed: _busy ? null : () => _generate(ImageSource.gallery), icon: const Icon(Icons.photo), label: const Text('Elegir foto')),
          ]),
        ],
        if (result != null) ...[
          const SizedBox(height: 16),
          // Va antes de la imagen: una foto alta no debe dejar el aviso fuera de la pantalla
          Text(result['label'] as String, key: const Key('preview-label'), style: const TextStyle(fontWeight: FontWeight.bold, color: SalonColors.gold)),
          const SizedBox(height: 8),
          ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.memory(base64Decode(result['image_base64'] as String), key: const Key('preview-image'), fit: BoxFit.contain)),
          const SizedBox(height: 8),
          Text('Te quedan ${result['remaining_today']} imágenes hoy. Si sales de esta pantalla no se conservará.', style: const TextStyle(fontSize: 12)),
        ],
        if (granted) ...[
          const SizedBox(height: 16),
          TextButton(key: const Key('preview-revoke'), onPressed: _busy ? null : _revoke, child: const Text('Retirar mi autorización para enviar fotos')),
        ],
      ]),
    );
  }
}
