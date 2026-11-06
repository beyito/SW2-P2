import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Estado de la red. Al recuperarla avisa, para vaciar la cola automáticamente (CU-22).
class ConnectivityStatus extends ChangeNotifier {
  final Connectivity _connectivity = Connectivity();
  final Future<void> Function() onOnline;
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _online = true;

  ConnectivityStatus({required this.onOnline});

  bool get isOnline => _online;

  Future<void> start() async {
    _apply(await _connectivity.checkConnectivity());
    _subscription = _connectivity.onConnectivityChanged.listen(_apply);
    if (_online) unawaited(onOnline());
  }

  void _apply(List<ConnectivityResult> results) {
    final online = results.any((result) => result != ConnectivityResult.none);
    if (online == _online) return;
    _online = online;
    notifyListeners();
    if (online) unawaited(onOnline());
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
