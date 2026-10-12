// Priya Kitchen — ordering website server (no extra packages needed; Node.js 22.13 or newer)
require('./lib/env').loadEnv();

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const token = require('./lib/token');

const DEMO = process.env.DEMO_MODE === 'true';
const isProd = process.env.NODE_ENV === 'production';

// ---- required settings -------------------------------------------------
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  if (!DEMO) {
    console.error('ERROR: set JWT_SECRET (a long random text, at least 16 characters).');
    process.exit(1);
  }
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
}
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (DEMO ? 'admin123' : '');
if (!ADMIN_PASSWORD) {
  console.error('ERROR: set ADMIN_PASSWORD.');
  process.exit(1);
}

const { db, transaction, getSettings, setSetting } = require('./lib/db');
const otp = require('./lib/otp');
const rzp = require('./lib/razorpay');
const { notifyOwner, providerName } = require('./lib/notify');

// How customers pay: Razorpay (if keys are set), otherwise direct UPI to your UPI ID.
const UPI_ID = (process.env.UPI_ID || '').trim();
const UPI_NAME = (process.env.UPI_NAME || 'Priya Kitchen').trim();
const PAY_MODE = rzp.configured() ? 'razorpay' : UPI_ID ? 'upi' : DEMO ? 'demo' : '';
if (!PAY_MODE) {
  console.error('ERROR: set UPI_ID (your UPI ID, e.g. priyakitchen@okaxis) so customers can pay you.');
  process.exit(1);
}
if (UPI_ID && !/^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(UPI_ID)) {
  console.error('ERROR: UPI_ID does not look like a UPI ID (example: name@okaxis).');
  process.exit(1);
}
// How customers log in: SMS OTP (if 2Factor is set up), otherwise a 4-digit PIN they choose.
const AUTH_MODE = process.env.AUTH_MODE || (otp.smsConfigured() || DEMO ? 'otp' : 'pin');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const FLOW = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
const VISIBLE = ['payment_submitted', ...FLOW, 'cancelled'];

// ---- helpers -----------------------------------------------------------
const iso = () => new Date().toISOString();
const orderCode = (id) => 'PK' + (1000 + Number(id));
const httpError = (status, message) => Object.assign(new Error(message), { status });
const qs = (arr) => arr.map(() => '?').join(',');

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

function normPhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

function int(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function publicUser(u) {
  return u ? { phone: u.phone, name: u.name || '', address: u.address || '', profileComplete: !!(u.name && u.address) } : null;
}

function publicOrder(o) {
  return {
    id: Number(o.id),
    code: orderCode(o.id),
    items: JSON.parse(o.items),
    subtotal: o.subtotal,
    deliveryFee: o.delivery_fee,
    total: o.total,
    name: o.name,
    phone: o.phone,
    address: o.address,
    note: o.note,
    status: o.status,
    utr: o.utr || '',
    history: JSON.parse(o.history || '[]'),
    createdAt: o.created_at,
    paidAt: o.paid_at,
    updatedAt: o.updated_at
  };
}

const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// simple in-memory rate limiter
const hits = new Map();
function allow(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  h.n += 1;
  return h.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60000).unref();

// ---- live updates (Server-Sent Events) ----------------------------------
const userStreams = new Map(); // userId -> Set(res)
const adminStreams = new Set();

function openStream(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => clearInterval(ping));
}

function push(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function emitOrder(row, isNew) {
  const po = publicOrder(row);
  const set = userStreams.get(Number(row.user_id));
  if (set) for (const r of set) push(r, 'order', po);
  for (const r of adminStreams) push(r, isNew ? 'new_order' : 'order', po);
}

// ---- payment → order placed --------------------------------------------
const markPaidTx = transaction((id, paymentId) => {
  const row = getOrder(id);
  if (!row || (row.status !== 'pending_payment' && row.status !== 'failed')) return { row, changed: false };
  const now = iso();
  db.prepare("UPDATE orders SET status = 'placed', paid_at = ?, updated_at = ?, rzp_payment_id = COALESCE(?, rzp_payment_id), history = ? WHERE id = ?")
    .run(now, now, paymentId || null, JSON.stringify([{ status: 'placed', at: now }]), id);
  return { row: getOrder(id), changed: true };
});

function alertOwner(row) {
  notifyOwner(publicOrder(row))
    .then((sent) => { if (sent) db.prepare('UPDATE orders SET notified = 1 WHERE id = ?').run(row.id); })
    .catch((e) => console.error('[whatsapp] alert failed for ' + orderCode(row.id) + ':', e.message));
}

function markPaid(id, paymentId) {
  const { row, changed } = markPaidTx(id, paymentId);
  if (changed) {
    emitOrder(row, true);
    alertOwner(row);
  }
  return row;
}

// Direct UPI: build the payment link the customer's UPI app opens.
function upiInfo(row) {
  const amount = Number(row.total).toFixed(2);
  const note = 'Order ' + orderCode(row.id);
  // UPI apps expect the @ in the UPI ID unencoded (UPI_ID is validated at start-up).
  const link = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
  return { link, upiId: UPI_ID, payee: UPI_NAME, amount: row.total, note };
}

// Customer says they paid by UPI and gives the reference (UTR) number → owner checks and confirms.
const submitUpiTx = transaction((id, utr) => {
  const row = getOrder(id);
  if (!row || row.status !== 'pending_payment') return { row, changed: false };
  const now = iso();
  db.prepare("UPDATE orders SET status = 'payment_submitted', utr = ?, updated_at = ?, history = ? WHERE id = ?")
    .run(utr, now, JSON.stringify([{ status: 'payment_submitted', at: now }]), id);
  return { row: getOrder(id), changed: true };
});

// ---- tiny HTTP framework -----------------------------------------------
const routes = [];
function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, handler });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'Request too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(res._cookies ? { 'Set-Cookie': res._cookies } : {}) });
  res.end(body);
}

function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isProd) parts.push('Secure');
  (res._cookies = res._cookies || []).push(parts.join('; '));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  else if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
  });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---- auth helpers ------------------------------------------------------
function setAuth(res, name, payload, days) {
  setCookie(res, name, token.sign(payload, JWT_SECRET, days), days * 86400);
}

function readToken(req, name, typ) {
  const p = token.verify(req.cookies[name], JWT_SECRET);
  return p && p.typ === typ ? p : null;
}

function currentUser(req) {
  const p = readToken(req, 'pk_user', 'user');
  return p ? getUser(p.uid) || null : null;
}

function needUser(req) {
  const u = currentUser(req);
  if (!u) throw httpError(401, 'Please log in first.');
  return u;
}

function needAdmin(req) {
  if (!readToken(req, 'pk_admin', 'admin')) throw httpError(401, 'Admin login required.');
}

// ---- Razorpay webhook --------------------------------------------------
route('POST', '/api/razorpay/webhook', { raw: true }, (req, res) => {
  if (!rzp.verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'])) throw httpError(400, 'invalid signature');
  let evt;
  try { evt = JSON.parse(req.rawBody.toString('utf8')); } catch (_) { throw httpError(400, 'invalid json'); }
  const p = evt.payload || {};
  const rzpOrderId = (p.order && p.order.entity && p.order.entity.id) || (p.payment && p.payment.entity && p.payment.entity.order_id);
  const paymentId = p.payment && p.payment.entity ? p.payment.entity.id : null;
  if ((evt.event === 'order.paid' || evt.event === 'payment.captured') && rzpOrderId) {
    const row = db.prepare('SELECT id FROM orders WHERE rzp_order_id = ?').get(rzpOrderId);
    if (row) markPaid(Number(row.id), paymentId);
  }
  sendJson(res, 200, { ok: true });
});

// ---- public API --------------------------------------------------------
route('GET', '/healthz', (req, res) => sendJson(res, 200, { ok: true }));

route('GET', '/api/config', (req, res) => {
  const s = getSettings();
  sendJson(res, 200, {
    demo: DEMO,
    demoPayment: PAY_MODE === 'demo',
    payMode: PAY_MODE,
    authMode: AUTH_MODE,
    upiId: UPI_ID,
    acceptingOrders: s.accepting_orders === '1',
    deliveryFee: int(s.delivery_fee),
    freeDeliveryAbove: int(s.free_delivery_above),
    minOrder: int(s.min_order),
    ownerWhatsapp: (process.env.OWNER_WHATSAPP || '').replace(/\D/g, '')
  });
});

route('GET', '/api/menu', (req, res) => {
  sendJson(res, 200, { items: db.prepare('SELECT id, name, description, price, category FROM menu_items WHERE available = 1 ORDER BY sort, id').all() });
});

route('POST', '/api/auth/send-otp', async (req, res) => {
  const phone = normPhone(req.body.phone);
  if (!phone) throw httpError(400, 'Please enter a valid 10-digit mobile number.');
  if (!allow('otp-ip:' + req.ip, 15, 3600e3)) throw httpError(429, 'Too many requests. Please try again later.');
  const r = await otp.send(phone);
  sendJson(res, 200, { ok: true, phone, demoOtp: r.code });
});

route('POST', '/api/auth/verify-otp', (req, res) => {
  const phone = normPhone(req.body.phone);
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!phone || code.length !== 4) throw httpError(400, 'Please enter the 4-digit OTP.');
  if (!allow('verify-ip:' + req.ip, 40, 3600e3)) throw httpError(429, 'Too many attempts. Please try again later.');
  otp.verify(phone, code);
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const info = db.prepare('INSERT INTO users (phone, created_at) VALUES (?, ?)').run(phone, iso());
    user = getUser(Number(info.lastInsertRowid));
  }
  setAuth(res, 'pk_user', { typ: 'user', uid: Number(user.id) }, 60);
  sendJson(res, 200, { user: publicUser(user) });
});

// PIN login (used when SMS OTP is not set up): first time you choose a 4-digit PIN, after that you enter it.
function hashPin(pin, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pin + ':' + JWT_SECRET, salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(hashPin(pin, salt).split(':')[1], 'hex');
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

route('POST', '/api/auth/pin-check', (req, res) => {
  if (AUTH_MODE !== 'pin') throw httpError(404, 'Not found.');
  const phone = normPhone(req.body.phone);
  if (!phone) throw httpError(400, 'Please enter a valid 10-digit mobile number.');
  if (!allow('pincheck-ip:' + req.ip, 60, 3600e3)) throw httpError(429, 'Too many requests. Please try again later.');
  const user = db.prepare('SELECT pin_hash FROM users WHERE phone = ?').get(phone);
  sendJson(res, 200, { phone, hasPin: !!(user && user.pin_hash) });
});

route('POST', '/api/auth/pin-login', (req, res) => {
  if (AUTH_MODE !== 'pin') throw httpError(404, 'Not found.');
  const phone = normPhone(req.body.phone);
  const pin = String(req.body.pin || '');
  if (!phone) throw httpError(400, 'Please enter a valid 10-digit mobile number.');
  if (!/^\d{4}$/.test(pin)) throw httpError(400, 'Your PIN must be 4 digits.');
  if (!allow('pin-ip:' + req.ip, 30, 3600e3) || !allow('pin-phone:' + phone, 8, 15 * 60e3)) {
    throw httpError(429, 'Too many attempts. Please wait 15 minutes, or message us on WhatsApp to reset your PIN.');
  }
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (user && user.pin_hash) {
    if (!checkPin(pin, user.pin_hash)) throw httpError(401, 'Wrong PIN. Forgot it? Message us on WhatsApp and we will reset it.');
  } else if (user) {
    db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(pin), user.id);
  } else {
    const info = db.prepare('INSERT INTO users (phone, pin_hash, created_at) VALUES (?, ?, ?)').run(phone, hashPin(pin), iso());
    user = getUser(Number(info.lastInsertRowid));
  }
  setAuth(res, 'pk_user', { typ: 'user', uid: Number(user.id) }, 60);
  sendJson(res, 200, { user: publicUser(getUser(user.id)) });
});

route('POST', '/api/auth/logout', (req, res) => {
  setCookie(res, 'pk_user', '', 0);
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/me', (req, res) => sendJson(res, 200, { user: publicUser(currentUser(req)) }));

route('PUT', '/api/me', (req, res) => {
  const u = needUser(req);
  const name = clean(req.body.name, 60);
  const address = clean(req.body.address, 300);
  if (name.length < 2) throw httpError(400, 'Please enter your name.');
  if (address.length < 10) throw httpError(400, 'Please enter your full delivery address.');
  db.prepare('UPDATE users SET name = ?, address = ? WHERE id = ?').run(name, address, u.id);
  sendJson(res, 200, { user: publicUser(getUser(u.id)) });
});

route('POST', '/api/checkout', async (req, res) => {
  const u = needUser(req);
  const s = getSettings();
  if (s.accepting_orders !== '1') throw httpError(409, "Sorry, we're not taking orders right now. Please check back soon.");
  if (!u.name) throw httpError(400, 'Please add your name first.');
  const address = clean(req.body.address || u.address, 300);
  if (address.length < 10) throw httpError(400, 'Please enter your full delivery address.');
  const note = clean(req.body.note, 200);

  const wanted = new Map();
  for (const it of (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 40)) {
    const id = int(it && it.id);
    const qty = int(it && it.qty);
    if (id > 0 && qty > 0) wanted.set(id, Math.min(50, (wanted.get(id) || 0) + qty));
  }
  const lines = [];
  for (const [id, qty] of wanted) {
    const m = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1').get(id);
    if (!m) throw httpError(400, 'An item in your cart is no longer available. Please refresh the page.');
    lines.push({ id: Number(m.id), name: m.name, price: m.price, qty, amount: m.price * qty });
  }
  if (!lines.length) throw httpError(400, 'Your cart is empty.');

  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const minOrder = int(s.min_order);
  if (subtotal < minOrder) throw httpError(400, `Minimum order is ₹${minOrder}.`);
  let fee = int(s.delivery_fee);
  const freeAbove = int(s.free_delivery_above);
  if (freeAbove > 0 && subtotal >= freeAbove) fee = 0;
  const total = subtotal + fee;

  if (address !== u.address) db.prepare('UPDATE users SET address = ? WHERE id = ?').run(address, u.id);

  const now = iso();
  const info = db.prepare(`INSERT INTO orders (user_id, items, subtotal, delivery_fee, total, name, phone, address, note, status, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`)
    .run(u.id, JSON.stringify(lines), subtotal, fee, total, u.name, u.phone, address, note, now, now);
  const id = Number(info.lastInsertRowid);
  const code = orderCode(id);

  if (PAY_MODE === 'demo') return sendJson(res, 200, { orderId: id, code, total, demoPayment: true });
  if (PAY_MODE === 'upi') return sendJson(res, 200, { orderId: id, code, total, upi: upiInfo(getOrder(id)) });

  try {
    const r = await rzp.createOrder(total * 100, code);
    db.prepare('UPDATE orders SET rzp_order_id = ? WHERE id = ?').run(r.id, id);
    sendJson(res, 200, {
      orderId: id, code, total,
      razorpay: { keyId: rzp.keyId(), orderId: r.id, amount: r.amount, currency: r.currency },
      prefill: { name: u.name, contact: '+91' + u.phone }
    });
  } catch (e) {
    console.error('[razorpay]', e.message);
    db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(id);
    throw httpError(502, 'Could not start the payment. Please try again.');
  }
});

route('POST', '/api/checkout/verify', (req, res) => {
  const u = needUser(req);
  const b = req.body;
  const row = db.prepare('SELECT * FROM orders WHERE rzp_order_id = ? AND user_id = ?').get(String(b.razorpay_order_id || ''), u.id);
  if (!row) throw httpError(404, 'Order not found.');
  if (!rzp.verifyPayment(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
    throw httpError(400, 'We could not verify your payment. If money was deducted, please contact us on WhatsApp.');
  }
  sendJson(res, 200, { order: publicOrder(markPaid(Number(row.id), String(b.razorpay_payment_id))) });
});

// Testing only: pretend the payment went through (works only with DEMO_MODE=true and no Razorpay keys).
route('POST', '/api/checkout/demo-pay', (req, res) => {
  const u = needUser(req);
  if (!(DEMO && !rzp.configured())) throw httpError(404, 'Not found.');
  const row = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'pending_payment'").get(int(req.body.orderId), u.id);
  if (!row) throw httpError(404, 'Order not found.');
  sendJson(res, 200, { order: publicOrder(markPaid(Number(row.id), 'demo')) });
});

// Direct UPI: details to pay one of your own unpaid orders
route('GET', '/api/orders/:id/upi', (req, res) => {
  const u = needUser(req);
  if (PAY_MODE !== 'upi') throw httpError(404, 'Not found.');
  const row = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(int(req.params.id), u.id);
  if (!row) throw httpError(404, 'Order not found.');
  sendJson(res, 200, { order: publicOrder(row), upi: upiInfo(row) });
});

// Direct UPI: customer submits the UPI reference number after paying
route('POST', '/api/orders/:id/upi-paid', (req, res) => {
  const u = needUser(req);
  if (PAY_MODE !== 'upi') throw httpError(404, 'Not found.');
  const utr = String(req.body.utr || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9]{10,22}$/.test(utr)) throw httpError(400, 'Please enter the 12-digit UPI reference number (UTR) from your payment app.');
  const row = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(int(req.params.id), u.id);
  if (!row) throw httpError(404, 'Order not found.');
  if (row.status !== 'pending_payment') return sendJson(res, 200, { order: publicOrder(row) });
  const used = db.prepare("SELECT id FROM orders WHERE utr = ? AND id != ? AND status != 'cancelled'").get(utr, row.id);
  if (used) throw httpError(400, 'This UPI reference number was already used for another order. Please check it.');
  const r = submitUpiTx(row.id, utr);
  if (r.changed) {
    emitOrder(r.row, true);
    alertOwner(r.row);
  }
  sendJson(res, 200, { order: publicOrder(r.row) });
});

route('GET', '/api/orders', (req, res) => {
  const u = needUser(req);
  const recent = new Date(Date.now() - 3 * 3600e3).toISOString();
  const rows = db.prepare(`SELECT * FROM orders WHERE user_id = ? AND (status IN (${qs(VISIBLE)}) OR (status = 'pending_payment' AND ? = 'upi' AND created_at > ?)) ORDER BY id DESC LIMIT 50`)
    .all(u.id, ...VISIBLE, PAY_MODE, recent);
  sendJson(res, 200, { orders: rows.map(publicOrder) });
});

route('GET', '/api/orders/stream', (req, res) => {
  const u = needUser(req);
  const uid = Number(u.id);
  openStream(req, res);
  if (!userStreams.has(uid)) userStreams.set(uid, new Set());
  userStreams.get(uid).add(res);
  req.on('close', () => {
    const set = userStreams.get(uid);
    if (set) { set.delete(res); if (!set.size) userStreams.delete(uid); }
  });
});

// ---- admin API ---------------------------------------------------------
route('POST', '/api/admin/login', (req, res) => {
  if (!allow('admin-ip:' + req.ip, 10, 15 * 60e3)) throw httpError(429, 'Too many attempts. Try again in 15 minutes.');
  const a = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) throw httpError(401, 'Wrong password.');
  setAuth(res, 'pk_admin', { typ: 'admin' }, 30);
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/admin/logout', (req, res) => {
  setCookie(res, 'pk_admin', '', 0);
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/admin/me', (req, res) => {
  needAdmin(req);
  sendJson(res, 200, { ok: true, whatsapp: providerName(), demo: DEMO, payMode: PAY_MODE, authMode: AUTH_MODE, upiId: UPI_ID });
});

route('GET', '/api/admin/orders', (req, res) => {
  needAdmin(req);
  const statuses = req.query.get('scope') === 'all' ? VISIBLE : ['payment_submitted', ...FLOW.slice(0, 4)];
  const rows = db.prepare(`SELECT * FROM orders WHERE status IN (${qs(statuses)}) ORDER BY id DESC LIMIT 300`).all(...statuses);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // date in India
  const todayRows = db.prepare("SELECT total FROM orders WHERE paid_at IS NOT NULL AND status != 'cancelled' AND substr(datetime(paid_at, '+330 minutes'), 1, 10) = ?").all(today);
  sendJson(res, 200, {
    orders: rows.map(publicOrder),
    today: { count: todayRows.length, revenue: todayRows.reduce((a, r) => a + r.total, 0) }
  });
});

route('POST', '/api/admin/orders/:id/status', (req, res) => {
  needAdmin(req);
  const status = String(req.body.status || '');
  if (![...FLOW, 'cancelled'].includes(status)) throw httpError(400, 'Unknown status.');
  const row = getOrder(int(req.params.id));
  if (!row || !VISIBLE.includes(row.status)) throw httpError(404, 'Order not found.');
  if (row.status === status) return sendJson(res, 200, { order: publicOrder(row) });
  const history = JSON.parse(row.history || '[]');
  const now = iso();
  history.push({ status, at: now });
  // Confirming a UPI payment marks the order as paid.
  const paidAt = row.status === 'payment_submitted' && status !== 'cancelled' ? now : row.paid_at;
  db.prepare('UPDATE orders SET status = ?, history = ?, updated_at = ?, paid_at = ? WHERE id = ?').run(status, JSON.stringify(history), now, paidAt, row.id);
  const updated = getOrder(row.id);
  emitOrder(updated, false);
  sendJson(res, 200, { order: publicOrder(updated) });
});

route('GET', '/api/admin/stream', (req, res) => {
  needAdmin(req);
  openStream(req, res);
  adminStreams.add(res);
  req.on('close', () => adminStreams.delete(res));
});

function readMenuBody(b) {
  const name = clean(b.name, 80);
  const description = clean(b.description, 300);
  const category = clean(b.category, 40) || 'Tiffins';
  const price = int(b.price, -1);
  if (name.length < 2) throw httpError(400, 'Please enter the item name.');
  if (!(price >= 1 && price <= 100000)) throw httpError(400, 'Please enter a price in rupees.');
  return [name, description, price, category, b.available === false ? 0 : 1, int(b.sort, 0)];
}

route('GET', '/api/admin/menu', (req, res) => {
  needAdmin(req);
  sendJson(res, 200, { items: db.prepare('SELECT * FROM menu_items ORDER BY sort, id').all().map((m) => ({ ...m, available: !!m.available })) });
});

route('POST', '/api/admin/menu', (req, res) => {
  needAdmin(req);
  const info = db.prepare('INSERT INTO menu_items (name, description, price, category, available, sort) VALUES (?, ?, ?, ?, ?, ?)').run(...readMenuBody(req.body));
  sendJson(res, 200, { id: Number(info.lastInsertRowid) });
});

route('PUT', '/api/admin/menu/:id', (req, res) => {
  needAdmin(req);
  const info = db.prepare('UPDATE menu_items SET name = ?, description = ?, price = ?, category = ?, available = ?, sort = ? WHERE id = ?').run(...readMenuBody(req.body), int(req.params.id));
  if (!info.changes) throw httpError(404, 'Item not found.');
  sendJson(res, 200, { ok: true });
});

route('DELETE', '/api/admin/menu/:id', (req, res) => {
  needAdmin(req);
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(int(req.params.id));
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/admin/reset-pin', (req, res) => {
  needAdmin(req);
  const phone = normPhone(req.body.phone);
  if (!phone) throw httpError(400, 'Enter the customer’s 10-digit mobile number.');
  const info = db.prepare('UPDATE users SET pin_hash = NULL WHERE phone = ?').run(phone);
  if (!info.changes) throw httpError(404, 'No customer with that number.');
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/admin/settings', (req, res) => {
  needAdmin(req);
  const s = getSettings();
  sendJson(res, 200, { acceptingOrders: s.accepting_orders === '1', deliveryFee: int(s.delivery_fee), freeDeliveryAbove: int(s.free_delivery_above), minOrder: int(s.min_order) });
});

route('PUT', '/api/admin/settings', (req, res) => {
  needAdmin(req);
  const b = req.body;
  const updates = [];
  if (b.acceptingOrders !== undefined) updates.push(['accepting_orders', b.acceptingOrders ? '1' : '0']);
  for (const [k, key] of [['deliveryFee', 'delivery_fee'], ['freeDeliveryAbove', 'free_delivery_above'], ['minOrder', 'min_order']]) {
    if (b[k] !== undefined) {
      const v = int(b[k], -1);
      if (v < 0 || v > 100000) throw httpError(400, 'Please enter amounts in whole rupees.');
      updates.push([key, v]);
    }
  }
  updates.forEach(([k, v]) => setSetting(k, v));
  sendJson(res, 200, { ok: true });
});

// ---- server ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
    if (!r) {
      if (pathname.startsWith('/api/')) throw httpError(404, 'Not found.');
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, pathname)) return;
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const m = pathname.match(r.re);
    req.params = {};
    r.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
    req.query = url.searchParams;
    req.cookies = parseCookies(req);
    req.ip = clientIp(req);
    req.body = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (r.opts.raw) {
        req.rawBody = await readBody(req, 1024 * 1024);
      } else {
        // Every state-changing call must be JSON — blocks cross-site form posts.
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw httpError(415, 'Unsupported request.');
        const buf = await readBody(req, 50 * 1024);
        try { req.body = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch (_) { throw httpError(400, 'Invalid request.'); }
        if (!req.body || typeof req.body !== 'object') req.body = {};
      }
    }
    await r.handler(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong. Please try again.' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Priya Kitchen running on http://localhost:${PORT}`);
  if (DEMO) console.log('*** DEMO MODE: OTP shown on screen; payment simulated if Razorpay keys are missing. Never use on the live site. Admin password: ' + (process.env.ADMIN_PASSWORD ? '(from .env)' : 'admin123'));
  console.log('Payments: ' + PAY_MODE + (UPI_ID ? ' → ' + UPI_ID : '') + ' · Login: ' + AUTH_MODE);
  console.log('WhatsApp alerts via: ' + providerName() + ' → +' + (process.env.OWNER_WHATSAPP || '(OWNER_WHATSAPP not set)'));
});
