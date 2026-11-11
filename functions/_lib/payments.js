// ==========================================
// Payment notices (webhooks) from Throne and YouPay.
// Each notice is checked to be genuine BEFORE anything else happens.
// ==========================================

const enc = new TextEncoder();
const MAX_AGE_SECONDS = 15 * 60; // ignore notices older than 15 minutes (replays)

// Load amounts players can pick (cents). Anything else needs a manual look.
export const LOAD_AMOUNTS = {
  youpay: [1000, 2500, 5000, 10000],
  throne: [500, 2000, 5000, 10000]
};

// YouPay gift links -> amount, in case the notice names the gift
const YOUPAY_GIFTS = { '1402719': 1000, '1402722': 2500, '1402723': 5000, '1402724': 10000 };

function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function freshTimestamp(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return false;
  const seconds = n > 1e12 ? n / 1000 : n; // accept seconds or milliseconds
  return Math.abs(Date.now() / 1000 - seconds) <= MAX_AGE_SECONDS;
}

// ---------- Throne ----------
// Throne signs with its public key (no secret needed on our side).
// Headers: X-Signature-Timestamp, X-Signature-Ed25519. Signed text = timestamp + "." + raw body.
const THRONE_PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAPXbUfxh7XL4SYUVcfhmYMIbxvtR9E9LDd8gPJ1PwSD8=';
let throneKey = null;

export async function verifyThrone(request, rawBody, publicKeyB64) {
  const ts = request.headers.get('x-signature-timestamp');
  const sig = hexToBytes(request.headers.get('x-signature-ed25519') || '');
  if (!ts || !sig || sig.length !== 64) return false;
  if (!freshTimestamp(ts)) return false;
  if (publicKeyB64 || !throneKey) {
    const der = Uint8Array.from(atob(publicKeyB64 || THRONE_PUBLIC_KEY_B64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
    if (publicKeyB64) return crypto.subtle.verify({ name: 'Ed25519' }, key, sig, enc.encode(ts + '.' + rawBody));
    throneKey = key;
  }
  return crypto.subtle.verify({ name: 'Ed25519' }, throneKey, sig, enc.encode(ts + '.' + rawBody));
}

// Reads a Throne notice. Only "LOAD $X" items are wallet loads.
export function parseThrone(body) {
  const d = body && body.data || {};
  const out = {
    eventId: String(body && body.event_id || ''),
    type: String(body && body.event_type || ''),
    itemName: String(d.item_name || ''),
    message: String(d.message || ''),
    gifter: String(d.gifter_username || ''),
    paidCents: Number.isInteger(d.price) ? d.price : null,
    currency: d.currency ? String(d.currency) : null,
    amountCents: null,
    isLoad: false
  };
  const m = out.itemName.match(/\bLOAD\s*\$\s*(\d+)\b/i);
  if (out.type === 'gift_purchased' && m) {
    out.isLoad = true;
    const cents = parseInt(m[1], 10) * 100;
    if (LOAD_AMOUNTS.throne.indexOf(cents) !== -1) out.amountCents = cents;
  }
  return out;
}

// ---------- YouPay ----------
// Header x-youpay-webhook-signature: "sha256=<hex>", an HMAC-SHA256 with your
// YouPay signing secret over "<timestamp>.<raw body>".
export async function verifyYouPay(request, rawBody, secret) {
  if (!secret) return false;
  const header = (request.headers.get('x-youpay-webhook-signature') || '').trim();
  const given = header.replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  // The timestamp may come in its own header or inside the signature header
  let ts = request.headers.get('x-youpay-webhook-timestamp') || request.headers.get('x-youpay-timestamp') || '';
  const inHeader = header.match(/t=(\d+)/);
  if (!ts && inHeader) ts = inHeader[1];
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const candidates = [];
  if (ts) candidates.push(ts + '.' + rawBody);
  candidates.push(rawBody);
  for (const text of candidates) {
    const mac = bytesToHex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
    if (safeEqual(mac, given)) {
      return !ts || freshTimestamp(ts);
    }
  }
  return false;
}

// YouPay doesn't publish its notice layout, so read it carefully and only
// trust an amount that matches one of the load buttons exactly.
function walk(obj, fn, path) {
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) walk(obj[k], fn, (path ? path + '.' : '') + k);
  } else fn(path || '', obj);
}

export function parseYouPay(body) {
  const strings = [], fields = [];
  walk(body, (path, v) => { fields.push([path.toLowerCase(), v]); if (typeof v === 'string') strings.push(v); });
  const pick = re => { const f = fields.find(([p, v]) => re.test(p) && v != null && v !== ''); return f ? f[1] : null; };

  const statusRaw = String(pick(/(^|\.)(status|event|event_type|type|topic)$/) || '').toLowerCase();
  let status = 'unknown';
  if (/chargeback|dispute/.test(statusRaw)) status = 'chargeback';
  else if (/refund/.test(statusRaw)) status = 'refunded';
  else if (/fulfil|complete|paid|success/.test(statusRaw)) status = 'fulfilled';

  const orderId = pick(/(^|\.)(order_id|orderid|order_number|ordernumber|id)$/);
  const message = String(pick(/message|note|comment/) || '');

  // Amount: the gift link number first, then any amount field that matches a load exactly
  let amountCents = null, fromLoadLink = false;
  for (const s of strings) {
    const m = s.match(/\/gift\/(\d+)/) || (YOUPAY_GIFTS[s] ? [null, s] : null);
    if (m && YOUPAY_GIFTS[m[1]]) { amountCents = YOUPAY_GIFTS[m[1]]; fromLoadLink = true; break; }
  }
  if (amountCents == null) {
    for (const [p, v] of fields) {
      if (!/amount|price|total|subtotal|value/.test(p)) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      const asCents = Number.isInteger(n) && LOAD_AMOUNTS.youpay.indexOf(n) !== -1 ? n : null;
      const fromDollars = LOAD_AMOUNTS.youpay.indexOf(Math.round(n * 100)) !== -1 ? Math.round(n * 100) : null;
      // Prefer reading it as dollars ("25.00"); fall back to cents ("2500")
      if (fromDollars != null && /\./.test(String(v)) ) { amountCents = fromDollars; break; }
      if (asCents != null) { amountCents = asCents; break; }
      if (fromDollars != null) { amountCents = fromDollars; break; }
    }
  }
  return {
    eventId: orderId != null ? String(orderId) : '',
    status, message, amountCents, fromLoadLink,
    gifter: String(pick(/(gifter|payer|customer|buyer|from).*(name|username)|(^|\.)(name|username)$/) || ''),
    allText: strings.join(' ')
  };
}

// Finds wallet codes hidden anywhere in a message (spaces, dashes and case don't matter).
export function codeCandidates(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i + 16 <= clean.length; i++) out.add(clean.slice(i, i + 16));
  return Array.from(out);
}
