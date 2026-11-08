import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/salon_theme.dart';

const _platforms = {'LINKEDIN': 'LinkedIn', 'INSTAGRAM': 'Instagram', 'TIKTOK': 'TikTok', 'FACEBOOK': 'Facebook'};
const _styleProfile = '{ getMyProfile { styleProfile { gender ageRange } } }';

/// Asesoría de imagen para redes sociales (CU-16, RF-06): usa el último diagnóstico, el clóset y el perfil de estilo.
class BrandScreen extends StatefulWidget {
  final ApiClient api;

  const BrandScreen({super.key, required this.api});

  @override
  State<BrandScreen> createState() => _BrandScreenState();
}

class _BrandScreenState extends State<BrandScreen> {
  final _sector = TextEditingController();
  final _goal = TextEditingController();
  String _platform = 'LINKEDIN';
  Map<String, dynamic>? _strategy;
  bool _busy = false;
  String? _error;

  Future<void> _ask() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // El perfil es opcional: si no se puede leer, la asesoría se pide igual
      Map<String, dynamic>? profile;
      try {
        profile = (await widget.api.graphql(Config.crm, _styleProfile))['getMyProfile']?['styleProfile'] as Map<String, dynamic>?;
      } on Exception {
        profile = null;
      }
      final strategy = await widget.api.send('POST', '${Config.ia}/brand/strategy', body: {
        'platform': _platform,
        'sector': _sector.text.trim().isEmpty ? null : _sector.text.trim(),
        'goal': _goal.text.trim().isEmpty ? null : _goal.text.trim(),
        'gender': profile?['gender'],
        'age_range': profile?['ageRange'],
      });
      if (mounted) setState(() => _strategy = strategy as Map<String, dynamic>);
    } on OfflineException {
      if (mounted) setState(() => _error = 'La asesoría requiere conexión.');
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strategy = _strategy;
    return Scaffold(
      appBar: AppBar(title: const Text('Asesoría para redes')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        DropdownButtonFormField<String>(
          key: const Key('brand-platform'),
          initialValue: _platform,
          decoration: const InputDecoration(labelText: 'Red social'),
          items: [for (final entry in _platforms.entries) DropdownMenuItem(value: entry.key, child: Text(entry.value))],
          onChanged: (value) => setState(() => _platform = value ?? 'LINKEDIN'),
        ),
        TextField(key: const Key('brand-sector'), controller: _sector, maxLength: 80, decoration: const InputDecoration(labelText: 'Sector (opcional)')),
        TextField(key: const Key('brand-goal'), controller: _goal, maxLength: 200, decoration: const InputDecoration(labelText: 'Objetivo (opcional)')),
        FilledButton(key: const Key('brand-submit'), onPressed: _busy ? null : _ask, child: Text(_busy ? 'Preparando...' : 'Obtener asesoría')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, key: const Key('brand-error'))),
        if (strategy != null) ...[
          const SizedBox(height: 16),
          Text(_platforms[strategy['platform']] ?? '', key: const Key('brand-result'), style: const TextStyle(fontSize: 20, fontFamily: 'serif', color: SalonColors.text)),
          if (strategy['personalized'] != true)
            const Text('Haz un diagnóstico para recibir una asesoría a tu medida.', style: TextStyle(fontSize: 12)),
          _row('Tono', strategy['tone']),
          _row('Corte', strategy['recommended_look']),
          _row('Color', strategy['recommended_color']),
          _row('Encuadre', strategy['framing_tip']),
          _row('Iluminación', strategy['lighting_tip']),
          Wrap(spacing: 6, children: [for (final color in (strategy['color_palette'] as List? ?? [])) Chip(label: Text('$color'))]),
          if ((strategy['closet_matches'] as List? ?? []).isNotEmpty) ...[
            const Text('De tu clóset, combinan:', style: TextStyle(fontWeight: FontWeight.bold)),
            for (final item in strategy['closet_matches'] as List) Text('• ${item['name']} (${item['color']})'),
          ],
          const SizedBox(height: 8),
          const Text('Biografía sugerida', style: TextStyle(fontWeight: FontWeight.bold)),
          Text('${strategy['bio'] ?? ''}', key: const Key('brand-bio')),
          const SizedBox(height: 8),
          const Text('Ideas de contenido', style: TextStyle(fontWeight: FontWeight.bold)),
          for (final idea in strategy['content_ideas'] as List? ?? []) Text('• $idea'),
          const SizedBox(height: 8),
          Text('Textos: ${strategy['generated_by'] ?? ''}', style: const TextStyle(fontSize: 11)),
        ],
      ]),
    );
  }

  Widget _row(String label, Object? value) => value == null
      ? const SizedBox.shrink()
      : Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('$label: $value'));
}
