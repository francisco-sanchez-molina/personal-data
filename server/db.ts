import Database from 'better-sqlite3'

export type DB = Database.Database

export function openDb(dbPath: string): DB {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes_index (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path UNINDEXED,
      title,
      body,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      context TEXT NOT NULL DEFAULT 'journal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(date, filename)
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_date ON attachments(date);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      notes TEXT,
      remind_at INTEGER,
      notified_at INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
    CREATE INDEX IF NOT EXISTS idx_events_remind ON events(remind_at) WHERE remind_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📁',
      folder TEXT NOT NULL UNIQUE,
      template TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS note_tags (
      path TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (path, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);

    CREATE TABLE IF NOT EXISTS event_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      offset_min INTEGER NOT NULL,
      remind_at INTEGER NOT NULL,
      notified_at INTEGER,
      UNIQUE(event_id, offset_min)
    );
    CREATE INDEX IF NOT EXISTS idx_event_reminders_due ON event_reminders(remind_at) WHERE notified_at IS NULL;
  `)

  // v2: se añadió note_tags → forzar reindexado completo para poblar los tags de notas ya indexadas
  const version = db.pragma('user_version', { simple: true }) as number
  if (version < 2) {
    db.exec('DELETE FROM notes_index')
  }
  // v3: de un aviso por evento (events.remind_at) a varios (event_reminders)
  if (version < 3) {
    const legacy = db
      .prepare('SELECT id, date, time, remind_at, notified_at FROM events WHERE remind_at IS NOT NULL')
      .all() as { id: number; date: string; time: string | null; remind_at: number; notified_at: number | null }[]
    const ins = db.prepare(
      'INSERT OR IGNORE INTO event_reminders (event_id, offset_min, remind_at, notified_at) VALUES (?, ?, ?, ?)'
    )
    for (const e of legacy) {
      const base = new Date(`${e.date}T${e.time ?? '09:00'}:00`).getTime()
      const offset = Math.max(0, Math.round((base - e.remind_at) / 60_000))
      ins.run(e.id, offset, e.remind_at, e.notified_at)
    }
    db.pragma('user_version = 3')
  }
  // v4: adjuntos con contexto — 'journal' (fotos del día) o 'note' (imágenes pegadas en notas)
  if (version < 4) {
    const cols = (db.prepare('PRAGMA table_info(attachments)').all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes('context')) {
      db.exec("ALTER TABLE attachments ADD COLUMN context TEXT NOT NULL DEFAULT 'journal'")
    }
    db.pragma('user_version = 4')
  }

  return db
}
