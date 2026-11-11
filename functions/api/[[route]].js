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
  randomCode, normalizeCode
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
async function logEvent(env, request, action, walletId, detail) {
  try {
    const country = request && request.cf && request.cf.country ? request.cf.country : null;
    await env.DB.prepare('INSERT INTO admin_log (action, wallet_id, detail, created_at) VALUES (?, ?, ?, ?)')
      .bind(action, walletId || null, String(detail == null ? '' : detail).slice(0, 8000) + (country ? ' [' + country + ']' : ''), Date.now()).run();
  } catch (e) { console.error('log failed', e); }
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
    db.prepare(`CREATE TABLE IF NOT EXISTS wallet_totp (wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id), secret TEXT, pending TEXT, last_step INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`)
  ]);
  schemaReady = true;
}

// ---------- unfinished wallets ----------
// A wallet that never got a PIN (and never had money or games) is removed
// 30 minutes after it was made. If that visitor comes back, their wallet box
// starts over from the beginning. Runs at most once every 5 minutes.
const UNFINISHED_MS = 30 * 60 * 1000;
let lastCleanup = 0;
async function cleanUnfinished(env, request) {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  try {
    const db = env.DB;
    const old = (await db.prepare(
      `SELECT id, display_code FROM wallets w
       WHERE w.pin_hash IS NULL AND w.created_at < ? AND w.balance_cents = 0 AND w.total_loaded_cents = 0
         AND NOT EXISTS (SELECT 1 FROM drops d WHERE d.wallet_id = w.id)
         AND NOT EXISTS (SELECT 1 FROM duels u WHERE u.wallet_id = w.id)
         AND NOT EXISTS (SELECT 1 FROM loads l WHERE l.wallet_id = w.id)
       LIMIT 50`
    ).bind(now - UNFINISHED_MS).all()).results;
    for (const w of old) {
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE wallet_id = ?').bind(w.id),
        db.prepare('DELETE FROM wallet_totp WHERE wallet_id = ?').bind(w.id),
        db.prepare('DELETE FROM reigns WHERE wallet_id = ?').bind(w.id),
        db.prepare('UPDATE admin_log SET wallet_id = NULL WHERE wallet_id = ?').bind(w.id),
        db.prepare('DELETE FROM wallets WHERE id = ? AND pin_hash IS NULL').bind(w.id)
      ]);
      await logEvent(env, request, 'wallet_expired', null, w.display_code + ' (no PIN after 30 minutes)');
    }
  } catch (e) { console.error('cleanup failed', e); }
}

// ---------- wallets ----------
const WALLET_SELECT = `SELECT w.*,
  (SELECT held_cents FROM duels d WHERE d.wallet_id = w.id AND d.status = 'active') AS held_cents,
  (SELECT COUNT(*) FROM duels d WHERE d.wallet_id = w.id AND d.outcome = 'win') AS duel_wins,
  (SELECT t.secret IS NOT NULL FROM wallet_totp t WHERE t.wallet_id = w.id) AS two_factor
  FROM wallets w`;

function publicWallet(w) {
  if (!w) return null;
  return {
    code: w.display_code, hasPin: !!w.pin_hash, pinLength: w.pin_length || null,
    name: w.name, anonymous: !w.name, anonNumber: w.anon_number,
    balanceCents: w.balance_cents, drainedCents: w.total_drained_cents, loadedCents: w.total_loaded_cents,
    heldCents: w.held_cents || 0, duelWins: w.duel_wins || 0, twoFactor: !!w.two_factor
  };
}

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
  if (!w || w.status === 'banned') return null;
  return w;
}

async function needWallet(env, request) {
  const w = await sessionWallet(env, request);
  if (!w) throw new Oops('Set up your wallet first.', 401);
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

routes['POST name'] = async (env, request) => {
  const w = await needWallet(env, request);
  const body = await readJson(request);
  let name = String(body.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ');
  if (body.anonymous) name = null;
  else {
    if (name.length < 2 || name.length > 24) throw new Oops('Names need 2–24 characters.');
    if (/^anonymous|gnomie/i.test(name)) throw new Oops('Please pick a different name.');
  }
  await env.DB.prepare('UPDATE wallets SET name = ? WHERE id = ?').bind(name, w.id).run();
  await logEvent(env, request, 'name_set', w.id, name || 'Anonymous #' + w.anon_number);
  return json({ wallet: publicWallet(await walletById(env.DB, w.id)) });
};

routes['POST signin'] = async (env, request) => {
  const body = await readJson(request);
  const code = normalizeCode(body.code), pin = String(body.pin || '');
  const fail = new Oops("That code and PIN don't match.", 401);
  if (code.length !== 16 || !/^\d{4,6}$/.test(pin)) throw fail;
  const w = await env.DB.prepare('SELECT * FROM wallets WHERE code = ?').bind(code).first();
  if (!w || !w.pin_hash || w.status === 'banned') {
    await logEvent(env, request, 'signin_failed', w ? w.id : null, w ? (w.status === 'banned' ? 'Banned wallet' : 'No PIN set') : 'Unknown code');
    throw fail;
  }
  const now = Date.now();
  if (w.locked_until > now) throw new Oops('Too many tries. Please wait ' + Math.ceil((w.locked_until - now) / 60000) + ' minutes and try again.', 429);
  if (!safeEqual(await pinHash(pin, w.pin_salt), w.pin_hash)) {
    const tries = w.failed_pin_count + 1;
    await env.DB.prepare('UPDATE wallets SET failed_pin_count = ?, locked_until = ? WHERE id = ?')
      .bind(tries >= PIN_TRIES ? 0 : tries, tries >= PIN_TRIES ? now + PIN_LOCK_MS : 0, w.id).run();
    await logEvent(env, request, tries >= PIN_TRIES ? 'signin_locked' : 'signin_failed', w.id, tries >= PIN_TRIES ? 'Locked 15 minutes after ' + PIN_TRIES + ' wrong PINs' : 'Wrong PIN (' + tries + ' of ' + PIN_TRIES + ')');
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
        .bind(tries >= PIN_TRIES ? 0 : tries, tries >= PIN_TRIES ? now + PIN_LOCK_MS : 0, w.id).run();
      await logEvent(env, request, tries >= PIN_TRIES ? 'signin_locked' : 'signin_failed', w.id, tries >= PIN_TRIES ? 'Locked 15 minutes after ' + PIN_TRIES + ' wrong tries' : 'Right PIN, wrong app code (' + tries + ' of ' + PIN_TRIES + ')');
      throw new Oops('That app code didn’t work. Use the newest code.', 401, { needsCode: true });
    }
    await env.DB.prepare('UPDATE wallet_totp SET last_step = ? WHERE wallet_id = ?').bind(step, w.id).run();
  }
  await env.DB.prepare('UPDATE wallets SET failed_pin_count = 0, locked_until = 0 WHERE id = ?').bind(w.id).run();
  const cookie = await newSession(env.DB, w.id);
  await logEvent(env, request, 'signin_ok', w.id, tf ? 'PIN + app code' : 'PIN');
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

// Local testing only (never turned on in Cloudflare)
routes['POST test-credit'] = async (env, request) => {
  if (env.ALLOW_TEST_CREDIT !== '1') throw new Oops('Not found.', 404);
  const w = await needWallet(env, request);
  const { cents } = await readJson(request);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100000) throw new Oops('Bad amount.');
  await env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?')
    .bind(cents, cents, w.id).run();
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
  if (DUEL.AMOUNTS.indexOf(amount) === -1) throw new Oops('Pick an amount to play for.');
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

// ---------- routes: leaderboards ----------
// Only rank, name and how long they've held their spot ever leave the server.
const BOARD_SQL = {
  'all': `SELECT id AS wallet_id, total_drained_cents AS score FROM wallets WHERE total_drained_cents > 0 AND status != 'banned'`,
  'drop-the-ball': `SELECT d.wallet_id, SUM(d.amount_cents) AS score FROM drops d JOIN wallets w ON w.id = d.wallet_id
                    WHERE d.game = 'drop-the-ball' AND w.status != 'banned' GROUP BY d.wallet_id HAVING score > 0`,
  'dice-duel': `SELECT d.wallet_id, SUM(d.paid_cents) AS score FROM duels d JOIN wallets w ON w.id = d.wallet_id
                WHERE d.status = 'done' AND w.status != 'banned' GROUP BY d.wallet_id HAVING score > 0`,
  'dice-duel-wins': `SELECT d.wallet_id, COUNT(*) AS score FROM duels d JOIN wallets w ON w.id = d.wallet_id
                     WHERE d.outcome = 'win' AND w.status != 'banned' GROUP BY d.wallet_id`
};

routes['GET leaderboard'] = async (env, request, url) => {
  const key = url.searchParams.get('board') || 'all';
  if (!BOARD_SQL[key]) throw new Oops('Unknown board.');
  const db = env.DB, now = Date.now();
  const me = await sessionWallet(env, request);
  const top = (await db.prepare(
    `SELECT s.wallet_id, s.score, w.name, w.anon_number FROM (${BOARD_SQL[key]}) s JOIN wallets w ON w.id = s.wallet_id
     ORDER BY s.score DESC, s.wallet_id ASC LIMIT 10`
  ).all()).results;

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
    rank: i + 1, name: nameOf(r),
    reignDays: Math.max(1, Math.round((now - (since[i + 1] || now)) / DAY)),
    me: !!me && r.wallet_id === me.id
  }));
  // Your own spot, even if you're not in the top 10
  if (me && !rows.some(r => r.me)) {
    const mine = await db.prepare(`SELECT score FROM (${BOARD_SQL[key]}) WHERE wallet_id = ?`).bind(me.id).first();
    if (mine) {
      const ahead = await db.prepare(
        `SELECT COUNT(*) AS n FROM (${BOARD_SQL[key]}) WHERE score > ? OR (score = ? AND wallet_id < ?)`
      ).bind(mine.score, mine.score, me.id).first();
      rows.push({ rank: ahead.n + 1, name: nameOf(me), reignDays: 1, me: true });
    }
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

async function needHQ(env, request) {
  if (!env.ADMIN_PASSWORD) throw new Oops('Backstage password not set up yet.', 503);
  await hqSchema(env.DB);
  if (await hqLocked(env.DB)) throw new Oops('Backstage is locked.', 423, { locked: true });
  const token = getCookie(request, HQ_COOKIE);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    const ok = await env.DB.prepare('SELECT 1 FROM backstage_sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha256(token), Date.now()).first();
    if (ok) return;
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
  const passOk = safeEqual(String(password || ''), env.ADMIN_PASSWORD);
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
  try { await needHQ(env, request); } catch (e) { signedIn = false; }
  return json({ ready: true, signedIn, twoFactor: !!(await hqGet(env.DB, 'totp_secret')) });
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

async function hqWallet(db, code) {
  const w = await db.prepare(WALLET_SELECT + ' WHERE w.code = ?').bind(normalizeCode(code)).first();
  if (!w) throw new Oops('No wallet with that code.', 404);
  return w;
}
function hqWalletView(w) {
  return {
    id: w.id, code: w.display_code, name: w.name || ('Anonymous #' + w.anon_number), anonymous: !w.name,
    balanceCents: w.balance_cents, loadedCents: w.total_loaded_cents, spentCents: w.total_drained_cents,
    heldCents: w.held_cents || 0, duelWins: w.duel_wins || 0, hasPin: !!w.pin_hash, pinLength: w.pin_length, twoFactor: !!w.two_factor,
    failedPins: w.failed_pin_count, locked: w.locked_until > Date.now(), lockedUntil: w.locked_until,
    status: w.status, createdAt: w.created_at
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
         dailyLoads, dailyDrops, dailyDuels, dailyWallets, topLoaded, topSpent, events] = await Promise.all([
    one(`SELECT COUNT(*) AS total,
           SUM(pin_hash IS NOT NULL) AS with_pin, SUM(status = 'banned') AS banned, SUM(name IS NOT NULL) AS named,
           SUM(created_at >= ?) AS new_today, SUM(created_at >= ?) AS new_7d, SUM(created_at >= ?) AS new_30d,
           SUM(balance_cents > 0) AS with_balance, SUM(locked_until > ?) AS locked_now
         FROM wallets`, today, d7, d30, now),
    one(`SELECT COALESCE(SUM(balance_cents), 0) AS balances, COALESCE(SUM(total_loaded_cents), 0) AS loaded,
           COALESCE(SUM(total_drained_cents), 0) AS spent,
           (SELECT COALESCE(SUM(held_cents), 0) FROM duels WHERE status = 'active') AS held,
           (SELECT COUNT(DISTINCT wallet_id) FROM (
              SELECT wallet_id FROM drops WHERE created_at >= ? UNION SELECT wallet_id FROM duels WHERE created_at >= ?
              UNION SELECT wallet_id FROM loads WHERE created_at >= ? AND wallet_id IS NOT NULL)) AS active_7d
         FROM wallets`, d7, d7, d7),
    all(`SELECT platform, status, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COALESCE(SUM(paid_cents), 0) AS paid,
           SUM(created_at >= ?) AS n_today, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_today,
           SUM(created_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_7d,
           SUM(created_at >= ?) AS n_30d, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_30d
         FROM loads GROUP BY platform, status`, today, today, d7, d7, d30, d30),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players,
           SUM(created_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_cents END), 0) AS cents_7d
         FROM drops`, d7, d7),
    all(`SELECT board, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players FROM drops GROUP BY board`),
    all(`SELECT board, aim, slot, COUNT(*) AS n FROM drops GROUP BY board, aim, slot`),
    one(`SELECT COUNT(*) AS n, SUM(status = 'active') AS active, SUM(outcome = 'win') AS wins, SUM(outcome = 'tie') AS ties,
           SUM(outcome = 'lose') AS losses, COALESCE(SUM(paid_cents), 0) AS cents, COUNT(DISTINCT wallet_id) AS players,
           AVG(you_score) AS avg_you, AVG(gnomie_score) AS avg_gnomie,
           SUM(status = 'done' AND finished_at >= ?) AS n_7d, COALESCE(SUM(CASE WHEN finished_at >= ? THEN paid_cents END), 0) AS cents_7d
         FROM duels`, d7, d7),
    all(`SELECT amount_cents, COUNT(*) AS n, SUM(outcome = 'win') AS wins, SUM(outcome = 'tie') AS ties, SUM(outcome = 'lose') AS losses,
           COALESCE(SUM(paid_cents), 0) AS cents FROM duels WHERE status = 'done' GROUP BY amount_cents ORDER BY amount_cents`),
    all(`SELECT CAST((created_at - ?) / ${DAY} AS INTEGER) AS day, platform, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents
         FROM loads WHERE created_at >= ? AND status = 'credited' GROUP BY day, platform`, since, since),
    all(`SELECT CAST((created_at - ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents
         FROM drops WHERE created_at >= ? GROUP BY day`, since, since),
    all(`SELECT CAST((finished_at - ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS n, COALESCE(SUM(paid_cents), 0) AS cents
         FROM duels WHERE status = 'done' AND finished_at >= ? GROUP BY day`, since, since),
    all(`SELECT CAST((created_at - ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS n FROM wallets WHERE created_at >= ? GROUP BY day`, since, since),
    all(`SELECT display_code, name, anon_number, total_loaded_cents AS cents FROM wallets WHERE total_loaded_cents > 0 ORDER BY cents DESC LIMIT 10`),
    all(`SELECT display_code, name, anon_number, total_drained_cents AS cents FROM wallets WHERE total_drained_cents > 0 ORDER BY cents DESC LIMIT 10`),
    all(`SELECT action, COUNT(*) AS n, SUM(created_at >= ?) AS n_today, SUM(created_at >= ?) AS n_7d FROM admin_log GROUP BY action`, today, d7)
  ]);

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
  dailyWallets.forEach(r => { const s = series[r.day]; if (s) s.wallets += r.n; });

  const nm = r => ({ code: r.display_code, name: r.name || ('Anonymous #' + r.anon_number), cents: r.cents });
  return json({
    generatedAt: now, days, wallets, money, loads: loadsBy,
    drop: { totals: dropTotals, boards: dropBoards, fairness },
    duel: { totals: duelTotals, byAmount: duelByAmount },
    series, topLoaded: topLoaded.map(nm), topSpent: topSpent.map(nm), events
  });
};

// Leaderboards with the real amounts (only you see these)
routes['GET hq/leaderboard'] = async (env, request, url) => {
  await needHQ(env, request);
  const key = url.searchParams.get('board') || 'all';
  if (!BOARD_SQL[key]) throw new Oops('Unknown board.');
  const rows = (await env.DB.prepare(
    `SELECT s.score, w.display_code, w.name, w.anon_number,
       (SELECT started_at FROM reigns r WHERE r.board_key = ? AND r.wallet_id = s.wallet_id AND r.ended_at IS NULL) AS reign_start
     FROM (${BOARD_SQL[key]}) s JOIN wallets w ON w.id = s.wallet_id ORDER BY s.score DESC, s.wallet_id ASC LIMIT 50`
  ).bind(key).all()).results;
  return json({ rows: rows.map((r, i) => ({ rank: i + 1, code: r.display_code, name: r.name || ('Anonymous #' + r.anon_number), score: r.score, reignStart: r.reign_start })) });
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
  if (q.get('board')) { where.push('d.board = ?'); b.push(q.get('board')); }
  if (q.get('before')) { where.push('d.id < ?'); b.push(+q.get('before')); }
  if (q.get('wallet')) { where.push('w.code = ?'); b.push(normalizeCode(q.get('wallet'))); }
  const rows = (await env.DB.prepare(
    `SELECT d.id, d.board, d.aim, d.slot, d.amount_cents, d.created_at, w.display_code, w.name, w.anon_number
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
  const sorts = { newest: 'w.id DESC', balance: 'w.balance_cents DESC', loaded: 'w.total_loaded_cents DESC', spent: 'w.total_drained_cents DESC', name: 'COALESCE(w.name, \'~\') ASC' };
  const order = sorts[q.get('sort')] || sorts.newest;
  const where = [], b = [];
  if (search) {
    where.push('(w.code LIKE ? OR LOWER(COALESCE(w.name, \'\')) LIKE ? OR (\'anonymous #\' || w.anon_number) LIKE ?)');
    b.push('%' + normalizeCode(search) + '%', '%' + search.toLowerCase() + '%', '%' + search.toLowerCase() + '%');
  }
  if (q.get('status')) { where.push('w.status = ?'); b.push(q.get('status')); }
  const rows = (await env.DB.prepare(
    `${WALLET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`
  ).bind(...b, clampInt(q.get('limit'), 1, 500, 100)).all()).results;
  return json({ rows: rows.map(hqWalletView) });
};

// One wallet, everything about it
routes['GET hq/wallet'] = async (env, request, url) => {
  await needHQ(env, request);
  const w = await hqWallet(env.DB, url.searchParams.get('code'));
  const db = env.DB;
  const [loads, drops, duels, events, sessions, perGame] = await Promise.all([
    db.prepare('SELECT * FROM loads WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT id, board, aim, slot, amount_cents, created_at FROM drops WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT id, amount_cents, held_cents, status, outcome, you_score, gnomie_score, paid_cents, created_at, finished_at FROM duels WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT * FROM admin_log WHERE wallet_id = ? ORDER BY id DESC LIMIT 100').bind(w.id).all(),
    db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM sessions WHERE wallet_id = ? AND expires_at > ?').bind(w.id, Date.now()).first(),
    db.prepare(`SELECT 'drop-the-ball' AS game, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM drops WHERE wallet_id = ?
                UNION ALL SELECT 'dice-duel', COUNT(*), COALESCE(SUM(paid_cents), 0) FROM duels WHERE wallet_id = ? AND status = 'done'`).bind(w.id, w.id).all()
  ]);
  return json({
    wallet: hqWalletView(w), devices: sessions.n, lastSignIn: sessions.last, perGame: perGame.results,
    loads: loads.results, drops: drops.results, duels: duels.results, events: events.results
  });
};

// ---------- Backstage actions (each one is logged) ----------
routes['POST hq/adjust'] = async (env, request) => {
  await needHQ(env, request);
  const b = await readJson(request);
  const cents = Math.round(Number(b.cents));
  if (!Number.isInteger(cents) || cents === 0 || Math.abs(cents) > 1000000) throw new Oops('Enter an amount.');
  const w = await hqWallet(env.DB, b.code);
  const asLoad = b.kind === 'load';
  await env.DB.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, total_loaded_cents = total_loaded_cents + ? WHERE id = ?')
    .bind(cents, asLoad ? cents : 0, w.id).run();
  await logEvent(env, request, asLoad ? 'backstage_manual_load' : 'backstage_balance_fix', w.id, money(cents) + (b.note ? ' · ' + b.note : ''));
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
  if (['active', 'banned'].indexOf(b.status) === -1) throw new Oops('Bad status.');
  const w = await hqWallet(env.DB, b.code);
  await env.DB.prepare('UPDATE wallets SET status = ?, failed_pin_count = 0, locked_until = 0 WHERE id = ?').bind(b.status, w.id).run();
  if (b.status === 'banned') await env.DB.prepare('DELETE FROM sessions WHERE wallet_id = ?').bind(w.id).run();
  await logEvent(env, request, b.status === 'banned' ? 'backstage_ban' : 'backstage_unban', w.id, '');
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
    await cleanUnfinished(env, request);
    return await handler(env, request, url);
  } catch (e) {
    if (e instanceof Oops) return json(Object.assign({ error: e.message }, e.extra || {}), e.status);
    console.error(e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
