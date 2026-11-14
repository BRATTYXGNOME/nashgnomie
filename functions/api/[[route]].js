// ==========================================
// NASH | Gnomie: Games server (Cloudflare Pages Functions + D1)
// Every /api/... request lands here. The database is bound as DB.
// Secrets (set in Cloudflare, never in this file):
//   YOUPAY_SIGNING_SECRET, ADMIN_PASSWORD (your Backstage password)
// Money is always whole cents; times are unix milliseconds.
// ==========================================

import {
  BOARDS, dropPath, slotValue, oddsFor,
  DUEL, rollDie, emptyBoard, boardScore, boardFull, cloneBoard, openColumns, placeDie, gnomieChoose,
  randomCode, normalizeCode,
  TOOFAR, newDeck, handTotal, BOTTLE, spinSlice, shuffledOrder,
  MANCALA, mancalaStart, mancalaMoves, mancalaMove, gnomieMancala, mancalaBeadsStart, mancalaBeadsFromPits, mancalaBeadMove,
  FIVE, fiveStart, fiveOpenCols, fiveDrop, fiveLine, fiveFull, gnomieFive
} from '../_lib/rules.js';
import { verifyThrone, parseThrone, verifyYouPay, parseYouPay, codeCandidates } from '../_lib/payments.js';
import { newSecret, checkCode, otpauthUrl } from '../_lib/totp.js';

const DAY = 86400000;
const SESSION_COOKIE = 'ng_wallet';
const SESSION_DAYS = 400;
const PIN_TRIES = 5, PIN_LOCK_MS = 15 * 60 * 1000;
const enc = new TextEncoder();

// ---------- small helpers ----------
class Oops extends Error { constructor(msg, status, extra) { super(msg); this.status = status || 400; this.extra = extra; } }

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {})
  });
}
function money(c) { return '$' + (c / 100).toFixed(2); }
function hex(buf) { return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function pinHash(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return hex(bits);
}
async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!/application\/json/i.test(type)) throw new Oops('Bad request.', 415);
  const text = await request.text();
  if (text.length > 20000) throw new Oops('Bad request.', 413);
  try { return text ? JSON.parse(text) : {}; } catch (e) { throw new Oops('Bad request.'); }
}
function getCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function sessionCookie(token, maxAgeSeconds) {
  return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAgeSeconds;
}

// ---------- event log (everything shows up in Backstage) ----------
// Stored in the admin_log table. Country only, never IP addresses.
// Region (city, region, country) is saved in its own column, never in the details.
function regionOf(request) {
  const cf = request && request.cf;
  if (!cf) return null;
  return [cf.city, cf.region, cf.country].filter(Boolean).join(', ').slice(0, 120) || null;
}
async function logEvent(env, request, action, walletId, detail) {
  const text = String(detail == null ? '' : detail).slice(0, 8000);
  try {
    await env.DB.prepare('INSERT INTO admin_log (action, wallet_id, detail, created_at, region) VALUES (?, ?, ?, ?, ?)')
      .bind(action, walletId || null, text, Date.now(), regionOf(request)).run();
  } catch (e) {
    try { // older database without the region column
      await env.DB.prepare('INSERT INTO admin_log (action, wallet_id, detail, created_at) VALUES (?, ?, ?, ?)').bind(action, walletId || null, text, Date.now()).run();
    } catch (e2) { console.error('log failed', e2); }
  }
}

// ---------- database setup ----------
// The main tables were created in the Cloudflare console. Dice Duel needs one
// more table; it's created here automatically the first time it's needed.
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS duels (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), amount_cents INTEGER NOT NULL, held_cents INTEGER NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', outcome TEXT, you_score INTEGER, gnomie_score INTEGER, paid_cents INTEGER, created_at INTEGER NOT NULL, finished_at INTEGER)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_duels_one_active ON duels(wallet_id) WHERE status = 'active'`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_duels_done ON duels(status, wallet_id)`),
    // Fans' optional authenticator-app 2FA
    db.prepare(`CREATE TABLE IF NOT EXISTS wallet_totp (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), secret TEXT, pending TEXT, last_step INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`),
    // Too Far games (one in progress per wallet)
    db.prepare(`CREATE TABLE IF NOT EXISTS toofar (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), amount_cents INTEGER NOT NULL, held_cents INTEGER NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', outcome TEXT, you_total INTEGER, gnomie_total INTEGER, paid_cents INTEGER, created_at INTEGER NOT NULL, finished_at INTEGER)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_toofar_one_active ON toofar(wallet_id) WHERE status = 'active'`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_toofar_done ON toofar(status, wallet_id)`),
    // Mancala games (one in progress per wallet)
    db.prepare(`CREATE TABLE IF NOT EXISTS mancala (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), amount_cents INTEGER NOT NULL, held_cents INTEGER NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', outcome TEXT, you_score INTEGER, gnomie_score INTEGER, paid_cents INTEGER, created_at INTEGER NOT NULL, finished_at INTEGER)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mancala_one_active ON mancala(wallet_id) WHERE status = 'active'`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_mancala_done ON mancala(status, wallet_id)`),
    // 5 in a Row games (one in progress per wallet)
    db.prepare(`CREATE TABLE IF NOT EXISTS fiverow (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), amount_cents INTEGER NOT NULL, held_cents INTEGER NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', outcome TEXT, moves INTEGER, paid_cents INTEGER, created_at INTEGER NOT NULL, finished_at INTEGER)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fiverow_one_active ON fiverow(wallet_id) WHERE status = 'active'`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fiverow_done ON fiverow(status, wallet_id)`),
    // Balance changes made in Backstage (kind: load | adjust | set), with an
    // optional note that is either private (only Gnomie) or shown to the fan
    db.prepare(`CREATE TABLE IF NOT EXISTS adjustments (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), cents INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT, public INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, log_id INTEGER UNIQUE)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_adjustments_wallet ON adjustments(wallet_id)`),
    // "Nudge to add money" banners and what the fan did with them
    db.prepare(`CREATE TABLE IF NOT EXISTS nudges (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), message TEXT, created_at INTEGER NOT NULL, seen_at INTEGER, closed_at INTEGER, response TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nudges_wallet ON nudges(wallet_id)`),
    // Fans asking Gnomie to close their wallet (one open request per wallet)
    db.prepare(`CREATE TABLE IF NOT EXISTS close_requests (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), balance_cents INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    // Fans letting Gnomie know they're on a financial break
    db.prepare(`CREATE TABLE IF NOT EXISTS breaks (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), created_at INTEGER NOT NULL)`),
    // Usernames the fan shares with Gnomie (only Gnomie sees them)
    db.prepare(`CREATE TABLE IF NOT EXISTS wallet_contacts (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), telegram TEXT, throne TEXT, updated_at INTEGER NOT NULL)`),
    // Gnomie's own private notes about a wallet
    db.prepare(`CREATE TABLE IF NOT EXISTS wallet_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), note TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_wallet_notes_wallet ON wallet_notes(wallet_id)`),
    // The fan's chosen color for their side of every game board
    db.prepare(`CREATE TABLE IF NOT EXISTS wallet_prefs (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), color TEXT)`),
    // Every time a fan agrees to the wallet terms (and which version)
    db.prepare(`CREATE TABLE IF NOT EXISTS agreements (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), version TEXT NOT NULL, how TEXT, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_agreements_wallet ON agreements(wallet_id)`),
    // "I sent a load but it didn't show up" reports from fans
    db.prepare(`CREATE TABLE IF NOT EXISTS load_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), amount_cents INTEGER NOT NULL, sent_when TEXT, throne TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_load_reports_status ON load_reports(status, wallet_id)`),
    // Other things fans ask for: a game problem, or a new wallet code (with a reason)
    db.prepare(`CREATE TABLE IF NOT EXISTS fan_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL REFERENCES wallets(id), kind TEXT NOT NULL, game TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'open', resolution TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fan_requests_status ON fan_requests(status, kind)`),
    // Gnomie's spoof wallets (left out of every statistic) and extra color unlocks
    db.prepare(`CREATE TABLE IF NOT EXISTS spoofs (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS color_unlocks (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), bonus INTEGER NOT NULL DEFAULT 0)`)
  ]);
  // Region gets its own column in the event log (fails harmlessly if it's already there)
  try { await db.prepare('ALTER TABLE admin_log ADD COLUMN region TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE nudges ADD COLUMN response TEXT').run(); } catch (e) {}
  await carryOverOldAdjustments(db);
  schemaReady = true;
}

// Balance changes made in Backstage before notes could be shown to fans were
// only written in the event log. Copy them into the adjustments table once,
// as private notes, so they appear in account activity and can be shown.
async function carryOverOldAdjustments(db) {
  try {
    const old = (await db.prepare(
      `SELECT a.id, a.action, a.wallet_id, a.detail, a.created_at FROM admin_log a
       WHERE a.action IN ('backstage_manual_load', 'backstage_balance_fix') AND a.wallet_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM adjustments j WHERE j.log_id = a.id) LIMIT 200`
    ).all()).results;
    for (const o of old) {
      const m = String(o.detail || '').match(/^\$(-?\d+(?:\.\d+)?)/);
      if (!m) continue;
      const note = String(o.detail).replace(/^\$-?[\d.]+\s*(·\s*)?/, '').replace(/\s*\[[A-Z]{2}\]$/, '').trim() || null;
      await db.prepare('INSERT OR IGNORE INTO adjustments (wallet_id, cents, kind, note, public, created_at, log_id) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .bind(o.wallet_id, Math.round(parseFloat(m[1]) * 100), o.action === 'backstage_manual_load' ? 'load' : 'adjust', note, o.created_at, o.id).run();
    }
  } catch (e) { console.error('carry over failed', e); }
}

// Wallets are never removed automatically; Gnomie closes them in Backstage.

// The wallet terms. Change this whenever the terms change: every fan then has
// to check the boxes again before they can see their wallet.
const TERMS_VERSION = '2026-11-14';
async function recordAgreement(db, walletId, how) {
  await db.prepare('INSERT INTO agreements (wallet_id, version, how, created_at) VALUES (?, ?, ?, ?)').bind(walletId, TERMS_VERSION, how, Date.now()).run();
}

// Colors for the fan's side of every board (and their name on leaderboards).
// Everyone starts with purple; each load of $20 or more unlocks the next color.
const COLORS = { purple: 0, green: 1, blue: 2, orange: 3, gold: 4, red: 5, white: 6, electric: 7 };
const COLOR_LOAD_MIN = 2000;

// Names nobody can use on the leaderboard: slurs, and anything mean about Gnomie.
// Letters swapped for look-alike numbers/symbols (b1tch, $lut) are caught too.
const BLOCKED_NAME_PARTS = ['bitch', 'whore', 'cunt', 'skank', 'slut', 'hoe', 'twat', 'scam', 'fraud', 'thief', 'ugly', 'fatass', 'retard', 'rape', 'rapist',
  'nigg', 'nigga', 'fag', 'faggot', 'dyke', 'tranny', 'kike', 'spic', 'chink', 'gook', 'wetback', 'beaner', 'coon', 'nazi', 'hitler', 'kys', 'killyourself', 'pedo', 'molest'];
function nameBlocked(name) {
  const flat = String(name || '').toLowerCase()
    .replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[4@]/g, 'a').replace(/0/g, 'o').replace(/[5$]/g, 's').replace(/7/g, 't')
    .replace(/[^a-z]/g, '');
  return BLOCKED_NAME_PARTS.some(w => flat.includes(w));
}

// ---------- wallets ----------
const WALLET_SELECT = `SELECT w.*,
  (SELECT held_cents FROM duels d WHERE d.wallet_id = w.id AND d.status = 'active') AS held_duel,
  (SELECT held_cents FROM toofar t WHERE t.wallet_id = w.id AND t.status = 'active') AS held_toofar,
  (SELECT held_cents FROM mancala m WHERE m.wallet_id = w.id AND m.status = 'active') AS held_mancala,
  (SELECT COUNT(*) FROM mancala m WHERE m.wallet_id = w.id AND m.outcome = 'win') AS mancala_wins,
  (SELECT held_cents FROM fiverow f WHERE f.wallet_id = w.id AND f.status = 'active') AS held_five,
  (SELECT COUNT(*) FROM fiverow f WHERE f.wallet_id = w.id AND f.outcome = 'win') AS five_wins,
  (SELECT COUNT(*) FROM toofar t WHERE t.wallet_id = w.id AND t.outcome = 'win') AS toofar_wins,
  (SELECT COUNT(*) FROM duels d WHERE d.wallet_id = w.id AND d.outcome = 'win') AS duel_wins,
  (SELECT t.secret IS NOT NULL FROM wallet_totp t WHERE t.wallet_id = w.id) AS two_factor,
  (SELECT n.id FROM nudges n WHERE n.wallet_id = w.id AND n.closed_at IS NULL ORDER BY n.id DESC LIMIT 1) AS nudge_id,
  (SELECT n.message FROM nudges n WHERE n.wallet_id = w.id AND n.closed_at IS NULL ORDER BY n.id DESC LIMIT 1) AS nudge_message,
  (SELECT c.created_at FROM close_requests c WHERE c.wallet_id = w.id) AS close_requested_at,
  (SELECT k.created_at FROM breaks k WHERE k.wallet_id = w.id) AS break_since,
  (SELECT a.version FROM agreements a WHERE a.wallet_id = w.id ORDER BY a.id DESC LIMIT 1) AS terms_version,
  (SELECT p.color FROM wallet_prefs p WHERE p.wallet_id = w.id) AS color,
  ((SELECT COUNT(*) FROM loads l WHERE l.wallet_id = w.id AND l.status = 'credited' AND l.amount_cents >= 2000) +
   (SELECT COUNT(*) FROM adjustments j WHERE j.wallet_id = w.id AND j.kind = 'load' AND j.cents >= 2000) +
   COALESCE((SELECT u.bonus FROM color_unlocks u WHERE u.wallet_id = w.id), 0) +
   (CASE WHEN EXISTS (SELECT 1 FROM spoofs x WHERE x.wallet_id = w.id) THEN 99 ELSE 0 END)) AS load_count,
  (SELECT 1 FROM spoofs x WHERE x.wallet_id = w.id) AS spoof,
  (SELECT c.telegram FROM wallet_contacts c WHERE c.wallet_id = w.id) AS telegram,
  (SELECT c.throne FROM wallet_contacts c WHERE c.wallet_id = w.id) AS throne_name
  FROM wallets w`;

function publicWallet(w) {
  if (!w) return null;
  // Until they've agreed to the current terms, they don't get to see their balance
  if (w.pin_hash && w.terms_version !== TERMS_VERSION) {
    return { code: w.display_code, hasPin: true, needsTerms: true, name: w.name, anonymous: !w.name, anonNumber: w.anon_number, color: colorOf(w) };
  }
  return {
    code: w.display_code, hasPin: !!w.pin_hash, pinLength: w.pin_length || null,
    name: w.name, anonymous: !w.name, anonNumber: w.anon_number,
    balanceCents: w.balance_cents, drainedCents: w.total_drained_cents, loadedCents: w.total_loaded_cents,
    heldCents: (w.held_duel || 0) + (w.held_toofar || 0) + (w.held_mancala || 0) + (w.held_five || 0), duelWins: w.duel_wins || 0, twoFactor: !!w.two_factor,
    heldFor: [w.held_duel ? 'Dice Duel' : null, w.held_toofar ? 'Too Far' : null, w.held_mancala ? 'Mancala' : null, w.held_five ? '5 in a Row' : null].filter(Boolean), tooFarWins: w.toofar_wins || 0, mancalaWins: w.mancala_wins || 0, fiveWins: w.five_wins || 0,
    nudge: w.nudge_id && !w.break_since ? { id: w.nudge_id, message: w.nudge_message || '' } : null,
    closeRequested: !!w.close_requested_at, onBreak: !!w.break_since,
    color: colorOf(w), loadCount: w.load_count || 0, telegram: w.telegram || '', throneName: w.throne_name || ''
  };
}
function colorOf(w) { return COLORS[w.color] !== undefined && (w.load_count || 0) >= COLORS[w.color] ? w.color : 'purple'; }

async function walletById(db, id) {
  return db.prepare(WALLET_SELECT + ' WHERE w.id = ?').bind(id).first();
}

async function sessionWallet(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare('SELECT wallet_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(token), Date.now()).first();
  if (!row) return null;
  const w = await walletById(env.DB, row.wallet_id);
  if (!w || w.status !== 'active') return null;
  return w;
}

async function needWallet(env, request) {
  const w = await sessionWallet(env, request);
  if (!w) throw new Oops('Set up your wallet first.', 401);
  if (w.pin_hash && w.terms_version !== TERMS_VERSION) throw new Oops('Please agree to the wallet terms first.', 403, { needsTerms: true });
  return w;
}

async function newSession(db, walletId) {
  const token = randomHex(32), now = Date.now();
  await db.prepare('INSERT INTO sessions (token_hash, wallet_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), walletId, now, now + SESSION_DAYS * DAY, now).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

// Takes money off (or puts it back) only if the balance hasn't changed since
// we looked, so two taps at once can never double-spend.
async function changeBalance(db, walletId, expectedBalance, delta, drainedDelta) {
  const r = await db.prepare(
    'UPDATE wallets SET balance_cents = balance_cents + ?, total_drained_cents = total_drained_cents + ? WHERE id = ? AND balance_cents = ?'
  ).bind(delta, drainedDelta || 0, walletId, expectedBalance).run();
  return r.meta.changes === 1;
}

// ---------- routes: wallet ----------
const routes = {};

routes['GET health'] = async (env) => json({ ok: true, db: !!env.DB });

routes['GET me'] = async (env, request) => json({ wallet: publicWallet(await sessionWallet(env, request)) });

routes['POST wallet'] = async (env, request) => {
  const body = await readJson(request);
  if (body.agreed !== true) throw new Oops('Please check every box to continue.');
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const display = randomCode();
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO wallets (code, display_code, anon_number, agreed_at, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(anon_number), 0) + 1 FROM wallets), ?, ?)`
    ).bind(normalizeCode(display), display, now, now).run();
    if (r.meta.changes === 1) {
      const id = r.meta.last_row_id;
      await recordAgreement(env.DB, id, 'new wallet');
      const cookie = await newSession(env.DB, id);
      await logEvent(env, request, 'wallet_created', id, display);
      return json({ wallet: publicWallet(await walletById(env.DB, id)) }, 200, { 'set-cookie': cookie });
    }
  }
  throw new Oops('Something went wrong. Please try again.', 500);
};

routes['POST pin'] = async (env, request) => {
  const w = await needWallet(env, request);
  const { pin } = await readJson(request);
  if (!/^(\d{4}|\d{6})$/.test(String(pin || ''))) throw new Oops('Your PIN must be 4 or 6 digits.');
  if (w.pin_hash) throw new Oops('Your PIN is already set.');
  const salt = randomHex(16);
  await env.DB.prepare('UPDATE wallets SET pin_hash = ?, pin_salt = ?, pin_length = ? WHERE id = ? AND pin_hash IS NULL')
    .bind(await pinHash(pin, salt), salt, pin.length, w.id).run();
  await logEvent(env, request, 'pin_set', w.id, pin.length + ' digits');
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// Names work like usernames: one person each (capital letters don't make a new name)
async function nameTaken(db, name, walletId) {
  return !!(await db.prepare('SELECT 1 FROM wallets WHERE LOWER(name) = ? AND id != ? LIMIT 1').bind(name.toLowerCase(), walletId).first());
}

routes['POST name'] = async (env, request) => {
  const w = await needWallet(env, request);
  const body = await readJson(request);
  let name = String(body.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ');
  if (body.anonymous) name = null;
  else {
    if (name.length < 2 || name.length > 24) throw new Oops('Names need 2–24 characters.');
    if (/^anonymous|gnomie/i.test(name) || nameBlocked(name)) throw new Oops('Please pick a different name.');
    if (await nameTaken(env.DB, name, w.id)) throw new Oops('Someone already has that name. Try another one.');
  }
  if (name === w.name) return json({ wallet: publicWallet(w) });
  await env.DB.prepare('UPDATE wallets SET name = ? WHERE id = ?').bind(name, w.id).run();
  await logEvent(env, request, 'name_set', w.id, name || 'Anonymous #' + w.anon_number);
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

routes['POST signin'] = async (env, request) => {
  const body = await readJson(request);
  const raw = String(body.code || '').trim().replace(/\s+/g, ' ').slice(0, 60), code = normalizeCode(raw), pin = String(body.pin || '');
  if (body.agreed !== true) throw new Oops('Please check every box to continue.');
  const fail = new Oops("That wallet and PIN don't match.", 401);
  if (!raw || !/^\d{4,6}$/.test(pin)) throw fail;
  // A wallet code always wins; otherwise try it as a leaderboard name
  let w = code.length === 16 ? await env.DB.prepare('SELECT * FROM wallets WHERE code = ?').bind(code).first() : null;
  let byName = false;
  if (!w) {
    const anon = raw.match(/^anonymous\s*#?\s*(\d+)$/i);
    w = anon ? await env.DB.prepare('SELECT * FROM wallets WHERE name IS NULL AND anon_number = ?').bind(+anon[1]).first()
             : await env.DB.prepare('SELECT * FROM wallets WHERE LOWER(name) = ? LIMIT 1').bind(raw.toLowerCase()).first();
    byName = !!w;
  }
  if (!w || !w.pin_hash || w.status !== 'active') {
    await logEvent(env, request, 'signin_failed', w ? w.id : null, w ? (w.status === 'banned' ? 'Banned wallet' : w.status === 'closed' ? 'Closed wallet' : 'No PIN set') : 'Unknown code');
    if (w && w.status === 'closed' && w.pin_hash && safeEqual(await pinHash(pin, w.pin_salt), w.pin_hash)) {
      throw new Oops('This wallet was closed. DM me on Telegram if you think that’s a mistake.', 403);
    }
    throw fail;
  }
  const now = Date.now();
  if (w.locked_until > now) {
    const mins = Math.ceil((w.locked_until - now) / 60000);
    throw new Oops('Too many tries. Please wait ' + (mins > 90 ? Math.ceil(mins / 60) + ' hours' : mins + ' minutes') + ' and try again.', 429);
  }
  // Names are public, so signing in by name locks for a whole day after too many wrong tries
  const lockMs = byName ? DAY : PIN_LOCK_MS, lockText = byName ? 'Locked 24 hours (signing in by name)' : 'Locked 15 minutes';
  if (!safeEqual(await pinHash(pin, w.pin_salt), w.pin_hash)) {
    const tries = w.failed_pin_count + 1;
    await env.DB.prepare('UPDATE wallets SET failed_pin_count = ?, locked_until = ? WHERE id = ?')
      .bind(tries >= PIN_TRIES ? 0 : tries, tries >= PIN_TRIES ? now + lockMs : 0, w.id).run();
    await logEvent(env, request, tries >= PIN_TRIES ? 'signin_locked' : 'signin_failed', w.id, (tries >= PIN_TRIES ? lockText + ' after ' + PIN_TRIES + ' wrong PINs' : 'Wrong PIN (' + tries + ' of ' + PIN_TRIES + ')') + (byName ? ' · used their name' : ''));
    throw fail;
  }
  // Wallets with 2FA also need the 6-digit code from the fan's authenticator app
  const tf = await env.DB.prepare('SELECT * FROM wallet_totp WHERE wallet_id = ? AND secret IS NOT NULL').bind(w.id).first();
  if (tf) {
    if (!String(body.otp || '').trim()) throw new Oops('Enter the 6-digit code from your authenticator app.', 401, { needsCode: true });
    const step = await checkCode(tf.secret, body.otp, tf.last_step);
    if (step < 0) {
      const tries = w.failed_pin_count + 1;
      await env.DB.prepare('UPDATE wallets SET failed_pin_count = ?, locked_until = ? WHERE id = ?')
        .bind(tries >= PIN_TRIES ? 0 : tries, tries >= PIN_TRIES ? now + lockMs : 0, w.id).run();
      await logEvent(env, request, tries >= PIN_TRIES ? 'signin_locked' : 'signin_failed', w.id, tries >= PIN_TRIES ? lockText + ' after ' + PIN_TRIES + ' wrong tries' : 'Right PIN, wrong app code (' + tries + ' of ' + PIN_TRIES + ')');
      throw new Oops('That app code didn’t work. Use the newest code.', 401, { needsCode: true });
    }
    await env.DB.prepare('UPDATE wallet_totp SET last_step = ? WHERE wallet_id = ?').bind(step, w.id).run();
  }
  await env.DB.prepare('UPDATE wallets SET failed_pin_count = 0, locked_until = 0 WHERE id = ?').bind(w.id).run();
  const cookie = await newSession(env.DB, w.id);
  await recordAgreement(env.DB, w.id, 'sign-in');
  await logEvent(env, request, 'signin_ok', w.id, (byName ? 'Name' : 'Code') + ' + PIN' + (tf ? ' + app code' : '') + ' · agreed to the wallet terms');
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) }, 200, { 'set-cookie': cookie });
};

routes['POST signout'] = async (env, request) => {
  const token = getCookie(request, SESSION_COOKIE);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
};

// ---------- fans' 2FA (authenticator app) ----------
routes['POST 2fa/start'] = async (env, request) => {
  const w = await needWallet(env, request);
  if (w.two_factor) throw new Oops('Your authenticator app is already connected.');
  const secret = newSecret();
  await env.DB.prepare('INSERT INTO wallet_totp (wallet_id, pending, created_at) VALUES (?, ?, ?) ON CONFLICT(wallet_id) DO UPDATE SET pending = excluded.pending')
    .bind(w.id, secret, Date.now()).run();
  return json({ secret, otpauth: otpauthUrl(secret, 'NASH Gnomie:Wallet') });
};

routes['POST 2fa/confirm'] = async (env, request) => {
  const w = await needWallet(env, request);
  const { otp } = await readJson(request);
  const row = await env.DB.prepare('SELECT * FROM wallet_totp WHERE wallet_id = ?').bind(w.id).first();
  if (!row || !row.pending) throw new Oops('Start again: tap “Turn on” first.');
  const step = await checkCode(row.pending, otp, 0);
  if (step < 0) throw new Oops('That code didn’t work. Type the newest code from your app.');
  await env.DB.prepare('UPDATE wallet_totp SET secret = pending, pending = NULL, last_step = ? WHERE wallet_id = ?').bind(step, w.id).run();
  await logEvent(env, request, 'wallet_2fa_on', w.id, 'Authenticator app connected');
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

routes['POST 2fa/off'] = async (env, request) => {
  const w = await needWallet(env, request);
  const { pin, otp } = await readJson(request);
  const row = await env.DB.prepare('SELECT * FROM wallet_totp WHERE wallet_id = ? AND secret IS NOT NULL').bind(w.id).first();
  if (!row) throw new Oops('Your authenticator app isn’t connected.');
  if (!w.pin_hash || !safeEqual(await pinHash(String(pin || ''), w.pin_salt), w.pin_hash)) throw new Oops('Wrong PIN.', 401);
  const step = await checkCode(row.secret, otp, row.last_step);
  if (step < 0) throw new Oops('That code didn’t work. Type the newest code from your app.', 401);
  await env.DB.prepare('DELETE FROM wallet_totp WHERE wallet_id = ?').bind(w.id).run();
  await logEvent(env, request, 'wallet_2fa_off', w.id, 'Turned off by the fan');
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// ---------- account activity (like a bank statement) ----------
// Every change to a wallet's balance, newest first, with the balance after it.
// Active games show the amount set aside; finished games show what was paid.
const BOARD_NAMES = { sweet: 'Sweet', spicy: 'Spicy', savage: 'Savage' };
const DUEL_RESULT = { win: 'You won', tie: 'Tie', lose: 'Gnomie won' };
const TOOFAR_RESULT = { win: 'You won', tie: 'Tie', lose: 'Gnomie won', bust: 'Went too far' };
const ADJ_LABEL = { load: 'Load added by Gnomie', adjust: 'Balance adjusted by Gnomie', set: 'Balance set by Gnomie', bonus: 'Correction: bonus from Gnomie' };

async function buildStatement(db, w, forFan) {
  const id = w.id, limit = 1000;
  const [loads, adjs, drops, duels, toofar, mancala, fiverow] = await Promise.all([
    db.prepare("SELECT id, platform, amount_cents, external_id, item_name, created_at, updated_at FROM loads WHERE wallet_id = ? AND status = 'credited' ORDER BY id DESC LIMIT ?").bind(id, limit).all(),
    db.prepare('SELECT * FROM adjustments WHERE wallet_id = ? ORDER BY id DESC LIMIT ?').bind(id, limit).all(),
    db.prepare('SELECT id, game, board, path, amount_cents, created_at FROM drops WHERE wallet_id = ? ORDER BY id DESC LIMIT ?').bind(id, limit).all(),
    db.prepare('SELECT id, amount_cents, held_cents, status, outcome, paid_cents, created_at, finished_at FROM duels WHERE wallet_id = ? ORDER BY id DESC LIMIT ?').bind(id, limit).all(),
    db.prepare('SELECT id, amount_cents, held_cents, status, outcome, paid_cents, created_at, finished_at FROM toofar WHERE wallet_id = ? ORDER BY id DESC LIMIT ?').bind(id, limit).all(),
    db.prepare('SELECT id, amount_cents, held_cents, status, outcome, paid_cents, you_score, gnomie_score, created_at, finished_at FROM mancala WHERE wallet_id = ? ORDER BY id DESC LIMIT ?').bind(id, limit).all(),
    db.prepare('SELECT id, amount_cents, held_cents, status, outcome, paid_cents, created_at, finished_at FROM fiverow WHERE wallet_id = ? ORDER BY id DESC LIMIT ?').bind(id, limit).all()
  ]);
  const rows = [];
  const add = (key, at, label, detail, cents, extra) => rows.push(Object.assign({ key, at, label, detail: detail || '', cents }, extra || {}));
  for (const l of loads.results) {
    const order = /^manual:([^:]+):/.exec(l.external_id || '');
    const fix = l.item_name === 'correction';
    add('l' + l.id, l.updated_at || l.created_at, (fix ? 'Correction: ' : '') + 'Load from ' + (l.platform === 'youpay' ? 'YouPay' : 'Throne'),
      order && !/^\d{13}$/.test(order[1]) ? 'Order #' + order[1] : '', l.amount_cents, forFan ? null : { loadId: l.id, order: order ? order[1] : '' });
  }
  for (const a of adjs.results) {
    const show = !!a.public;
    if (forFan) add('a' + a.id, a.created_at, ADJ_LABEL[a.kind] || ADJ_LABEL.adjust, '', a.cents, show && a.note ? { note: a.note } : null);
    else add('a' + a.id, a.created_at, ADJ_LABEL[a.kind] || ADJ_LABEL.adjust, '', a.cents, { adjId: a.id, adjKind: a.kind, note: a.note || '', notePublic: show });
  }
  for (const d of drops.results) {
    if (d.game === 'spin-the-bottle') add('s' + d.id, d.created_at, 'Spin the Bottle', (BOARD_NAMES[d.board] || d.board) + (/\|hit$/.test(d.path) ? ' · landed on your wedge, paid double' : ''), -d.amount_cents);
    else add('d' + d.id, d.created_at, 'Drop the Ball', (BOARD_NAMES[d.board] || d.board) + ' board', -d.amount_cents);
  }
  for (const g of duels.results) {
    if (g.status === 'active') add('u' + g.id, g.created_at, 'Dice Duel', 'In progress · set aside', -g.held_cents);
    else if (g.status === 'done') add('u' + g.id, g.finished_at || g.created_at, 'Dice Duel', (DUEL_RESULT[g.outcome] || g.outcome) + ' · played for ' + money(g.amount_cents), -(g.paid_cents || 0));
  }
  for (const g of toofar.results) {
    if (g.status === 'active') add('t' + g.id, g.created_at, 'Too Far', 'In progress · set aside', -g.held_cents);
    else if (g.status === 'done') add('t' + g.id, g.finished_at || g.created_at, 'Too Far', (TOOFAR_RESULT[g.outcome] || g.outcome) + ' · played for ' + money(g.amount_cents), -(g.paid_cents || 0));
  }
  for (const g of mancala.results) {
    if (g.status === 'active') add('m' + g.id, g.created_at, 'Mancala', 'In progress · set aside', -g.held_cents);
    else if (g.status === 'done') add('m' + g.id, g.finished_at || g.created_at, 'Mancala', (DUEL_RESULT[g.outcome] || g.outcome) + ' ' + g.you_score + '–' + g.gnomie_score + ' · played for ' + money(g.amount_cents), -(g.paid_cents || 0));
  }
  for (const g of fiverow.results) {
    if (g.status === 'active') add('f' + g.id, g.created_at, '5 in a Row', 'In progress · set aside', -g.held_cents);
    else if (g.status === 'done') add('f' + g.id, g.finished_at || g.created_at, '5 in a Row', (DUEL_RESULT[g.outcome] || g.outcome) + ' · played for ' + money(g.amount_cents), -(g.paid_cents || 0));
  }
  rows.sort((a, b) => b.at - a.at || (b.key < a.key ? -1 : 1));
  let bal = w.balance_cents;
  for (const r of rows) { r.balanceAfter = bal; bal -= r.cents; delete r.key; }
  return rows.slice(0, 300);
}

routes['GET statement'] = async (env, request) => {
  const w = await needWallet(env, request);
  return json({ rows: await buildStatement(env.DB, w, true) });
};

// ---------- asking to close a wallet ----------
routes['POST close-request'] = async (env, request) => {
  const w = await needWallet(env, request);
  if ((await readJson(request)).agreed !== true) throw new Oops('Please check the box to continue.');
  if (w.held_duel || w.held_toofar || w.held_mancala || w.held_five) throw new Oops('Finish your game in progress first.');
  await env.DB.prepare('INSERT OR IGNORE INTO close_requests (wallet_id, balance_cents, created_at) VALUES (?, ?, ?)').bind(w.id, w.balance_cents, Date.now()).run();
  await logEvent(env, request, 'close_requested', w.id, 'Balance ' + money(w.balance_cents) + ' (agreed it can’t be withdrawn)');
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

routes['POST close-request/cancel'] = async (env, request) => {
  const w = await needWallet(env, request);
  const r = await env.DB.prepare('DELETE FROM close_requests WHERE wallet_id = ?').bind(w.id).run();
  if (r.meta.changes) await logEvent(env, request, 'close_request_cancelled', w.id, '');
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// ---------- deleting a wallet that was never used ----------
// Only wallets that never had a load, a game or a balance can be deleted
// (anything else gets closed instead, so its history stays on record).
async function walletUnused(db, id) {
  const w = await db.prepare('SELECT total_loaded_cents, total_drained_cents, balance_cents FROM wallets WHERE id = ?').bind(id).first();
  if (!w || w.total_loaded_cents || w.total_drained_cents || w.balance_cents) return false;
  const used = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM loads WHERE wallet_id = ?) + (SELECT COUNT(*) FROM drops WHERE wallet_id = ?) + (SELECT COUNT(*) FROM duels WHERE wallet_id = ?) +
      (SELECT COUNT(*) FROM toofar WHERE wallet_id = ?) + (SELECT COUNT(*) FROM mancala WHERE wallet_id = ?) + (SELECT COUNT(*) FROM fiverow WHERE wallet_id = ?) +
      (SELECT COUNT(*) FROM adjustments WHERE wallet_id = ?) AS n`).bind(id, id, id, id, id, id, id).first();
  return used.n === 0;
}
async function deleteWalletRows(db, id) {
  const t = ['sessions', 'wallet_totp', 'reigns', 'agreements', 'nudges', 'wallet_contacts', 'wallet_prefs', 'wallet_notes', 'fan_requests', 'load_reports', 'breaks', 'close_requests'];
  await db.batch(t.map(name => db.prepare('DELETE FROM ' + name + ' WHERE wallet_id = ?').bind(id))
    .concat([db.prepare('UPDATE admin_log SET wallet_id = NULL WHERE wallet_id = ?').bind(id), db.prepare('DELETE FROM wallets WHERE id = ?').bind(id)]));
}
routes['POST wallet/delete'] = async (env, request) => {
  const w = await sessionWallet(env, request);
  if (!w) throw new Oops('Set up your wallet first.', 401);
  if (!(await walletUnused(env.DB, w.id))) throw new Oops('This wallet has been used, so it can’t be deleted. You can ask Gnomie to close it instead.');
  await logEvent(env, request, 'wallet_deleted', null, w.display_code + ' deleted by the fan (never used)');
  await deleteWalletRows(env.DB, w.id);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
};

// ---------- agreeing to new terms, usernames, color ----------
routes['POST agree'] = async (env, request) => {
  const w = await sessionWallet(env, request);
  if (!w) throw new Oops('Set up your wallet first.', 401);
  if ((await readJson(request)).agreed !== true) throw new Oops('Please check every box to continue.');
  if (w.terms_version !== TERMS_VERSION) {
    await recordAgreement(env.DB, w.id, 'updated terms');
    await logEvent(env, request, 'terms_agreed', w.id, 'Wallet terms ' + TERMS_VERSION);
  }
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

function cleanHandle(v) { return String(v || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_.\-]/g, '').slice(0, 40); }

routes['POST contacts'] = async (env, request) => {
  const w = await needWallet(env, request);
  const b = await readJson(request);
  const tg = cleanHandle(b.telegram), th = cleanHandle(b.throne);
  await env.DB.prepare('INSERT INTO wallet_contacts (wallet_id, telegram, throne, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(wallet_id) DO UPDATE SET telegram = excluded.telegram, throne = excluded.throne, updated_at = excluded.updated_at')
    .bind(w.id, tg || null, th || null, Date.now()).run();
  await logEvent(env, request, 'contacts_set', w.id, 'Telegram: ' + (tg ? '@' + tg : '—') + ' · Throne: ' + (th || '—'));
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

routes['POST color'] = async (env, request) => {
  const w = await needWallet(env, request);
  const color = String((await readJson(request)).color || '');
  if (COLORS[color] === undefined) throw new Oops('Pick a color.');
  if ((w.load_count || 0) < COLORS[color]) throw new Oops('That color unlocks after ' + COLORS[color] + ' load' + (COLORS[color] > 1 ? 's' : '') + ' of $20 or more.');
  await env.DB.prepare('INSERT INTO wallet_prefs (wallet_id, color) VALUES (?, ?) ON CONFLICT(wallet_id) DO UPDATE SET color = excluded.color').bind(w.id, color).run();
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// ---------- "my load didn't show up" ----------
const REPORT_AMOUNTS = [500, 2000, 5000, 10000];
function publicReport(r) {
  return { id: r.id, amountCents: r.amount_cents, sentWhen: r.sent_when || '', status: r.status, resolution: r.resolution || '', createdAt: r.created_at, resolvedAt: r.resolved_at };
}
routes['GET load-reports'] = async (env, request) => {
  const w = await needWallet(env, request);
  const rows = (await env.DB.prepare('SELECT * FROM load_reports WHERE wallet_id = ? ORDER BY id DESC LIMIT 10').bind(w.id).all()).results;
  return json({ rows: rows.map(publicReport) });
};
routes['POST load-report'] = async (env, request) => {
  const w = await needWallet(env, request);
  const b = await readJson(request);
  const cents = Math.round(Number(b.amountCents));
  if (REPORT_AMOUNTS.indexOf(cents) === -1) throw new Oops('Pick the load you sent.');
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM load_reports WHERE wallet_id = ? AND status = 'open'").bind(w.id).first();
  if (open.n >= 3) throw new Oops('You already have 3 reports waiting. Gnomie will get to them soon, or message her on Telegram.');
  const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, n) || null;
  await env.DB.prepare('INSERT INTO load_reports (wallet_id, amount_cents, sent_when, throne, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(w.id, cents, clean(b.sentWhen, 80), cleanHandle(b.throne) || null, clean(b.note, 500), Date.now()).run();
  await logEvent(env, request, 'load_reported', w.id, money(cents) + ' load not showing' + (b.sentWhen ? ' · sent ' + clean(b.sentWhen, 80) : ''));
  const rows = (await env.DB.prepare('SELECT * FROM load_reports WHERE wallet_id = ? ORDER BY id DESC LIMIT 10').bind(w.id).all()).results;
  return json({ rows: rows.map(publicReport) });
};

// ---------- financial break ----------
routes['POST break'] = async (env, request) => {
  const w = await needWallet(env, request);
  const on = (await readJson(request)).on === true;
  if (on) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO breaks (wallet_id, created_at) VALUES (?, ?)').bind(w.id, Date.now()).run();
    if (r.meta.changes) await logEvent(env, request, 'break_started', w.id, 'Balance ' + money(w.balance_cents) + ' · sent ' + money(w.total_loaded_cents) + ' in total');
  } else {
    const r = await env.DB.prepare('DELETE FROM breaks WHERE wallet_id = ?').bind(w.id).run();
    if (r.meta.changes) await logEvent(env, request, 'break_ended', w.id, '');
  }
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// ---------- change PIN ----------
routes['POST pin/change'] = async (env, request) => {
  const w = await needWallet(env, request);
  const b = await readJson(request);
  if (!safeEqual(await pinHash(String(b.current || ''), w.pin_salt), w.pin_hash)) {
    await logEvent(env, request, 'pin_change_failed', w.id, 'Wrong current PIN');
    await new Promise(r => setTimeout(r, 600));
    throw new Oops('Your current PIN is wrong.');
  }
  const next = String(b.next || '');
  if (!/^(\d{4}|\d{6})$/.test(next)) throw new Oops('Your new PIN must be 4 or 6 digits.');
  const salt = randomHex(16);
  await env.DB.prepare('UPDATE wallets SET pin_hash = ?, pin_salt = ?, pin_length = ? WHERE id = ?').bind(await pinHash(next, salt), salt, next.length, w.id).run();
  await logEvent(env, request, 'pin_changed', w.id, next.length + ' digits');
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// ---------- requests: a game problem, or a new wallet code ----------
const REQUEST_KINDS = { issue: 'Game problem', new_code: 'New wallet code' };
function publicRequest(r) { return { id: r.id, kind: r.kind, game: r.game || '', status: r.status, resolution: r.resolution || '', createdAt: r.created_at }; }
routes['GET requests'] = async (env, request) => {
  const w = await needWallet(env, request);
  const rows = (await env.DB.prepare('SELECT * FROM fan_requests WHERE wallet_id = ? ORDER BY id DESC LIMIT 10').bind(w.id).all()).results;
  return json({ rows: rows.map(publicRequest) });
};
routes['POST request'] = async (env, request) => {
  const w = await needWallet(env, request);
  const b = await readJson(request);
  if (!REQUEST_KINDS[b.kind]) throw new Oops('Pick what this is about.');
  const note = String(b.note || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, ' ').trim().slice(0, 1000);
  if (note.length < 4) throw new Oops(b.kind === 'new_code' ? 'Tell Gnomie why you need a new code.' : 'Tell Gnomie what happened.');
  const game = String(b.game || '').slice(0, 40) || null;
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM fan_requests WHERE wallet_id = ? AND kind = ? AND status = 'open'").bind(w.id, b.kind).first();
  if (open.n >= (b.kind === 'new_code' ? 1 : 3)) throw new Oops(b.kind === 'new_code' ? 'You already asked for a new code. Gnomie will get to it soon.' : 'You already have 3 reports waiting. Gnomie will get to them soon.');
  await env.DB.prepare('INSERT INTO fan_requests (wallet_id, kind, game, note, created_at) VALUES (?, ?, ?, ?, ?)').bind(w.id, b.kind, game, note, Date.now()).run();
  await logEvent(env, request, b.kind === 'new_code' ? 'new_code_requested' : 'issue_reported', w.id, (game ? game + ': ' : '') + note.slice(0, 200));
  const rows = (await env.DB.prepare('SELECT * FROM fan_requests WHERE wallet_id = ? ORDER BY id DESC LIMIT 10').bind(w.id).all()).results;
  return json({ rows: rows.map(publicRequest) });
};

// ---------- nudges ----------
routes['POST nudge/seen'] = async (env, request) => {
  const w = await needWallet(env, request);
  const { id } = await readJson(request);
  const r = await env.DB.prepare('UPDATE nudges SET seen_at = ? WHERE id = ? AND wallet_id = ? AND seen_at IS NULL').bind(Date.now(), id, w.id).run();
  if (r.meta.changes === 1) await logEvent(env, request, 'nudge_seen', w.id, 'Nudge #' + id);
  return json({ ok: true });
};

// Close a nudge, optionally answering it: "I'm taking a break" or "I promise I'll do better"
routes['POST nudge/close'] = async (env, request) => {
  const w = await needWallet(env, request);
  const { id, response } = await readJson(request);
  const now = Date.now(), answer = response === 'break' || response === 'promise' ? response : 'closed';
  const r = await env.DB.prepare('UPDATE nudges SET closed_at = ?, seen_at = COALESCE(seen_at, ?), response = ? WHERE id = ? AND wallet_id = ? AND closed_at IS NULL').bind(now, now, answer, id, w.id).run();
  if (answer === 'break') await env.DB.prepare('INSERT OR IGNORE INTO breaks (wallet_id, created_at) VALUES (?, ?)').bind(w.id, now).run();
  if (r.meta.changes === 1) await logEvent(env, request, answer === 'break' ? 'nudge_break' : answer === 'promise' ? 'nudge_promise' : 'nudge_closed', w.id, 'Nudge #' + id);
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// Local testing only (never turned on in Cloudflare)
routes['POST test-credit'] = async (env, request) => {
  if (env.ALLOW_TEST_CREDIT !== '1') throw new Oops('Not found.', 404);
  const w = await needWallet(env, request);
  const { cents } = await readJson(request);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100000) throw new Oops('Bad amount.');
  await env.DB.batch([
    env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?').bind(cents, cents, w.id),
    env.DB.prepare('INSERT INTO adjustments (wallet_id, cents, kind, note, public, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(w.id, cents, 'load', 'Test credit', Date.now())
  ]);
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// ---------- routes: Drop the Ball ----------
routes['POST drop'] = async (env, request) => {
  let w = await needWallet(env, request);
  const body = await readJson(request);
  const boardKey = String(body.board || '');
  if (body.game !== 'drop-the-ball') throw new Oops('Unknown game.');
  if (!BOARDS[boardKey]) throw new Oops('Unknown board.');
  const aim = Math.max(-6, Math.min(6, Math.round(Number(body.aim) || 0)));

  for (let attempt = 0; attempt < 5; attempt++) {
    if (w.balance_cents <= 0) throw new Oops('Your wallet is empty.');
    if (w.balance_cents < BOARDS[boardKey].unlockCents) throw new Oops('That board is locked for your wallet.');
    const result = dropPath(aim);
    const loss = Math.min(slotValue(boardKey, result.slot), w.balance_cents);
    if (await changeBalance(env.DB, w.id, w.balance_cents, -loss, loss)) {
      await env.DB.prepare('INSERT INTO drops (wallet_id, game, board, aim, path, slot, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(w.id, 'drop-the-ball', boardKey, aim, result.path.join(','), result.slot, loss, Date.now()).run();
      return json({ path: result.path, slot: result.slot, lossCents: loss, wallet: publicWallet(await walletById(env.DB, w.id)) });
    }
    w = await walletById(env.DB, w.id); // balance changed under us; look again
  }
  throw new Oops('Busy. Please try again.', 409);
};

// Games without Sweet/Spicy/Savage boards take any amount the fan types: $1 to $500
function validAmount(a) { return Number.isInteger(a) && a >= 100 && a <= 50000; }

// ---------- routes: Dice Duel ----------
function publicDuel(row, state) {
  if (!row) return null;
  return {
    amount: row.amount_cents, held: row.held_cents,
    player: cloneBoard(state.player), gnome: cloneBoard(state.gnome), die: state.die,
    youScore: boardScore(state.player), gnomieScore: boardScore(state.gnome)
  };
}
async function activeDuel(db, walletId) {
  const row = await db.prepare("SELECT * FROM duels WHERE wallet_id = ? AND status = 'active'").bind(walletId).first();
  return row ? { row, state: JSON.parse(row.state) } : null;
}

routes['GET duel'] = async (env, request) => {
  const w = await needWallet(env, request);
  const d = await activeDuel(env.DB, w.id);
  return json({ duel: d ? publicDuel(d.row, d.state) : null });
};

routes['POST duel/start'] = async (env, request) => {
  let w = await needWallet(env, request);
  const amount = (await readJson(request)).amount;
  if (!validAmount(amount)) throw new Oops('Pick an amount from $1.00 to $500.00.');
  const hold = amount * DUEL.PAY.lose;
  if (w.balance_cents < hold) throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
  const state = { player: emptyBoard(), gnome: emptyBoard(), die: null };
  // The "one game at a time" rule is enforced by the database itself
  let ins;
  try {
    ins = await env.DB.prepare('INSERT INTO duels (wallet_id, amount_cents, held_cents, state, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(w.id, amount, hold, JSON.stringify(state), 'active', Date.now()).run();
  } catch (e) { throw new Oops('Finish your current game first.'); }
  const duelId = ins.meta.last_row_id;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (w.balance_cents < hold) break;
    if (await changeBalance(env.DB, w.id, w.balance_cents, -hold, 0)) {
      const d = await activeDuel(env.DB, w.id);
      return json({ duel: publicDuel(d.row, d.state), wallet: publicWallet(await walletById(env.DB, w.id)) });
    }
    w = await walletById(env.DB, w.id);
  }
  await env.DB.prepare('DELETE FROM duels WHERE id = ?').bind(duelId).run();
  throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
};

routes['POST duel/roll'] = async (env, request) => {
  const w = await needWallet(env, request);
  const d = await activeDuel(env.DB, w.id);
  if (!d) throw new Oops('No game in progress.');
  if (!d.state.die) {
    const next = Object.assign({}, d.state, { die: rollDie() });
    const r = await env.DB.prepare("UPDATE duels SET state = ? WHERE id = ? AND state = ? AND status = 'active'")
      .bind(JSON.stringify(next), d.row.id, d.row.state).run();
    if (r.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
    d.state = next;
  }
  return json({ duel: publicDuel(d.row, d.state) });
};

routes['POST duel/place'] = async (env, request) => {
  let w = await needWallet(env, request);
  const col = (await readJson(request)).col;
  const d = await activeDuel(env.DB, w.id);
  if (!d) throw new Oops('No game in progress.');
  const s = { player: cloneBoard(d.state.player), gnome: cloneBoard(d.state.gnome), die: d.state.die };
  if (!s.die) throw new Oops('Roll first.');
  if (openColumns(s.player).indexOf(col) === -1) throw new Oops('That column is full.');

  const out = { you: { col, die: s.die, knocked: placeDie(s.player, s.gnome, col, s.die) } };
  if (!boardFull(s.player)) {
    const gd = rollDie(), gc = gnomieChoose(s.gnome, s.player, gd);
    out.gnomie = { col: gc, die: gd, knocked: placeDie(s.gnome, s.player, gc, gd) };
  }
  s.die = null;

  if (boardFull(s.player) || boardFull(s.gnome)) {
    const ps = boardScore(s.player), gs = boardScore(s.gnome);
    const outcome = ps > gs ? 'win' : ps === gs ? 'tie' : 'lose';
    const pay = Math.round(d.row.amount_cents * DUEL.PAY[outcome]);
    const r = await env.DB.prepare(
      "UPDATE duels SET state = ?, status = 'done', outcome = ?, you_score = ?, gnomie_score = ?, paid_cents = ?, finished_at = ? WHERE id = ? AND state = ? AND status = 'active'"
    ).bind(JSON.stringify(s), outcome, ps, gs, pay, Date.now(), d.row.id, d.row.state).run();
    if (r.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
    // Give back the part of the set-aside amount they don't pay
    await env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_drained_cents = total_drained_cents + ? WHERE id = ?')
      .bind(d.row.held_cents - pay, pay, w.id).run();
    out.result = { outcome, you: ps, gnomie: gs, paidCents: pay, amount: d.row.amount_cents };
    out.final = publicDuel(d.row, s);
  } else {
    const r = await env.DB.prepare("UPDATE duels SET state = ? WHERE id = ? AND state = ? AND status = 'active'")
      .bind(JSON.stringify(s), d.row.id, d.row.state).run();
    if (r.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
    out.duel = publicDuel(d.row, s);
  }
  out.wallet = publicWallet(await walletById(env.DB, w.id));
  return json(out);
};

// ---------- routes: Too Far ----------
function publicTooFar(row, st) {
  if (!row) return null;
  return {
    amount: row.amount_cents, held: row.held_cents,
    you: st.you.map(c => ({ v: c.v })), gnomie: st.gnomie.map(c => ({ v: c.v })),
    youTotal: handTotal(st.you), gnomieTotal: handTotal(st.gnomie), gnomieStayed: !!st.gnomieStayed
  };
}
async function activeTooFar(db, walletId) {
  const row = await db.prepare("SELECT * FROM toofar WHERE wallet_id = ? AND status = 'active'").bind(walletId).first();
  return row ? { row, st: JSON.parse(row.state) } : null;
}
function tooFarPays(amount) {
  return { win: amount * TOOFAR.PAY.win, tie: Math.round(amount * TOOFAR.PAY.tie), lose: amount * TOOFAR.PAY.lose, bust: Math.round(amount * TOOFAR.PAY.bust) };
}
// Ends the game: saves the outcome and gives back what they don't pay.
async function finishTooFar(env, g, st, outcome) {
  const you = handTotal(st.you), gn = handTotal(st.gnomie);
  const pay = tooFarPays(g.row.amount_cents)[outcome === 'gnomie_bust' ? 'win' : outcome];
  const saved = outcome === 'gnomie_bust' ? 'win' : outcome;
  const r = await env.DB.prepare(
    "UPDATE toofar SET state = ?, status = 'done', outcome = ?, you_total = ?, gnomie_total = ?, paid_cents = ?, finished_at = ? WHERE id = ? AND state = ? AND status = 'active'"
  ).bind(JSON.stringify(st), saved, you, gn, pay, Date.now(), g.row.id, g.row.state).run();
  if (r.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
  await env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_drained_cents = total_drained_cents + ? WHERE id = ?')
    .bind(g.row.held_cents - pay, pay, g.row.wallet_id).run();
  return { outcome, you, gnomie: gn, paidCents: pay, amount: g.row.amount_cents };
}

routes['GET toofar'] = async (env, request) => {
  const w = await needWallet(env, request);
  const g = await activeTooFar(env.DB, w.id);
  return json({ game: g ? publicTooFar(g.row, g.st) : null });
};

routes['POST toofar/start'] = async (env, request) => {
  let w = await needWallet(env, request);
  const amount = Math.round(Number((await readJson(request)).amount));
  if (!Number.isInteger(amount) || amount < TOOFAR.MIN_CENTS || amount > TOOFAR.MAX_CENTS) throw new Oops('Pick an amount from ' + money(TOOFAR.MIN_CENTS) + ' to ' + money(TOOFAR.MAX_CENTS) + '.');
  const hold = Math.round(amount * TOOFAR.PAY.bust);
  if (w.balance_cents < hold) throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
  const deck = newDeck();
  // Your first two cards can never start you over the target:
  // if they would, the second card goes back under the deck and you get the next one.
  const first = deck.pop();
  let second = deck.pop();
  while (first + second > TOOFAR.TARGET) { deck.unshift(second); second = deck.pop(); }
  const st = { deck, you: [{ v: first }, { v: second }], gnomie: [{ v: deck.pop() }] };
  let ins;
  try {
    ins = await env.DB.prepare('INSERT INTO toofar (wallet_id, amount_cents, held_cents, state, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(w.id, amount, hold, JSON.stringify(st), 'active', Date.now()).run();
  } catch (e) { throw new Oops('Finish your current game first.'); }
  for (let attempt = 0; attempt < 5; attempt++) {
    if (w.balance_cents < hold) break;
    if (await changeBalance(env.DB, w.id, w.balance_cents, -hold, 0)) {
      const g = await activeTooFar(env.DB, w.id);
      return json({ game: publicTooFar(g.row, g.st), wallet: publicWallet(await walletById(env.DB, w.id)) });
    }
    w = await walletById(env.DB, w.id);
  }
  await env.DB.prepare('DELETE FROM toofar WHERE id = ?').bind(ins.meta.last_row_id).run();
  throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
};

// Taking turns: you draw (or stay), then Gnomie takes her turn by her own rule
// (kept on the server). Once she stops, she stays stopped. Going over ends it.
function gnomieTurn(st) {
  if (st.gnomieStayed) return { stayed: true, already: true };
  if (handTotal(st.gnomie) >= TOOFAR.GNOMIE_STOPS) { st.gnomieStayed = true; return { stayed: true }; }
  const card = { v: st.deck.pop() };
  st.gnomie.push(card);
  if (handTotal(st.gnomie) >= TOOFAR.GNOMIE_STOPS && handTotal(st.gnomie) <= TOOFAR.TARGET) st.gnomieStayed = true;
  return { card, stayed: !!st.gnomieStayed };
}
function copyState(st) { return { deck: st.deck.slice(), you: st.you.slice(), gnomie: st.gnomie.slice(), gnomieStayed: !!st.gnomieStayed }; }
function tooFarOutcome(st) {
  const you = handTotal(st.you), gn = handTotal(st.gnomie);
  return gn > TOOFAR.TARGET ? 'gnomie_bust' : you > gn ? 'win' : you === gn ? 'tie' : 'lose';
}

routes['POST toofar/draw'] = async (env, request) => {
  const w = await needWallet(env, request);
  const g = await activeTooFar(env.DB, w.id);
  if (!g) throw new Oops('No game in progress.');
  const st = copyState(g.st);
  if (handTotal(st.you) >= TOOFAR.TARGET) throw new Oops('You’re already at ' + TOOFAR.TARGET + '. Stay to finish.');
  const card = { v: st.deck.pop() };
  st.you.push(card);
  const out = { card };
  if (handTotal(st.you) > TOOFAR.TARGET) {
    out.result = await finishTooFar(env, g, st, 'bust');
    out.final = publicTooFar(g.row, st);
  } else {
    out.gnomie = gnomieTurn(st);
    if (handTotal(st.gnomie) > TOOFAR.TARGET) {
      out.result = await finishTooFar(env, g, st, 'gnomie_bust');
      out.final = publicTooFar(g.row, st);
    } else {
      const r = await env.DB.prepare("UPDATE toofar SET state = ? WHERE id = ? AND state = ? AND status = 'active'")
        .bind(JSON.stringify(st), g.row.id, g.row.state).run();
      if (r.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
      out.game = publicTooFar(g.row, st);
    }
  }
  out.wallet = publicWallet(await walletById(env.DB, w.id));
  return json(out);
};

// You stay: Gnomie keeps taking her turns until she stops (or goes over)
routes['POST toofar/stay'] = async (env, request) => {
  const w = await needWallet(env, request);
  const g = await activeTooFar(env.DB, w.id);
  if (!g) throw new Oops('No game in progress.');
  const st = copyState(g.st);
  const drawn = [];
  while (!st.gnomieStayed && handTotal(st.gnomie) <= TOOFAR.TARGET) {
    const t = gnomieTurn(st);
    if (t.card) drawn.push(t.card);
  }
  const result = await finishTooFar(env, g, st, tooFarOutcome(st));
  return json({ gnomieDrew: drawn, result, final: publicTooFar(g.row, st), wallet: publicWallet(await walletById(env.DB, w.id)) });
};

// ---------- routes: Mancala ----------
function publicMancala(row, st) {
  if (!row) return null;
  return { amount: row.amount_cents, held: row.held_cents, pits: st.pits.slice(), beads: st.beads || mancalaBeadsFromPits(st.pits), turn: st.turn };
}
async function activeMancala(db, walletId) {
  const row = await db.prepare("SELECT * FROM mancala WHERE wallet_id = ? AND status = 'active'").bind(walletId).first();
  return row ? { row, st: JSON.parse(row.state) } : null;
}
async function finishMancala(env, g, st) {
  const you = st.pits[6], gn = st.pits[13];
  const outcome = you > gn ? 'win' : you === gn ? 'tie' : 'lose';
  const pay = Math.round(g.row.amount_cents * MANCALA.PAY[outcome]);
  const r = await env.DB.prepare(
    "UPDATE mancala SET state = ?, status = 'done', outcome = ?, you_score = ?, gnomie_score = ?, paid_cents = ?, finished_at = ? WHERE id = ? AND state = ? AND status = 'active'"
  ).bind(JSON.stringify(st), outcome, you, gn, pay, Date.now(), g.row.id, g.row.state).run();
  if (r.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
  await env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_drained_cents = total_drained_cents + ? WHERE id = ?')
    .bind(g.row.held_cents - pay, pay, g.row.wallet_id).run();
  return { outcome, you, gnomie: gn, paidCents: pay, amount: g.row.amount_cents };
}

routes['GET mancala'] = async (env, request) => {
  const w = await needWallet(env, request);
  const g = await activeMancala(env.DB, w.id);
  return json({ game: g ? publicMancala(g.row, g.st) : null });
};

routes['POST mancala/start'] = async (env, request) => {
  let w = await needWallet(env, request);
  const amount = (await readJson(request)).amount;
  if (!validAmount(amount)) throw new Oops('Pick an amount from $1.00 to $500.00.');
  const hold = amount * MANCALA.PAY.lose;
  if (w.balance_cents < hold) throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
  const st = { pits: mancalaStart(), beads: mancalaBeadsStart(), turn: 'you' };
  let ins;
  try {
    ins = await env.DB.prepare('INSERT INTO mancala (wallet_id, amount_cents, held_cents, state, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(w.id, amount, hold, JSON.stringify(st), 'active', Date.now()).run();
  } catch (e) { throw new Oops('Finish your current game first.'); }
  for (let attempt = 0; attempt < 5; attempt++) {
    if (w.balance_cents < hold) break;
    if (await changeBalance(env.DB, w.id, w.balance_cents, -hold, 0)) {
      const g = await activeMancala(env.DB, w.id);
      return json({ game: publicMancala(g.row, g.st), wallet: publicWallet(await walletById(env.DB, w.id)) });
    }
    w = await walletById(env.DB, w.id);
  }
  await env.DB.prepare('DELETE FROM mancala WHERE id = ?').bind(ins.meta.last_row_id).run();
  throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
};

// Your move, then (unless you earned another turn) Gnomie's moves until it's your turn again
routes['POST mancala/move'] = async (env, request) => {
  const w = await needWallet(env, request);
  const g = await activeMancala(env.DB, w.id);
  if (!g) throw new Oops('No game in progress.');
  const pit = (await readJson(request)).pit;
  const st = { pits: g.st.pits.slice(), beads: g.st.beads || mancalaBeadsFromPits(g.st.pits), turn: g.st.turn };
  if (st.turn !== 'you') throw new Oops('It’s Gnomie’s turn.');
  if (!Number.isInteger(pit) || pit < 0 || pit > 5 || st.pits[pit] === 0) throw new Oops('Pick one of your pits that has stones.');
  const moves = [];
  let r = mancalaMove(st.pits, 'you', pit);
  moves.push({ side: 'you', pit, capture: r.capture, again: r.again });
  st.pits = r.pits; st.beads = mancalaBeadMove(st.beads, 'you', pit);
  let over = r.over;
  if (!over && !r.again) {
    st.turn = 'gnomie';
    for (let guard = 0; guard < 40 && !over && st.turn === 'gnomie'; guard++) {
      const m = gnomieMancala(st.pits);
      const gr = mancalaMove(st.pits, 'gnomie', m);
      moves.push({ side: 'gnomie', pit: m, capture: gr.capture, again: gr.again });
      st.pits = gr.pits; st.beads = mancalaBeadMove(st.beads, 'gnomie', m); over = gr.over;
      if (!gr.again) st.turn = 'you';
    }
  }
  const out = { moves };
  if (over) {
    out.result = await finishMancala(env, g, st);
    out.final = publicMancala(g.row, st);
  } else {
    st.turn = 'you';
    const u = await env.DB.prepare("UPDATE mancala SET state = ? WHERE id = ? AND state = ? AND status = 'active'").bind(JSON.stringify(st), g.row.id, g.row.state).run();
    if (u.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
    out.game = publicMancala(g.row, st);
  }
  out.wallet = publicWallet(await walletById(env.DB, w.id));
  return json(out);
};

// ---------- routes: 5 in a Row ----------
function publicFive(row, st) {
  if (!row) return null;
  return { amount: row.amount_cents, held: row.held_cents, board: st.board.map(c => c.slice()) };
}
async function activeFive(db, walletId) {
  const row = await db.prepare("SELECT * FROM fiverow WHERE wallet_id = ? AND status = 'active'").bind(walletId).first();
  return row ? { row, st: JSON.parse(row.state) } : null;
}
async function finishFive(env, g, st, outcome) {
  const pay = Math.round(g.row.amount_cents * FIVE.PAY[outcome]);
  const moves = st.board.reduce((s, c) => s + c.length, 0);
  const r = await env.DB.prepare(
    "UPDATE fiverow SET state = ?, status = 'done', outcome = ?, moves = ?, paid_cents = ?, finished_at = ? WHERE id = ? AND state = ? AND status = 'active'"
  ).bind(JSON.stringify(st), outcome, moves, pay, Date.now(), g.row.id, g.row.state).run();
  if (r.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
  await env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_drained_cents = total_drained_cents + ? WHERE id = ?')
    .bind(g.row.held_cents - pay, pay, g.row.wallet_id).run();
  return { outcome, paidCents: pay, amount: g.row.amount_cents };
}

routes['GET five'] = async (env, request) => {
  const w = await needWallet(env, request);
  const g = await activeFive(env.DB, w.id);
  return json({ game: g ? publicFive(g.row, g.st) : null });
};

routes['POST five/start'] = async (env, request) => {
  let w = await needWallet(env, request);
  const amount = (await readJson(request)).amount;
  if (!validAmount(amount)) throw new Oops('Pick an amount from $1.00 to $500.00.');
  const hold = amount * FIVE.PAY.lose;
  if (w.balance_cents < hold) throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
  const st = { board: fiveStart() };
  let ins;
  try {
    ins = await env.DB.prepare('INSERT INTO fiverow (wallet_id, amount_cents, held_cents, state, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(w.id, amount, hold, JSON.stringify(st), 'active', Date.now()).run();
  } catch (e) { throw new Oops('Finish your current game first.'); }
  for (let attempt = 0; attempt < 5; attempt++) {
    if (w.balance_cents < hold) break;
    if (await changeBalance(env.DB, w.id, w.balance_cents, -hold, 0)) {
      const g = await activeFive(env.DB, w.id);
      return json({ game: publicFive(g.row, g.st), wallet: publicWallet(await walletById(env.DB, w.id)) });
    }
    w = await walletById(env.DB, w.id);
  }
  await env.DB.prepare('DELETE FROM fiverow WHERE id = ?').bind(ins.meta.last_row_id).run();
  throw new Oops('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amount) + '.');
};

// Your piece, then Gnomie's (unless the game just ended)
routes['POST five/move'] = async (env, request) => {
  const w = await needWallet(env, request);
  const g = await activeFive(env.DB, w.id);
  if (!g) throw new Oops('No game in progress.');
  const col = (await readJson(request)).col;
  if (!Number.isInteger(col) || fiveOpenCols(g.st.board).indexOf(col) === -1) throw new Oops('Pick a column that has room.');
  const st = { board: g.st.board };
  const out = {};
  const mine = fiveDrop(st.board, col, 'y'); st.board = mine.board;
  out.you = { col, row: mine.row };
  let line = fiveLine(st.board, col, mine.row), outcome = line ? 'win' : fiveFull(st.board) ? 'tie' : null;
  if (!outcome) {
    const c = gnomieFive(st.board), hers = fiveDrop(st.board, c, 'g'); st.board = hers.board;
    out.gnomie = { col: c, row: hers.row };
    line = fiveLine(st.board, c, hers.row);
    outcome = line ? 'lose' : fiveFull(st.board) ? 'tie' : null;
  }
  if (outcome) {
    out.result = await finishFive(env, g, st, outcome);
    out.line = line;
    out.final = publicFive(g.row, st);
  } else {
    const u = await env.DB.prepare("UPDATE fiverow SET state = ? WHERE id = ? AND state = ? AND status = 'active'").bind(JSON.stringify(st), g.row.id, g.row.state).run();
    if (u.meta.changes !== 1) throw new Oops('Busy. Please try again.', 409);
    out.game = publicFive(g.row, st);
  }
  out.wallet = publicWallet(await walletById(env.DB, w.id));
  return json(out);
};

// ---------- routes: Spin the Bottle ----------
routes['POST bottle/spin'] = async (env, request) => {
  let w = await needWallet(env, request);
  const body = await readJson(request);
  const boardKey = String(body.board || ''), pick = body.pick;
  if (!BOTTLE[boardKey]) throw new Oops('Unknown board.');
  if (!Number.isInteger(pick) || pick < 0 || pick > 7) throw new Oops('Pick a wedge first.');
  const slices = BOTTLE[boardKey].slices, worst = 2 * Math.max(...slices);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (w.balance_cents < worst) throw new Oops('Your wallet needs at least ' + money(worst) + ' for this board (double the biggest wedge).');
    // Secret wedge order, then the spin; both decided here, never on the page
    const order = shuffledOrder(8), amounts = order.map(i => slices[i]);
    const slot = spinSlice(), hit = slot === pick, pay = hit ? amounts[slot] * 2 : amounts[slot];
    if (await changeBalance(env.DB, w.id, w.balance_cents, -pay, pay)) {
      await env.DB.prepare('INSERT INTO drops (wallet_id, game, board, aim, path, slot, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(w.id, 'spin-the-bottle', boardKey, pick, order.join(',') + (hit ? '|hit' : ''), slot, pay, Date.now()).run();
      return json({ slot, hit, amounts, sliceCents: amounts[slot], paidCents: pay, wallet: publicWallet(await walletById(env.DB, w.id)) });
    }
    w = await walletById(env.DB, w.id);
  }
  throw new Oops('Busy. Please try again.', 409);
};

// ---------- routes: leaderboards ----------
// Only rank, name and how long they've held their spot ever leave the server.
const BOARD_SQL = {
  'all': `SELECT id AS wallet_id, total_drained_cents AS score FROM wallets WHERE total_drained_cents > 0 AND status = 'active'`,
  'drop-the-ball': `SELECT d.wallet_id, SUM(d.amount_cents) AS score FROM drops d JOIN wallets w ON w.id = d.wallet_id
                    WHERE d.game = 'drop-the-ball' AND w.status = 'active' GROUP BY d.wallet_id HAVING score > 0`,
  'dice-duel': `SELECT d.wallet_id, SUM(d.paid_cents) AS score FROM duels d JOIN wallets w ON w.id = d.wallet_id
                WHERE d.status = 'done' AND w.status = 'active' GROUP BY d.wallet_id HAVING score > 0`,
  'too-far': `SELECT t.wallet_id, SUM(t.paid_cents) AS score FROM toofar t JOIN wallets w ON w.id = t.wallet_id
              WHERE t.status = 'done' AND w.status = 'active' GROUP BY t.wallet_id HAVING score > 0`,
  'too-far-wins': `SELECT t.wallet_id, COUNT(*) AS score FROM toofar t JOIN wallets w ON w.id = t.wallet_id
                   WHERE t.outcome = 'win' AND w.status = 'active' GROUP BY t.wallet_id`,
  'spin-the-bottle': `SELECT d.wallet_id, SUM(d.amount_cents) AS score FROM drops d JOIN wallets w ON w.id = d.wallet_id
                      WHERE d.game = 'spin-the-bottle' AND w.status = 'active' GROUP BY d.wallet_id HAVING score > 0`,
  'five-in-a-row': `SELECT f.wallet_id, SUM(f.paid_cents) AS score FROM fiverow f JOIN wallets w ON w.id = f.wallet_id
                    WHERE f.status = 'done' AND w.status = 'active' GROUP BY f.wallet_id HAVING score > 0`,
  'five-in-a-row-wins': `SELECT f.wallet_id, COUNT(*) AS score FROM fiverow f JOIN wallets w ON w.id = f.wallet_id
                         WHERE f.outcome = 'win' AND w.status = 'active' GROUP BY f.wallet_id`,
  'mancala': `SELECT m.wallet_id, SUM(m.paid_cents) AS score FROM mancala m JOIN wallets w ON w.id = m.wallet_id
              WHERE m.status = 'done' AND w.status = 'active' GROUP BY m.wallet_id HAVING score > 0`,
  'mancala-wins': `SELECT m.wallet_id, COUNT(*) AS score FROM mancala m JOIN wallets w ON w.id = m.wallet_id
                   WHERE m.outcome = 'win' AND w.status = 'active' GROUP BY m.wallet_id`,
  'dice-duel-wins': `SELECT d.wallet_id, COUNT(*) AS score FROM duels d JOIN wallets w ON w.id = d.wallet_id
                     WHERE d.outcome = 'win' AND w.status = 'active' GROUP BY d.wallet_id`
};

// Spoof wallets can sit on the leaderboards, but any real player who has put in
// at least the threshold (default $3; 1 win on the "wins" boards) ranks above
// every spoof. Real players under the threshold rank below the spoofs.
async function spoofThreshold(db) {
  try { const r = await db.prepare("SELECT value FROM backstage WHERE key = 'spoof_threshold_cents'").first(); return r ? Number(r.value) : 300; } catch (e) { return 300; }
}
async function rankedBoard(db, key) {
  const threshold = /-wins$/.test(key) ? 1 : await spoofThreshold(db);
  return (await db.prepare(
    `SELECT s.wallet_id, s.score, w.name, w.anon_number, (SELECT p.color FROM wallet_prefs p WHERE p.wallet_id = w.id) AS color,
       ((SELECT COUNT(*) FROM loads l WHERE l.wallet_id = w.id AND l.status = 'credited' AND l.amount_cents >= 2000) +
        (SELECT COUNT(*) FROM adjustments j WHERE j.wallet_id = w.id AND j.kind = 'load' AND j.cents >= 2000) +
        COALESCE((SELECT u.bonus FROM color_unlocks u WHERE u.wallet_id = w.id), 0) +
        (CASE WHEN EXISTS (SELECT 1 FROM spoofs x WHERE x.wallet_id = w.id) THEN 99 ELSE 0 END)) AS load_count,
       (SELECT 1 FROM spoofs x WHERE x.wallet_id = w.id) AS spoof
     FROM (${BOARD_SQL[key]}) s JOIN wallets w ON w.id = s.wallet_id
     ORDER BY CASE WHEN EXISTS (SELECT 1 FROM spoofs x WHERE x.wallet_id = s.wallet_id) THEN 1 WHEN s.score >= ? THEN 0 ELSE 2 END, s.score DESC, s.wallet_id ASC LIMIT 1000`
  ).bind(threshold).all()).results;
}

routes['GET leaderboard'] = async (env, request, url) => {
  const key = url.searchParams.get('board') || 'all';
  if (!BOARD_SQL[key]) throw new Oops('Unknown board.');
  const db = env.DB, now = Date.now();
  const me = await sessionWallet(env, request);
  const all = await rankedBoard(db, key);
  const top = all.slice(0, 10);

  // Track how long each of the top 3 has held their spot
  const open = (await db.prepare('SELECT * FROM reigns WHERE board_key = ? AND ended_at IS NULL').bind(key).all()).results;
  const since = {}, stmts = [];
  for (let rank = 1; rank <= 3; rank++) {
    const holder = top[rank - 1], current = open.find(r => r.rank === rank);
    if (current && holder && current.wallet_id === holder.wallet_id) { since[rank] = current.started_at; continue; }
    if (current) stmts.push(db.prepare('UPDATE reigns SET ended_at = ? WHERE id = ?').bind(now, current.id));
    if (holder) {
      stmts.push(db.prepare('INSERT INTO reigns (board_key, rank, wallet_id, started_at) VALUES (?, ?, ?, ?)').bind(key, rank, holder.wallet_id, now));
      since[rank] = now;
    }
  }
  if (stmts.length) await db.batch(stmts);

  const nameOf = r => r.name || ('Anonymous #' + r.anon_number);
  const rows = top.map((r, i) => ({
    rank: i + 1, name: nameOf(r), color: colorOf(r),
    reignDays: Math.max(1, Math.round((now - (since[i + 1] || now)) / DAY)),
    me: !!me && r.wallet_id === me.id
  }));
  // Your own spot, even if you're not in the top 10
  if (me && !rows.some(r => r.me)) {
    const at = all.findIndex(r => r.wallet_id === me.id);
    if (at !== -1) rows.push({ rank: at + 1, name: nameOf(me), color: colorOf(me), reignDays: 1, me: true });
  }
  return json({ rows });
};

// ---------- payment notices ----------
// Credits a load to the wallet whose code is in the message. Anything unclear
// is saved as "needs review" for the admin page instead of being guessed.
async function recordLoad(env, request, load) {
  const db = env.DB, now = Date.now();
  let wallet = null;
  const candidates = codeCandidates(load.message);
  for (let i = 0; i < candidates.length && !wallet; i += 90) {
    const chunk = candidates.slice(i, i + 90);
    wallet = await db.prepare(`SELECT id FROM wallets WHERE code IN (${chunk.map(() => '?').join(',')}) LIMIT 1`).bind(...chunk).first();
  }
  const ok = wallet && Number.isInteger(load.amountCents) && load.amountCents > 0;
  const ins = await db.prepare(
    `INSERT OR IGNORE INTO loads (platform, external_id, wallet_id, amount_cents, paid_cents, currency, gifter, message, item_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(load.platform, load.externalId, wallet ? wallet.id : null, load.amountCents || 0, load.paidCents ?? null,
         load.currency || null, (load.gifter || '').slice(0, 100), (load.message || '').slice(0, 1000),
         (load.itemName || '').slice(0, 200), ok ? 'credited' : 'needs_review', now, now).run();
  const label = (load.platform === 'youpay' ? 'YouPay' : 'Throne') + ' ' + (load.amountCents ? money(load.amountCents) : '(amount unclear)') + (load.gifter ? ' from ' + load.gifter : '');
  if (ins.meta.changes !== 1) { await logEvent(env, request, 'load_duplicate', wallet ? wallet.id : null, label + ' (already counted)'); return 'duplicate'; }
  if (!ok) { await logEvent(env, request, 'load_needs_review', wallet ? wallet.id : null, label + (wallet ? ' (amount unclear)' : ' (no wallet code found)')); return 'needs_review'; }
  await db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?')
    .bind(load.amountCents, load.amountCents, wallet.id).run();
  await logEvent(env, request, 'load_credited', wallet.id, label);
  return 'credited';
}

async function logNote(db, action, walletId, detail) {
  await db.prepare('INSERT INTO admin_log (action, wallet_id, detail, created_at) VALUES (?, ?, ?, ?)')
    .bind(action, walletId, String(detail).slice(0, 8000), Date.now()).run();
}

routes['POST webhooks/throne'] = async (env, request) => {
  const raw = await request.text();
  if (raw.length > 100000) return json({ error: 'too big' }, 413);
  // Record every arrival before any checks, so Backstage shows whether Throne got through
  const h = request.headers;
  await logEvent(env, request, 'notice_received', null, 'Throne · ' + raw.length + ' bytes · timestamp ' + (h.get('x-signature-timestamp') || 'missing') +
    ' · signature ' + ((h.get('x-signature-ed25519') || '').length || 'missing') + ' chars · ' + (h.get('user-agent') || 'no user agent').slice(0, 60));
  let genuine = false;
  try { genuine = await verifyThrone(request, raw, env.THRONE_TEST_PUBLIC_KEY); }
  catch (e) { await logEvent(env, request, 'notice_error', null, 'Throne signature check crashed: ' + (e && e.message)); return json({ error: 'check failed' }, 500); }
  if (!genuine) {
    await logEvent(env, request, 'notice_rejected', null, 'Throne notice failed the signature check (fake, altered or too old)');
    return json({ error: 'bad signature' }, 401);
  }
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400); }
  const t = parseThrone(body);
  if (!t.isLoad) { // a normal gift, not a wallet load
    await logEvent(env, request, 'throne_gift', null, (t.itemName || t.type) + (t.gifter ? ' from ' + t.gifter : ''));
    return json({ ok: true, ignored: true });
  }
  const status = await recordLoad(env, request, {
    platform: 'throne', externalId: t.eventId || ('raw:' + await sha256(raw)),
    amountCents: t.amountCents, paidCents: t.paidCents, currency: t.currency,
    gifter: t.gifter, message: t.message, itemName: t.itemName
  });
  return json({ ok: true, status });
};

routes['POST webhooks/youpay'] = async (env, request) => {
  const raw = await request.text();
  if (raw.length > 100000) return json({ error: 'too big' }, 413);
  if (!(await verifyYouPay(request, raw, env.YOUPAY_SIGNING_SECRET))) {
    await logEvent(env, request, 'notice_rejected', null, env.YOUPAY_SIGNING_SECRET ? 'YouPay notice failed the signature check (fake, altered or too old)' : 'YouPay notice arrived but the signing secret is not set up yet');
    return json({ error: 'bad signature' }, 401);
  }
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400); }
  // YouPay's layout isn't documented, so keep a copy of every notice for checking
  await logNote(env.DB, 'youpay_notice', null, raw);
  const y = parseYouPay(body);
  const externalId = y.eventId || ('raw:' + await sha256(raw));

  if (y.status === 'fulfilled') {
    // Normal YouPay gifts also send notices. It's only a wallet load if it came
    // from one of the load links or has a wallet code in it.
    const text = (y.message || '') + ' ' + y.allText;
    let hasCode = false;
    const cands = codeCandidates(text);
    for (let i = 0; i < cands.length && !hasCode; i += 90) {
      const chunk = cands.slice(i, i + 90);
      hasCode = !!(await env.DB.prepare(`SELECT 1 FROM wallets WHERE code IN (${chunk.map(() => '?').join(',')}) LIMIT 1`).bind(...chunk).first());
    }
    if (!y.fromLoadLink && !hasCode) {
      await logEvent(env, request, 'youpay_gift', null, 'Order ' + externalId + (y.gifter ? ' from ' + y.gifter : '') + ' (not a wallet load)');
      return json({ ok: true, ignored: true });
    }
    const status = await recordLoad(env, request, {
      platform: 'youpay', externalId, amountCents: y.amountCents,
      gifter: y.gifter, message: y.message || y.allText, itemName: ''
    });
    return json({ ok: true, status });
  }
  if (y.status === 'refunded' || y.status === 'chargeback') {
    // Take the load back off the wallet (the balance can go below zero)
    const load = await env.DB.prepare("SELECT * FROM loads WHERE platform = 'youpay' AND external_id = ?").bind(externalId).first();
    if (load && load.status === 'credited' && load.wallet_id) {
      await env.DB.batch([
        env.DB.prepare('UPDATE loads SET status = ?, updated_at = ? WHERE id = ?').bind(y.status, Date.now(), load.id),
        env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, total_loaded_cents = total_loaded_cents - ? WHERE id = ?')
          .bind(load.amount_cents, load.amount_cents, load.wallet_id)
      ]);
      await logNote(env.DB, 'youpay_' + y.status, load.wallet_id, 'Load #' + load.id + ' reversed: ' + money(load.amount_cents));
    } else {
      await logNote(env.DB, 'youpay_' + y.status + '_unmatched', null, 'Order ' + externalId);
    }
    return json({ ok: true });
  }
  return json({ ok: true, ignored: true });
};

// ---------- Backstage (private: password + authenticator app code) ----------
// Its settings and sign-ins live in two small tables made automatically.
// Lost your phone? In the Cloudflare D1 console run:
//   DELETE FROM backstage WHERE key = 'totp_secret'
// and the next sign-in will show a new QR code to scan.
// Locked Backstage with the lock switch? To unlock, in the D1 console run:
//   DELETE FROM backstage WHERE key = 'lockdown'
const HQ_COOKIE = 'ng_backstage', HQ_HOURS = 12, HQ_TRIES = 5, HQ_LOCK_MS = 15 * 60 * 1000;
let hqSchemaReady = false;
async function hqSchema(db) {
  if (hqSchemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS backstage (key TEXT PRIMARY KEY, value TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS backstage_sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)')
  ]);
  hqSchemaReady = true;
}
async function hqGet(db, key) { const r = await db.prepare('SELECT value FROM backstage WHERE key = ?').bind(key).first(); return r ? r.value : null; }
async function hqSet(db, key, value) {
  if (value == null) await db.prepare('DELETE FROM backstage WHERE key = ?').bind(key).run();
  else await db.prepare('INSERT INTO backstage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value)).run();
}
function hqCookie(token, maxAge) {
  return HQ_COOKIE + '=' + token + '; Path=/api/hq; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAge;
}

async function hqLocked(db) { return !!(await hqGet(db, 'lockdown')); }

// ---------- Backstage password ----------
// The very first password is the ADMIN_PASSWORD secret in Cloudflare. Once
// Gnomie picks a new one in Backstage, it's saved here (scrambled, never readable)
// and the Cloudflare secret is no longer used. Passwords expire after 30 days.
const PW_MAX_AGE = 30 * DAY, PW_MIN = 12;
async function passwordOk(env, password) {
  const db = env.DB, h = await hqGet(db, 'pw_hash');
  if (h) return safeEqual(await pinHash(String(password || ''), await hqGet(db, 'pw_salt')), h);
  return safeEqual(String(password || ''), env.ADMIN_PASSWORD);
}
async function passwordSetAt(db) {
  let t = Number(await hqGet(db, 'pw_set_at') || 0);
  if (!t) { t = Date.now(); await hqSet(db, 'pw_set_at', t); } // the clock starts the first time it's used
  return t;
}
async function passwordExpired(db) { return Date.now() - await passwordSetAt(db) > PW_MAX_AGE; }
async function savePassword(env, pw) {
  pw = String(pw || '');
  if (pw.length < PW_MIN) throw new Oops('Use at least ' + PW_MIN + ' characters.');
  if (await passwordOk(env, pw)) throw new Oops('Pick a password you haven’t used right before.');
  const prev = await hqGet(env.DB, 'pw_prev_hash'), prevSalt = await hqGet(env.DB, 'pw_prev_salt');
  if (prev && safeEqual(await pinHash(pw, prevSalt), prev)) throw new Oops('Pick a password you haven’t used right before.');
  const salt = randomHex(16);
  const cur = await hqGet(env.DB, 'pw_hash');
  if (cur) { await hqSet(env.DB, 'pw_prev_hash', cur); await hqSet(env.DB, 'pw_prev_salt', await hqGet(env.DB, 'pw_salt')); }
  await hqSet(env.DB, 'pw_salt', salt);
  await hqSet(env.DB, 'pw_hash', await pinHash(pw, salt));
  await hqSet(env.DB, 'pw_set_at', Date.now());
}

async function needHQ(env, request, allowExpired) {
  if (!env.ADMIN_PASSWORD) throw new Oops('Backstage password not set up yet.', 503);
  await hqSchema(env.DB);
  if (await hqLocked(env.DB)) throw new Oops('Backstage is locked.', 423, { locked: true });
  const token = getCookie(request, HQ_COOKIE);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    const ok = await env.DB.prepare('SELECT 1 FROM backstage_sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha256(token), Date.now()).first();
    if (ok) {
      if (!allowExpired && await passwordExpired(env.DB)) throw new Oops('Your Backstage password is a month old. Choose a new one to continue.', 403, { mustChange: true });
      return;
    }
  }
  throw new Oops('Please sign in.', 401);
}

// Checks the password (and the app code once 2FA is set up), with a lock after 5 misses.
async function hqCheck(env, request, password, code, pendingSecret) {
  const db = env.DB, now = Date.now();
  const lockedUntil = Number(await hqGet(db, 'locked_until') || 0);
  if (lockedUntil > now) throw new Oops('Too many tries. Backstage is locked for ' + Math.ceil((lockedUntil - now) / 60000) + ' more minutes.', 429);
  const secret = pendingSecret || await hqGet(db, 'totp_secret');
  let step = -1;
  const passOk = await passwordOk(env, password);
  if (passOk && secret) step = await checkCode(secret, code, Number(await hqGet(db, 'totp_last_step') || 0));
  if (!passOk || (secret && step < 0)) {
    const fails = Number(await hqGet(db, 'fail_count') || 0) + 1;
    await hqSet(db, 'fail_count', fails >= HQ_TRIES ? 0 : fails);
    if (fails >= HQ_TRIES) await hqSet(db, 'locked_until', now + HQ_LOCK_MS);
    await logEvent(env, request, fails >= HQ_TRIES ? 'backstage_locked' : 'backstage_failed', null,
      (!passOk ? 'Wrong password' : 'Wrong authenticator code') + (fails >= HQ_TRIES ? ' · locked 15 minutes' : ' (' + fails + ' of ' + HQ_TRIES + ')'));
    await new Promise(r => setTimeout(r, 800));
    throw new Oops(!passOk ? 'Wrong password.' : 'That code didn’t work. Use the newest code from your app.', 401);
  }
  await hqSet(db, 'fail_count', 0);
  if (step >= 0) await hqSet(db, 'totp_last_step', step); // each code works only once
  return !!secret;
}

async function hqStartSession(env, request, detail) {
  const token = randomHex(32), now = Date.now();
  await env.DB.prepare('DELETE FROM backstage_sessions WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('INSERT INTO backstage_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), now, now + HQ_HOURS * 3600000).run();
  await logEvent(env, request, 'backstage_signin', null, detail);
  return hqCookie(token, HQ_HOURS * 3600);
}

routes['GET hq/session'] = async (env, request) => {
  if (!env.ADMIN_PASSWORD) return json({ ready: false });
  await hqSchema(env.DB);
  if (await hqLocked(env.DB)) return json({ ready: true, locked: true, signedIn: false });
  let signedIn = true;
  try { await needHQ(env, request, true); } catch (e) { signedIn = false; }
  const out = { ready: true, signedIn, twoFactor: !!(await hqGet(env.DB, 'totp_secret')) };
  if (signedIn) { const at = await passwordSetAt(env.DB); out.mustChange = Date.now() - at > PW_MAX_AGE; out.passwordExpiresAt = at + PW_MAX_AGE; }
  return json(out);
};

// Change the password while signed in (also how an expired password gets replaced)
routes['POST hq/password'] = async (env, request) => {
  await needHQ(env, request, true);
  const b = await readJson(request);
  if (!(await passwordOk(env, b.current))) {
    await logEvent(env, request, 'backstage_failed', null, 'Wrong current password while changing it');
    await new Promise(r => setTimeout(r, 800));
    throw new Oops('Your current password is wrong.', 400);
  }
  await savePassword(env, b.next);
  await logEvent(env, request, 'backstage_password_changed', null, 'New Backstage password set');
  return json({ ok: true, passwordExpiresAt: Date.now() + PW_MAX_AGE });
};

// Forgot the password: two codes in a row from the authenticator app, then a new password.
// Everyone is signed out afterwards.
routes['POST hq/password-forgot'] = async (env, request) => {
  if (!env.ADMIN_PASSWORD) throw new Oops('Backstage password not set up yet.', 503);
  await hqSchema(env.DB);
  const db = env.DB, now = Date.now();
  if (await hqLocked(db)) throw new Oops('Backstage is locked.', 423, { locked: true });
  const lockedUntil = Number(await hqGet(db, 'locked_until') || 0);
  if (lockedUntil > now) throw new Oops('Too many tries. Backstage is locked for ' + Math.ceil((lockedUntil - now) / 60000) + ' more minutes.', 429);
  const secret = await hqGet(db, 'totp_secret');
  if (!secret) throw new Oops('Your authenticator app isn’t connected yet, so the password can’t be reset this way. Change ADMIN_PASSWORD in Cloudflare instead.', 400);
  const b = await readJson(request);
  const s1 = await checkCode(secret, b.code1, Number(await hqGet(db, 'totp_last_step') || 0));
  const s2 = s1 >= 0 ? await checkCode(secret, b.code2, s1) : -1;
  if (s1 < 0 || s2 !== s1 + 1) {
    const fails = Number(await hqGet(db, 'fail_count') || 0) + 1;
    await hqSet(db, 'fail_count', fails >= HQ_TRIES ? 0 : fails);
    if (fails >= HQ_TRIES) await hqSet(db, 'locked_until', now + HQ_LOCK_MS);
    await logEvent(env, request, fails >= HQ_TRIES ? 'backstage_locked' : 'backstage_failed', null, 'Wrong authenticator codes while resetting the password' + (fails >= HQ_TRIES ? ' · locked 15 minutes' : ' (' + fails + ' of ' + HQ_TRIES + ')'));
    await new Promise(r => setTimeout(r, 800));
    throw new Oops('Those codes didn’t work. Type the code your app shows now, wait for it to change, then type the new one.', 400);
  }
  await savePassword(env, b.next);
  await hqSet(db, 'totp_last_step', s2);
  await hqSet(db, 'fail_count', 0);
  await db.prepare('DELETE FROM backstage_sessions').run();
  await logEvent(env, request, 'backstage_password_reset', null, 'Password reset with two authenticator codes · everyone signed out');
  return json({ ok: true }, 200, { 'set-cookie': hqCookie('', 0) });
};

routes['POST hq/login'] = async (env, request) => {
  if (!env.ADMIN_PASSWORD) throw new Oops('Backstage password not set up yet.', 503);
  await hqSchema(env.DB);
  if (await hqLocked(env.DB)) {
    await logEvent(env, request, 'backstage_locked_attempt', null, 'Sign-in tried while Backstage is locked');
    throw new Oops('Backstage is locked.', 423, { locked: true });
  }
  const b = await readJson(request);
  const hasTwoFactor = await hqCheck(env, request, b.password, b.code);
  if (!hasTwoFactor) {
    // First time: make a secret to scan. It only counts once a code from it is confirmed.
    const secret = newSecret();
    await hqSet(env.DB, 'totp_pending', secret);
    return json({ setup: true, secret, otpauth: otpauthUrl(secret) });
  }
  return json({ ok: true }, 200, { 'set-cookie': await hqStartSession(env, request, 'Password + authenticator code') });
};

routes['POST hq/setup-2fa'] = async (env, request) => {
  if (!env.ADMIN_PASSWORD) throw new Oops('Backstage password not set up yet.', 503);
  await hqSchema(env.DB);
  if (await hqLocked(env.DB)) throw new Oops('Backstage is locked.', 423, { locked: true });
  if (await hqGet(env.DB, 'totp_secret')) throw new Oops('2FA is already set up.');
  const pending = await hqGet(env.DB, 'totp_pending');
  if (!pending) throw new Oops('Start again from the sign-in screen.');
  const b = await readJson(request);
  await hqCheck(env, request, b.password, b.code, pending);
  await hqSet(env.DB, 'totp_secret', pending);
  await hqSet(env.DB, 'totp_pending', null);
  await logEvent(env, request, 'backstage_2fa_setup', null, 'Authenticator app connected');
  return json({ ok: true }, 200, { 'set-cookie': await hqStartSession(env, request, 'First sign-in, 2FA connected') });
};

// Signs every device out of Backstage (you sign straight back in with password + code)
routes['POST hq/signout-everywhere'] = async (env, request) => {
  await needHQ(env, request);
  const r = await env.DB.prepare('DELETE FROM backstage_sessions').run();
  await logEvent(env, request, 'backstage_signout_everywhere', null, r.meta.changes + ' Backstage sign-in(s) ended');
  return json({ ok: true }, 200, { 'set-cookie': hqCookie('', 0) });
};

// Full lock: signs everyone out and refuses all sign-ins until unlocked in the
// Cloudflare D1 console. The games, wallets and payments keep working.
routes['POST hq/lockdown'] = async (env, request) => {
  await needHQ(env, request);
  // Locking needs the password and authenticator code again, not just being signed in
  const body = await readJson(request);
  await hqCheck(env, request, body.password, body.code);
  await hqSet(env.DB, 'lockdown', Date.now());
  await env.DB.prepare('DELETE FROM backstage_sessions').run();
  await logEvent(env, request, 'backstage_lockdown', null, 'Backstage locked. Unlock in the Cloudflare D1 console.');
  return json({ ok: true }, 200, { 'set-cookie': hqCookie('', 0) });
};

routes['POST hq/logout'] = async (env, request) => {
  await hqSchema(env.DB);
  const token = getCookie(request, HQ_COOKIE);
  if (token && /^[0-9a-f]{64}$/.test(token)) await env.DB.prepare('DELETE FROM backstage_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': hqCookie('', 0) });
};

const LAST_ACTIVE_SQL = `MAX(w.created_at,
  COALESCE((SELECT MAX(a.created_at) FROM admin_log a WHERE a.wallet_id = w.id AND a.action NOT LIKE 'backstage%'), 0),
  COALESCE((SELECT MAX(d.created_at) FROM drops d WHERE d.wallet_id = w.id), 0),
  COALESCE((SELECT MAX(u.created_at) FROM duels u WHERE u.wallet_id = w.id), 0),
  COALESCE((SELECT MAX(t.created_at) FROM toofar t WHERE t.wallet_id = w.id), 0),
  COALESCE((SELECT MAX(m.created_at) FROM mancala m WHERE m.wallet_id = w.id), 0),
  COALESCE((SELECT MAX(f.created_at) FROM fiverow f WHERE f.wallet_id = w.id), 0))`;
// How busy a fan has been: everything they did in the last 30 days (sign-ins, loads, games...)
const ACTIVITY_SQL = `(
  (SELECT COUNT(*) FROM admin_log a WHERE a.wallet_id = w.id AND a.action NOT LIKE 'backstage%' AND a.created_at > (strftime('%s','now') - 2592000) * 1000) +
  (SELECT COUNT(*) FROM drops d WHERE d.wallet_id = w.id AND d.created_at > (strftime('%s','now') - 2592000) * 1000) +
  (SELECT COUNT(*) FROM duels u WHERE u.wallet_id = w.id AND u.created_at > (strftime('%s','now') - 2592000) * 1000) +
  (SELECT COUNT(*) FROM toofar t WHERE t.wallet_id = w.id AND t.created_at > (strftime('%s','now') - 2592000) * 1000) +
  (SELECT COUNT(*) FROM mancala m WHERE m.wallet_id = w.id AND m.created_at > (strftime('%s','now') - 2592000) * 1000) +
  (SELECT COUNT(*) FROM fiverow f WHERE f.wallet_id = w.id AND f.created_at > (strftime('%s','now') - 2592000) * 1000))`;
const HQ_SELECT = WALLET_SELECT.replace('SELECT w.*,', 'SELECT w.*, ' + LAST_ACTIVE_SQL + ' AS last_active, ' + ACTIVITY_SQL + ' AS activity_30d,');

async function hqWallet(db, code) {
  const w = await db.prepare(HQ_SELECT + ' WHERE w.code = ?').bind(normalizeCode(code)).first();
  if (!w) throw new Oops('No wallet with that code.', 404);
  return w;
}
function hqWalletView(w) {
  return {
    id: w.id, code: w.display_code, name: w.name || ('Anonymous #' + w.anon_number), anonymous: !w.name,
    balanceCents: w.balance_cents, loadedCents: w.total_loaded_cents, spentCents: w.total_drained_cents,
    heldCents: (w.held_duel || 0) + (w.held_toofar || 0) + (w.held_mancala || 0) + (w.held_five || 0), duelWins: w.duel_wins || 0, tooFarWins: w.toofar_wins || 0, mancalaWins: w.mancala_wins || 0, fiveWins: w.five_wins || 0, hasPin: !!w.pin_hash, pinLength: w.pin_length, twoFactor: !!w.two_factor,
    failedPins: w.failed_pin_count, locked: w.locked_until > Date.now(), lockedUntil: w.locked_until,
    status: w.status, createdAt: w.created_at, closeRequestedAt: w.close_requested_at || null, onBreakSince: w.break_since || null,
    lastActive: w.last_active || w.created_at, activity30d: w.activity_30d || 0, telegram: w.telegram || '', throneName: w.throne_name || '',
    color: colorOf(w), loadCount: w.load_count || 0, termsVersion: w.terms_version || null, termsCurrent: w.terms_version === TERMS_VERSION,
    spoof: !!w.spoof, colorsUnlocked: (w.load_count || 0) >= 7
  };
}
const startOfDay = t => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
function clampInt(v, lo, hi, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }

// Everything at a glance
routes['GET hq/stats'] = async (env, request, url) => {
  await needHQ(env, request);
  const db = env.DB, now = Date.now();
  const days = clampInt(url.searchParams.get('days'), 7, 365, 30);
  const today = startOfDay(now), since = today - (days - 1) * DAY, d7 = now - 7 * DAY, d30 = now - 30 * DAY;
  const one = (sql, ...b) => db.prepare(sql).bind(...b).first();
  const all = async (sql, ...b) => (await db.prepare(sql).bind(...b).all()).results;

  const [wallets, money, loadsBy, dropTotals, dropBoards, dropAimSlot, duelTotals, duelByAmount,
         dailyLoads, dailyDrops, dailyDuels, dailyWallets, topLoaded, topSpent, events,
         spinTotals, spinBoards, spinSlots, tfTotals, tfByAmount, dailyTooFar] = await Promise.all([
    one(`SELECT COUNT(*) AS total,
           SUM(pin_hash IS NOT NULL) AS with_pin, SUM(status = 'banned') AS banned, SUM(name IS NOT NULL) AS named,
           SUM(created_at >= ?) AS new_today, SUM(created_at >= ?) AS new_7d, SUM(created_at >= ?) AS new_30d,
           SUM(balance_cents > 0) AS with_balance, SUM(locked_until > ?) AS locked_now
         FROM (SELECT * FROM wallets WHERE id NOT IN (SELECT wallet_id FROM spoofs)) AS wallets`, today, d7, d30, now),
    one(`SELECT COALESCE(SUM(balance_cents), 0) AS balances, COALESCE(SUM(total_loaded_cents), 0) AS loaded,
           COALESCE(SUM(total_drained_cents), 0) AS spent,
           (SELECT COALESCE(SUM(held_cents), 0) FROM (SELECT * FROM duels WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS duels WHERE status = 'active') + (SELECT COALESCE(SUM(held_cents), 0) FROM (SELECT * FROM toofar WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS toofar WHERE status = 'active') AS held,
           (SELECT COUNT(DISTINCT wallet_id) FROM (
              SELECT wallet_id FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE created_at >= ? UNION SELECT wallet_id FROM (SELECT * FROM duels WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS duels WHERE created_at >= ?
              UNION SELECT wallet_id FROM (SELECT * FROM toofar WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS toofar WHERE created_at >= ?
              UNION SELECT wallet_id FROM (SELECT * FROM loads WHERE wallet_id IS NULL OR wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS loads WHERE created_at >= ? AND wallet_id IS NOT NULL)) AS active_7d
         FROM (SELECT * FROM wallets WHERE id NOT IN (SELECT wallet_id FROM spoofs)) AS wallets`, d7, d7, d7, d7),
    all(`SELECT platform, status, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COALESCE(SUM(paid_cents), 0) AS paid,
           SUM(created_at >= ?) AS n_today, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_today,
           SUM(created_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_7d,
           SUM(created_at >= ?) AS n_30d, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_30d
         FROM (SELECT * FROM loads WHERE wallet_id IS NULL OR wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS loads GROUP BY platform, status`, today, today, d7, d7, d30, d30),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players,
           SUM(created_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_7d
         FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE game = 'drop-the-ball'`, d7, d7),
    all(`SELECT board, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE game = 'drop-the-ball' GROUP BY board`),
    all(`SELECT board, aim, slot, COUNT(*) AS n FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE game = 'drop-the-ball' GROUP BY board, aim, slot`),
    one(`SELECT COUNT(*) AS n, SUM(status = 'active') AS active, SUM(outcome = 'win') AS wins, SUM(outcome = 'tie') AS ties,
           SUM(outcome = 'lose') AS losses, COALESCE(SUM(paid_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players,
           AVG(you_score) AS avg_you, AVG(gnomie_score) AS avg_gnomie,
           SUM(status = 'done' AND finished_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN finished_at >= ? THEN paid_cents END), 0) AS cents_7d
         FROM (SELECT * FROM duels WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS duels`, d7, d7),
    all(`SELECT amount_cents, COUNT(*) AS n, SUM(outcome = 'win') AS wins, SUM(outcome = 'tie') AS ties, SUM(outcome = 'lose') AS losses,
           COALESCE(SUM(paid_cents), 0) AS cents FROM (SELECT * FROM duels WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS duels WHERE status = 'done' GROUP BY amount_cents ORDER BY amount_cents`),
    all(`SELECT CAST((created_at - ?) / ${DAY} AS INTEGER) AS day, platform, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents
         FROM (SELECT * FROM loads WHERE wallet_id IS NULL OR wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS loads WHERE created_at >= ? AND status = 'credited' GROUP BY day, platform`, since, since),
    all(`SELECT CAST((created_at - ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents
         FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE created_at >= ? GROUP BY day`, since, since),
    all(`SELECT CAST((finished_at - ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS n, COALESCE(SUM(paid_cents), 0) AS cents
         FROM (SELECT * FROM duels WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS duels WHERE status = 'done' AND finished_at >= ? GROUP BY day`, since, since),
    all(`SELECT CAST((created_at - ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS n FROM (SELECT * FROM wallets WHERE id NOT IN (SELECT wallet_id FROM spoofs)) AS wallets WHERE created_at >= ? GROUP BY day`, since, since),
    all(`SELECT display_code, name, anon_number, total_loaded_cents AS cents FROM (SELECT * FROM wallets WHERE id NOT IN (SELECT wallet_id FROM spoofs)) AS wallets WHERE total_loaded_cents > 0 ORDER BY cents DESC LIMIT 10`),
    all(`SELECT display_code, name, anon_number, total_drained_cents AS cents FROM (SELECT * FROM wallets WHERE id NOT IN (SELECT wallet_id FROM spoofs)) AS wallets WHERE total_drained_cents > 0 ORDER BY cents DESC LIMIT 10`),
    all(`SELECT action, COUNT(*) AS n, SUM(created_at >= ?) AS n_today, SUM(created_at >= ?) AS n_7d FROM admin_log GROUP BY action`, today, d7),
    // Spin the Bottle
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players, SUM(path LIKE '%|hit' OR path = 'called') AS called_hits,
           SUM(created_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_7d
         FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE game = 'spin-the-bottle'`, d7, d7),
    all(`SELECT board, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE game = 'spin-the-bottle' GROUP BY board`),
    all(`SELECT board, slot, COUNT(*) AS n FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops WHERE game = 'spin-the-bottle' GROUP BY board, slot`),
    // Too Far
    one(`SELECT COUNT(*) AS n, SUM(status = 'active') AS active, SUM(outcome = 'win') AS wins, SUM(outcome = 'tie') AS ties,
           SUM(outcome = 'lose') AS losses, SUM(outcome = 'bust') AS busts, COALESCE(SUM(paid_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players,
           AVG(you_total) AS avg_you, AVG(gnomie_total) AS avg_gnomie,
           SUM(status = 'done' AND finished_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN finished_at >= ? THEN paid_cents END), 0) AS cents_7d
         FROM (SELECT * FROM toofar WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS toofar`, d7, d7),
    all(`SELECT amount_cents, COUNT(*) AS n, SUM(outcome = 'win') AS wins, SUM(outcome = 'tie') AS ties, SUM(outcome = 'lose') AS losses,
           SUM(outcome = 'bust') AS busts, COALESCE(SUM(paid_cents), 0) AS cents FROM (SELECT * FROM toofar WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS toofar WHERE status = 'done' GROUP BY amount_cents ORDER BY amount_cents`),
    all(`SELECT CAST((finished_at - ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS n, COALESCE(SUM(paid_cents), 0) AS cents
         FROM (SELECT * FROM toofar WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS toofar WHERE status = 'done' AND finished_at >= ? GROUP BY day`, since, since)
  ]);

  // Spin the Bottle fairness: every slice should come up about 1 in 8
  const spinFair = {};
  for (const row of spinSlots) {
    const f = spinFair[row.board] = spinFair[row.board] || { n: 0, actual: new Array(8).fill(0) };
    f.n += row.n; f.actual[row.slot] += row.n;
  }

  // Fairness check: where balls actually landed vs. what the odds say, per board
  const fairness = {};
  for (const row of dropAimSlot) {
    const f = fairness[row.board] = fairness[row.board] || { n: 0, actual: new Array(13).fill(0), expected: new Array(13).fill(0) };
    f.n += row.n;
    f.actual[row.slot] += row.n;
  }
  const byAim = {};
  for (const row of dropAimSlot) byAim[row.board + ':' + row.aim] = (byAim[row.board + ':' + row.aim] || 0) + row.n;
  for (const key of Object.keys(byAim)) {
    const [board, aim] = key.split(':');
    const odds = oddsFor(Number(aim));
    for (let k = 0; k < 13; k++) fairness[board].expected[k] += byAim[key] * odds[k];
  }

  // Daily series
  const series = [];
  for (let i = 0; i < days; i++) series.push({ day: since + i * DAY, youpay: 0, throne: 0, loads: 0, drops: 0, duels: 0, spent: 0, wallets: 0 });
  dailyLoads.forEach(r => { const s = series[r.day]; if (s) { s[r.platform] += r.cents; s.loads += r.n; } });
  dailyDrops.forEach(r => { const s = series[r.day]; if (s) { s.drops += r.n; s.spent += r.cents; } });
  dailyDuels.forEach(r => { const s = series[r.day]; if (s) { s.duels += r.n; s.spent += r.cents; } });
  dailyTooFar.forEach(r => { const s = series[r.day]; if (s) { s.spent += r.cents; } });
  dailyWallets.forEach(r => { const s = series[r.day]; if (s) s.wallets += r.n; });

  const nm = r => ({ code: r.display_code, name: r.name || ('Anonymous #' + r.anon_number), cents: r.cents });
  const closeReqs = (await db.prepare('SELECT COUNT(*) AS n FROM close_requests').first()).n;
  const loadReports = (await db.prepare("SELECT COUNT(*) AS n FROM load_reports WHERE status = 'open'").first()).n;
  // Most popular games: plays, players and total, in the chosen period and all time
  const popular = (await db.prepare(
    `SELECT game, COUNT(*) AS plays, COUNT(DISTINCT wallet_id) AS players, COALESCE(SUM(cents), 0) AS cents,
            SUM(at >= ?) AS plays_period, COALESCE(SUM(CASE WHEN at >= ? THEN cents END), 0) AS cents_period
     FROM (SELECT game, wallet_id, amount_cents AS cents, created_at AS at FROM (SELECT * FROM drops WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS drops
           UNION ALL SELECT 'dice-duel', wallet_id, paid_cents, finished_at FROM (SELECT * FROM duels WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS duels WHERE status = 'done'
           UNION ALL SELECT 'too-far', wallet_id, paid_cents, finished_at FROM (SELECT * FROM toofar WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS toofar WHERE status = 'done'
           UNION ALL SELECT 'mancala', wallet_id, paid_cents, finished_at FROM (SELECT * FROM mancala WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS mancala WHERE status = 'done'
           UNION ALL SELECT 'five-in-a-row', wallet_id, paid_cents, finished_at FROM (SELECT * FROM fiverow WHERE wallet_id NOT IN (SELECT wallet_id FROM spoofs)) AS fiverow WHERE status = 'done')
     GROUP BY game ORDER BY plays_period DESC, plays DESC`
  ).bind(since, since).all()).results;
  const fanRequests = (await db.prepare("SELECT COUNT(*) AS n FROM fan_requests WHERE status = 'open'").first()).n;
  return json({
    generatedAt: now, days, wallets, money, loads: loadsBy, closeRequests: closeReqs, loadReports, fanRequests, popular,
    drop: { totals: dropTotals, boards: dropBoards, fairness },
    duel: { totals: duelTotals, byAmount: duelByAmount },
    spin: { totals: spinTotals, boards: spinBoards, fairness: spinFair, slices: BOTTLE },
    toofar: { totals: tfTotals, byAmount: tfByAmount },
    series, topLoaded: topLoaded.map(nm), topSpent: topSpent.map(nm), events
  });
};

// Leaderboards with the real amounts (only you see these)
routes['GET hq/leaderboard'] = async (env, request, url) => {
  await needHQ(env, request);
  const key = url.searchParams.get('board') || 'all';
  if (!BOARD_SQL[key]) throw new Oops('Unknown board.');
  const rows = (await rankedBoard(env.DB, key)).slice(0, 50);
  const codes = rows.length ? (await env.DB.prepare(`SELECT id, display_code FROM wallets WHERE id IN (${rows.map(() => '?').join(',')})`).bind(...rows.map(r => r.wallet_id)).all()).results : [];
  const codeOf = {}; codes.forEach(c => { codeOf[c.id] = c.display_code; });
  const open = (await env.DB.prepare('SELECT * FROM reigns WHERE board_key = ? AND ended_at IS NULL').bind(key).all()).results;
  return json({ threshold: /-wins$/.test(key) ? 1 : await spoofThreshold(env.DB), rows: rows.map((r, n) => ({
    rank: n + 1, code: codeOf[r.wallet_id], name: r.name || ('Anonymous #' + r.anon_number), score: r.score, spoof: !!r.spoof,
    reignStart: (open.find(x => x.wallet_id === r.wallet_id && x.rank === n + 1) || {}).started_at || null
  })) });
};

// Paged lists: loads, drops, duels, events, wallets. ?before=<id> loads older pages.
routes['GET hq/loads'] = async (env, request, url) => {
  await needHQ(env, request);
  const q = url.searchParams, where = [], b = [];
  if (q.get('status')) { where.push('l.status = ?'); b.push(q.get('status')); }
  if (q.get('platform')) { where.push('l.platform = ?'); b.push(q.get('platform')); }
  if (q.get('before')) { where.push('l.id < ?'); b.push(+q.get('before')); }
  const rows = (await env.DB.prepare(
    `SELECT l.*, w.display_code, w.name, w.anon_number FROM loads l LEFT JOIN wallets w ON w.id = l.wallet_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT ?`
  ).bind(...b, clampInt(q.get('limit'), 1, 500, 100)).all()).results;
  return json({ rows });
};

routes['GET hq/drops'] = async (env, request, url) => {
  await needHQ(env, request);
  const q = url.searchParams, where = [], b = [];
  if (q.get('game')) { where.push('d.game = ?'); b.push(q.get('game')); }
  if (q.get('board')) { where.push('d.board = ?'); b.push(q.get('board')); }
  if (q.get('before')) { where.push('d.id < ?'); b.push(+q.get('before')); }
  if (q.get('wallet')) { where.push('w.code = ?'); b.push(normalizeCode(q.get('wallet'))); }
  const rows = (await env.DB.prepare(
    `SELECT d.id, d.game, d.board, d.aim, d.slot, d.path, d.amount_cents, d.created_at, w.display_code, w.name, w.anon_number
     FROM drops d JOIN wallets w ON w.id = d.wallet_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC LIMIT ?`
  ).bind(...b, clampInt(q.get('limit'), 1, 500, 100)).all()).results;
  return json({ rows });
};

routes['GET hq/duels'] = async (env, request, url) => {
  await needHQ(env, request);
  const q = url.searchParams, where = [], b = [];
  if (q.get('status')) { where.push('d.status = ?'); b.push(q.get('status')); }
  if (q.get('before')) { where.push('d.id < ?'); b.push(+q.get('before')); }
  if (q.get('wallet')) { where.push('w.code = ?'); b.push(normalizeCode(q.get('wallet'))); }
  const rows = (await env.DB.prepare(
    `SELECT d.id, d.amount_cents, d.held_cents, d.status, d.outcome, d.you_score, d.gnomie_score, d.paid_cents, d.created_at, d.finished_at,
       w.display_code, w.name, w.anon_number
     FROM duels d JOIN wallets w ON w.id = d.wallet_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC LIMIT ?`
  ).bind(...b, clampInt(q.get('limit'), 1, 500, 100)).all()).results;
  return json({ rows });
};

routes['GET hq/events'] = async (env, request, url) => {
  await needHQ(env, request);
  const q = url.searchParams, where = [], b = [];
  if (q.get('action')) { where.push('a.action = ?'); b.push(q.get('action')); }
  if (q.get('before')) { where.push('a.id < ?'); b.push(+q.get('before')); }
  if (q.get('wallet')) { where.push('w.code = ?'); b.push(normalizeCode(q.get('wallet'))); }
  const rows = (await env.DB.prepare(
    `SELECT a.*, w.display_code, w.name, w.anon_number FROM admin_log a LEFT JOIN wallets w ON w.id = a.wallet_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`
  ).bind(...b, clampInt(q.get('limit'), 1, 500, 100)).all()).results;
  return json({ rows });
};

routes['GET hq/wallets'] = async (env, request, url) => {
  await needHQ(env, request);
  const q = url.searchParams, search = String(q.get('q') || '').trim();
  const sorts = { active: 'activity_30d DESC, last_active DESC', recent: 'last_active DESC', newest: 'w.id DESC', balance: 'w.balance_cents DESC', loaded: 'w.total_loaded_cents DESC', spent: 'w.total_drained_cents DESC', name: 'COALESCE(w.name, \'~\') ASC', quiet: 'last_active ASC' };
  const order = sorts[q.get('sort')] || sorts.active;
  const where = [], b = [];
  if (search) {
    const like = '%' + search.toLowerCase().replace(/^@/, '') + '%', code = normalizeCode(search);
    where.push(`(${code ? 'w.code LIKE ? OR ' : ''}LOWER(COALESCE(w.name, '')) LIKE ? OR ('anonymous #' || w.anon_number) LIKE ?
      OR EXISTS (SELECT 1 FROM wallet_contacts c WHERE c.wallet_id = w.id AND (LOWER(COALESCE(c.telegram, '')) LIKE ? OR LOWER(COALESCE(c.throne, '')) LIKE ?))
      OR EXISTS (SELECT 1 FROM wallet_notes n WHERE n.wallet_id = w.id AND LOWER(n.note) LIKE ?)
      OR EXISTS (SELECT 1 FROM loads l WHERE l.wallet_id = w.id AND LOWER(COALESCE(l.gifter, '')) LIKE ?))`);
    if (code) b.push('%' + code + '%');
    b.push(like, like, like, like, like, like);
  }
  if (q.get('status') === 'all') { /* everyone, closed too */ }
  else if (q.get('status') === 'requested') where.push('EXISTS (SELECT 1 FROM close_requests c WHERE c.wallet_id = w.id)');
  else if (q.get('status') === 'break') where.push('EXISTS (SELECT 1 FROM breaks k WHERE k.wallet_id = w.id)');
  else if (q.get('status') === 'spoof') where.push('EXISTS (SELECT 1 FROM spoofs x WHERE x.wallet_id = w.id)');
  else if (q.get('status') === 'inactive') { where.push("w.status = 'active' AND " + LAST_ACTIVE_SQL + ' < ?'); b.push(Date.now() - 182 * DAY); }
  else if (q.get('status')) { where.push('w.status = ?'); b.push(q.get('status')); }
  else where.push("w.status != 'closed'");
  const rows = (await env.DB.prepare(
    `${HQ_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`
  ).bind(...b, clampInt(q.get('limit'), 1, 500, 100)).all()).results;
  return json({ rows: rows.map(hqWalletView) });
};

// One wallet, everything about it
routes['GET hq/wallet'] = async (env, request, url) => {
  await needHQ(env, request);
  const w = await hqWallet(env.DB, url.searchParams.get('code'));
  const db = env.DB;
  const [notes, agreements, statement, nudges, loads, drops, duels, events, sessions, perGame] = await Promise.all([
    db.prepare('SELECT id, note, created_at, updated_at FROM wallet_notes WHERE wallet_id = ? ORDER BY id DESC').bind(w.id).all(),
    db.prepare('SELECT version, how, created_at FROM agreements WHERE wallet_id = ? ORDER BY id DESC LIMIT 50').bind(w.id).all(),
    buildStatement(db, w, false),
    db.prepare('SELECT * FROM nudges WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT * FROM loads WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT id, game, board, aim, slot, amount_cents, created_at FROM drops WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT id, amount_cents, held_cents, status, outcome, you_score, gnomie_score, paid_cents, created_at, finished_at FROM duels WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT * FROM admin_log WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM sessions WHERE wallet_id = ? AND expires_at > ?').bind(w.id, Date.now()).first(),
    db.prepare(`SELECT 'drop-the-ball' AS game, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM drops WHERE wallet_id = ? AND game = 'drop-the-ball'
                UNION ALL SELECT 'dice-duel', COUNT(*), COALESCE(SUM(paid_cents), 0) FROM duels WHERE wallet_id = ? AND status = 'done'
                UNION ALL SELECT 'too-far', COUNT(*), COALESCE(SUM(paid_cents), 0) FROM toofar WHERE wallet_id = ? AND status = 'done'
                UNION ALL SELECT 'spin-the-bottle', COUNT(*), COALESCE(SUM(amount_cents), 0) FROM drops WHERE wallet_id = ? AND game = 'spin-the-bottle'`).bind(w.id, w.id, w.id, w.id).all()
  ]);
  return json({
    wallet: hqWalletView(w), devices: sessions.n, lastSignIn: sessions.last, perGame: perGame.results,
    notes: notes.results, agreements: agreements.results, termsVersion: TERMS_VERSION,
    statement, nudges: nudges.results.map(n => Object.assign({}, n, {
      loadedAfter: statement.some(r => r.cents > 0 && /^Load/.test(r.label) && r.at > n.created_at)
    })),
    loads: loads.results, drops: drops.results, duels: duels.results, events: events.results
  });
};

// ---------- Backstage actions (each one is logged) ----------
// Three ways to change a balance:
//   load   = money they sent (adds, and counts toward "Loaded")
//   adjust = add or remove, not new money (corrections, spoof wallets)
//   set    = make the balance exactly this amount
routes['POST hq/adjust'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const kind = b.kind === 'fix' ? 'adjust' : b.kind;
  if (['load', 'adjust', 'set'].indexOf(kind) === -1) throw new Oops('Pick what kind of change this is.');
  const amount = Math.round(Number(b.cents));
  if (!Number.isInteger(amount) || Math.abs(amount) > 1000000) throw new Oops('Enter an amount.');
  const note = String(b.note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) || null;
  const shown = b.public ? 1 : 0;
  const db = env.DB;
  for (let attempt = 0; attempt < 5; attempt++) {
    const w = await hqWallet(db, b.code);
    let delta;
    if (kind === 'load') { if (amount <= 0) throw new Oops('Enter how much they sent.'); delta = amount; }
    else if (kind === 'adjust') { if (amount === 0) throw new Oops('Enter an amount.'); delta = amount; }
    else { if (amount < 0) throw new Oops('A balance can’t be below $0.'); delta = amount - w.balance_cents; if (delta === 0) throw new Oops('Their balance is already ' + money(amount) + '.'); }
    if (w.balance_cents + delta < 0) throw new Oops('That would take them below $0. Their balance is ' + money(w.balance_cents) + '.');
    const r = await db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ? AND balance_cents = ?')
      .bind(delta, kind === 'load' ? delta : 0, w.id, w.balance_cents).run();
    if (r.meta.changes !== 1) continue; // balance changed while we looked; try again
    await db.prepare('INSERT INTO adjustments (wallet_id, cents, kind, note, public, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(w.id, delta, kind, note, shown, Date.now()).run();
    const what = kind === 'load' ? 'backstage_added_load' : kind === 'set' ? 'backstage_set_balance' : 'backstage_adjusted';
    await logEvent(env, request, what, w.id, (delta > 0 ? '+' : '−') + money(Math.abs(delta)) + (kind === 'set' ? ' (now ' + money(amount) + ')' : '') +
      (note ? ' · ' + (shown ? 'note shown to them: ' : 'private note: ') + note : ''));
    return json({ ok: true });
  }
  throw new Oops('Busy. Please try again.', 409);
};

// Missing-load reports: list, then credit or decline
routes['GET hq/load-reports'] = async (env, request, url) => {
  await needHQ(env, request);
  const status = url.searchParams.get('status') || 'open';
  const rows = (await env.DB.prepare(
    `SELECT r.*, w.display_code, w.name, w.anon_number FROM load_reports r JOIN wallets w ON w.id = r.wallet_id
     ${status === 'all' ? '' : 'WHERE r.status = ?'} ORDER BY r.id DESC LIMIT 100`
  ).bind(...(status === 'all' ? [] : [status])).all()).results;
  return json({ rows });
};
routes['POST hq/load-report'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const r = await env.DB.prepare('SELECT * FROM load_reports WHERE id = ?').bind(b.id).first();
  if (!r || r.status !== 'open') throw new Oops('That report was already handled.');
  const now = Date.now();
  if (b.action === 'credit') {
    const cents = Math.round(Number(b.cents));
    if (!Number.isInteger(cents) || cents <= 0) throw new Oops('Enter the amount to add.');
    const done = await env.DB.prepare("UPDATE load_reports SET status = 'credited', resolution = ?, resolved_at = ? WHERE id = ? AND status = 'open'").bind('Added ' + money(cents), now, r.id).run();
    if (done.meta.changes !== 1) throw new Oops('That report was already handled.');
    await env.DB.batch([
      env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?').bind(cents, cents, r.wallet_id),
      env.DB.prepare('INSERT INTO adjustments (wallet_id, cents, kind, note, public, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(r.wallet_id, cents, 'load', 'Your missing load was found and added.', now)
    ]);
    await logEvent(env, request, 'backstage_report_credited', r.wallet_id, money(cents) + ' added for a missing-load report');
  } else if (b.action === 'decline') {
    const msg = String(b.message || '').trim().slice(0, 200) || 'Gnomie couldn’t find this load. Message her on Telegram.';
    const done = await env.DB.prepare("UPDATE load_reports SET status = 'declined', resolution = ?, resolved_at = ? WHERE id = ? AND status = 'open'").bind(msg, now, r.id).run();
    if (done.meta.changes !== 1) throw new Oops('That report was already handled.');
    await logEvent(env, request, 'backstage_report_declined', r.wallet_id, msg);
  } else throw new Oops('Pick what to do.');
  return json({ ok: true });
};

// ---------- Backstage Inbox: everything that needs Gnomie, newest first ----------
// Things to act on (unclear payments, missing loads, requests, close requests)
// leave the Inbox once handled; heads-ups (nudge answers, breaks) once marked seen.
routes['GET hq/inbox'] = async (env, request) => {
  await needHQ(env, request);
  const db = env.DB, monthAgo = Date.now() - 30 * DAY;
  await db.prepare('CREATE TABLE IF NOT EXISTS inbox_seen (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  const seen = new Set((await db.prepare('SELECT key FROM inbox_seen').all()).results.map(r => r.key));
  const who = "w.display_code AS code, COALESCE(w.name, 'Anonymous #' || w.anon_number) AS name";
  const [unclear, reports, reqs, closes, nudges, breaks] = await Promise.all([
    db.prepare("SELECT l.*, w.display_code AS code FROM loads l LEFT JOIN wallets w ON w.id = l.wallet_id WHERE l.status = 'needs_review' ORDER BY l.id DESC LIMIT 50").all(),
    db.prepare(`SELECT r.*, ${who} FROM load_reports r JOIN wallets w ON w.id = r.wallet_id WHERE r.status = 'open' ORDER BY r.id DESC LIMIT 50`).all(),
    db.prepare(`SELECT r.*, ${who} FROM fan_requests r JOIN wallets w ON w.id = r.wallet_id WHERE r.status = 'open' ORDER BY r.id DESC LIMIT 50`).all(),
    db.prepare(`SELECT c.*, ${who}, w.balance_cents FROM close_requests c JOIN wallets w ON w.id = c.wallet_id ORDER BY c.created_at DESC LIMIT 50`).all(),
    db.prepare(`SELECT n.*, ${who} FROM nudges n JOIN wallets w ON w.id = n.wallet_id WHERE n.response IN ('promise', 'break') AND n.closed_at >= ? ORDER BY n.closed_at DESC LIMIT 50`).bind(monthAgo).all(),
    db.prepare(`SELECT k.*, ${who} FROM breaks k JOIN wallets w ON w.id = k.wallet_id WHERE k.created_at >= ? ORDER BY k.created_at DESC LIMIT 50`).bind(monthAgo).all()
  ]);
  const items = [];
  unclear.results.forEach(l => items.push({ key: 'unclear:' + l.id, kind: 'unclear', at: l.created_at, id: l.id, code: l.code || '', name: l.gifter || 'Someone',
    text: (l.platform === 'youpay' ? 'YouPay' : 'Throne') + ' payment' + (l.amount_cents ? ' of ' + money(l.amount_cents) : '') + ' came in, but the wallet code wasn’t clear', note: l.message || '', cents: l.amount_cents }));
  reports.results.forEach(r => items.push({ key: 'report:' + r.id, kind: 'report', at: r.created_at, id: r.id, code: r.code, name: r.name,
    text: 'says a LOAD ' + money(r.amount_cents) + ' didn’t show up', note: [r.sent_when ? 'sent ' + r.sent_when : '', r.throne ? 'Throne: ' + r.throne : '', r.note || ''].filter(Boolean).join(' · '), cents: r.amount_cents }));
  reqs.results.forEach(r => items.push({ key: 'req:' + r.id, kind: r.kind === 'new_code' ? 'newcode' : 'issue', at: r.created_at, id: r.id, code: r.code, name: r.name,
    text: r.kind === 'new_code' ? 'asked for a new wallet code' : 'reported a problem with ' + (r.game || 'a game'), note: r.note || '' }));
  closes.results.forEach(c => items.push({ key: 'close:' + c.wallet_id + ':' + c.created_at, kind: 'close', at: c.created_at, code: c.code, name: c.name,
    text: 'asked you to close their wallet', note: 'Balance ' + money(c.balance_cents) }));
  nudges.results.forEach(n => { const k = 'nudge:' + n.id; if (!seen.has(k)) items.push({ key: k, kind: 'nudge', at: n.closed_at, code: n.code, name: n.name,
    text: n.response === 'promise' ? 'answered your nudge: “I promise I’ll do better”' : 'answered your nudge by starting a financial break', note: n.message ? 'You said: ' + n.message : '' }); });
  breaks.results.forEach(k => { const key = 'break:' + k.wallet_id + ':' + k.created_at; if (!seen.has(key)) items.push({ key, kind: 'break', at: k.created_at, code: k.code, name: k.name,
    text: 'started a financial break', note: 'Nudges are paused for them' }); });
  items.sort((a, b) => b.at - a.at);
  return json({ items });
};
routes['POST hq/inbox-seen'] = async (env, request) => {
  await needHQ(env, request);
  const key = String((await readJson(request)).key || '').slice(0, 80);
  if (!/^(nudge|break):/.test(key)) throw new Oops('That one goes away once it’s handled.');
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS inbox_seen (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  await env.DB.prepare('INSERT OR IGNORE INTO inbox_seen (key, at) VALUES (?, ?)').bind(key, Date.now()).run();
  return json({ ok: true });
};

// Fan requests: game problems and new-code requests
routes['GET hq/requests'] = async (env, request, url) => {
  await needHQ(env, request);
  const status = url.searchParams.get('status') || 'open';
  const rows = (await env.DB.prepare(
    `SELECT r.*, w.display_code, w.name, w.anon_number FROM fan_requests r JOIN wallets w ON w.id = r.wallet_id
     ${status === 'all' ? '' : 'WHERE r.status = ?'} ORDER BY r.id DESC LIMIT 100`
  ).bind(...(status === 'all' ? [] : [status])).all()).results;
  return json({ rows });
};
routes['POST hq/request'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const r = await env.DB.prepare('SELECT * FROM fan_requests WHERE id = ?').bind(b.id).first();
  if (!r || r.status !== 'open') throw new Oops('That request was already handled.');
  const msg = String(b.message || '').trim().slice(0, 200) || (b.action === 'decline' ? 'Gnomie couldn’t do this one. Message her on Telegram.' : 'Handled by Gnomie.');
  await env.DB.prepare('UPDATE fan_requests SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?').bind(b.action === 'decline' ? 'declined' : 'done', msg, Date.now(), r.id).run();
  await logEvent(env, request, 'backstage_request_' + (b.action === 'decline' ? 'declined' : 'done'), r.wallet_id, REQUEST_KINDS[r.kind] + ' · ' + msg);
  return json({ ok: true });
};
// Give a wallet a brand-new code. The old one stops working right away.
routes['POST hq/new-code'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const w = await hqWallet(env.DB, b.code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const display = randomCode();
    const r = await env.DB.prepare('UPDATE wallets SET code = ?, display_code = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM wallets WHERE code = ?)')
      .bind(normalizeCode(display), display, w.id, normalizeCode(display)).run();
    if (r.meta.changes === 1) {
      await env.DB.prepare("UPDATE fan_requests SET status = 'done', resolution = 'Your new wallet code is ready. It’s in your wallet now, and your old code no longer works.', resolved_at = ? WHERE wallet_id = ? AND kind = 'new_code' AND status = 'open'").bind(Date.now(), w.id).run();
      await logEvent(env, request, 'backstage_new_code', w.id, w.display_code + ' → ' + display);
      return json({ ok: true, code: display });
    }
  }
  throw new Oops('Busy. Please try again.', 409);
};

// Gnomie's private notes about a wallet
routes['POST hq/note'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const note = String(b.note || '').trim().slice(0, 2000);
  if (!note) throw new Oops('Write a note first.');
  const now = Date.now();
  if (b.id) {
    const r = await env.DB.prepare('UPDATE wallet_notes SET note = ?, updated_at = ? WHERE id = ?').bind(note, now, b.id).run();
    if (!r.meta.changes) throw new Oops('That note is gone.');
  } else {
    const w = await hqWallet(env.DB, b.code);
    await env.DB.prepare('INSERT INTO wallet_notes (wallet_id, note, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(w.id, note, now, now).run();
  }
  return json({ ok: true });
};
routes['POST hq/note-delete'] = async (env, request) => {
  await needHQ(env, request);
  await env.DB.prepare('DELETE FROM wallet_notes WHERE id = ?').bind((await readJson(request)).id).run();
  return json({ ok: true });
};

// Telegram / Throne usernames (the fan can fill these in too)
routes['POST hq/contacts'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const w = await hqWallet(env.DB, b.code);
  const tg = cleanHandle(b.telegram), th = cleanHandle(b.throne);
  await env.DB.prepare('INSERT INTO wallet_contacts (wallet_id, telegram, throne, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(wallet_id) DO UPDATE SET telegram = excluded.telegram, throne = excluded.throne, updated_at = excluded.updated_at')
    .bind(w.id, tg || null, th || null, Date.now()).run();
  return json({ ok: true });
};

// Show or hide the note on a balance change (and fix its wording)
routes['POST hq/adjustment-note'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const note = String(b.note == null ? '' : b.note).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) || null;
  const r = await env.DB.prepare('UPDATE adjustments SET note = ?, public = ? WHERE id = ?').bind(note, b.public ? 1 : 0, b.id).run();
  if (!r.meta.changes) throw new Oops('That change is gone.');
  const row = await env.DB.prepare('SELECT wallet_id FROM adjustments WHERE id = ?').bind(b.id).first();
  await logEvent(env, request, 'backstage_note_changed', row.wallet_id, (b.public ? 'Shown to them: ' : 'Private: ') + (note || '(no note)'));
  return json({ ok: true });
};

// Delete a wallet for good (only if it was never used; otherwise close it)
routes['POST hq/delete'] = async (env, request) => {
  await needHQ(env, request);
  const w = await hqWallet(env.DB, (await readJson(request)).code);
  if (!(await walletUnused(env.DB, w.id))) throw new Oops('This wallet has loads or games, so it can’t be deleted. Close it instead.');
  await logEvent(env, request, 'backstage_deleted', null, w.display_code + ' (' + (w.name || 'Anonymous #' + w.anon_number) + ') deleted');
  await deleteWalletRows(env.DB, w.id);
  return json({ ok: true });
};

// Spoof wallet on/off (left out of statistics; all colors unlocked)
routes['POST hq/spoof'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const w = await hqWallet(env.DB, b.code);
  if (b.on) await env.DB.prepare('INSERT OR IGNORE INTO spoofs (wallet_id, created_at) VALUES (?, ?)').bind(w.id, Date.now()).run();
  else await env.DB.prepare('DELETE FROM spoofs WHERE wallet_id = ?').bind(w.id).run();
  await logEvent(env, request, b.on ? 'backstage_spoof_on' : 'backstage_spoof_off', w.id, '');
  return json({ ok: true });
};
routes['POST hq/spoof-threshold'] = async (env, request) => {
  await needHQ(env, request);
  const cents = Math.round(Number((await readJson(request)).cents));
  if (!Number.isInteger(cents) || cents < 0 || cents > 100000) throw new Oops('Enter an amount.');
  await hqSet(env.DB, 'spoof_threshold_cents', cents);
  return json({ ok: true });
};
// Unlock every color for a wallet (or take the extra unlocks back)
routes['POST hq/unlock-colors'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const w = await hqWallet(env.DB, b.code);
  await env.DB.prepare('INSERT INTO color_unlocks (wallet_id, bonus) VALUES (?, ?) ON CONFLICT(wallet_id) DO UPDATE SET bonus = excluded.bonus').bind(w.id, b.all ? 99 : 0).run();
  await logEvent(env, request, 'backstage_colors', w.id, b.all ? 'All colors unlocked' : 'Extra color unlocks removed');
  return json({ ok: true });
};

// Record a Throne load by hand (when the automatic notice didn't land, or to fix a
// mistake): the Throne amount + order number count as a real load in Money, and
// any bonus is added separately. Both show to the fan as a correction.
async function recordManualLoad(env, request, w, cents, order, bonus, note) {
  const now = Date.now();
  const stmts = [];
  if (cents > 0) {
    stmts.push(env.DB.prepare(`INSERT INTO loads (platform, external_id, wallet_id, amount_cents, paid_cents, currency, gifter, message, item_name, status, created_at, updated_at)
      VALUES ('throne', ?, ?, ?, ?, 'USD', '', ?, 'correction', 'credited', ?, ?)`).bind('manual:' + (order || now) + ':' + now, w.id, cents, cents, (note || '').slice(0, 300), now, now));
  }
  if (bonus > 0) stmts.push(env.DB.prepare('INSERT INTO adjustments (wallet_id, cents, kind, note, public, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(w.id, bonus, 'bonus', 'Correction: bonus from Gnomie' + (order ? ' (order #' + order + ')' : ''), now));
  stmts.push(env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?').bind(cents + bonus, cents, w.id));
  await env.DB.batch(stmts);
  await logEvent(env, request, 'backstage_recorded_load', w.id, 'Throne ' + money(cents) + (order ? ' · order #' + order : '') + (bonus ? ' + bonus ' + money(bonus) : ''));
}
function cleanOrder(v) { return String(v || '').replace(/[^A-Za-z0-9\-]/g, '').slice(0, 40); }
routes['POST hq/record-load'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const w = await hqWallet(env.DB, b.code);
  const cents = Math.round(Number(b.cents || 0)), bonus = Math.round(Number(b.bonus || 0));
  if (!Number.isInteger(cents) || !Number.isInteger(bonus) || cents < 0 || bonus < 0 || cents + bonus <= 0 || cents > 1000000) throw new Oops('Enter the Throne amount (and any bonus).');
  await recordManualLoad(env, request, w, cents, cleanOrder(b.order), bonus, b.note);
  return json({ ok: true });
};
// Fix a load later: new amount and/or order number (the balance follows the difference)
routes['POST hq/edit-load'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const l = await env.DB.prepare("SELECT * FROM loads WHERE id = ? AND status = 'credited'").bind(b.id).first();
  if (!l || !l.wallet_id) throw new Oops('That load can’t be edited.');
  const cents = Math.round(Number(b.cents));
  if (!Number.isInteger(cents) || cents <= 0) throw new Oops('Enter the amount.');
  const diff = cents - l.amount_cents, order = cleanOrder(b.order);
  const ext = order ? 'manual:' + order + ':' + l.id : l.external_id;
  await env.DB.batch([
    env.DB.prepare("UPDATE loads SET amount_cents = ?, paid_cents = ?, external_id = ?, item_name = 'correction', updated_at = ? WHERE id = ?").bind(cents, cents, ext, Date.now(), l.id),
    env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?').bind(diff, diff, l.wallet_id)
  ]);
  await logEvent(env, request, 'backstage_edited_load', l.wallet_id, money(l.amount_cents) + ' → ' + money(cents) + (order ? ' · order #' + order : ''));
  return json({ ok: true });
};
// Turn an older hand-added balance change into a proper Throne load (+ bonus)
routes['POST hq/adjustment-to-load'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const a = await env.DB.prepare('SELECT * FROM adjustments WHERE id = ?').bind(b.id).first();
  if (!a || a.cents <= 0) throw new Oops('That change can’t be turned into a load.');
  const cents = Math.round(Number(b.cents || 0)), bonus = Math.round(Number(b.bonus || 0));
  if (cents + bonus !== a.cents) throw new Oops('The load and bonus need to add up to ' + money(a.cents) + '.');
  const w = await env.DB.prepare('SELECT * FROM wallets WHERE id = ?').bind(a.wallet_id).first();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM adjustments WHERE id = ?').bind(a.id),
    env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, total_loaded_cents = total_loaded_cents - ? WHERE id = ?').bind(a.cents, a.kind === 'load' ? a.cents : 0, a.wallet_id)
  ]);
  await recordManualLoad(env, request, w, cents, cleanOrder(b.order), bonus, a.note);
  return json({ ok: true });
};

// Nudge to add money: a banner in their wallet until they close it
routes['POST hq/nudge'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const w = await hqWallet(env.DB, b.code);
  if (w.status !== 'active') throw new Oops('This wallet isn’t open.');
  if (w.break_since) throw new Oops('They’re on a financial break, so nudges are paused.');
  const message = String(b.message || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 140) || null;
  await env.DB.prepare('INSERT INTO nudges (wallet_id, message, created_at) VALUES (?, ?, ?)').bind(w.id, message, Date.now()).run();
  await logEvent(env, request, 'backstage_nudge', w.id, message || '(no message)');
  return json({ ok: true });
};

routes['POST hq/assign-load'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const load = await env.DB.prepare('SELECT * FROM loads WHERE id = ?').bind(b.loadId).first();
  if (!load || load.status !== 'needs_review') throw new Oops('That load was already handled.');
  const cents = Math.round(Number(b.cents));
  if (!Number.isInteger(cents) || cents <= 0) throw new Oops('Enter the amount to credit.');
  const w = await hqWallet(env.DB, b.code);
  const r = await env.DB.prepare("UPDATE loads SET status = 'credited', wallet_id = ?, amount_cents = ?, updated_at = ? WHERE id = ? AND status = 'needs_review'")
    .bind(w.id, cents, Date.now(), load.id).run();
  if (r.meta.changes !== 1) throw new Oops('That load was already handled.');
  await env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?')
    .bind(cents, cents, w.id).run();
  await logEvent(env, request, 'backstage_load_credited', w.id, 'Load #' + load.id + ' (' + load.platform + ') → ' + money(cents));
  return json({ ok: true });
};

routes['POST hq/dismiss-load'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const r = await env.DB.prepare("UPDATE loads SET status = 'gift', updated_at = ? WHERE id = ? AND status = 'needs_review'")
    .bind(Date.now(), b.loadId).run();
  if (r.meta.changes !== 1) throw new Oops('That load was already handled.');
  await logEvent(env, request, 'backstage_kept_as_gift', null, 'Load #' + b.loadId);
  return json({ ok: true });
};

routes['POST hq/set-pin'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  if (!/^(\d{4}|\d{6})$/.test(String(b.pin || ''))) throw new Oops('PIN must be 4 or 6 digits.');
  const w = await hqWallet(env.DB, b.code);
  const salt = randomHex(16);
  await env.DB.prepare('UPDATE wallets SET pin_hash = ?, pin_salt = ?, pin_length = ?, failed_pin_count = 0, locked_until = 0 WHERE id = ?')
    .bind(await pinHash(b.pin, salt), salt, b.pin.length, w.id).run();
  await logEvent(env, request, 'backstage_pin_reset', w.id, 'New PIN set in Backstage');
  return json({ ok: true });
};

routes['POST hq/rename'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const w = await hqWallet(env.DB, b.code);
  const name = b.anonymous ? null : String(b.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 24) || null;
  if (name && await nameTaken(env.DB, name, w.id)) throw new Oops('Another wallet already has that name.');
  await env.DB.prepare('UPDATE wallets SET name = ? WHERE id = ?').bind(name, w.id).run();
  await logEvent(env, request, 'backstage_rename', w.id, (w.name || 'Anonymous #' + w.anon_number) + ' → ' + (name || 'Anonymous #' + w.anon_number));
  return json({ ok: true });
};

routes['POST hq/2fa-off'] = async (env, request) => {
  await needHQ(env, request);
  const w = await hqWallet(env.DB, (await readJson(request)).code);
  await env.DB.prepare('DELETE FROM wallet_totp WHERE wallet_id = ?').bind(w.id).run();
  await logEvent(env, request, 'backstage_2fa_off', w.id, 'Fan’s authenticator app removed in Backstage');
  return json({ ok: true });
};

routes['POST hq/unlock'] = async (env, request) => {
  await needHQ(env, request);
  const w = await hqWallet(env.DB, (await readJson(request)).code);
  await env.DB.prepare('UPDATE wallets SET failed_pin_count = 0, locked_until = 0 WHERE id = ?').bind(w.id).run();
  await logEvent(env, request, 'backstage_unlock', w.id, '');
  return json({ ok: true });
};

routes['POST hq/signout-all'] = async (env, request) => {
  await needHQ(env, request);
  const w = await hqWallet(env.DB, (await readJson(request)).code);
  const r = await env.DB.prepare('DELETE FROM sessions WHERE wallet_id = ?').bind(w.id).run();
  await logEvent(env, request, 'backstage_signout_all', w.id, r.meta.changes + ' device(s) signed out');
  return json({ ok: true });
};

routes['POST hq/status'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  if (['active', 'banned', 'closed'].indexOf(b.status) === -1) throw new Oops('Bad status.');
  const w = await hqWallet(env.DB, b.code);
  if (b.status === 'closed' && (w.held_duel || w.held_toofar || w.held_mancala || w.held_five)) throw new Oops('They have a game in progress. Try again once it’s finished.');
  await env.DB.prepare('UPDATE wallets SET status = ?, failed_pin_count = 0, locked_until = 0 WHERE id = ?').bind(b.status, w.id).run();
  if (b.status !== 'active') await env.DB.prepare('DELETE FROM sessions WHERE wallet_id = ?').bind(w.id).run();
  if (b.status === 'closed') await env.DB.prepare('DELETE FROM close_requests WHERE wallet_id = ?').bind(w.id).run();
  const what = b.status === 'banned' ? 'backstage_ban' : b.status === 'closed' ? 'backstage_close' : w.status === 'closed' ? 'backstage_reopen' : 'backstage_unban';
  await logEvent(env, request, what, w.id, b.status === 'closed' ? 'Balance at closing: ' + money(w.balance_cents) : '');
  return json({ ok: true });
};

// ---------- router ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const handler = routes[request.method + ' ' + path];
  if (!handler) return json({ error: 'Not found.' }, 404);
  if (!env.DB) return json({ error: 'The games are being set up. Please check back soon.' }, 503);
  try {
    await ensureSchema(env.DB);
    return await handler(env, request, url);
  } catch (e) {
    if (e instanceof Oops) return json(Object.assign({ error: e.message }, e.extra || {}), e.status);
    console.error(e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
