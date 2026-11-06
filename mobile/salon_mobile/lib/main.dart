import 'package:flutter/material.dart';
import 'core/database/sqlite_service.dart';
import 'core/sync/offline_sync_manager.dart';
import 'features/biometrics/offline_tflite_scanner.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SalonMobileApp());
}

class SalonMobileApp extends StatelessWidget {
  const SalonMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Salón & IA Mobile',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0A0E17),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFD4AF37),
          secondary: Color(0xFFF5D061),
          surface: Color(0xFF141A29),
        ),
        fontFamily: 'Roboto',
      ),
      home: const MainMobileScreen(),
    );
  }
}

class MainMobileScreen extends StatefulWidget {
  const MainMobileScreen({super.key});

  @override
  State<MainMobileScreen> createState() => _MainMobileScreenState();
}

class _MainMobileScreenState extends State<MainMobileScreen> {
  final OfflineSyncManager _syncManager = OfflineSyncManager();
  final OfflineTFLiteScanner _tfliteScanner = OfflineTFLiteScanner();
  
  bool _isOnline = true;
  int _pendingCount = 0;
  bool _isScanning = false;
  Map<String, dynamic>? _biometricResult;

  final List<Map<String, dynamic>> _localAppointments = [
    {
      'id': 'apt-local-01',
      'service_name': 'Balayage Deluxe & Matizado',
      'stylist_name': 'Valentina Rossi',
      'scheduled_at': '15 Nov 2026, 10:00 AM',
      'price': 120.0,
      'status': 'CONFIRMED'
    }
  ];

  @override
  void initState() {
    super.initState();
    _checkStatus();
  }

  Future<void> _checkStatus() async {
    final online = await _syncManager.isOnline();
    final db = SQLiteService();
    try {
      final pending = await db.getPendingMutations();
      setState(() {
        _isOnline = online;
        _pendingCount = pending.length;
      });
    } catch (_) {
      // In case native sqlite plugin is stubbed in test environments
      setState(() {
        _isOnline = online;
      });
    }
  }

  Future<void> _triggerOfflineBiometrics() async {
    setState(() => _isScanning = true);
    final result = await _tfliteScanner.scanBiometricsLocal(mediaBytes: [1, 2, 3], isVideo: true);
    setState(() {
      _biometricResult = result;
      _isScanning = false;
    });
  }

  Future<void> _simulateOfflineBooking() async {
    final bookingId = 'apt-off-${DateTime.now().millisecondsSinceEpoch}';
    final payload = {
      'id': bookingId,
      'clientId': 'cli-001',
      'serviceName': 'Tratamiento Keratina Brasileña',
      'stylistName': 'Carlos Mendoza',
      'price': 95.0,
      'timestamp': DateTime.now().toIso8601String()
    };

    final res = await _syncManager.executeMutation(
      mutationId: bookingId,
      mutationType: 'CREATE_APPOINTMENT',
      endpoint: '/appointments',
      payload: payload,
    );

    setState(() {
      _localAppointments.add({
        'id': bookingId,
        'service_name': payload['serviceName'],
        'stylist_name': payload['stylistName'],
        'scheduled_at': '16 Nov 2026, 14:00 PM',
        'price': payload['price'],
        'status': res['synced'] == true ? 'CONFIRMED' : 'PENDING_OFFLINE_SYNC'
      });
      if (res['synced'] != true) {
        _pendingCount++;
      }
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res['synced'] == true
              ? '✅ Cita enviada al servidor!'
              : '💾 Cita guardada en SQLite local (Modo Offline)'),
          backgroundColor: res['synced'] == true ? const Color(0xFF42B883) : const Color(0xFFD4AF37),
        ),
      );
    }
  }

  Future<void> _triggerSync() async {
    final synced = await _syncManager.syncPendingQueue();
    setState(() {
      _pendingCount = 0;
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('🔄 Sincronización finalizada: $synced operaciones procesadas.'),
          backgroundColor: const Color(0xFF42B883),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF141A29),
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(8),
                gradient: const LinearGradient(colors: [Color(0xFFF5D061), Color(0xFFD4AF37)]),
              ),
              child: const Icon(Icons.auto_awesome, color: Color(0xFF0A0E17), size: 18),
            ),
            const SizedBox(width: 10),
            const Text(
              'SALÓN & IA STUDIO',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFFD4AF37)),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            tooltip: 'Sincronizar cola local',
            onPressed: _triggerSync,
          )
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Status Banner (Online/Offline)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: _isOnline ? const Color(0x1A42B883) : const Color(0x1AFF4B4B),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: _isOnline ? const Color(0xFF42B883) : const Color(0xFFFF4B4B),
                  width: 0.8,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    _isOnline ? Icons.wifi : Icons.wifi_off,
                    color: _isOnline ? const Color(0xFF42B883) : const Color(0xFFFF4B4B),
                    size: 18,
                  ),
                  const SizedBox(width: 10),
                  Text(
                    _isOnline ? 'Conectado al Servidor (Online)' : 'Modo Offline Activo (SQLite)',
                    style: TextStyle(
                      color: _isOnline ? const Color(0xFF42B883) : const Color(0xFFFF4B4B),
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                  const Spacer(),
                  if (_pendingCount > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFD4AF37),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '$_pendingCount pendientes',
                        style: const TextStyle(color: Color(0xFF0A0E17), fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Escaneo Biométrico Offline TFLite (CU-13)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF141A29),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0x22D4AF37)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.camera_alt, color: Color(0xFFD4AF37), size: 20),
                      SizedBox(width: 8),
                      Text(
                        'Escáner Biométrico Facial (CU-13)',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Funciona 100% offline con modelo embebido TFLite cuantizado en el móvil.',
                    style: TextStyle(fontSize: 12, color: Colors.white70),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFD4AF37),
                        foregroundColor: const Color(0xFF0A0E17),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                      icon: _isScanning
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0A0E17)),
                            )
                          : const Icon(Icons.videocam, size: 18),
                      label: Text(_isScanning ? 'Procesando tensores TFLite...' : 'Iniciar Escaneo de 3 Segundos'),
                      onPressed: _isScanning ? null : _triggerOfflineBiometrics,
                    ),
                  ),
                  if (_biometricResult != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.black26,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'Rostro: ${_biometricResult!['face_shape']} • Cabello: ${_biometricResult!['hair_type']} • Confianza: ${(_biometricResult!['confidence_face'] * 100).toInt()}% • Subtono: ${_biometricResult!['skin_undertone']}',
                        style: const TextStyle(fontSize: 11, color: Color(0xFF42B883), fontWeight: FontWeight.bold),
                      ),
                    ),
                  ]
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Mis Citas & Agendamiento Local
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Mis Citas Agendadas',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                TextButton.icon(
                  onPressed: _simulateOfflineBooking,
                  icon: const Icon(Icons.add, size: 16, color: Color(0xFFD4AF37)),
                  label: const Text('Agendar Offline', style: TextStyle(color: Color(0xFFD4AF37), fontSize: 12)),
                )
              ],
            ),
            const SizedBox(height: 8),

            ..._localAppointments.map((apt) => Card(
                  color: const Color(0xFF141A29),
                  margin: const EdgeInsets.only(bottom: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: Color(0x22FFFFFF)),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    title: Text(apt['service_name'], style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 4),
                        Text('Estilista: ${apt['stylist_name']} • ${apt['scheduled_at']}', style: const TextStyle(fontSize: 12, color: Colors.white70)),
                        const SizedBox(height: 4),
                        Text('\$${apt['price']} USD', style: const TextStyle(fontSize: 12, color: Color(0xFF42B883), fontWeight: FontWeight.bold)),
                      ],
                    ),
                    trailing: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: apt['status'] == 'CONFIRMED' ? const Color(0x2242B883) : const Color(0x22D4AF37),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        apt['status'] == 'CONFIRMED' ? 'Confirmada' : 'Pendiente Sync',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: apt['status'] == 'CONFIRMED' ? const Color(0xFF42B883) : const Color(0xFFD4AF37),
                        ),
                      ),
                    ),
                  ),
                )),
          ],
        ),
      ),
    );
  }
}
