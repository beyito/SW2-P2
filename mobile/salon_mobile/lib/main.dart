import 'dart:async';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'core/api/api_client.dart';
import 'core/auth/auth_service.dart';
import 'core/auth/session.dart';
import 'core/connectivity_status.dart';
import 'core/database/local_database.dart';
import 'core/sync/offline_queue.dart';
import 'core/tab_refresh.dart';
import 'features/account/account_screen.dart';
import 'features/appointments/appointments_screen.dart';
import 'features/biometrics/biometrics_screen.dart';
import 'features/biometrics/on_device_analyzer.dart';
import 'features/booking/booking_flow.dart';
import 'features/booking/payment_gateway.dart';
import 'features/closet/closet_screen.dart';
import 'features/community/community_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SalonMobileApp());
}

class SalonMobileApp extends StatelessWidget {
  const SalonMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Salón & IA',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0A0E17),
        colorScheme: const ColorScheme.dark(primary: Color(0xFFD4AF37), secondary: Color(0xFFF5D061), surface: Color(0xFF141A29)),
      ),
      home: const AuthGate(),
    );
  }
}

/// Decide entre la pantalla de inicio de sesión y la plataforma.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  final _auth = AuthService();
  Session? _session;
  bool _checking = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _auth.restore().then((session) {
      if (mounted) {
        setState(() {
          _session = session;
          _checking = false;
        });
      }
    });
  }

  Future<void> _login() async {
    setState(() => _error = null);
    try {
      final session = await _auth.login();
      setState(() => _session = session);
    } catch (_) {
      setState(() => _error = 'No se pudo iniciar sesión. Iniciar sesión requiere conexión.');
    }
  }

  Future<void> _logout() async {
    await _auth.logout();
    setState(() => _session = null);
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    if (_checking) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (session == null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('Salón & IA', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Color(0xFFF5D061))),
              const SizedBox(height: 24),
              FilledButton(key: const Key('login'), onPressed: _login, child: const Text('Iniciar sesión')),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, textAlign: TextAlign.center)),
            ]),
          ),
        ),
      );
    }
    return HomeScreen(key: ValueKey(session.userId), session: session, tokens: _auth, onLogout: _logout);
  }
}

class HomeScreen extends StatefulWidget {
  final Session session;
  final TokenProvider tokens;
  final Future<void> Function() onLogout;

  const HomeScreen({super.key, required this.session, required this.tokens, required this.onLogout});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const _retry = Duration(seconds: 30);

  final _analyzer = OnDeviceAnalyzer();
  final _payments = StripePaymentGateway();
  final _client = http.Client();
  ApiClient? _api;
  ConnectivityStatus? _connectivity;
  StreamSubscription<void>? _changes;
  Timer? _timer;
  List<QueuedOperation> _queue = [];
  final _selectedTab = ValueNotifier<int>(0);
  int get _tab => _selectedTab.value;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final database = await LocalDatabase.open(widget.session.userId);
    final queue = OfflineQueue(database, widget.tokens, _client, onSessionLost: widget.onLogout);
    final connectivity = ConnectivityStatus(onOnline: queue.sync);
    _changes = queue.changes.listen((_) => _refreshQueue(queue));
    connectivity.addListener(() {
      if (mounted) setState(() {});
    });
    await connectivity.start();
    // Reintenta también si la red seguía activa pero el servidor no respondía
    _timer = Timer.periodic(_retry, (_) {
      if (connectivity.isOnline) unawaited(queue.sync());
    });
    await _refreshQueue(queue);
    if (mounted) {
      setState(() {
        _api = ApiClient(database, widget.tokens, _client, queue);
        _connectivity = connectivity;
      });
    }
  }

  Future<void> _refreshQueue(OfflineQueue queue) async {
    final items = await queue.list();
    if (mounted) setState(() => _queue = items);
  }

  @override
  void dispose() {
    _changes?.cancel();
    _timer?.cancel();
    _connectivity?.dispose();
    _analyzer.dispose();
    _selectedTab.dispose();
    _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = _api, connectivity = _connectivity;
    if (api == null || connectivity == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final pending = _queue.where((item) => item.status == QueuedOperation.pending).length;
    final conflicts = _queue.where((item) => item.status == QueuedOperation.conflict).toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.session.name),
        actions: [IconButton(key: const Key('logout'), tooltip: 'Cerrar sesión', onPressed: widget.onLogout, icon: const Icon(Icons.logout))],
      ),
      body: Column(children: [
        if (!connectivity.isOnline || pending > 0)
          Container(
            key: const Key('offline-banner'),
            width: double.infinity,
            color: const Color(0xFF3B2F0B),
            padding: const EdgeInsets.all(10),
            child: Text(
              '${connectivity.isOnline ? '' : 'Sin conexión. '}${pending > 0 ? (pending == 1 ? '1 operación guardada en este dispositivo.' : '$pending operaciones guardadas en este dispositivo.') : 'Se muestra lo último que viste.'}',
              style: const TextStyle(fontSize: 13),
            ),
          ),
        for (final item in conflicts)
          ListTile(
            dense: true,
            title: Text('No se pudo completar "${item.label}"'),
            subtitle: Text(item.error ?? ''),
            trailing: TextButton(onPressed: () => api.queue.discard(item.id), child: const Text('Descartar')),
          ),
        Expanded(
          child: IndexedStack(index: _tab, children: [
            BiometricsScreen(api: api, analyzer: _analyzer, connectivity: connectivity),
            ClosetScreen(api: api, clientId: widget.session.userId),
            AppointmentsScreen(api: api, flow: BookingFlow(api, _payments), refresh: TabRefresh(_selectedTab, 2)),
            CommunityScreen(api: api, refresh: TabRefresh(_selectedTab, 3)),
            AccountScreen(api: api, refresh: TabRefresh(_selectedTab, 4)),
          ]),
        ),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _selectedTab.value = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.face), label: 'Diagnóstico'),
          NavigationDestination(icon: Icon(Icons.checkroom), label: 'Clóset'),
          NavigationDestination(icon: Icon(Icons.event), label: 'Mis citas'),
          NavigationDestination(icon: Icon(Icons.forum), label: 'Comunidad'),
          NavigationDestination(icon: Icon(Icons.person), label: 'Cuenta'),
        ],
      ),
    );
  }
}
