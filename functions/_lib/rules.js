// ==========================================
// Game rules used by the server. These must match games.js exactly
// (the page shows the odds; the server decides every result).
// ==========================================

// ---------- Drop the Ball ----------
export const ROWS = 12, MAX_H = 24, CENTER = 6;

export const BOARDS = {
  sweet:  { unlockCents: 0,     amounts: [25, 50, 100, 200, 300, 500],         edgeCents: 1000 },
  spicy:  { unlockCents: 2500,  amounts: [100, 200, 400, 600, 1000, 2000],     edgeCents: 4000 },
  savage: { unlockCents: 10000, amounts: [500, 1000, 1500, 2500, 4000, 7500],  edgeCents: 15000 }
};

function randomBit() {
  const a = new Uint8Array(1);
  crypto.getRandomValues(a);
  return a[0] & 1;
}

// One ball: starts at h = 12 + 2*aim, bounces left/right with equal chance,
// side walls bounce it back inward. Same rule as oddsFor() in games.js.
// One peg row: 85% a small bounce (1 step), 15% a big bounce that skips a peg (3 steps).
// Walls bounce the ball back in. The odds below follow exactly this rule.
const BIG_BOUNCE = 15;
function bounceTo(h, dir, big) {
  let n = h + dir * (big ? 3 : 1);
  if (n < 0) n = -n;
  if (n > MAX_H) n = 2 * MAX_H - n;
  return n;
}
export function dropPath(aim) {
  let h = 12 + 2 * aim;
  const path = [h];
  for (let r = 0; r < ROWS; r++) {
    const big = randomBelow(100) < BIG_BOUNCE;
    const dir = h === 0 ? 1 : h === MAX_H ? -1 : (randomBit() ? 1 : -1);
    h = bounceTo(h, dir, big);
    path.push(h);
  }
  return { path, slot: h / 2 };
}

// Exact chance of each slot (13) for an aim. Used by Backstage's fairness check.
export function oddsFor(aim) {
  let dist = new Array(MAX_H + 1).fill(0);
  dist[12 + 2 * aim] = 1;
  const pBig = BIG_BOUNCE / 100;
  for (let r = 0; r < ROWS; r++) {
    const next = new Array(MAX_H + 1).fill(0);
    for (let h = 0; h <= MAX_H; h++) {
      const p = dist[h];
      if (!p) continue;
      const dirs = h === 0 ? [[1, 1]] : h === MAX_H ? [[-1, 1]] : [[1, 0.5], [-1, 0.5]];
      for (const [dir, pd] of dirs) {
        next[bounceTo(h, dir, false)] += p * pd * (1 - pBig);
        next[bounceTo(h, dir, true)] += p * pd * pBig;
      }
    }
    dist = next;
  }
  const out = [];
  for (let k = 0; k < 13; k++) out.push(dist[2 * k]);
  return out;
}

export function slotValue(boardKey, slot) {
  const b = BOARDS[boardKey], d = Math.abs(slot - CENTER);
  return d < 6 ? b.amounts[d] : b.edgeCents;
}

// ---------- Dice Duel ----------
export const DUEL = { AMOUNTS: [100, 1000, 2000], PAY: { win: 1, tie: 1.5, lose: 2 } };

export function rollDie() {
  const a = new Uint32Array(1);
  // Reject the top sliver so every face is exactly equally likely
  do { crypto.getRandomValues(a); } while (a[0] >= 4294967292);
  return { v: 1 + (a[0] % 6) };
}

export function emptyBoard() { return [[], [], []]; }

export function columnScore(col) {
  const groups = {};
  col.forEach(d => { (groups[d.v] = groups[d.v] || []).push(d); });
  let total = 0;
  Object.keys(groups).forEach(k => {
    const g = groups[k];
    total += g.reduce((s, d) => s + d.v, 0) * g.length;
  });
  return total;
}

export function boardScore(b) { return columnScore(b[0]) + columnScore(b[1]) + columnScore(b[2]); }
export function boardFull(b) { return b[0].length === 3 && b[1].length === 3 && b[2].length === 3; }
export function cloneBoard(b) { return b.map(c => c.map(d => ({ v: d.v }))); }
export function openColumns(b) { return [0, 1, 2].filter(i => b[i].length < 3); }

// Put a die in a column and knock out the other side's matching numbers.
export function placeDie(mine, theirs, colIdx, die) {
  mine[colIdx].push({ v: die.v });
  const before = theirs[colIdx].length;
  theirs[colIdx] = theirs[colIdx].filter(d => d.v !== die.v);
  return before - theirs[colIdx].length;
}

// Gnomie: picks the column that gains her the most (plus what it knocks out
// of yours), with a little randomness, and sometimes her second-best move.
export function gnomieChoose(gnome, player, die) {
  const options = openColumns(gnome).map(c => {
    const g = cloneBoard(gnome), p = cloneBoard(player);
    const before = boardScore(g) - boardScore(p);
    placeDie(g, p, c, die);
    const after = boardScore(g) - boardScore(p);
    return { col: c, value: after - before + Math.random() * 3 };
  }).sort((a, b) => b.value - a.value);
  if (options.length > 1 && Math.random() < 0.18) return options[1].col;
  return options[0].col;
}

// ---------- Wallet codes ----------
// 16 random characters, uppercase, no look-alikes (0/O, 1/I/L), dashes in a
// different pattern for each person. Dashes are ignored when matching.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let chars = '';
  // 248 = 8 * 31, so every character is equally likely
  for (let i = 0; i < 16; i++) {
    let b = bytes[i];
    while (b >= 248) { const x = new Uint8Array(1); crypto.getRandomValues(x); b = x[0]; }
    chars += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  const sizes = new Uint8Array(12);
  crypto.getRandomValues(sizes);
  const groups = [];
  let left = 16;
  for (let j = 0; left > 0; j++) {
    let g = left <= 4 ? left : 2 + (sizes[j] % 3);
    if (left - g === 1) g++;
    groups.push(g);
    left -= g;
  }
  const out = [];
  let pos = 0;
  groups.forEach(g => { out.push(chars.slice(pos, pos + g)); pos += g; });
  return out.join('-');
}

export function normalizeCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// ---------- Too Far (get to 31 vs Gnomie; 31 for Gnomie's birthday, Aug 31) ----------
// Cards are numbered 1-11, four of each, shuffled fresh every game.
// You draw or stay; going over 31 costs the most. Gnomie's fixed rule: she
// keeps drawing until she has 27 or more.
export const TOOFAR = {
  MIN_CENTS: 100, MAX_CENTS: 50000,   // they type their own amount: $1 to $500
  PAY: { win: 1, tie: 1.5, lose: 2, bust: 2.5 },
  TARGET: 31, GNOMIE_STOPS: 27, CARD_MAX: 11, COPIES: 4
};

function randomBelow(n) {
  const a = new Uint32Array(1), limit = Math.floor(4294967296 / n) * n;
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return a[0] % n;
}

export function newDeck() {
  const deck = [];
  for (let v = 1; v <= TOOFAR.CARD_MAX; v++) for (let c = 0; c < TOOFAR.COPIES; c++) deck.push(v);
  for (let i = deck.length - 1; i > 0; i--) { const j = randomBelow(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
export function handTotal(hand) { return hand.reduce((s, c) => s + c.v, 0); }

// ---------- Spin the Bottle ----------
// 8 equal slices; small and big amounts alternate around the circle.
// Spin the Bottle: the 8 amounts are shuffled into secret wedges every spin.
// The fan picks a wedge blind, then everything is revealed and the bottle spins.
// Lands on their wedge = they pay double that wedge; anywhere else = that wedge.
// A board unlocks when the wallet covers the worst case (double the biggest wedge).
export const BOTTLE = {
  sweet:  { unlockCents: 1000,  slices: [25, 500, 50, 300, 75, 200, 100, 150] },
  spicy:  { unlockCents: 4000,  slices: [100, 2000, 200, 1200, 300, 800, 400, 500] },
  savage: { unlockCents: 15000, slices: [500, 7500, 750, 4500, 1000, 3000, 1500, 2000] }
};
export function spinSlice() { return randomBelow(8); }
// A fair shuffle of the wedge order (each order equally likely)
export function shuffledOrder(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = randomBelow(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// ---------- Mancala (Kalah rules) vs Gnomie ----------
// Board: 14 spots. 0-5 = your pits (left to right), 6 = your store,
// 7-12 = Gnomie's pits (right to left from your view), 13 = Gnomie's store.
// Stones move counter-clockwise, skipping the other player's store.
// Last stone in your own store = another turn. Last stone in an empty pit on
// your side = you capture it plus everything in the pit across from it.
// When one side runs out, the other side's stones go to that player's store.
export const MANCALA = { AMOUNTS: [100, 1000, 2000], PAY: { win: 1, tie: 1.5, lose: 2 }, STONES: 4 };
export function mancalaStart() { const p = new Array(14).fill(MANCALA.STONES); p[6] = 0; p[13] = 0; return p; }
const MANCALA_STORE = { you: 6, gnomie: 13 };
export function mancalaPits(side) { return side === 'you' ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]; }
export function mancalaMoves(p, side) { return mancalaPits(side).filter(i => p[i] > 0); }
// Plays one move; returns { pits, again (another turn), capture, over }
export function mancalaMove(pits, side, i) {
  const p = pits.slice(), own = MANCALA_STORE[side], other = MANCALA_STORE[side === 'you' ? 'gnomie' : 'you'];
  let n = p[i]; p[i] = 0; let at = i;
  while (n > 0) { at = (at + 1) % 14; if (at === other) continue; p[at]++; n--; }
  let capture = null;
  if (at !== own && mancalaPits(side).indexOf(at) !== -1 && p[at] === 1 && p[12 - at] > 0) {
    capture = { pit: at, across: 12 - at, stones: p[12 - at] + 1 };
    p[own] += p[12 - at] + 1; p[at] = 0; p[12 - at] = 0;
  }
  let over = false;
  const youLeft = [0, 1, 2, 3, 4, 5].reduce((s, k) => s + p[k], 0), gLeft = [7, 8, 9, 10, 11, 12].reduce((s, k) => s + p[k], 0);
  if (youLeft === 0 || gLeft === 0) {
    for (let k = 0; k < 6; k++) { p[6] += p[k]; p[k] = 0; }
    for (let k = 7; k < 13; k++) { p[13] += p[k]; p[k] = 0; }
    over = true;
  }
  return { pits: p, again: !over && at === own, capture, over, last: at };
}
// Gnomie: fair but beatable, sharp now and then. Each move she looks a few
// moves ahead (how far changes every move), and sometimes she just plays loose.
function mancalaScore(p) { return (p[13] - p[6]) * 2 + ([7, 8, 9, 10, 11, 12].reduce((s, k) => s + p[k], 0) - [0, 1, 2, 3, 4, 5].reduce((s, k) => s + p[k], 0)) * 0.25; }
function mancalaSearch(p, side, depth) {
  const moves = mancalaMoves(p, side);
  if (depth === 0 || !moves.length) return mancalaScore(p);
  let best = side === 'gnomie' ? -Infinity : Infinity;
  for (const m of moves) {
    const r = mancalaMove(p, side, m);
    const v = r.over ? (r.pits[13] - r.pits[6]) * 100 : mancalaSearch(r.pits, r.again ? side : (side === 'gnomie' ? 'you' : 'gnomie'), r.again ? depth : depth - 1);
    best = side === 'gnomie' ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}
export function gnomieMancala(p) {
  const moves = mancalaMoves(p, 'gnomie');
  if (moves.length === 1) return moves[0];
  if (randomBelow(100) < 12) return moves[randomBelow(moves.length)]; // a loose move now and then
  const depth = [1, 2, 3, 3, 4, 5][randomBelow(6)];
  let best = [], bestV = -Infinity;
  for (const m of moves) {
    const r = mancalaMove(p, 'gnomie', m);
    const v = r.over ? (r.pits[13] - r.pits[6]) * 100 : mancalaSearch(r.pits, r.again ? 'gnomie' : 'you', r.again ? depth : depth - 1);
    if (v > bestV + 1e-9) { bestV = v; best = [m]; } else if (Math.abs(v - bestV) < 1e-9) best.push(m);
  }
  return best[randomBelow(best.length)];
}

// Mancala beads: the same move, but tracking whose bead is whose ('y' started
// on your side, 'g' on Gnomie's) so the board can show what moved where.
export function mancalaBeadsStart() {
  const b = [];
  for (let i = 0; i < 14; i++) b.push(i === 6 || i === 13 ? [] : new Array(MANCALA.STONES).fill(i < 6 ? 'y' : 'g'));
  return b;
}
export function mancalaBeadsFromPits(p) { return p.map((n, i) => new Array(n).fill(i <= 6 ? 'y' : 'g')); }
export function mancalaBeadMove(beads, side, i) {
  const b = beads.map(a => a.slice()), own = side === 'you' ? 6 : 13, other = side === 'you' ? 13 : 6;
  const hand = b[i]; b[i] = []; let at = i;
  while (hand.length) { at = (at + 1) % 14; if (at === other) continue; b[at].push(hand.shift()); }
  const mine = side === 'you' ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
  if (at !== own && mine.indexOf(at) !== -1 && b[at].length === 1 && b[12 - at].length > 0) {
    b[own].push(...b[at], ...b[12 - at]); b[at] = []; b[12 - at] = [];
  }
  const youLeft = [0, 1, 2, 3, 4, 5].some(k => b[k].length), gLeft = [7, 8, 9, 10, 11, 12].some(k => b[k].length);
  if (!youLeft || !gLeft) {
    for (let k = 0; k < 6; k++) { b[6].push(...b[k]); b[k] = []; }
    for (let k = 7; k < 13; k++) { b[13].push(...b[k]); b[k] = []; }
  }
  return b;
}

// ---------- 5 in a Row vs Gnomie ----------
// 8 columns x 7 rows. Pieces drop to the lowest open spot in a column.
// First to line up 5 (across, up-down or diagonal) wins; a full board is a tie.
// board[c] = column c from the bottom up, each 'y' (you) or 'g' (Gnomie).
export const FIVE = { COLS: 8, ROWS: 7, NEED: 5, AMOUNTS: [100, 1000, 2000], PAY: { win: 1, tie: 1.5, lose: 2 } };
export function fiveStart() { return Array.from({ length: FIVE.COLS }, () => []); }
export function fiveOpenCols(b) { const out = []; for (let c = 0; c < FIVE.COLS; c++) if (b[c].length < FIVE.ROWS) out.push(c); return out; }
export function fiveDrop(b, c, who) { const n = b.map(col => col.slice()); n[c].push(who); return { board: n, row: n[c].length - 1 }; }
function fiveAt(b, c, r) { return c >= 0 && c < FIVE.COLS && r >= 0 && r < FIVE.ROWS ? b[c][r] : undefined; }
// The winning line through (c, r), or null
export function fiveLine(b, c, r) {
  const who = fiveAt(b, c, r);
  if (!who) return null;
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [[c, r]];
    for (let k = 1; fiveAt(b, c + dc * k, r + dr * k) === who; k++) line.push([c + dc * k, r + dr * k]);
    for (let k = 1; fiveAt(b, c - dc * k, r - dr * k) === who; k++) line.unshift([c - dc * k, r - dr * k]);
    if (line.length >= FIVE.NEED) return line;
  }
  return null;
}
export function fiveFull(b) { return b.every(col => col.length >= FIVE.ROWS); }
// Gnomie: fair but beatable. She always takes a winning move, usually (not
// always) blocks yours, and looks a few moves ahead (how far changes each move).
function fiveScore(b) {
  let s = 0;
  const W = [0, 1, 6, 30, 160, 100000];
  for (let c = 0; c < FIVE.COLS; c++) for (let r = 0; r < FIVE.ROWS; r++) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const ec = c + dc * 4, er = r + dr * 4;
      if (ec < 0 || ec >= FIVE.COLS || er < 0 || er >= FIVE.ROWS) continue;
      let g = 0, y = 0;
      for (let k = 0; k < 5; k++) { const v = fiveAt(b, c + dc * k, r + dr * k); if (v === 'g') g++; else if (v === 'y') y++; }
      if (g && !y) s += W[g]; else if (y && !g) s -= W[y] * 1.15;
    }
  }
  for (let r = 0; r < FIVE.ROWS; r++) { if (b[3][r] === 'g' || b[4][r] === 'g') s += 2; if (b[3][r] === 'y' || b[4][r] === 'y') s -= 2; }
  return s;
}
function fiveSearch(b, who, depth, alpha, beta) {
  const cols = fiveOpenCols(b);
  if (!cols.length) return 0;
  if (depth === 0) return fiveScore(b);
  const order = cols.slice().sort((x, y) => Math.abs(3.5 - x) - Math.abs(3.5 - y));
  if (who === 'g') {
    let best = -Infinity;
    for (const c of order) {
      const d = fiveDrop(b, c, 'g');
      const v = fiveLine(d.board, c, d.row) ? 1e7 + depth : fiveSearch(d.board, 'y', depth - 1, alpha, beta);
      best = Math.max(best, v); alpha = Math.max(alpha, v); if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const c of order) {
    const d = fiveDrop(b, c, 'y');
    const v = fiveLine(d.board, c, d.row) ? -1e7 - depth : fiveSearch(d.board, 'g', depth - 1, alpha, beta);
    best = Math.min(best, v); beta = Math.min(beta, v); if (alpha >= beta) break;
  }
  return best;
}
export function gnomieFive(b) {
  const cols = fiveOpenCols(b);
  for (const c of cols) { const d = fiveDrop(b, c, 'g'); if (fiveLine(d.board, c, d.row)) return c; }       // win if she can
  if (randomBelow(100) < 72) for (const c of cols) { const d = fiveDrop(b, c, 'y'); if (fiveLine(d.board, c, d.row)) return c; } // usually block
  if (randomBelow(100) < 22) return cols[randomBelow(cols.length)];                                      // a loose move now and then
  const depth = [1, 1, 2, 2, 3, 4][randomBelow(6)];
  let best = [], bestV = -Infinity;
  for (const c of cols) {
    const d = fiveDrop(b, c, 'g');
    const v = fiveSearch(d.board, 'y', depth - 1, -Infinity, Infinity);
    if (v > bestV + 1e-9) { bestV = v; best = [c]; } else if (Math.abs(v - bestV) < 1e-9) best.push(c);
  }
  return best[randomBelow(best.length)];
}
