const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const logger = require('./utils/logger');

let db;

function getDB() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function initDB() {
  const dbPath = path.resolve(process.env.DB_PATH || './data/desttek.db');
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath, {
    // WAL mode: better concurrency, safer crashes
    verbose: process.env.NODE_ENV === 'development' ? (sql) => logger.debug(sql) : null
  });

  // Security & performance PRAGMAs
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456'); // 256MB
  db.pragma('cache_size = -16000');   // 16MB cache

  runMigrations();
  seedAdmin();

  logger.info('Database initialized', { path: dbPath });
  return db;
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS records (
      id          TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fields (
      id         TEXT PRIMARY KEY,
      record_id  TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      label      TEXT NOT NULL,
      type       TEXT NOT NULL CHECK(type IN ('textarea','input')),
      value      TEXT NOT NULL DEFAULT '',
      position   INTEGER NOT NULL DEFAULT 0,
      is_fixed   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      last_login    TEXT,
      login_count   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id   TEXT,
      action     TEXT NOT NULL,
      target     TEXT,
      ip         TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_records_category ON records(category_id);
    CREATE INDEX IF NOT EXISTS idx_fields_record    ON fields(record_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_records_name     ON records(name COLLATE NOCASE);
  `);
}

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password === 'CHANGE_THIS_STRONG_PASSWORD') {
    logger.warn('⚠️  ADMIN_PASSWORD is not set or is default — please set it in .env');
  }

  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
  if (existing) return;

  const hash = await bcrypt.hash(password || 'changeme', 12);
  const { v4: uuidv4 } = require('uuid');
  db.prepare(`
    INSERT INTO admin_users (id, username, password_hash)
    VALUES (?, ?, ?)
  `).run(uuidv4(), username, hash);

  logger.info('Admin user seeded', { username });
}

// ── PREPARED STATEMENT QUERIES ──
// Using prepared statements prevents SQL injection entirely

const queries = {
  // Categories
  getAllCategories: () => db.prepare(
    'SELECT id, name, position, created_at, updated_at FROM categories ORDER BY position ASC, created_at ASC'
  ).all(),

  getCategoryById: (id) => db.prepare(
    'SELECT id, name, position FROM categories WHERE id = ?'
  ).get(id),

  insertCategory: (id, name, position) => db.prepare(
    'INSERT INTO categories (id, name, position) VALUES (?, ?, ?)'
  ).run(id, name, position),

  updateCategory: (name, position, id) => db.prepare(
    'UPDATE categories SET name = ?, position = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(name, position, id),

  deleteCategory: (id) => db.prepare(
    'DELETE FROM categories WHERE id = ?'
  ).run(id),

  // Records
  getRecordsByCategory: (categoryId) => db.prepare(
    'SELECT id, name, position, updated_at FROM records WHERE category_id = ? ORDER BY position ASC, created_at ASC'
  ).all(categoryId),

  getRecordById: (id) => db.prepare(
    'SELECT r.id, r.name, r.category_id, r.position, r.updated_at FROM records r WHERE r.id = ?'
  ).get(id),

  searchRecords: (query) => db.prepare(`
    SELECT DISTINCT r.id, r.name, r.category_id, r.updated_at,
           c.name as category_name
    FROM records r
    JOIN categories c ON c.id = r.category_id
    LEFT JOIN fields f ON f.record_id = r.id
    WHERE r.name LIKE ? OR f.value LIKE ?
    ORDER BY r.name ASC
    LIMIT 100
  `).all(`%${query}%`, `%${query}%`),

  insertRecord: (id, categoryId, name, position) => db.prepare(
    'INSERT INTO records (id, category_id, name, position) VALUES (?, ?, ?, ?)'
  ).run(id, categoryId, name, position),

  updateRecord: (name, position, id) => db.prepare(
    'UPDATE records SET name = ?, position = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(name, position, id),

  deleteRecord: (id) => db.prepare(
    'DELETE FROM records WHERE id = ?'
  ).run(id),

  // Fields
  getFieldsByRecord: (recordId) => db.prepare(
    'SELECT id, label, type, value, position, is_fixed FROM fields WHERE record_id = ? ORDER BY position ASC'
  ).all(recordId),

  insertField: (id, recordId, label, type, value, position, isFixed) => db.prepare(
    'INSERT INTO fields (id, record_id, label, type, value, position, is_fixed) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, recordId, label, type, value, position, isFixed),

  updateField: (label, value, position, id) => db.prepare(
    'UPDATE fields SET label = ?, value = ?, position = ? WHERE id = ?'
  ).run(label, value, position, id),

  deleteField: (id) => db.prepare(
    'DELETE FROM fields WHERE id = ?'
  ).run(id),

  // Auth
  getAdminByUsername: (username) => db.prepare(
    'SELECT id, username, password_hash FROM admin_users WHERE username = ?'
  ).get(username),

  updateLastLogin: (id) => db.prepare(
    'UPDATE admin_users SET last_login = datetime(\'now\'), login_count = login_count + 1 WHERE id = ?'
  ).run(id),

  // Audit
  insertAudit: (adminId, action, target, ip, userAgent) => db.prepare(
    'INSERT INTO audit_log (admin_id, action, target, ip, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(adminId, action, target, ip, userAgent),

  getAuditLog: (limit = 100) => db.prepare(
    'SELECT al.*, au.username FROM audit_log al LEFT JOIN admin_users au ON au.id = al.admin_id ORDER BY al.created_at DESC LIMIT ?'
  ).all(limit),
};

// Transaction helper
function transaction(fn) {
  return db.transaction(fn);
}

module.exports = { initDB, getDB, queries, transaction };
