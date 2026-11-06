import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

/// Servicio de Base de Datos Local SQLite (RF-10, CU-22)
/// Provee persistencia local para funcionamiento offline en Android e iOS.
class SQLiteService {
  static final SQLiteService _instance = SQLiteService._internal();
  factory SQLiteService() => _instance;
  SQLiteService._internal();

  static Database? _database;

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'salon_offline.db');

    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        // 1. Tabla de Citas en Caché Local
        await db.execute('''
          CREATE TABLE cached_appointments (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            service_id TEXT NOT NULL,
            service_name TEXT NOT NULL,
            stylist_name TEXT NOT NULL,
            scheduled_at TEXT NOT NULL,
            status TEXT NOT NULL,
            price REAL NOT NULL
          )
        ''');

        // 2. Tabla de Clóset Virtual Local (CU-15)
        await db.execute('''
          CREATE TABLE cached_closet_items (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            color TEXT NOT NULL,
            season TEXT NOT NULL,
            image_url TEXT
          )
        ''');

        // 3. Cola Transaccional de Sincronización Offline (CU-22, RF-10)
        await db.execute('''
          CREATE TABLE offline_sync_queue (
            id TEXT PRIMARY KEY,
            mutation_type TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL,
            retry_count INTEGER DEFAULT 0
          )
        ''');
      },
    );
  }

  // Operaciones de cola de sincronización (CU-22)
  Future<void> enqueueMutation({
    required String id,
    required String mutationType,
    required String endpoint,
    required String payload,
  }) async {
    final db = await database;
    await db.insert(
      'offline_sync_queue',
      {
        'id': id,
        'mutation_type': mutationType,
        'endpoint': endpoint,
        'payload': payload,
        'created_at': DateTime.now().toIso8601String(),
        'status': 'PENDING',
        'retry_count': 0,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<Map<String, dynamic>>> getPendingMutations() async {
    final db = await database;
    return await db.query(
      'offline_sync_queue',
      where: 'status = ?',
      whereArgs: ['PENDING'],
      orderBy: 'created_at ASC',
    );
  }

  Future<void> markMutationCompleted(String id) async {
    final db = await database;
    await db.delete('offline_sync_queue', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> saveLocalAppointment(Map<String, dynamic> appointment) async {
    final db = await database;
    await db.insert('cached_appointments', appointment, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<Map<String, dynamic>>> getLocalAppointments() async {
    final db = await database;
    return await db.query('cached_appointments');
  }
}
