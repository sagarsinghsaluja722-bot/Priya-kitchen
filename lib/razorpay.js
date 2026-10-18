// Razorpay: create a payment order, verify the payment signature, verify webhooks.
const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
// Razorpay API address (only changed for local testing)
const API = process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1';

function configured() {
  return !!(KEY_ID && KEY_SECRET);
}

function keyId() {
  return KEY_ID;
}

async function createOrder(amountPaise, receipt) {
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const r = await fetch(API + '/orders', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.id) {
    throw new Error('Razorpay order failed: ' + r.status + ' ' + JSON.stringify(body.error || body));
  }
  return body;
}

async function rzpGet(path) {
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const r = await fetch(API + path, { headers: { Authorization: 'Basic ' + auth } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Razorpay ' + path + ' failed: ' + r.status + ' ' + JSON.stringify(body.error || body));
  return body;
}

// Ask Razorpay whether an order has been paid. Returns the captured payment id, or null.
async function paidPaymentId(orderId) {
  const order = await rzpGet('/orders/' + encodeURIComponent(orderId));
  if (order.status !== 'paid') return null;
  const pays = await rzpGet('/orders/' + encodeURIComponent(orderId) + '/payments');
  const p = (pays.items || []).find((x) => x.status === 'captured');
  return p ? p.id : 'paid';
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function verifyPayment(orderId, paymentId, signature) {
  if (!configured()) return false;
  const expected = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

function verifyWebhook(rawBody, signature) {
  if (!WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

module.exports = { configured, keyId, createOrder, verifyPayment, verifyWebhook, paidPaymentId };
