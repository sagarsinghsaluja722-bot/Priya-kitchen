// Razorpay: create a payment order, verify the payment signature, verify webhooks.
const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

function configured() {
  return !!(KEY_ID && KEY_SECRET);
}

function keyId() {
  return KEY_ID;
}

async function createOrder(amountPaise, receipt) {
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
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

module.exports = { configured, keyId, createOrder, verifyPayment, verifyWebhook };
