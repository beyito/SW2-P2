import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Base local de cada usuario: en un equipo compartido nadie ve ni envía lo de otro (RF-10).
class LocalDatabase {
  static const _version = 1;

  static Future<void> createSchema(Database db, int version) async {
    await db.execute("""
      CREATE TABLE queue (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        method TEXT NOT NULL,
        body TEXT,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL
      )
    """);
    await db.execute('CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  static Future<Database> open(String userId) async {
    final safeId = userId.replaceAll(RegExp(r'[^\w-]'), '_');
    return openDatabase(
      p.join(await getDatabasesPath(), 'salon_$safeId.db'),
      version: _version,
      onCreate: createSchema,
    );
  }
}
