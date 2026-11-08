import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/connectivity_status.dart';
import 'on_device_analyzer.dart';
import 'recommendations_section.dart';
import '../../core/salon_theme.dart';

const _shapes = {'OVAL': 'Ovalado', 'ROUND': 'Redondo', 'SQUARE': 'Cuadrado', 'HEART': 'Corazón', 'OBLONG': 'Alargado'};
const _undertones = {'WARM': 'Cálido', 'COOL': 'Frío', 'NEUTRAL': 'Neutro'};
const _hairs = {'STRAIGHT': 'Liso', 'WAVY': 'Ondulado', 'CURLY': 'Rizado'};
const diagnosisKind = 'DIAGNOSIS';

/// Diagnóstico con consentimiento (CU-13): en línea analiza el servidor; sin conexión, el dispositivo.
class BiometricsScreen extends StatefulWidget {
  final ApiClient api;
  final OnDeviceAnalyzer analyzer;
  final ConnectivityStatus connectivity;

  const BiometricsScreen({super.key, required this.api, required this.analyzer, required this.connectivity});

  @override
  State<BiometricsScreen> createState() => _BiometricsScreenState();
}

class _BiometricsScreenState extends State<BiometricsScreen> {
  static const _consentUrl = '${Config.asesoria}/biometrics/consent';
  static const _diagnosesUrl = '${Config.asesoria}/biometrics/diagnoses';

  final _picker = ImagePicker();
  Map<String, dynamic>? _consent;
  Map<String, dynamic>? _diagnosis;
  bool _adult = false;
  bool _pendingSync = false;
  String? _busy;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _guard(String? busy, Future<void> Function() action) async {
    setState(() {
      _busy = busy;
      _error = null;
    });
    try {
      await action();
    } on Exception catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _load() => _guard('Cargando...', () async {
        final consent = await widget.api.read(_consentUrl) as Map<String, dynamic>;
        Map<String, dynamic>? latest;
        if (consent['granted'] == true) {
          final list = await widget.api.read(_diagnosesUrl) as List;
          if (list.isNotEmpty) latest = list.first as Map<String, dynamic>;
        }
        setState(() {
          _consent = consent;
          _diagnosis = latest;
        });
      });

  Future<void> _accept() => _guard('Guardando...', () async {
        await widget.api.send('POST', _consentUrl, body: {'policyVersion': _consent!['policyVersion'], 'declaresAdult': true});
        await _load();
      });

  /// Sin conexión se analiza aquí mismo y el resultado se guarda para enviarlo; nunca la foto.
  Future<void> _scan(ImageSource source) async {
    final file = await _picker.pickImage(source: source, maxWidth: 1600, imageQuality: 92);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    await _guard('Analizando...', () => _analyze(bytes));
  }

  Future<void> _analyze(Uint8List bytes) async {
    if (widget.connectivity.isOnline) {
      try {
        final result = await widget.api.upload('${Config.ia}/biometrics/scan', bytes, 'foto.jpg');
        setState(() {
          _diagnosis = result as Map<String, dynamic>;
          _pendingSync = false;
        });
        return;
      } on OfflineException {
        // El estado de la red se actualiza con retraso: se continúa en el dispositivo
      }
    }
    final result = await widget.analyzer.analyze(bytes);
    await widget.api.queue.enqueue(kind: diagnosisKind, label: 'Diagnóstico sin conexión', url: _diagnosesUrl, method: 'POST', body: result);
    setState(() {
      _diagnosis = result;
      _pendingSync = true;
    });
  }

  Future<void> _scanVideo() async {
    final file = await _picker.pickVideo(source: ImageSource.camera, maxDuration: const Duration(seconds: 5));
    if (file == null) return;
    final bytes = await file.readAsBytes();
    await _guard('Analizando el video...', () async {
      final result = await widget.api.upload('${Config.ia}/biometrics/scan', bytes, 'video.mp4');
      setState(() => _diagnosis = result as Map<String, dynamic>);
    });
  }

  /// También retira los resultados que aún no se enviaron: no deben llegar después al servidor.
  Future<void> _revoke() => _guard('Borrando...', () async {
        await widget.api.queue.discardKind(diagnosisKind);
        final result = await widget.api.write('CONSENT', 'Retirar consentimiento', 'DELETE', _consentUrl);
        await widget.api.clearCacheEntry(_diagnosesUrl);
        if (result.queued) {
          await widget.api.clearCacheEntry(_consentUrl);
          setState(() {
            _consent = {...?_consent, 'granted': false};
            _diagnosis = null;
          });
        } else {
          setState(() => _diagnosis = null);
          await _load();
        }
      });

  @override
  Widget build(BuildContext context) {
    final consent = _consent;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_busy != null) const LinearProgressIndicator(),
        if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error!, key: const Key('scan-error'), style: const TextStyle(color: SalonColors.danger))),
        if (consent != null && consent['granted'] != true) ..._consentView(consent),
        if (consent != null && consent['granted'] == true) ..._scanView(),
        if (_diagnosis != null) _result(_diagnosis!),
        RecommendationsSection(api: widget.api, diagnosis: _diagnosis, online: widget.connectivity.isOnline),
        if (consent != null && consent['granted'] == true)
          TextButton(key: const Key('revoke'), onPressed: _busy == null ? _revoke : null, child: const Text('Retirar mi consentimiento y borrar mis datos')),
      ],
    );
  }

  List<Widget> _consentView(Map<String, dynamic> consent) => [
        Text(consent['policyText'] as String, key: const Key('consent-text')),
        CheckboxListTile(
          key: const Key('consent-adult'),
          contentPadding: EdgeInsets.zero,
          value: _adult,
          title: const Text('Soy mayor de 18 años'),
          onChanged: (value) => setState(() => _adult = value ?? false),
        ),
        FilledButton(key: const Key('consent-accept'), onPressed: _adult && _busy == null ? _accept : null, child: const Text('Acepto')),
        if (!widget.connectivity.isOnline) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Aceptar requiere conexión.')),
      ];

  List<Widget> _scanView() => [
        Wrap(spacing: 8, runSpacing: 8, children: [
          FilledButton.icon(key: const Key('scan-camera'), onPressed: _busy == null ? () => _scan(ImageSource.camera) : null, icon: const Icon(Icons.camera_alt), label: const Text('Tomar foto')),
          OutlinedButton.icon(onPressed: _busy == null ? () => _scan(ImageSource.gallery) : null, icon: const Icon(Icons.photo), label: const Text('Elegir foto')),
          if (widget.connectivity.isOnline)
            OutlinedButton.icon(onPressed: _busy == null ? _scanVideo : null, icon: const Icon(Icons.videocam), label: const Text('Video de 3 a 5 s')),
        ]),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text('La foto o el video se descartan al terminar. Sin conexión solo se analizan fotos.', style: TextStyle(fontSize: 12)),
        ),
      ];

  Widget _result(Map<String, dynamic> diagnosis) => Card(
        key: const Key('diagnosis'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Rostro: ${_shapes[diagnosis['faceShape']]} (${_percent(diagnosis['faceShapeConfidence'])})', key: const Key('result-shape')),
            Text('Subtono: ${_undertones[diagnosis['skinUndertone']]} (${_percent(diagnosis['undertoneConfidence'])})'),
            Text(diagnosis['hairType'] == null ? 'Cabello: no se ve lo suficiente' : 'Cabello: ${_hairs[diagnosis['hairType']]} (${_percent(diagnosis['hairTypeConfidence'])})'),
            const SizedBox(height: 8),
            Text('Colores: ${(diagnosis['recommendedPalette'] as List).join(', ')}'),
            const SizedBox(height: 8),
            Text(
              _pendingSync ? 'Analizado en este dispositivo. Se enviará al volver la conexión.' : 'Es una estimación; tu estilista la confirma en la cita.',
              key: const Key('result-note'),
              style: const TextStyle(fontSize: 12),
            ),
          ]),
        ),
      );

  String _percent(dynamic value) => '${((value as num) * 100).round()}%';
}
