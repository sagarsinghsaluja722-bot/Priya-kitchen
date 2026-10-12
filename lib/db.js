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

module.exports = { db, transaction, getSettings, setSetting };
