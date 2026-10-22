// SQLite database (built into Node.js 22+): customers, OTPs, menu, orders and shop settings.
const fs = require('fs');
const path = require('path');

// hide Node's "SQLite is experimental" notice
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w && w.message ? w.message : w).includes('SQLite')) return;
  return origEmit.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'priya-kitchen.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  address TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL,
  sends_today INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'Tiffins',
  available INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  items TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  history TEXT NOT NULL DEFAULT '[]',
  rzp_order_id TEXT,
  rzp_payment_id TEXT,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_rzp ON orders(rzp_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Columns added after the first version
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('users', 'pin_hash', 'TEXT');
addColumn('orders', 'utr', 'TEXT');
addColumn('orders', 'pay_method', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'customer_notified', 'INTEGER NOT NULL DEFAULT 0');

// Run several statements as one all-or-nothing step.
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn(...args);
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}

const DEFAULT_SETTINGS = {
  accepting_orders: '1',
  cod_enabled: '1',
  test_payments: '0',
  delivery_minutes: '30',
  delivery_fee: '0',
  free_delivery_above: '0',
  min_order: '0'
};

// First run: load the starting menu and settings from menu.json
function seed() {
  let seedData = { settings: {}, items: [] };
  try {
    seedData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'menu.json'), 'utf8'));
  } catch (e) {
    console.warn('[db] could not read menu.json:', e.message);
  }
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const fromFile = seedData.settings && seedData.settings[k];
    insSetting.run(k, String(fromFile !== undefined ? fromFile : v));
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  if (count === 0 && Array.isArray(seedData.items)) {
    const ins = db.prepare('INSERT INTO menu_items (name, description, price, category, available, sort) VALUES (?, ?, ?, ?, 1, ?)');
    seedData.items.forEach((it, i) => ins.run(String(it.name), String(it.description || ''), Math.round(Number(it.price) || 0), String(it.category || 'Tiffins'), i));
  }
}
seed();

function getSettings() {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// ---- Backups ----------------------------------------------------------
// The whole shop (customers, menu, orders, settings) lives in one file: DATA_DIR/priya-kitchen.db.
// A copy is saved once a day into DATA_DIR/backups (the last 14 are kept), and the owner can
// download a copy at any time from Admin → Data.
const dbFile = path.join(dataDir, 'priya-kitchen.db');
const backupDir = path.join(dataDir, 'backups');
const KEEP_BACKUPS = 14;

function istStamp(d) {
  const t = new Date(d.getTime() + 5.5 * 3600e3).toISOString(); // India time
  return t.slice(0, 10) + '_' + t.slice(11, 16).replace(':', '');
}

function listBackups() {
  try {
    return fs.readdirSync(backupDir)
      .filter((f) => /^priya-kitchen-[\d_-]+\.db$/.test(f))
      .map((f) => { const st = fs.statSync(path.join(backupDir, f)); return { name: f, size: st.size, at: st.mtime.toISOString() }; })
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  } catch (_) { return []; }
}

function makeBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const name = 'priya-kitchen-' + istStamp(new Date()) + '.db';
  const file = path.join(backupDir, name);
  try { fs.unlinkSync(file); } catch (_) { /* not there */ }
  // VACUUM INTO writes a complete, consistent copy even while the shop is taking orders.
  db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
  for (const old of listBackups().slice(KEEP_BACKUPS)) {
    try { fs.unlinkSync(path.join(backupDir, old.name)); } catch (_) { /* ignore */ }
  }
  return { name, file };
}

// Daily backup: check every hour; make one if there is none for today (India date).
function dailyBackup() {
  const today = istStamp(new Date()).slice(0, 10);
  if (!listBackups().some((b) => b.name.includes(today))) {
    try { const b = makeBackup(); console.log('[backup] saved ' + b.name); } catch (e) { console.error('[backup] failed:', e.message); }
  }
}
setTimeout(dailyBackup, 10 * 1000).unref();
setInterval(dailyBackup, 3600 * 1000).unref();

function dataStats() {
  const n = (sql) => db.prepare(sql).get().n;
  let size = 0;
  for (const f of [dbFile, dbFile + '-wal']) { try { size += fs.statSync(f).size; } catch (_) { /* none */ } }
  return {
    location: dataDir,
    customers: n('SELECT COUNT(*) AS n FROM users'),
    orders: n("SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('pending_payment', 'failed')"),
    menuItems: n('SELECT COUNT(*) AS n FROM menu_items'),
    dbBytes: size,
    backups: listBackups()
  };
}

module.exports = { db, transaction, getSettings, setSetting, makeBackup, listBackups, dataStats, backupDir };
