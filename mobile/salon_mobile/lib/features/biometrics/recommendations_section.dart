import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../image_generation/image_preview_screen.dart';
import '../../core/salon_theme.dart';

const _recognizedGenders = {'FEMALE', 'MALE'};

/// Recomendaciones del catálogo (CU-14) a partir del diagnóstico y las preferencias declaradas.
/// El recomendador corre en el servidor: sin conexión se indica en lugar de mostrar una lista vieja.
class RecommendationsSection extends StatefulWidget {
  final ApiClient api;
  final Map<String, dynamic>? diagnosis;
  final bool online;
  final PhotoSource pickPhoto;

  const RecommendationsSection({super.key, required this.api, required this.diagnosis, required this.online, this.pickPhoto = pickPhotoFromDevice});

  @override
  State<RecommendationsSection> createState() => _RecommendationsSectionState();
}

class _RecommendationsSectionState extends State<RecommendationsSection> {
  late final ImageGenerationApi _images = ImageGenerationApi(widget.api);
  List<dynamic> _styles = [];
  bool _minor = false;
  String? _error;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(RecommendationsSection old) {
    super.didUpdateWidget(old);
    if (old.diagnosis != widget.diagnosis || old.online != widget.online) _load();
  }

  Map<String, Object> _attributes(Map<String, dynamic> profile) {
    final diagnosis = widget.diagnosis;
    final gender = profile['gender'];
    final values = <String, Object?>{
      'gender': _recognizedGenders.contains(gender) ? gender : null,
      'age_range': profile['ageRange'],
      'length': profile['preferredLength'],
      'maintenance': profile['maintenance'],
      'vibe': profile['vibe'],
      'face_shape': diagnosis?['faceShape'],
      'hair_type': diagnosis?['hairType'],
      'hair_tone': diagnosis?['hairTone'],
      'skin_undertone': diagnosis?['skinUndertone'],
    };
    return {
      for (final entry in values.entries)
        if (entry.value != null) entry.key: entry.value!,
    };
  }

  Future<void> _load() async {
    if (!widget.online) return;
    // Si llegan respuestas cruzadas, solo vale la más reciente
    final request = ++_request;
    try {
      final profile = await _images.styleProfile();
      final attributes = _attributes(profile);
      final styles = attributes.isEmpty ? <dynamic>[] : await widget.api.send('POST', '${Config.ia}/recommendations/styles', body: attributes) as List;
      if (!mounted || request != _request) return;
      setState(() {
        _styles = styles;
        _minor = profile['ageRange'] == 'UNDER_18';
        _error = null;
      });
    } on Exception catch (error) {
      if (mounted && request == _request) setState(() => _error = error.toString());
    }
  }

  void _preview(Map<String, dynamic> style) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => ImagePreviewScreen(
        api: widget.api,
        title: style['style_name'] as String,
        photoHint: 'Usa una foto tuya de frente, donde se vea bien tu cabello y no aparezca nadie más.',
        approximate: style['preview_approximate'] == true,
        pickPhoto: widget.pickPhoto,
        generate: (images, photo) => images.haircut(photo, style['style_id'] as String),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.online) {
      return const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Las recomendaciones requieren conexión.', key: Key('recommendations-offline')));
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, key: const Key('recommendations'), children: [
      if (_styles.isNotEmpty) const Padding(padding: EdgeInsets.only(top: 16, bottom: 8), child: Text('Recomendaciones de estilo', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, fontFamily: 'serif', color: SalonColors.text))),
      if (_error != null) Text(_error!, key: const Key('recommendations-error'), style: const TextStyle(color: SalonColors.danger)),
      for (final style in _styles.cast<Map<String, dynamic>>())
        Card(
          key: Key('style-${style['style_id']}'),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(style['style_name'] as String, style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(style['reason'] as String, style: const TextStyle(fontSize: 13)),
              if (style['can_preview'] == true && !_minor)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: OutlinedButton.icon(
                    key: Key('preview-${style['style_id']}'),
                    onPressed: () => _preview(style),
                    icon: const Icon(Icons.auto_awesome, size: 16),
                    label: const Text('Ver cómo me queda'),
                  ),
                ),
            ]),
          ),
        ),
    ]);
  }
}
