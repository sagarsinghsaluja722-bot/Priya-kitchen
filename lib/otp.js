// One-time password login. Codes are generated here, stored hashed, and sent by SMS through 2Factor.in.
const crypto = require('crypto');
const { db } = require('./db');

const OTP_TTL_MS = 5 * 60 * 1000;      // code valid for 5 minutes
const RESEND_GAP_MS = 30 * 1000;       // wait 30 s before asking for another code
const MAX_SENDS_PER_DAY = 6;           // per phone number
const MAX_ATTEMPTS = 5;                // wrong guesses before the code is burned

const DEMO = process.env.DEMO_MODE === 'true';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function hash(phone, code) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(phone + ':' + code).digest('hex');
}

function smsConfigured() {
  return !!process.env.TWOFACTOR_API_KEY;
}

async function sendSms(phone, code) {
  const key = encodeURIComponent(process.env.TWOFACTOR_API_KEY);
  const tpl = process.env.TWOFACTOR_TEMPLATE ? '/' + encodeURIComponent(process.env.TWOFACTOR_TEMPLATE) : '';
  const url = `https://2factor.in/API/V1/${key}/SMS/91${phone}/${code}${tpl}`;
  const r = await fetch(url);
  let body = {};
  try { body = await r.json(); } catch (_) { /* ignore */ }
  if (!r.ok || body.Status !== 'Success') {
    console.error('[otp] 2Factor error:', r.status, body);
    throw httpError(502, 'Could not send OTP right now. Please try again in a minute.');
  }
}

async function send(phone) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (row && now - row.last_sent_at < RESEND_GAP_MS) {
    const wait = Math.ceil((RESEND_GAP_MS - (now - row.last_sent_at)) / 1000);
    throw httpError(429, `Please wait ${wait} seconds before requesting a new OTP.`);
  }
  const sendsToday = row && row.day === today ? row.sends_today : 0;
  if (sendsToday >= MAX_SENDS_PER_DAY) throw httpError(429, 'Too many OTP requests for this number today. Please try tomorrow.');

  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  let channel;
  if (smsConfigured()) {
    await sendSms(phone, code);
    channel = 'sms';
  } else if (DEMO) {
    console.log(`[otp][DEMO] OTP for ${phone}: ${code}`);
    channel = 'demo';
  } else {
    throw httpError(500, 'OTP service is not set up yet.');
  }

  db.prepare(`INSERT INTO otps (phone, code_hash, expires_at, attempts, last_sent_at, sends_today, day)
              VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
              ON CONFLICT(phone) DO UPDATE SET code_hash=?2, expires_at=?3, attempts=0, last_sent_at=?4, sends_today=?5, day=?6`)
    .run(phone, hash(phone, code), now + OTP_TTL_MS, now, sendsToday + 1, today);

  return { channel, code: channel === 'demo' ? code : undefined };
}

function verify(phone, code) {
  const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (!row || !row.code_hash) throw httpError(400, 'Please request an OTP first.');
  if (Date.now() > row.expires_at) throw httpError(400, 'This OTP has expired. Please request a new one.');
  if (row.attempts >= MAX_ATTEMPTS) throw httpError(429, 'Too many wrong attempts. Please request a new OTP.');
  const a = Buffer.from(hash(phone, code));
  const b = Buffer.from(row.code_hash);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    throw httpError(400, 'Wrong OTP. Please check and try again.');
  }
  db.prepare("UPDATE otps SET code_hash = '', expires_at = 0 WHERE phone = ?").run(phone);
  return true;
}

module.exports = { send, verify, smsConfigured };
