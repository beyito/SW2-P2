import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import '../database/sqlite_service.dart';

/// Gestor de Sincronización Offline-First (CU-22, RF-10)
/// Coordina la persistencia en cola local SQLite y la sincronización con el backend
/// cuando se restablece la conectividad a Internet.
class OfflineSyncManager {
  final SQLiteService _db = SQLiteService();
  final String _backendBaseUrl;

  OfflineSyncManager({String backendBaseUrl = 'http://10.0.2.2:3001'})
      : _backendBaseUrl = backendBaseUrl;

  /// Verifica si el dispositivo cuenta con conexión a Internet
  Future<bool> isOnline() async {
    final connectivityResult = await Connectivity().checkConnectivity();
    return !connectivityResult.contains(ConnectivityResult.none);
  }

  /// Ejecuta una mutación con soporte Offline-First
  /// Si está online -> envía al backend y guarda copia local.
  /// Si está offline -> guarda en SQLite 'offline_sync_queue' para sincronización posterior.
  Future<Map<String, dynamic>> executeMutation({
    required String mutationId,
    required String mutationType,
    required String endpoint,
    required Map<String, dynamic> payload,
  }) async {
    final online = await isOnline();

    if (online) {
      try {
        final url = Uri.parse('$_backendBaseUrl$endpoint');
        final response = await http.post(
          url,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(payload),
        );

        if (response.statusCode >= 200 && response.statusCode < 300) {
          return {
            'success': true,
            'synced': true,
            'data': jsonDecode(response.body),
          };
        }
      } catch (e) {
        // En caso de caída de conexión a mitad de solicitud, caer a cola offline
      }
    }

    // Persistir en cola offline local
    await _db.enqueueMutation(
      id: mutationId,
      mutationType: mutationType,
      endpoint: endpoint,
      payload: jsonEncode(payload),
    );

    return {
      'success': true,
      'synced': false,
      'message': 'Operación encolada localmente en SQLite. Se sincronizará al recuperar conexión.',
    };
  }

  /// Sincroniza todas las mutaciones pendientes (CU-22)
  Future<int> syncPendingQueue() async {
    final online = await isOnline();
    if (!online) return 0;

    final pending = await _db.getPendingMutations();
    int syncedCount = 0;

    for (final mutation in pending) {
      final id = mutation['id'] as String;
      final endpoint = mutation['endpoint'] as String;
      final payloadStr = mutation['payload'] as String;

      try {
        final url = Uri.parse('$_backendBaseUrl$endpoint');
        final response = await http.post(
          url,
          headers: {'Content-Type': 'application/json'},
          body: payloadStr,
        );

        if (response.statusCode >= 200 && response.statusCode < 300) {
          await _db.markMutationCompleted(id);
          syncedCount++;
        }
      } catch (e) {
        // Continúa con la siguiente si una falla
      }
    }

    return syncedCount;
  }
}
