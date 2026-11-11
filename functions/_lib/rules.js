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
export function dropPath(aim) {
  let h = 12 + 2 * aim;
  const path = [h];
  for (let r = 0; r < ROWS; r++) {
    if (h === 0) h = 1;
    else if (h === MAX_H) h = MAX_H - 1;
    else h += randomBit() ? 1 : -1;
    path.push(h);
  }
  return { path, slot: h / 2 };
}

// Exact chance of each slot (13) for an aim. Used by Backstage's fairness check.
export function oddsFor(aim) {
  let dist = new Array(MAX_H + 1).fill(0);
  dist[12 + 2 * aim] = 1;
  for (let r = 0; r < ROWS; r++) {
    const next = new Array(MAX_H + 1).fill(0);
    for (let h = 0; h <= MAX_H; h++) {
      const p = dist[h];
      if (!p) continue;
      if (h === 0) next[1] += p;
      else if (h === MAX_H) next[MAX_H - 1] += p;
      else { next[h - 1] += p / 2; next[h + 1] += p / 2; }
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
