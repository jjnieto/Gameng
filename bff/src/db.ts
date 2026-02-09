import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

let db: Database.Database | undefined;

/**
 * Initialize SQLite database and run pending migrations.
 * @param dbPath - Path to the .sqlite file (":memory:" for tests).
 * @param migrationsDir - Directory containing numbered .sql migration files.
 */
export function initDb(
  dbPath: string,
  migrationsDir?: string,
): Database.Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  // Ensure migrations table exists
  instance.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Run pending migrations
  if (migrationsDir) {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      const already = instance
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(id) as unknown;
      if (already) continue;

      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      instance.exec(sql);
      instance
        .prepare("INSERT INTO migrations (id) VALUES (?)")
        .run(id);
    }
  }

  db = instance;
  return instance;
}

/**
 * Get the current DB instance. Throws if not initialized.
 */
export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

/**
 * Close the DB connection.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
