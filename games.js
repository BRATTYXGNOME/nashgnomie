// ==========================================
// NASH | Gnomie: Games (shared)
// Wallet, Drop the Ball odds math, leaderboards.
//
// GamesAPI is the only part that talks to the server (functions/api on
// Cloudflare). On a plain local preview with no server running, it falls
// back to a pretend backend saved in this browser, with fake money.
// ==========================================

(function() {
  'use strict';

  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // ---------- money ----------
  function money(cents) {
    var neg = cents < 0; cents = Math.abs(Math.round(cents));
    var s = '$' + (cents / 100).toFixed(2);
    return neg ? '−' + s : s;
  }
  function shortMoney(cents) {
    if (cents < 100) return cents + '¢';
    return '$' + (cents % 100 === 0 ? (cents / 100) : (cents / 100).toFixed(2));
  }

  // ==========================================
  // DROP THE BALL: boards + exact odds
  // 12 rows of pegs, 13 drains (0..12). The ball's position is counted in
  // half-drain steps h = 0..24. It starts at h = 12 + 2*aim (aim -6..6) and
  // at every row bounces one step left or right with equal chance, except at
  // a side wall, where it can only bounce back inward. After 12 rows h is
  // always even and the drain is h / 2. The odds shown on screen are worked
  // out from this exact same rule, and the server uses it to drop each ball.
  // ==========================================
  var ROWS = 12, MAX_H = 24, DRAINS = 13, CENTER = 6;

  var BOARDS = {
    sweet:  { name: 'Sweet',  unlockCents: 0,     amounts: [25, 50, 100, 200, 300, 500],           edgeCents: 1000 },
    spicy:  { name: 'Spicy',  unlockCents: 2500,  amounts: [100, 200, 400, 600, 1000, 2000],      edgeCents: 4000 },
    savage: { name: 'Savage', unlockCents: 10000, amounts: [500, 1000, 1500, 2500, 4000, 7500],   edgeCents: 15000 }
  };
  var BOARD_ORDER = ['sweet', 'spicy', 'savage'];

  // One peg row: 85% a small bounce (1 step), 15% a big bounce that skips a
  // peg (3 steps); walls bounce it back. Same rule as the server.
  var BIG_BOUNCE = 15;
  function bounceTo(h, dir, big) {
    var n = h + dir * (big ? 3 : 1);
    if (n < 0) n = -n;
    if (n > MAX_H) n = 2 * MAX_H - n;
    return n;
  }
  // Chance of each drain (array of 13) for a given aim, exact.
  function oddsFor(aim) {
    var dist = new Array(MAX_H + 1).fill(0), pBig = BIG_BOUNCE / 100;
    dist[12 + 2 * aim] = 1;
    for (var r = 0; r < ROWS; r++) {
      var next = new Array(MAX_H + 1).fill(0);
      for (var h = 0; h <= MAX_H; h++) {
        var p = dist[h];
        if (!p) continue;
        var dirs = h === 0 ? [[1, 1]] : h === MAX_H ? [[-1, 1]] : [[1, 0.5], [-1, 0.5]];
        for (var d = 0; d < dirs.length; d++) {
          next[bounceTo(h, dirs[d][0], false)] += p * dirs[d][1] * (1 - pBig);
          next[bounceTo(h, dirs[d][0], true)] += p * dirs[d][1] * pBig;
        }
      }
      dist = next;
    }
    var out = [];
    for (var k = 0; k < DRAINS; k++) out.push(dist[2 * k]);
    return out;
  }

  // What a drain is worth on a board: a fixed amount, center to edge.
  // (balanceCents is unused but kept so callers don't change.)
  function drainValue(boardKey, slot, balanceCents) {
    var b = BOARDS[boardKey], d = Math.abs(slot - CENTER);
    return { cents: d < 6 ? b.amounts[d] : b.edgeCents };
  }

  // What the ball actually takes: never more than what's in the wallet.
  function lossFor(boardKey, slot, balanceCents) {
    return Math.min(drainValue(boardKey, slot, balanceCents).cents, balanceCents);
  }

  function averageLoss(boardKey, aim, balanceCents) {
    var odds = oddsFor(aim), total = 0;
    for (var k = 0; k < DRAINS; k++) total += odds[k] * lossFor(boardKey, k, balanceCents);
    return total;
  }

  function oneIn(p) {
    if (p <= 0) return 'never';
    var n = 1 / p;
    return '1 in ' + (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toLocaleString());
  }
  function percent(p) {
    var v = p * 100;
    if (v === 0) return '0%';
    if (v < 0.01) return '<0.01%';
    if (v < 1) return v.toFixed(2) + '%';
    return v.toFixed(1) + '%';
  }

  function secureRandomBit() {
    var a = new Uint8Array(1);
    crypto.getRandomValues(a);
    return a[0] & 1;
  }

  // One ball, same rule as oddsFor. Returns the h position at every row.
  function dropPath(aim) {
    var h = 12 + 2 * aim, path = [h];
    for (var r = 0; r < ROWS; r++) {
      var big = (crypto.getRandomValues(new Uint8Array(1))[0] % 100) < BIG_BOUNCE;
      var dir = h === 0 ? 1 : h === MAX_H ? -1 : (secureRandomBit() ? 1 : -1);
      h = bounceTo(h, dir, big);
      path.push(h);
    }
    return { path: path, slot: h / 2 };
  }

  // ==========================================
  // WALLET CODES: 16 random characters, all uppercase, no look-alikes
  // (no 0/O, 1/I/L). Dashes sit in different places for each person and are
  // ignored when matching.
  // ==========================================
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function randomCode() {
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    var chars = '';
    for (var i = 0; i < 16; i++) chars += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    // Groups of 2-4 characters in a random pattern, e.g. XX-XXX-XXXX-XX-XXX-XX
    var groups = [], left = 16, sizes = new Uint8Array(12);
    crypto.getRandomValues(sizes);
    for (var j = 0; left > 0; j++) {
      var g = left <= 4 ? left : 2 + (sizes[j] % 3);
      if (left - g === 1) g++;
      groups.push(g); left -= g;
    }
    var out = [], pos = 0;
    groups.forEach(function(g) { out.push(chars.slice(pos, pos + g)); pos += g; });
    return out.join('-');
  }
  function normalizeCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  async function sha256(text) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ==========================================
  // DICE DUEL: rules, scoring, Gnomie's moves
  // Each side has 3 columns of up to 3 dice. On your turn you roll one die
  // and put it in a column with space. Placing a die knocks out the other
  // side's dice of the same number in that column. Matching numbers in a
  // column are worth more: each group scores (sum of its dice) x (how many
  // match). The game ends when either side fills all 9 spots; higher total
  // wins.
  // Money: win pays 1x, tie 1.5x, Gnomie wins 2x. 2x is held when the game
  // starts, so leaving can't dodge it; the difference comes back at the end.
  // ==========================================
  // ==========================================
  // TOO FAR (21-style vs Gnomie) and SPIN THE BOTTLE: shown here, decided on
  // the server (functions/_lib/rules.js holds the same numbers).
  // ==========================================
  var TOOFAR = {
    MIN_CENTS: 100, MAX_CENTS: 50000,
    PAY: { win: 1, tie: 1.5, lose: 2, bust: 2.5 },
    TARGET: 31, CARD_MAX: 11 // Gnomie's own rule stays on the server
  };
  // MANCALA (Kalah rules): same rules as the server, used here only to animate
  // the moves the server already decided. 0-5 = your pits, 6 = your store,
  // 7-12 = Gnomie's pits, 13 = Gnomie's store.
  var MANCALA = { AMOUNTS: [100, 1000, 2000], PAY: { win: 1, tie: 1.5, lose: 2 } };
  function mancalaSow(pits, side, i) {
    var p = pits.slice(), own = side === 'you' ? 6 : 13, other = side === 'you' ? 13 : 6, n = p[i], at = i, path = [];
    p[i] = 0;
    while (n > 0) { at = (at + 1) % 14; if (at === other) continue; p[at]++; n--; path.push(at); }
    return { pits: p, path: path, last: at, own: own };
  }
  // 5 IN A ROW: 8 columns x 7 rows, decided on the server
  var FIVE = { COLS: 8, ROWS: 7, AMOUNTS: [100, 1000, 2000], PAY: { win: 1, tie: 1.5, lose: 2 } };
  var BOTTLE = {
    sweet:  { name: 'Sweet',  unlockCents: 1000,  slices: [25, 500, 50, 300, 75, 200, 100, 150] },
    spicy:  { name: 'Spicy',  unlockCents: 4000,  slices: [100, 2000, 200, 1200, 300, 800, 400, 500] },
    savage: { name: 'Savage', unlockCents: 15000, slices: [500, 7500, 750, 4500, 1000, 3000, 1500, 2000] }
  };

  var DUEL = {
    AMOUNTS: [100, 1000, 2000],
    PAY: { win: 1, tie: 1.5, lose: 2 }
  };

  function rollDie() {
    var a = new Uint32Array(1); crypto.getRandomValues(a);
    return { v: 1 + (a[0] % 6) };
  }
  function emptyBoard() { return [[], [], []]; }
  function columnScore(col) {
    var groups = {};
    col.forEach(function(d) { (groups[d.v] = groups[d.v] || []).push(d); });
    var total = 0;
    Object.keys(groups).forEach(function(k) {
      var g = groups[k], sum = 0;
      g.forEach(function(d) { sum += d.v; });
      total += sum * g.length;
    });
    return total;
  }
  function boardScore(b) { return columnScore(b[0]) + columnScore(b[1]) + columnScore(b[2]); }
  function boardFull(b) { return b[0].length === 3 && b[1].length === 3 && b[2].length === 3; }
  function cloneBoard(b) { return b.map(function(c) { return c.map(function(d) { return { v: d.v }; }); }); }
  // Put a die in a column and knock out the other side's matching numbers.
  // Returns how many of the other side's dice were knocked out.
  function placeDie(mine, theirs, colIdx, die) {
    mine[colIdx].push({ v: die.v });
    var before = theirs[colIdx].length;
    theirs[colIdx] = theirs[colIdx].filter(function(d) { return d.v !== die.v; });
    return before - theirs[colIdx].length;
  }
  function openColumns(b) { return [0, 1, 2].filter(function(i) { return b[i].length < 3; }); }

  // Gnomie: "pretty smart". Scores every legal column by what it gains plus
  // what it knocks out of yours, adds a little randomness, and now and then
  // takes its second-best option, so it's beatable.
  function gnomieChoose(gnome, player, die) {
    var options = openColumns(gnome).map(function(c) {
      var g = cloneBoard(gnome), p = cloneBoard(player);
      var before = boardScore(g) - boardScore(p);
      placeDie(g, p, c, die);
      var after = boardScore(g) - boardScore(p);
      return { col: c, value: after - before + Math.random() * 3 };
    }).sort(function(a, b) { return b.value - a.value; });
    if (options.length > 1 && Math.random() < 0.18) return options[1].col;
    return options[0].col;
  }

  // ==========================================
  // PREVIEW BACKEND (this browser only, fake money). Only used on this
  // computer when the real server isn't running.
  // ==========================================
  var STORE_KEY = 'nashgnomie_games_preview';
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { wallets: [], current: null }; }
    catch (e) { return { wallets: [], current: null }; }
  }
  function writeStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  function publicWallet(w) {
    if (!w) return null;
    return { code: w.display_code, hasPin: !!w.pin_hash, pinLength: w.pin_length || null, name: w.name,
             anonymous: !w.name, anonNumber: w.anon_number, balanceCents: w.balance_cents,
             drainedCents: w.drained_cents, loadedCents: w.loaded_cents,
             heldCents: w.duel ? w.duel.held : 0, duelWins: w.duel_wins || 0, twoFactor: !!w.two_factor };
  }
  function publicDuel(d) {
    if (!d) return null;
    return { amount: d.amount, held: d.held, player: cloneBoard(d.player), gnome: cloneBoard(d.gnome), die: d.die,
             youScore: boardScore(d.player), gnomieScore: boardScore(d.gnome) };
  }
  function currentWallet(s) {
    return s.wallets.find(function(w) { return w.code === s.current; }) || null;
  }

  var PreviewAPI = {

    me: async function() { return publicWallet(currentWallet(readStore())); },

    createWallet: async function(agreed) {
      if (!agreed) throw new Error('Please check every box to continue.');
      var s = readStore();
      var display = randomCode();
      var w = { code: normalizeCode(display), display_code: display, pin_hash: null, pin_length: null,
                name: null, anon_number: s.wallets.length + 1, balance_cents: 0, drained_cents: 0,
                loaded_cents: 0, drains: {}, created_at: Date.now() };
      s.wallets.push(w); s.current = w.code; writeStore(s);
      return publicWallet(w);
    },

    setPin: async function(pin) {
      if (!/^(\d{4}|\d{6})$/.test(pin)) throw new Error('Your PIN must be 4 or 6 digits.');
      var s = readStore(), w = currentWallet(s);
      if (!w) throw new Error('No wallet found.');
      w.pin_hash = await sha256(w.code + ':' + pin); w.pin_length = pin.length; writeStore(s);
      return publicWallet(w);
    },

    setName: async function(name, anonymous) {
      var s = readStore(), w = currentWallet(s);
      if (!w) throw new Error('No wallet found.');
      name = String(name || '').trim().replace(/\s+/g, ' ');
      if (!anonymous) {
        if (name.length < 2 || name.length > 24) throw new Error('Names need 2–24 characters.');
      }
      w.name = anonymous ? null : name; writeStore(s);
      return publicWallet(w);
    },

    signIn: async function(code, pin) {
      var s = readStore(), c = normalizeCode(code);
      var w = s.wallets.find(function(x) { return x.code === c; });
      if (!w || !w.pin_hash || w.pin_hash !== await sha256(c + ':' + pin)) throw new Error("That code and PIN don't match.");
      s.current = w.code; writeStore(s);
      return publicWallet(w);
    },

    signOut: async function() { var s = readStore(); s.current = null; writeStore(s); },

    // Preview only: any 6 digits count as the app code
    twoFactorStart: async function() {
      var secret = 'PREVIEWONLYABCDEFGHIJKLMNOPQRSTU';
      return { secret: secret, otpauth: 'otpauth://totp/NASH%20Gnomie%3AWallet?secret=' + secret + '&issuer=NASH%20Gnomie' };
    },
    twoFactorConfirm: async function(otp) {
      if (!/^\d{6}$/.test(String(otp || ''))) throw new Error('That code didn’t work. Type the newest code from your app.');
      var s = readStore(), w = currentWallet(s); w.two_factor = true; writeStore(s); return publicWallet(w);
    },
    twoFactorOff: async function(pin, otp) {
      var s = readStore(), w = currentWallet(s); w.two_factor = false; writeStore(s); return publicWallet(w);
    },

    // Preview only: pretend a YouPay/Throne load arrived
    testCredit: async function(cents) {
      var s = readStore(), w = currentWallet(s);
      if (!w) throw new Error('No wallet found.');
      w.balance_cents += cents; w.loaded_cents += cents; writeStore(s);
      return publicWallet(w);
    },

    drop: async function(game, boardKey, aim) {
      var s = readStore(), w = currentWallet(s);
      if (!w) throw new Error('Set up your wallet first.');
      if (!BOARDS[boardKey]) throw new Error('Unknown board.');
      if (w.balance_cents <= 0) throw new Error('Your wallet is empty.');
      if (w.balance_cents < BOARDS[boardKey].unlockCents) throw new Error('That board is locked for your wallet.');
      aim = Math.max(-6, Math.min(6, Math.round(aim)));
      var result = dropPath(aim);
      var value = drainValue(boardKey, result.slot, w.balance_cents);
      var loss = Math.min(value.cents, w.balance_cents);
      w.balance_cents -= loss; w.drained_cents += loss;
      w.drains[game] = (w.drains[game] || 0) + loss;
      writeStore(s);
      return { path: result.path, slot: result.slot, lossCents: loss,
               wallet: publicWallet(w) };
    },

    // ----- Dice Duel (preview) -----
    duelState: async function() {
      var w = currentWallet(readStore());
      return w && w.duel ? publicDuel(w.duel) : null;
    },

    duelStart: async function(amountCents) {
      var s = readStore(), w = currentWallet(s);
      if (!w) throw new Error('Set up your wallet first.');
      if (!(amountCents >= 100 && amountCents <= 50000)) throw new Error('Pick an amount from $1.00 to $500.00.');
      if (w.duel) throw new Error('Finish your current game first.');
      var hold = amountCents * DUEL.PAY.lose;
      if (w.balance_cents < hold) throw new Error('Your wallet needs at least ' + money(hold) + ' to play for ' + money(amountCents) + '.');
      w.balance_cents -= hold;
      w.duel = { amount: amountCents, held: hold, player: emptyBoard(), gnome: emptyBoard(), die: null, started: Date.now() };
      writeStore(s);
      return { duel: publicDuel(w.duel), wallet: publicWallet(w) };
    },

    duelRoll: async function() {
      var s = readStore(), w = currentWallet(s);
      if (!w || !w.duel) throw new Error('No game in progress.');
      if (!w.duel.die) { w.duel.die = rollDie(); writeStore(s); }
      return { duel: publicDuel(w.duel) };
    },

    duelPlace: async function(colIdx) {
      var s = readStore(), w = currentWallet(s);
      if (!w || !w.duel) throw new Error('No game in progress.');
      var d = w.duel;
      if (!d.die) throw new Error('Roll first.');
      if (openColumns(d.player).indexOf(colIdx) === -1) throw new Error('That column is full.');
      var out = { you: { col: colIdx, die: d.die, knocked: placeDie(d.player, d.gnome, colIdx, d.die) } };
      if (!boardFull(d.player)) {
        var gd = rollDie(), gc = gnomieChoose(d.gnome, d.player, gd);
        out.gnomie = { col: gc, die: gd, knocked: placeDie(d.gnome, d.player, gc, gd) };
      }
      if (boardFull(d.player) || boardFull(d.gnome)) {
        var ps = boardScore(d.player), gs = boardScore(d.gnome);
        var outcome = ps > gs ? 'win' : ps === gs ? 'tie' : 'lose';
        var pay = Math.round(d.amount * DUEL.PAY[outcome]);
        w.balance_cents += d.held - pay;
        w.drained_cents += pay;
        w.drains['dice-duel'] = (w.drains['dice-duel'] || 0) + pay;
        if (outcome === 'win') w.duel_wins = (w.duel_wins || 0) + 1;
        out.result = { outcome: outcome, you: ps, gnomie: gs, paidCents: pay, amount: d.amount };
        out.final = publicDuel(d);
        w.duel = null;
      } else {
        d.die = null;
        out.duel = publicDuel(d);
      }
      writeStore(s);
      out.wallet = publicWallet(w);
      return out;
    },

    leaderboard: async function(boardKey) {
      var s = readStore();
      var now = Date.now(), day = 86400000;
      // Pretend other players so the preview looks lived-in
      var fake = [
        { name: 'StarDust', cents: 41250, since: now - 12 * day },
        { name: null, anon: 3, cents: 30210, since: now - 5 * day },
        { name: 'gnomelover', cents: 22800, since: now - 2 * day },
        { name: 'night_owl', cents: 15100, since: now - 9 * day },
        { name: null, anon: 7, cents: 9900, since: now - day },
        { name: 'wallet.exe', cents: 7350, since: now - 3 * day },
        { name: 'pixel_prince', cents: 5400, since: now - 6 * day },
        { name: null, anon: 12, cents: 3100, since: now - day },
        { name: 'coffee&chaos', cents: 2200, since: now - 4 * day },
        { name: 'lurker', cents: 900, since: now - day },
        { name: null, anon: 15, cents: 500, since: now - day }
      ];
      var rows = fake.map(function(f) { return { name: f.name || ('Anonymous #' + f.anon), cents: f.cents, since: f.since, me: false }; });
      var w = currentWallet(s);
      if (w) {
        var mine = boardKey === 'all' ? w.drained_cents : boardKey === 'dice-duel-wins' ? (w.duel_wins || 0) * 1000 : (w.drains[boardKey] || 0);
        if (mine > 0) rows.push({ name: w.name || ('Anonymous #' + w.anon_number), cents: mine, since: now, me: true });
      }
      rows.sort(function(a, b) { return b.cents - a.cents; });
      // Amounts never leave the "server": only rank, name and reign
      return rows.map(function(r, i) {
        return { rank: i + 1, name: r.name, reignDays: Math.max(1, Math.round((now - r.since) / day)), me: r.me };
      });
    },
    // The pretend backend has no history or nudges
    statement: async function() { return []; },
    closeRequest: async function() { throw new Error('Not in the preview.'); },
    closeRequestCancel: async function() { throw new Error('Not in the preview.'); },
    setBreak: async function() { throw new Error('Not in the preview.'); },
    agree: async function() { return publicWallet(currentWallet(readStore())); },
    deleteWallet: async function() {},
    loadReports: async function() { return []; },
    reportLoad: async function() { throw new Error('Not in the preview.'); },
    setContacts: async function() { throw new Error('Not in the preview.'); },
    setColor: async function() { throw new Error('Not in the preview.'); },
    nudgeSeen: async function() {},
    nudgeClose: async function() { return publicWallet(currentWallet(readStore())); },
    changePin: async function() { throw new Error('Not in the preview.'); },
    requests: async function() { return []; },
    sendRequest: async function() { throw new Error('Not in the preview.'); }
  };

  // ==========================================
  // REAL SERVER (Cloudflare): same functions, same results
  // ==========================================
  async function call(method, path, body) {
    var res, data;
    try {
      res = await fetch('/api/' + path, {
        method: method, credentials: 'same-origin',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      data = await res.json();
    } catch (e) { throw new Error('Could not reach the server. Check your connection and try again.'); }
    if (!res.ok) { var err = new Error(data && data.error || 'Something went wrong. Please try again.'); err.data = data || {}; throw err; }
    return data;
  }

  var ServerAPI = {
    me: async function() { return (await call('GET', 'me')).wallet; },
    createWallet: async function(agreed) { return (await call('POST', 'wallet', { agreed: agreed === true })).wallet; },
    setPin: async function(pin) { return (await call('POST', 'pin', { pin: pin })).wallet; },
    setName: async function(name, anonymous) { return (await call('POST', 'name', { name: name, anonymous: !!anonymous })).wallet; },
    signIn: async function(code, pin, otp) { return (await call('POST', 'signin', { code: code, pin: pin, otp: otp || '', agreed: true })).wallet; },
    closeRequest: async function() { return (await call('POST', 'close-request', { agreed: true })).wallet; },
    closeRequestCancel: async function() { return (await call('POST', 'close-request/cancel', {})).wallet; },
    setBreak: async function(on) { return (await call('POST', 'break', { on: !!on })).wallet; },
    agree: async function() { return (await call('POST', 'agree', { agreed: true })).wallet; },
    deleteWallet: async function() { await call('POST', 'wallet/delete', {}); },
    loadReports: async function() { return (await call('GET', 'load-reports')).rows; },
    reportLoad: async function(r) { return (await call('POST', 'load-report', r)).rows; },
    setContacts: async function(telegram, throne) { return (await call('POST', 'contacts', { telegram: telegram, throne: throne })).wallet; },
    setColor: async function(color) { return (await call('POST', 'color', { color: color })).wallet; },
    twoFactorStart: async function() { return call('POST', '2fa/start', {}); },
    twoFactorConfirm: async function(otp) { return (await call('POST', '2fa/confirm', { otp: otp })).wallet; },
    twoFactorOff: async function(pin, otp) { return (await call('POST', '2fa/off', { pin: pin, otp: otp })).wallet; },
    signOut: async function() { await call('POST', 'signout', {}); },
    testCredit: async function(cents) { return (await call('POST', 'test-credit', { cents: cents })).wallet; },
    drop: async function(game, boardKey, aim) { return call('POST', 'drop', { game: game, board: boardKey, aim: aim }); },
    duelState: async function() { return (await call('GET', 'duel')).duel; },
    duelStart: async function(amountCents) { return call('POST', 'duel/start', { amount: amountCents }); },
    duelRoll: async function() { return call('POST', 'duel/roll', {}); },
    duelPlace: async function(colIdx) { return call('POST', 'duel/place', { col: colIdx }); },
    tooFarState: async function() { return (await call('GET', 'toofar')).game; },
    tooFarStart: async function(amountCents) { return call('POST', 'toofar/start', { amount: amountCents }); },
    tooFarDraw: async function() { return call('POST', 'toofar/draw', {}); },
    tooFarStay: async function() { return call('POST', 'toofar/stay', {}); },
    mancalaState: async function() { return (await call('GET', 'mancala')).game; },
    mancalaStart: async function(amountCents) { return call('POST', 'mancala/start', { amount: amountCents }); },
    mancalaMove: async function(pit) { return call('POST', 'mancala/move', { pit: pit }); },
    fiveState: async function() { return (await call('GET', 'five')).game; },
    fiveStart: async function(amountCents) { return call('POST', 'five/start', { amount: amountCents }); },
    fiveMove: async function(col) { return call('POST', 'five/move', { col: col }); },
    bottleSpin: async function(boardKey, pick) { return call('POST', 'bottle/spin', { board: boardKey, pick: pick }); },
    leaderboard: async function(boardKey) { return (await call('GET', 'leaderboard?board=' + encodeURIComponent(boardKey))).rows; },
    statement: async function() { return (await call('GET', 'statement')).rows; },
    nudgeSeen: async function(id) { await call('POST', 'nudge/seen', { id: id }); },
    nudgeClose: async function(id, response) { return (await call('POST', 'nudge/close', { id: id, response: response || '' })).wallet; },
    changePin: async function(current, next) { return (await call('POST', 'pin/change', { current: current, next: next })).wallet; },
    requests: async function() { return (await call('GET', 'requests')).rows; },
    sendRequest: async function(kind, game, note) { return (await call('POST', 'request', { kind: kind, game: game, note: note })).rows; }
  };

  // Live site: always the real server. This computer: the real server if
  // it's running, otherwise the pretend one.
  var backend = !LOCAL ? Promise.resolve(ServerAPI) :
    fetch('/api/health').then(function(r) { return r.ok ? ServerAPI : PreviewAPI; }, function() { return PreviewAPI; });

  var GamesAPI = {};
  Object.keys(ServerAPI).forEach(function(name) {
    GamesAPI[name] = async function() {
      var api = await backend;
      return api[name].apply(api, arguments);
    };
  });

  // ==========================================
  // UI helpers
  // ==========================================
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k) {
      if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function copyText(text, btn, label) {
    var done = function() {
      if (!btn) return;
      var old = btn.innerHTML;
      btn.innerHTML = 'Copied! ✓';
      btn.classList.add('copied');
      setTimeout(function() { btn.innerHTML = label || old; btn.classList.remove('copied'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done, function() { fallbackCopy(text); done(); });
    }
    fallbackCopy(text); done(); return Promise.resolve();
  }
  function fallbackCopy(text) {
    var t = el('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }

  // The fan's color for their side of every board (Gnomie's side is always pink)
  // Everyone starts with purple; each load of $20 or more unlocks the next one
  var COLORS = [
    { key: 'purple',   name: 'Purple',   hex: '#a78bfa', loads: 0 },
    { key: 'green',    name: 'Green',    hex: '#4ade80', loads: 1 },
    { key: 'blue',     name: 'Blue',     hex: '#60a5fa', loads: 2 },
    { key: 'orange',   name: 'Orange',   hex: '#fb923c', loads: 3 },
    { key: 'gold',     name: 'Gold',     hex: '#facc15', loads: 4 },
    { key: 'red',      name: 'Red',      hex: '#f87171', loads: 5 },
    { key: 'white',    name: 'White',    hex: '#f4f1f4', loads: 6 },
    { key: 'electric', name: 'Electric', hex: '#22d3ee', loads: 7 }
  ];
  function colorHex(key) { for (var i = 0; i < COLORS.length; i++) if (COLORS[i].key === key) return COLORS[i].hex; return COLORS[0].hex; }
  function applyColor(wallet) { document.documentElement.style.setProperty('--you', colorHex(wallet && wallet.color)); }
  applyColor(null);

  function emit(wallet) { applyColor(wallet); document.dispatchEvent(new CustomEvent('wallet:change', { detail: wallet })); }

  // ==========================================
  // LOAD OPTIONS (Throne for now; YouPay links kept for later)
  // ==========================================
  var LOADS = {
    youpay: [
      { cents: 1000,  url: 'https://youpay.me/NashGnomie/gift/1402719' },
      { cents: 2500,  url: 'https://youpay.me/NashGnomie/gift/1402722' },
      { cents: 5000,  url: 'https://youpay.me/NashGnomie/gift/1402723' },
      { cents: 10000, url: 'https://youpay.me/NashGnomie/gift/1402724' }
    ],
    throne: [
      { cents: 500,   url: 'https://throne.com/nashgnomie/item/2a9ef72b-662b-41c4-b16b-d9683fa988b4' },
      { cents: 2000,  url: 'https://throne.com/nashgnomie/item/e5b7b2a5-860e-42f7-89b1-1b7cda5186a6' },
      { cents: 5000,  url: 'https://throne.com/nashgnomie/item/3f9c6e60-ea92-4ffb-b526-bd017a2971d4' },
      { cents: 10000, url: 'https://throne.com/nashgnomie/item/5a9986ad-bf91-46bf-b9d8-e4556b5c8555' }
    ]
  };

  function loadPanelHTML() {
    function buttons(list, platform) {
      return list.map(function(o) {
        return '<button type="button" class="wl-load-btn" data-url="' + o.url + '" data-platform="' + platform + '">' +
          '<span class="wl-load-amt">' + shortMoney(o.cents) + '</span><span class="wl-load-sub">Copy code &amp; load</span></button>';
      }).join('');
    }
    // YouPay is hidden for now: its payment notices don't include the gift
    // message, so the wallet code can't reach the server. (Links kept above.)
    return '' +
      '<div class="wl-load wl-load-single">' +
        '<div class="wl-load-option">' +
          '<div class="wl-load-head"><span class="wl-load-name">Throne</span></div>' +
          '<ol class="wl-steps">' +
            '<li>Add a load amount to your cart</li>' +
            '<li>Select <strong>&ldquo;Checkout&rdquo;</strong></li>' +
            '<li>Select <strong>&ldquo;Add Gift Message&rdquo;</strong></li>' +
            '<li>Paste your <strong>EXACT</strong> code, dashes included</li>' +
          '</ol>' +
          '<div class="wl-load-grid">' + buttons(LOADS.throne, 'throne') + '</div>' +
        '</div>' +
        '<p class="wl-warning">&#9888; Paste your <strong>EXACT</strong> code (dashes included) in the gift message. If it&rsquo;s missing or wrong, the load can&rsquo;t reach your wallet and counts as a <strong>GIFT</strong>.</p>' +
        '<p class="wl-fine">Loads are in USD and usually appear within a minute. Your bank may add conversion fees.</p>' +
      '</div>';
  }

  // ==========================================
  // WALLET UI
  // mount(container, { compact: bool })
  // ==========================================
  // The boxes fans check before they can see their wallet (new wallet, every
  // sign-in, and again whenever the terms change)
  // ---------- on-page dialogs (replace the browser's confirm/prompt/alert pop-ups,
  // which some browsers block or hide) ----------
  function uiDialog(msg, opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'dlg-wrap';
      wrap.innerHTML = '<div class="dlg" role="dialog" aria-modal="true">' +
        '<p class="dlg-msg"></p>' +
        (opts.input ? '<input type="text" class="dlg-input" />' : '') +
        '<div class="dlg-btns">' + (opts.cancel ? '<button type="button" class="ghost" data-x>Cancel</button>' : '') + '<button type="button" data-ok>' + (opts.ok || 'OK') + '</button></div></div>';
      wrap.querySelector('.dlg-msg').textContent = msg;
      var input = wrap.querySelector('.dlg-input');
      if (input) input.value = opts.value == null ? '' : opts.value;
      function done(v) { wrap.remove(); document.removeEventListener('keydown', key); resolve(v); }
      function key(e) { if (e.key === 'Escape') done(opts.input ? null : false); if (e.key === 'Enter' && (input ? document.activeElement === input : true)) { e.preventDefault(); done(input ? input.value : true); } }
      wrap.querySelector('[data-ok]').addEventListener('click', function() { done(input ? input.value : true); });
      var x = wrap.querySelector('[data-x]'); if (x) x.addEventListener('click', function() { done(input ? null : false); });
      wrap.addEventListener('click', function(e) { if (e.target === wrap && opts.cancel) done(input ? null : false); });
      document.addEventListener('keydown', key);
      document.body.appendChild(wrap);
      setTimeout(function() { (input || wrap.querySelector('[data-ok]')).focus(); if (input) input.select(); }, 20);
    });
  }
  function uiConfirm(msg) { return uiDialog(msg, { cancel: true, ok: 'Yes' }); }
  function uiPrompt(msg, value) { return uiDialog(msg, { cancel: true, input: true, value: value, ok: 'OK' }); }
  function uiAlert(msg) { return uiDialog(msg, {}); }

  var AGREE_BOXES =
    '<p class="wl-lead">Before you see your wallet:</p>' +
    '<label><input type="checkbox" required /> <span>I am <strong>18 or older</strong> (21+ preferred).</span></label>' +
    '<label><input type="checkbox" required /> <span>I <strong>already paid Gnomie</strong> when I sent money on Throne.</span></label>' +
    '<label><input type="checkbox" required /> <span>My wallet balance is <strong>not real money</strong> and has no cash value.</span></label>' +
    '<label><input type="checkbox" required /> <span>My wallet balance can <strong>never be withdrawn, refunded or cashed out.</strong></span></label>' +
    '<label><input type="checkbox" required /> <span>My wallet balance is <strong>shared across all games</strong> on this site.</span></label>' +
    '<label><input type="checkbox" required /> <span>There are <strong>no prizes.</strong> The games make my send feel worth it.</span></label>';
  var AGREE_BUTTON = 'I Get It, Show Me My Wallet';
  function allChecked(box) { return Array.prototype.every.call(box.querySelectorAll('.wl-agree input[type=checkbox], input[type=checkbox][required]'), function(c) { return c.checked; }); }

  var TERMS_HTML =
    '<div class="wl-terms">' +
      '<h3>Wallet Terms</h3>' +
      '<p class="wl-terms-lead"><strong>Nothing on this site charges you.</strong> Your wallet balance is a record of what you already sent Gnomie on Throne. When you play, each game&rsquo;s cost comes out of that record, never from your card or bank. It&rsquo;s a fun way for both of you to enjoy your send.</p>' +
      '<h4>1. Who can play</h4><p>You must be 18 or older (21+ preferred) and legally allowed to use this site where you live. Each wallet is for one person only.</p>' +
      '<h4>2. Loads that don&rsquo;t show up</h4><p>Loads usually appear in your wallet within a minute. If one doesn&rsquo;t, something may have gone wrong on the site, on Throne, or with the code in the gift message. Let Gnomie know and she&rsquo;ll check. Please expect some delay: Gnomie is one person with a lot on her plate, but this is a priority for her. If she doesn&rsquo;t answer right away, she isn&rsquo;t ignoring you.</p>' +
      '<div class="wl-terms-act" data-help="load"></div>' +
      '<h4>3. Spend responsibly</h4><p>Only send what you can truly afford to lose without a second thought. Never send money meant for rent, bills, food or other necessities. Never send money that doesn&rsquo;t belong to you. Never send just to keep a game going. If sending stops feeling fun, take a financial break: Gnomie won&rsquo;t nudge you while you&rsquo;re on one, and your wallet will wait for you.</p>' +
      '<div class="wl-terms-act" data-help="break"></div>' +
      '<h4>4. Your balance is a record, not money</h4><p>Every load is a gift to Gnomie through Throne, and it&rsquo;s hers the moment you send it. Your balance only shows how much of that gift you haven&rsquo;t played with yet. It isn&rsquo;t money, credit or property, and it can&rsquo;t be withdrawn, refunded, cashed out or moved to another wallet, even if your wallet is closed.</p>' +
      '<h4>5. No prizes</h4><p>There is nothing to win. Every game ends with an amount taken from your balance; a better result just means a smaller amount. Leaderboards are only for fun and bragging rights.</p>' +
      '<h4>6. How games are decided</h4><p>Every game is played and scored by the site itself, using the rules in its How to Play. Gnomie can&rsquo;t see or change a game while you&rsquo;re playing. If something goes wrong, like a glitch or an outage, let Gnomie know: she may fix your balance or cancel the game.</p>' +
      '<div class="wl-terms-act" data-help="issue"></div>' +
      '<h4>7. Your code and PIN</h4><p>Keep your wallet code and PIN private. Gnomie never sees your PIN and can&rsquo;t recover it. Your code is always in your Throne gift history. You can change your PIN or ask for a new code in Wallet settings. If you lose access, it may not be restored, and the balance in that wallet is gone. (Remember: you already sent it, so all you lose is the fun.)</p>' +
      '<h4>8. Throne payments and chargebacks</h4><p>Payments are handled entirely by Throne, under Throne&rsquo;s own terms. This site doesn&rsquo;t take payments, give refunds or handle disputes. Filing a chargeback or dispute on a Throne gift may cost you your wallet and your access to the games.</p>' +
      '<h4>9. Closing your wallet</h4><p>You can ask Gnomie to close your wallet at any time. Gnomie may close, pause or remove any wallet at any time, including unused, empty or long-inactive ones. When a wallet is closed, its balance is simply cleared.</p>' +
      '<h4>10. Privacy</h4><p>The site keeps the basic records it needs to run your wallet and the games, like what you do here and general information about your visit. These records are never sold or shared by Gnomie.</p>' +
      '<h4>11. Changes</h4><p>These terms, the games and their prices may change at any time. If the terms change, you&rsquo;ll be asked to agree again before you see your wallet. The site is offered as-is, with no promise it will always be available.</p>' +
      '<p class="wl-fine">Questions? <a class="wl-tg-link" href="https://t.me/nashgnomie" target="_blank" rel="noopener">Message Gnomie on Telegram</a>.</p>' +
    '</div>';

  var FORGOT_HTML =
    '<div class="wl-forgot">' +
      '<p><strong>Your wallet code is in your Throne gift history.</strong> Every load you sent has your code in its gift message.</p>' +
      '<ol>' +
        '<li>Sign in at <strong>throne.com</strong>.</li>' +
        '<li>Open the gifts you&rsquo;ve sent (your orders).</li>' +
        '<li>Open any <strong>LOAD</strong> gift. The gift message is your wallet code.</li>' +
      '</ol>' +
      '<p><strong>Remember your leaderboard name?</strong> Type it instead of your code.</p>' +
      '<p><strong>Forgot your PIN?</strong> Gnomie never sees your PIN and can&rsquo;t look it up, so keep it somewhere safe.</p>' +
      '<p class="wl-fine">Still stuck? Message Gnomie on Telegram with your Throne username or the details of a load you sent.</p>' +
    '</div>';

  function mountWallet(container, opts) {
    opts = opts || {};
    var state = { wallet: null, view: 'loading', loadOpen: false, settingsOpen: false, pinLen: 4,
                  activityOpen: false, activity: null, activityShown: 8, seenNudge: null, editName: false, closing: false,
                  termsOpen: false, editContacts: false, pending: null, forgotOpen: false, reportOpen: false, reports: null, reportSent: false };

    function render() {
      var w = state.wallet;
      container.innerHTML = '';
      container.className = 'wallet-card' + (opts.compact ? ' wallet-compact' : '');

      if (state.view === 'loading') { container.appendChild(el('p', { class: 'wl-muted' }, 'Loading your wallet…')); return; }
      if (state.view === 'error') { container.appendChild(el('p', { class: 'wl-muted' }, esc(state.error) + ' <button type="button" class="wl-link" onclick="location.reload()">Try again</button>')); return; }

      // 0) No wallet on this device: choose "start" or "sign in" first, so nobody makes one by accident
      if (state.view === 'welcome') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Game wallet'));
        var wl = el('div', { class: 'wl-welcome' },
          '<p class="wl-lead">Your game wallet holds what you&rsquo;ve sent Gnomie on Throne, so you can play every game here. Have a look at the games first, no wallet needed.</p>' +
          '<div class="wl-welcome-btns">' +
            '<button type="button" class="btn btn-primary" data-act="start">Start a Game Wallet</button>' +
            '<button type="button" class="btn btn-outline" data-act="signin">Sign In to My Wallet</button>' +
          '</div>' +
          '<p class="wl-fine">Already have a wallet on another phone or computer? Choose <strong>Sign In</strong>, not Start.</p>');
        wl.querySelector('[data-act=start]').addEventListener('click', function() { state.view = 'agree'; render(); });
        wl.querySelector('[data-act=signin]').addEventListener('click', function() { state.view = 'signin'; render(); });
        container.appendChild(wl);
        return;
      }

      // 1) Starting a wallet: the agreements first, no code until they agree
      if (state.view === 'agree') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Your wallet'));
        var form = el('form', { class: 'wl-agree', novalidate: '' },
          AGREE_BOXES +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">' + AGREE_BUTTON + '</button>' +
          '<button type="button" class="wl-link" data-act="terms" aria-expanded="' + (state.termsOpen ? 'true' : 'false') + '">Read the wallet terms ' + (state.termsOpen ? '▴' : '▾') + '</button>' +
          (state.termsOpen ? TERMS_HTML : '') +
          '<button type="button" class="btn btn-outline wl-wide" data-act="signin">I Already Have a Wallet: Sign In</button>' +
          '<button type="button" class="wl-link" data-act="back">Back</button>');
        form.querySelector('[data-act=back]').addEventListener('click', function() { state.view = 'welcome'; render(); });
        form.addEventListener('submit', async function(e) {
          e.preventDefault();
          var err = form.querySelector('.wl-error');
          if (!allChecked(form)) { err.textContent = 'Please check every box to continue.'; return; }
          try { state.wallet = await GamesAPI.createWallet(true); state.view = 'pin'; render(); emit(state.wallet); }
          catch (x) { err.textContent = x.message; }
        });
        form.querySelector('[data-act=signin]').addEventListener('click', function() { state.termsOpen = false; state.view = 'signin'; render(); });
        form.querySelector('[data-act=terms]').addEventListener('click', function() {
          var boxes = Array.prototype.map.call(form.querySelectorAll('input[type=checkbox]'), function(c) { return c.checked; });
          state.termsOpen = !state.termsOpen; render();
          container.querySelectorAll('.wl-agree input[type=checkbox]').forEach(function(c, i) { c.checked = !!boxes[i]; });
        });
        container.appendChild(form);
        return;
      }

      // 1b) Signed in, but the terms changed since they last agreed
      if (state.view === 'terms') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Your wallet'));
        var tform = el('form', { class: 'wl-agree', novalidate: '' },
          '<p class="wl-fine wl-terms-note">The wallet terms have been updated.</p>' + AGREE_BOXES +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">' + AGREE_BUTTON + '</button>' +
          '<button type="button" class="wl-link" data-act="terms">Read the wallet terms ' + (state.termsOpen ? '▴' : '▾') + '</button>' +
          (state.termsOpen ? TERMS_HTML : ''));
        tform.querySelector('[data-act=terms]').addEventListener('click', function() { state.termsOpen = !state.termsOpen; render(); });
        tform.addEventListener('submit', async function(e) {
          e.preventDefault();
          var err = tform.querySelector('.wl-error');
          if (!allChecked(tform)) { err.textContent = 'Please check every box to continue.'; return; }
          try { state.wallet = await GamesAPI.agree(); state.view = 'ready'; render(); emit(state.wallet); }
          catch (x) { err.textContent = x.message; }
        });
        container.appendChild(tform);
        return;
      }

      // 2) Sign in: code (or leaderboard name) + PIN + the boxes
      if (state.view === 'signin') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Sign in to your wallet'));
        var sform = el('form', { class: 'wl-form', novalidate: '' },
          '<label class="wl-field"><span>Wallet code (with the dashes) or leaderboard name</span><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. AB3D-EF-GH4J-KL-MN or your name" required /></label>' +
          '<label class="wl-field"><span>PIN</span><input type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 or 6 digits" required /></label>' +
          '<p class="wl-fine wl-pin-note">Gnomie never sees your PIN and can&rsquo;t look it up.</p>' +
          '<div class="wl-agree wl-agree-signin">' + AGREE_BOXES + '</div>' +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">' + AGREE_BUTTON + '</button>' +
          '<button type="button" class="wl-link" data-act="forgot" aria-expanded="' + (state.forgotOpen ? 'true' : 'false') + '">Forgot your wallet code? ' + (state.forgotOpen ? '▴' : '▾') + '</button>' +
          (state.forgotOpen ? FORGOT_HTML : '') +
          '<button type="button" class="wl-link" data-act="back">Back</button>');
        sform.addEventListener('submit', async function(e) {
          e.preventDefault();
          var inputs = sform.querySelectorAll('input'), err = sform.querySelector('.wl-error');
          if (!inputs[0].value.trim() || !inputs[1].value) { err.textContent = 'Enter your wallet code (or name) and your PIN.'; return; }
          if (!allChecked(sform)) { err.textContent = 'Please check every box to continue.'; return; }
          try { state.wallet = await GamesAPI.signIn(inputs[0].value, inputs[1].value, ''); state.view = 'ready'; render(); emit(state.wallet); }
          catch (x) {
            // Only wallets with an authenticator app get asked for a code, and only after the PIN is right
            if (x.data && x.data.needsCode) { state.pending = { code: inputs[0].value, pin: inputs[1].value }; state.view = 'signin2'; render(); return; }
            err.textContent = x.message;
          }
        });
        sform.querySelector('[data-act=forgot]').addEventListener('click', function() {
          var keep = Array.prototype.map.call(sform.querySelectorAll('input[type=text], input[type=password]'), function(i) { return i.value; });
          state.forgotOpen = !state.forgotOpen; render();
          container.querySelectorAll('input[type=text], input[type=password]').forEach(function(i, n) { if (keep[n] != null) i.value = keep[n]; });
        });
        sform.querySelector('[data-act=back]').addEventListener('click', function() { state.view = 'welcome'; render(); });
        container.appendChild(sform);
        return;
      }

      // 2b) Their PIN was right and they use an authenticator app: ask for its code
      if (state.view === 'signin2') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'One more step'));
        var oform = el('form', { class: 'wl-form', novalidate: '' },
          '<p class="wl-lead">Your wallet uses an authenticator app. Type the 6-digit code it shows right now.</p>' +
          '<label class="wl-field"><span>Authenticator code</span><input type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 digits" required /></label>' +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">Sign In</button>' +
          '<button type="button" class="wl-link" data-act="restart">Start over</button>');
        oform.addEventListener('submit', async function(e) {
          e.preventDefault();
          var err = oform.querySelector('.wl-error');
          try { state.wallet = await GamesAPI.signIn(state.pending.code, state.pending.pin, oform.querySelector('input').value); state.pending = null; state.view = 'ready'; render(); emit(state.wallet); }
          catch (x) { err.textContent = x.message; }
        });
        oform.querySelector('[data-act=restart]').addEventListener('click', function() { state.pending = null; state.view = 'signin'; render(); });
        container.appendChild(oform);
        setTimeout(function() { var i = oform.querySelector('input'); if (i) i.focus(); }, 0);
        return;
      }

      // 3) Fresh wallet: show the code, pick a PIN and a leaderboard name
      if (state.view === 'pin') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Your wallet code'));
        container.appendChild(codeBlock(w.code, true));
        var pform = el('form', { class: 'wl-form', novalidate: '' },
          '<p class="wl-lead"><strong>Save this code now.</strong> Screenshot it or paste it into your notes. Your code + PIN is how you get back into your wallet on any phone or computer.</p>' +
          '<label class="wl-check wl-saved"><input type="checkbox" class="wl-saved-box" /> <span>I <strong>saved my wallet code</strong> somewhere safe.</span></label>' +
          '<div class="wl-pinlen" role="group" aria-label="PIN length">' +
            '<button type="button" data-len="4" class="' + (state.pinLen === 4 ? 'on' : '') + '">4 digits</button>' +
            '<button type="button" data-len="6" class="' + (state.pinLen === 6 ? 'on' : '') + '">6 digits</button>' +
          '</div>' +
          '<label class="wl-field"><span>Choose your PIN</span><input type="password" inputmode="numeric" maxlength="' + state.pinLen + '" autocomplete="new-password" required /></label>' +
          '<label class="wl-field"><span>Type it again</span><input type="password" inputmode="numeric" maxlength="' + state.pinLen + '" autocomplete="new-password" required /></label>' +
          '<label class="wl-field"><span>Leaderboard name</span><input type="text" maxlength="24" autocomplete="off" placeholder="Pick a name" /></label>' +
          '<label class="wl-check"><input type="checkbox" class="wl-anon" /> <span>Stay anonymous (show me as Anonymous #' + w.anonNumber + ')</span></label>' +
          '<p class="wl-fine">Gnomie never sees your PIN and can&rsquo;t look it up. Don&rsquo;t forget it.</p>' +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">Save &amp; Continue</button>' +
          '<button type="button" class="wl-link" data-act="oops">Oops, I already have a wallet. Delete this one and sign in.</button>');
        pform.querySelector('[data-act=oops]').addEventListener('click', async function() {
          if (!await uiConfirm('Delete this new wallet and sign in to your real one instead?')) return;
          try { await GamesAPI.deleteWallet(); } catch (x) {}
          state.wallet = null; state.view = 'signin'; render(); emit(null);
        });
        pform.querySelectorAll('.wl-pinlen button').forEach(function(b) {
          b.addEventListener('click', function() { state.pinLen = +b.dataset.len; render(); });
        });
        var nameInput = pform.querySelectorAll('input')[2], anon = pform.querySelector('.wl-anon');
        anon.addEventListener('change', function() { nameInput.disabled = anon.checked; });
        pform.addEventListener('submit', async function(e) {
          e.preventDefault();
          var ins = pform.querySelectorAll('input'), err = pform.querySelector('.wl-error');
          var pin = ins[0].value;
          if (!pform.querySelector('.wl-saved-box').checked) { err.textContent = 'Save your wallet code first, then check the box.'; return; }
          if (!new RegExp('^\\d{' + state.pinLen + '}$').test(pin)) { err.textContent = 'Your PIN must be ' + state.pinLen + ' digits.'; return; }
          if (pin !== ins[1].value) { err.textContent = "Those PINs don't match."; return; }
          try {
            await GamesAPI.setPin(pin);
            state.wallet = await GamesAPI.setName(nameInput.value, anon.checked);
            state.view = 'ready'; render(); emit(state.wallet);
          } catch (x) {
            // Wallet was removed for sitting unfinished too long: start over
            if (x.data && /Set up your wallet/.test(x.message)) { state.wallet = null; state.view = 'welcome'; render(); emit(null); return; }
            err.textContent = x.message;
          }
        });
        container.appendChild(pform);
        return;
      }

      // 4) Ready: balance, code, load
      if (w.nudge) {
        var nudge = el('div', { class: 'wl-nudge', role: 'status' },
          '<p class="wl-nudge-text">' + (w.nudge.message ? esc(w.nudge.message) : 'Your wallet will be closed if it stays at $0! Add funds to keep your wallet.') + '</p>' +
          '<div class="wl-nudge-answers"><button type="button" class="wl-pill" data-answer="promise">I promise I&rsquo;ll do better</button><button type="button" class="wl-pill wl-pill-quiet" data-answer="break">I&rsquo;m taking a financial break</button></div>' +
          '<button type="button" class="wl-nudge-x" data-answer="" aria-label="Close">&times;</button>');
        nudge.querySelectorAll('[data-answer]').forEach(function(b) {
          b.addEventListener('click', async function() {
            var id = w.nudge.id, answer = b.dataset.answer;
            state.wallet = Object.assign({}, w, { nudge: null }); render();
            try { var nw = await GamesAPI.nudgeClose(id, answer); if (nw) { state.wallet = nw; render(); emit(nw); } } catch (x) {}
          });
        });
        container.appendChild(nudge);
        if (state.seenNudge !== w.nudge.id) { state.seenNudge = w.nudge.id; GamesAPI.nudgeSeen(w.nudge.id).catch(function() {}); }
      }
      var top = el('div', { class: 'wl-top' },
        '<div class="wl-balance"><span class="wl-label">Wallet balance</span>' +
          '<span class="wl-amount">' + money(w.balanceCents) + ' <small>USD</small></span>' +
          (w.heldCents ? '<span class="wl-held">+ ' + money(w.heldCents) + ' set aside for your ' + esc((w.heldFor && w.heldFor.length ? w.heldFor : ['Dice Duel']).join(' &amp; ')) .replace(/&amp;amp;/g, '&amp;') + ' game' + (w.heldFor && w.heldFor.length > 1 ? 's' : '') + '</span>' : '') +
          (w.onBreak ? '<span class="wl-break-badge">&#127769; On a financial break <button type="button" class="wl-break-back" data-act="break-back">I&rsquo;m back</button></span>' : '') + '</div>');
      if (w.onBreak) container.classList.add('wl-on-break');
      var backBtn = top.querySelector('[data-act=break-back]');
      if (backBtn) backBtn.addEventListener('click', async function() {
        try { state.wallet = await GamesAPI.setBreak(false); render(); emit(state.wallet); } catch (x) {}
      });
      var actions = el('div', { class: 'wl-actions' });
      var loadBtn = el('button', { type: 'button', class: 'btn btn-primary' }, state.loadOpen ? 'Close' : 'Load Wallet');
      loadBtn.addEventListener('click', function() { state.loadOpen = !state.loadOpen; render(); });
      actions.appendChild(loadBtn);
      top.appendChild(actions);
      container.appendChild(top);
      container.appendChild(codeBlock(w.code, false));

      if (state.loadOpen) {
        var panel = el('div', { class: 'wl-load-wrap' }, loadPanelHTML());
        panel.querySelectorAll('.wl-load-btn').forEach(function(b) {
          b.addEventListener('click', function() {
            copyText(w.code, null);
            b.querySelector('.wl-load-sub').textContent = 'Code copied ✓';
            window.open(b.dataset.url, '_blank', 'noopener');
          });
        });
        if (LOCAL) {
          var test = el('div', { class: 'wl-test' }, '<span>Preview only:</span>');
          [500, 2500, 10000].forEach(function(c) {
            var tb = el('button', { type: 'button' }, '+' + shortMoney(c) + ' test credit');
            tb.addEventListener('click', async function() { state.wallet = await GamesAPI.testCredit(c); render(); emit(state.wallet); });
            test.appendChild(tb);
          });
          panel.appendChild(test);
        }
        panel.appendChild(reportSection(w));
        container.appendChild(panel);
      }

      // Account activity + Wallet settings: two toggles side by side, one open at a time
      var tabs = el('div', { class: 'wl-more' });
      [['activity', 'Account activity'], opts.compact ? null : ['settings', 'Wallet settings'], ['terms', 'Wallet terms']].filter(Boolean).forEach(function(t) {
        var open = t[0] === 'activity' ? state.activityOpen : t[0] === 'settings' ? state.settingsOpen : state.termsOpen;
        var b = el('button', { type: 'button', class: 'wl-more-btn' + (open ? ' on' : ''), 'aria-expanded': open ? 'true' : 'false' }, esc(t[1]) + ' <span aria-hidden="true">' + (open ? '▴' : '▾') + '</span>');
        b.addEventListener('click', function() {
          if (t[0] === 'activity') {
            state.activityOpen = !state.activityOpen; state.settingsOpen = false; state.termsOpen = false; state.activityShown = 8;
            if (state.activityOpen) loadActivity(); else render();
          } else if (t[0] === 'settings') { state.settingsOpen = !state.settingsOpen; state.activityOpen = false; state.termsOpen = false; state.editName = false; state.editContacts = false; state.editPin = false; state.closing = false; render(); }
          else { state.termsOpen = !state.termsOpen; state.activityOpen = false; state.settingsOpen = false; render(); }
        });
        tabs.appendChild(b);
      });
      container.appendChild(tabs);
      if (state.activityOpen) container.appendChild(activitySection());
      if (state.termsOpen) {
        var tw = el('div', { class: 'wl-terms-wrap' }, TERMS_HTML);
        tw.querySelectorAll('.wl-terms-act').forEach(function(slot) { slot.appendChild(helpButton(w, slot.dataset.help)); });
        container.appendChild(tw);
      }

      if (!opts.compact) {
        var settings = el('div', { class: 'wl-settings' });
        if (state.settingsOpen) {
          var shownName = w.name || ('Anonymous #' + w.anonNumber);
          var body = el('div', { class: 'wl-set' },
            '<div class="wl-set-row">' +
              '<div class="wl-set-text"><span class="wl-set-label">Leaderboard name</span><span class="wl-set-value">' + esc(shownName) + '</span></div>' +
              (state.editName ? '' : '<button type="button" class="wl-pill" data-act="name-edit">Change</button>') +
            '</div>' +
            (state.editName ?
              '<form class="wl-set-edit wl-name-form" novalidate>' +
                '<input type="text" maxlength="24" autocomplete="off" value="' + esc(w.name || '') + '" placeholder="New name" aria-label="New leaderboard name" />' +
                '<p class="wl-fine">2&ndash;24 characters. Letters, numbers, spaces and symbols are all fine. Each name belongs to one person.</p>' +
                '<div class="age-error wl-error" aria-live="polite"></div>' +
                '<div class="wl-set-btns"><button type="submit" class="btn btn-primary">Save</button>' +
                  (w.name ? '<button type="button" class="btn btn-outline" data-act="name-anon">Go anonymous</button>' : '') +
                  '<button type="button" class="wl-link" data-act="name-cancel">Cancel</button></div>' +
              '</form>' : '') +
            '<div class="wl-set-row wl-set-colors">' +
              '<div class="wl-set-text"><span class="wl-set-label">Your color</span><span class="wl-set-value">Your side of every game, and your name on leaderboards</span></div>' +
              '<div class="wl-swatches">' + COLORS.map(function(c) {
                var locked = (w.loadCount || 0) < c.loads;
                return '<button type="button" class="wl-swatch' + (w.color === c.key ? ' on' : '') + (locked ? ' locked' : '') + '" data-color="' + c.key + '" style="--sw:' + c.hex + '"' +
                  ' title="' + c.name + (locked ? ' (unlocks after ' + c.loads + ' load' + (c.loads > 1 ? 's' : '') + ' of $20+)' : '') + '" aria-label="' + c.name + (locked ? ', locked' : '') + '"' + (locked ? ' aria-disabled="true"' : '') + '>' +
                  (locked ? '<span aria-hidden="true">&#128274;</span>' : '') + '</button>';
              }).join('') + '</div>' +
            '</div>' +
            '<p class="wl-swatch-note" aria-live="polite">' + esc(state.swatchNote || 'Every load of $20 or more unlocks a new color.') + '</p>' +
            '<div class="wl-set-row">' +
              '<div class="wl-set-text"><span class="wl-set-label">Your Telegram &amp; Throne usernames <small>(only Gnomie sees these)</small></span><span class="wl-set-value">' +
                (w.telegram || w.throneName ? esc([w.telegram ? 'Telegram @' + w.telegram : '', w.throneName ? 'Throne ' + w.throneName : ''].filter(Boolean).join(' · ')) : 'Not added') + '</span></div>' +
              (state.editContacts ? '' : '<button type="button" class="wl-pill" data-act="contacts-edit">' + (w.telegram || w.throneName ? 'Edit' : 'Add') + '</button>') +
            '</div>' +
            (state.editContacts ?
              '<form class="wl-set-edit wl-contacts" novalidate>' +
                '<input type="text" maxlength="41" autocomplete="off" value="' + esc(w.telegram ? '@' + w.telegram : '') + '" placeholder="Telegram username (optional)" aria-label="Telegram username" />' +
                '<input type="text" maxlength="40" autocomplete="off" value="' + esc(w.throneName || '') + '" placeholder="Throne username (optional)" aria-label="Throne username" />' +
                '<p class="wl-fine">Your own usernames on Telegram and Throne. Only Gnomie sees them, and they help her find your wallet if you ever get locked out.</p>' +
                '<div class="age-error wl-error" aria-live="polite"></div>' +
                '<div class="wl-set-btns"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="wl-link" data-act="contacts-cancel">Cancel</button></div>' +
              '</form>' : '') +
            '<div class="wl-set-row">' +
              '<div class="wl-set-text"><span class="wl-set-label">PIN</span><span class="wl-set-value">' + (w.pinLength || 4) + ' digits &middot; Gnomie never sees it</span></div>' +
              (state.editPin ? '' : '<button type="button" class="wl-pill" data-act="pin-edit">Change</button>') +
            '</div>' +
            (state.editPin ?
              '<form class="wl-set-edit wl-pin-form" novalidate>' +
                '<input type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="Current PIN" aria-label="Current PIN" />' +
                '<input type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="New PIN (4 or 6 digits)" aria-label="New PIN" />' +
                '<input type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="Type the new PIN again" aria-label="New PIN again" />' +
                '<div class="age-error wl-error" aria-live="polite"></div>' +
                '<div class="wl-set-btns"><button type="submit" class="btn btn-primary">Save PIN</button><button type="button" class="wl-link" data-act="pin-cancel">Cancel</button></div>' +
              '</form>' : '') +
            '<div class="wl-set-row">' +
              '<div class="wl-set-text"><span class="wl-set-label">Wallet code</span><span class="wl-set-value">Worried someone has it?</span></div>' +
              '<button type="button" class="wl-pill wl-pill-quiet" data-act="new-code">Request a new code</button>' +
            '</div>' +
            '<div class="wl-set-row">' +
              '<div class="wl-set-text"><span class="wl-set-label">Authenticator app</span><span class="wl-set-value">' + (w.twoFactor ? 'On &#10003;' : 'Off') + '</span></div>' +
              (w.twoFactor ? '<button type="button" class="wl-pill" data-act="tf-off">Turn off</button>' : '<button type="button" class="wl-pill" data-act="tf-on">Turn on</button>') +
            '</div>' +
            '<div class="wl-tf" hidden></div>' +
            '<div class="wl-set-row">' +
              '<div class="wl-set-text"><span class="wl-set-label">Financial break</span><span class="wl-set-value">' + (w.onBreak ? 'You&rsquo;re on a break. Gnomie will hold your wallet.' : 'Taking a break? Let Gnomie know.') + '</span></div>' +
              '<button type="button" class="wl-pill" data-act="break">' + (w.onBreak ? 'I&rsquo;m back' : 'I&rsquo;m on a break') + '</button>' +
            '</div>' +
            '<div class="wl-set-row">' +
              '<div class="wl-set-text"><span class="wl-set-label">Close my wallet</span><span class="wl-set-value">' + (w.closeRequested ? 'Requested. Gnomie will close it soon.' : 'Done playing for good? Let Gnomie know.') + '</span></div>' +
              (w.closeRequested ? '<button type="button" class="wl-pill" data-act="close-cancel">Cancel request</button>' : (state.closing ? '' : '<button type="button" class="wl-pill wl-pill-quiet" data-act="close-ask">Request</button>')) +
            '</div>' +
            (state.closing && !w.closeRequested ?
              '<div class="wl-close-box">' +
                '<p class="wl-lead">This tells Gnomie you&rsquo;re done playing for good. Once she closes your wallet, your code stops working and your name leaves the leaderboards. Just need some time off? Choose a financial break instead.</p>' +
                '<label class="wl-check"><input type="checkbox" /> <span>I understand my remaining balance of <strong>' + money(w.balanceCents) + '</strong> can&rsquo;t be withdrawn or refunded.</span></label>' +
                '<div class="age-error wl-error" aria-live="polite"></div>' +
                '<div class="wl-set-btns"><button type="button" class="btn btn-outline" data-act="close-send">Request Closure</button><button type="button" class="wl-link" data-act="close-back">Never mind</button></div>' +
              '</div>' : '') +
            (!w.loadedCents && !w.drainedCents && !w.heldCents ?
              '<div class="wl-set-row"><div class="wl-set-text"><span class="wl-set-label">Made this wallet by accident?</span><span class="wl-set-value">It has never been loaded, so you can delete it.</span></div><button type="button" class="wl-pill wl-pill-quiet" data-act="delete-wallet">Delete wallet</button></div>' : '') +
            '<button type="button" class="wl-link wl-signout" data-act="signout">Sign out on this device</button>');
          var del = body.querySelector('[data-act=delete-wallet]');
          if (del) del.addEventListener('click', async function() {
            if (!await uiConfirm('Delete this wallet for good? This can’t be undone.')) return;
            try { await GamesAPI.deleteWallet(); state.wallet = null; state.view = 'welcome'; render(); emit(null); } catch (x) { await uiAlert(x.message); }
          });
          body.querySelector('[data-act=signout]').addEventListener('click', async function() {
            await GamesAPI.signOut(); state.wallet = null; state.view = 'welcome'; render(); emit(null);
          });
          var pinEdit = body.querySelector('[data-act=pin-edit]');
          if (pinEdit) pinEdit.addEventListener('click', function() { state.editPin = true; render(); });
          var pinForm = body.querySelector('.wl-pin-form');
          if (pinForm) {
            pinForm.addEventListener('submit', async function(e) {
              e.preventDefault();
              var ins = pinForm.querySelectorAll('input'), err = pinForm.querySelector('.wl-error');
              if (ins[1].value !== ins[2].value) { err.textContent = 'The new PINs don’t match.'; return; }
              try { state.wallet = await GamesAPI.changePin(ins[0].value, ins[1].value); state.editPin = false; state.swatchNote = 'PIN changed.'; render(); emit(state.wallet); }
              catch (x) { err.textContent = x.message; }
            });
            pinForm.querySelector('[data-act=pin-cancel]').addEventListener('click', function() { state.editPin = false; render(); });
          }
          body.querySelector('[data-act=new-code]').addEventListener('click', function() { openHelp(w, 'newcode'); });
          body.querySelector('[data-act=break]').addEventListener('click', async function() {
            try { state.wallet = await GamesAPI.setBreak(!w.onBreak); render(); emit(state.wallet); } catch (x) {}
          });
          body.querySelectorAll('.wl-swatch').forEach(function(b) {
            b.addEventListener('click', async function() {
              var c = COLORS.filter(function(x) { return x.key === b.dataset.color; })[0];
              if ((w.loadCount || 0) < c.loads) { state.swatchNote = c.name + ' unlocks after ' + c.loads + ' load' + (c.loads > 1 ? 's' : '') + ' of $20 or more. You have ' + (w.loadCount || 0) + '.'; render(); return; }
              state.swatchNote = '';
              try { state.wallet = await GamesAPI.setColor(c.key); render(); emit(state.wallet); } catch (x) { state.swatchNote = x.message; render(); }
            });
          });
          var cEdit = body.querySelector('[data-act=contacts-edit]');
          if (cEdit) cEdit.addEventListener('click', function() { state.editContacts = true; render(); });
          var cForm = body.querySelector('.wl-contacts');
          if (cForm) {
            cForm.addEventListener('submit', async function(e) {
              e.preventDefault();
              var ins = cForm.querySelectorAll('input');
              try { state.wallet = await GamesAPI.setContacts(ins[0].value, ins[1].value); state.editContacts = false; render(); emit(state.wallet); }
              catch (x) { cForm.querySelector('.wl-error').textContent = x.message; }
            });
            cForm.querySelector('[data-act=contacts-cancel]').addEventListener('click', function() { state.editContacts = false; render(); });
          }
          var closeAsk = body.querySelector('[data-act=close-ask]');
          if (closeAsk) closeAsk.addEventListener('click', function() { state.closing = true; render(); });
          var closeBack = body.querySelector('[data-act=close-back]');
          if (closeBack) closeBack.addEventListener('click', function() { state.closing = false; render(); });
          var closeSend = body.querySelector('[data-act=close-send]');
          if (closeSend) closeSend.addEventListener('click', async function() {
            var box = body.querySelector('.wl-close-box'), err = box.querySelector('.wl-error');
            if (!box.querySelector('input').checked) { err.textContent = 'Please check the box to continue.'; return; }
            try { state.wallet = await GamesAPI.closeRequest(); state.closing = false; render(); emit(state.wallet); }
            catch (x) { err.textContent = x.message; }
          });
          var closeCancel = body.querySelector('[data-act=close-cancel]');
          if (closeCancel) closeCancel.addEventListener('click', async function() {
            try { state.wallet = await GamesAPI.closeRequestCancel(); render(); emit(state.wallet); } catch (x) {}
          });
          var nameEdit = body.querySelector('[data-act=name-edit]');
          if (nameEdit) nameEdit.addEventListener('click', function() { state.editName = true; render(); var i = container.querySelector('.wl-name-form input'); if (i) i.focus(); });
          var nameForm = body.querySelector('.wl-name-form');
          if (nameForm) {
            var saveName = async function(anonymous) {
              var err = nameForm.querySelector('.wl-error');
              err.textContent = '';
              try { state.wallet = await GamesAPI.setName(nameForm.querySelector('input').value, anonymous); state.editName = false; render(); emit(state.wallet); }
              catch (x) { err.textContent = x.message; }
            };
            nameForm.addEventListener('submit', function(e) { e.preventDefault(); saveName(false); });
            var anonBtn = nameForm.querySelector('[data-act=name-anon]');
            if (anonBtn) anonBtn.addEventListener('click', function() { saveName(true); });
            nameForm.querySelector('[data-act=name-cancel]').addEventListener('click', function() { state.editName = false; render(); });
          }
          var tfBox = body.querySelector('.wl-tf');
          var tfOn = body.querySelector('[data-act=tf-on]'), tfOff = body.querySelector('[data-act=tf-off]');
          // Turn on: scan a QR code (or type the key), then confirm with a code
          if (tfOn) tfOn.addEventListener('click', async function() {
            tfBox.hidden = false; tfBox.innerHTML = '<p class="wl-muted">One moment…</p>';
            var setup;
            try { setup = await GamesAPI.twoFactorStart(); } catch (x) { tfBox.innerHTML = '<p class="age-error">' + esc(x.message) + '</p>'; return; }
            tfBox.innerHTML =
              '<p class="wl-lead">Open Google Authenticator (or any authenticator app), tap <strong>+</strong> and scan this code. Signing in on a new device will then need your PIN <em>and</em> the app&rsquo;s 6-digit code.</p>' +
              '<div class="wl-qr"></div>' +
              '<p class="wl-fine">Can&rsquo;t scan? Choose &ldquo;Enter a setup key&rdquo; and type:<br><span class="wl-key">' + esc(setup.secret.match(/.{1,4}/g).join(' ')) + '</span></p>' +
              '<label class="wl-field"><span>Type the 6-digit code it shows</span><input type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" /></label>' +
              '<div class="age-error wl-error" aria-live="polite"></div>' +
              '<button type="button" class="btn btn-primary wl-wide" data-act="tf-confirm">Turn On</button>';
            showQR(tfBox.querySelector('.wl-qr'), setup.otpauth);
            tfBox.querySelector('[data-act=tf-confirm]').addEventListener('click', async function() {
              try { state.wallet = await GamesAPI.twoFactorConfirm(tfBox.querySelector('input').value); render(); emit(state.wallet); }
              catch (x) { tfBox.querySelector('.wl-error').textContent = x.message; }
            });
          });
          // Turn off: needs the PIN and a current app code
          if (tfOff) tfOff.addEventListener('click', function() {
            tfBox.hidden = false;
            tfBox.innerHTML =
              '<p class="wl-lead">To turn off your authenticator app, enter your PIN and a current code from the app.</p>' +
              '<label class="wl-field"><span>PIN</span><input type="password" inputmode="numeric" maxlength="6" autocomplete="off" /></label>' +
              '<label class="wl-field"><span>Code from your app</span><input type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" /></label>' +
              '<div class="age-error wl-error" aria-live="polite"></div>' +
              '<button type="button" class="btn btn-outline wl-wide" data-act="tf-confirm-off">Turn Off</button>';
            tfBox.querySelector('[data-act=tf-confirm-off]').addEventListener('click', async function() {
              var ins = tfBox.querySelectorAll('input');
              try { state.wallet = await GamesAPI.twoFactorOff(ins[0].value, ins[1].value); render(); emit(state.wallet); }
              catch (x) { tfBox.querySelector('.wl-error').textContent = x.message; }
            });
          });
          settings.appendChild(body);
        }
        container.appendChild(settings);
      }
    }

    // ---------- help pop-ups ----------
    // Each topic gets one clear button that opens its own pop-up panel:
    //   load    = a load didn't show up      (alert Gnomie, or DM her)
    //   issue   = a problem with a game      (alert Gnomie, or DM her)
    //   break   = taking a financial break   (pauses nudges)
    //   newcode = ask for a new wallet code  (needs a reason)
    var TELEGRAM = 'https://t.me/nashgnomie';
    var REPORT_STATUS = { open: 'Waiting for Gnomie', credited: 'Added to your wallet', declined: 'Not found', done: 'Done' };
    var HELP_BUTTONS = {
      load: 'A load didn&rsquo;t show up',
      issue: 'Report a problem with a game',
      break: function(w) { return w.onBreak ? 'I&rsquo;m back from my break' : 'I&rsquo;m taking a financial break'; }
    };
    function helpButton(w, kind) {
      var label = typeof HELP_BUTTONS[kind] === 'function' ? HELP_BUTTONS[kind](w) : HELP_BUTTONS[kind];
      var b = el('button', { type: 'button', class: 'wl-help-btn' }, label + ' <span aria-hidden="true">&rsaquo;</span>');
      b.addEventListener('click', function() { openHelp(w, kind); });
      return b;
    }
    function reportSection(w) {
      var wrap = el('div', { class: 'wl-report' });
      var t = el('button', { type: 'button', class: 'wl-link' }, 'Sent a load but it&rsquo;s not showing?');
      t.addEventListener('click', function() { openHelp(w, 'load'); });
      wrap.appendChild(t);
      return wrap;
    }

    function openModal(title, body) {
      var old = document.querySelector('.wl-modal'); if (old) old.remove();
      var m = el('div', { class: 'wl-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
      var card = el('div', { class: 'wl-modal-card' }, '<div class="wl-modal-head"><h3>' + title + '</h3><button type="button" class="wl-modal-x" aria-label="Close">&times;</button></div>');
      card.appendChild(body);
      m.appendChild(card);
      function close() { m.remove(); document.removeEventListener('keydown', onKey); document.body.classList.remove('wl-modal-open'); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      m.addEventListener('click', function(e) { if (e.target === m) close(); });
      card.querySelector('.wl-modal-x').addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(m);
      document.body.classList.add('wl-modal-open');
      var f = card.querySelector('input, select, textarea, button.btn'); if (f) setTimeout(function() { f.focus(); }, 30);
      return close;
    }

    // "Send Gnomie an alert" (reaches Backstage) or "Message Gnomie on Telegram" (copy a ready message)
    function twoWays(alertLabel, formHTML, dmText, onSend, listHTML) {
      var mode = 'alert', sent = false;
      var box = el('div', { class: 'wl-modal-body' });
      function draw() {
        box.innerHTML =
          (sent ? '<p class="wl-report-done">&#10003; Sent. Gnomie will check and get back to you.</p>' : '') +
          '<div class="wl-help-tabs" role="tablist">' +
            '<button type="button" role="tab" data-mode="alert" class="' + (mode === 'alert' ? 'on' : '') + '">' + alertLabel + '</button>' +
            '<button type="button" role="tab" data-mode="dm" class="' + (mode === 'dm' ? 'on' : '') + '">Message Gnomie on Telegram</button>' +
          '</div>' +
          (mode === 'alert' ? '<form class="wl-report-form" novalidate>' + formHTML + '<div class="age-error wl-error" aria-live="polite"></div><button type="submit" class="btn btn-primary wl-wide">Send to Gnomie</button></form>'
            : '<div class="wl-report-tg"><p class="wl-fine">Copy this message, then send it to Gnomie on Telegram.</p><p class="wl-report-msg">' + esc(dmText()) + '</p>' +
              '<div class="wl-set-btns"><button type="button" class="btn btn-outline" data-act="copy-msg">Copy Message</button><a class="btn btn-primary" href="' + TELEGRAM + '" target="_blank" rel="noopener">Open Telegram</a></div></div>') +
          '<p class="wl-fine wl-modal-note">You can message Gnomie on Telegram any time, even after sending an alert.</p>' +
          (listHTML ? listHTML() : '');
        box.querySelectorAll('[data-mode]').forEach(function(b) { b.addEventListener('click', function() { mode = b.dataset.mode; draw(); }); });
        var copy = box.querySelector('[data-act=copy-msg]');
        if (copy) copy.addEventListener('click', function(e) { copyText(dmText(), e.currentTarget, 'Copy Message'); });
        var form = box.querySelector('form');
        if (form) form.addEventListener('submit', async function(e) {
          e.preventDefault();
          var err = form.querySelector('.wl-error');
          try { await onSend(form); sent = true; draw(); }
          catch (x) { err.textContent = x.message; }
        });
      }
      draw();
      return { box: box, redraw: draw };
    }
    function statusList(title, rows, label) {
      if (!rows || !rows.length) return '';
      return '<div class="wl-report-list"><p class="wl-set-label">' + title + '</p>' + rows.map(function(r) {
        return '<div class="wl-report-row"><span>' + label(r) + ' · ' + esc(new Date(r.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })) + '</span>' +
          '<span class="wl-report-st ' + esc(r.status) + '">' + esc(REPORT_STATUS[r.status] || r.status) + '</span>' +
          (r.status !== 'open' && r.resolution ? '<span class="wl-fine">' + esc(r.resolution) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }

    function openHelp(w, kind) {
      if (kind === 'load') {
        var amt = 2000, reports = state.reports || [];
        var amountSelect = function() {
          return '<label class="wl-field"><span>Which load did you send?</span><select class="wl-help-amt">' +
            [500, 2000, 5000, 10000].map(function(c) { return '<option value="' + c + '"' + (c === amt ? ' selected' : '') + '>LOAD ' + shortMoney(c) + '</option>'; }).join('') + '</select></label>';
        };
        var intro = el('p', { class: 'wl-modal-lead' }, 'Loads usually show up within a minute. Now and then one gets stuck, on the site, on Throne, or with the code in the gift message. Tell Gnomie which load it was and she&rsquo;ll check. Please expect some delay: she&rsquo;s one person, but this is a priority for her, and she isn&rsquo;t ignoring you.');
        var tw = twoWays('Send Gnomie an alert',
          amountSelect() +
          '<label class="wl-field"><span>When did you send it?</span><input type="text" name="when" maxlength="80" placeholder="e.g. Today around 9pm" /></label>' +
          '<label class="wl-field"><span>Throne username <small>(optional)</small></span><input type="text" name="throne" maxlength="40" value="' + esc(w.throneName || '') + '" placeholder="Leave blank if you were anonymous" /></label>' +
          '<label class="wl-field"><span>Anything else? <small>(optional)</small></span><input type="text" name="note" maxlength="500" /></label>',
          function() { return 'Hi Gnomie, a load I sent didn’t show up in my wallet. I sent LOAD ' + shortMoney(amt) + '. My wallet code is: ' + w.code; },
          async function(form) {
            if (!form.when.value.trim()) throw new Error('Tell Gnomie roughly when you sent it.');
            amt = +form.querySelector('.wl-help-amt').value;
            reports = state.reports = await GamesAPI.reportLoad({ amountCents: amt, sentWhen: form.when.value, throne: form.throne.value, note: form.note.value });
          },
          function() { return statusList('Your alerts', reports, function(r) { return 'LOAD ' + shortMoney(r.amountCents); }); });
        tw.box.addEventListener('change', function(e) { if (e.target.classList.contains('wl-help-amt')) amt = +e.target.value; });
        var body = el('div'); body.appendChild(intro); body.appendChild(tw.box);
        openModal('A load didn&rsquo;t show up', body);
        if (!state.reports) GamesAPI.loadReports().then(function(r) { reports = state.reports = r; tw.redraw(); }, function() {});
        return;
      }
      if (kind === 'issue') {
        var reqs = [];
        var GAMES = ['Drop the Ball', 'Dice Duel', 'Too Far', 'Spin the Bottle', 'Something else'];
        var intro2 = el('p', { class: 'wl-modal-lead' }, 'Did a game freeze, glitch, or charge you the wrong amount? Tell Gnomie what happened and she&rsquo;ll look into it.');
        var tw2 = twoWays('Send Gnomie an alert',
          '<label class="wl-field"><span>Which game?</span><select name="game">' + GAMES.map(function(g) { return '<option>' + g + '</option>'; }).join('') + '</select></label>' +
          '<label class="wl-field"><span>What happened?</span><textarea name="note" maxlength="1000" rows="4" placeholder="e.g. The dice froze after my roll and my balance went down"></textarea></label>',
          function() { var f = tw2 && tw2.box.querySelector('form'); return 'Hi Gnomie, I had a problem with a game' + (f ? ' (' + f.game.value + ')' : '') + '. My wallet code is: ' + w.code; },
          async function(form) { reqs = (await GamesAPI.sendRequest('issue', form.game.value, form.note.value)).filter(function(r) { return r.kind === 'issue'; }); },
          function() { return statusList('Your reports', reqs, function(r) { return esc(r.game || 'Game problem'); }); });
        var body2 = el('div'); body2.appendChild(intro2); body2.appendChild(tw2.box);
        openModal('Report a problem with a game', body2);
        GamesAPI.requests().then(function(r) { reqs = r.filter(function(x) { return x.kind === 'issue'; }); tw2.redraw(); }, function() {});
        return;
      }
      if (kind === 'break') {
        var b3 = el('div', { class: 'wl-modal-body' });
        var drawBreak = function() {
          var on = state.wallet && state.wallet.onBreak;
          b3.innerHTML = on
            ? '<p class="wl-modal-lead">You&rsquo;re on a financial break. Gnomie won&rsquo;t nudge you, and your wallet is waiting for you. Come back whenever you&rsquo;re ready.</p><button type="button" class="btn btn-primary wl-wide" data-act="toggle">I&rsquo;m Back</button>'
            : '<p class="wl-modal-lead">Need some time off from sending? That&rsquo;s okay. While you&rsquo;re on a financial break, <strong>Gnomie won&rsquo;t nudge you</strong>, and she&rsquo;ll hold your wallet for you even if it&rsquo;s empty.</p><p class="wl-fine">You can still play with what&rsquo;s already in your wallet. End your break any time from here or Wallet settings.</p><button type="button" class="btn btn-primary wl-wide" data-act="toggle">Start My Financial Break</button>';
          b3.querySelector('[data-act=toggle]').addEventListener('click', async function() {
            try { state.wallet = await GamesAPI.setBreak(!on); render(); emit(state.wallet); drawBreak(); } catch (x) {}
          });
        };
        drawBreak();
        openModal('Financial break', b3);
        return;
      }
      if (kind === 'newcode') {
        var b4 = el('div', { class: 'wl-modal-body' }), myReqs = [];
        var drawCode = function() {
          b4.innerHTML =
            '<p class="wl-modal-lead">If you think someone else has your wallet code, ask Gnomie for a new one. Once she makes it, your new code shows up here and the old one stops working.</p>' +
            '<form class="wl-report-form" novalidate><label class="wl-field"><span>Why do you need a new code?</span><textarea name="note" maxlength="1000" rows="3" placeholder="e.g. I shared a screenshot with my code in it"></textarea></label>' +
            '<div class="age-error wl-error" aria-live="polite"></div><button type="submit" class="btn btn-primary wl-wide">Ask Gnomie for a New Code</button></form>' +
            statusList('Your requests', myReqs, function() { return 'New code'; });
          b4.querySelector('form').addEventListener('submit', async function(e) {
            e.preventDefault();
            try { myReqs = (await GamesAPI.sendRequest('new_code', '', e.target.note.value)).filter(function(r) { return r.kind === 'new_code'; }); drawCode(); b4.insertAdjacentHTML('afterbegin', '<p class="wl-report-done">&#10003; Sent. Gnomie will make your new code soon.</p>'); }
            catch (x) { e.target.querySelector('.wl-error').textContent = x.message; }
          });
        };
        drawCode();
        openModal('Request a new wallet code', b4);
        GamesAPI.requests().then(function(r) { myReqs = r.filter(function(x) { return x.kind === 'new_code'; }); drawCode(); }, function() {});
      }
    }

    // Account activity: every load, game and change, like a bank statement
    function activitySection() {
      var wrap = el('div', { class: 'wl-activity' });
      var rows = state.activity;
      if (!rows) { wrap.appendChild(el('p', { class: 'wl-muted' }, 'Loading…')); return wrap; }
      if (!rows.length) { wrap.appendChild(el('p', { class: 'wl-muted wl-ledger-empty' }, 'Nothing yet. Your loads and games will show up here.')); return wrap; }
      var list = el('ul', { class: 'wl-ledger' });
      rows.slice(0, state.activityShown).forEach(function(r) {
        var d = new Date(r.at);
        var date = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        list.appendChild(el('li', {},
          '<div class="wl-led-main"><span class="wl-led-label">' + esc(r.label) + '</span>' +
            '<span class="wl-led-detail">' + esc(date) + (r.detail ? ' · ' + esc(r.detail) : '') + '</span>' +
            (r.note ? '<span class="wl-led-note">Note from Gnomie: ' + esc(r.note) + '</span>' : '') + '</div>' +
          '<div class="wl-led-amt"><span class="' + (r.cents > 0 ? 'wl-led-plus' : '') + '">' + (r.cents > 0 ? '+' : '') + money(r.cents) + '</span>' +
            '<span class="wl-led-bal">Balance ' + money(r.balanceAfter) + '</span></div>'));
      });
      wrap.appendChild(list);
      if (rows.length > state.activityShown) {
        var more = el('button', { type: 'button', class: 'wl-link' }, 'Show more');
        more.addEventListener('click', function() { state.activityShown += 10; render(); });
        wrap.appendChild(more);
      }
      return wrap;
    }
    async function loadActivity() {
      state.activity = null; render();
      try { state.activity = await GamesAPI.statement(); } catch (x) { state.activity = []; }
      if (state.activityOpen) render();
    }

    function showQR(box, text) {
      function draw() { box.innerHTML = ''; new window.QRCode(box, { text: text, width: 168, height: 168, correctLevel: window.QRCode.CorrectLevel.M }); }
      if (window.QRCode) return draw();
      var sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      sc.onload = draw;
      sc.onerror = function() { box.hidden = true; };
      document.head.appendChild(sc);
    }

    // The code stays hidden until tapped (the fresh-wallet screen always shows it).
    // Copy works either way.
    function codeBlock(code, big) {
      var wrap = el('div', { class: 'wl-code' + (big ? ' wl-code-big' : '') });
      var label = el('span', { class: 'wl-label' }, 'Your code');
      var shown = big || state.codeShown;
      var masked = code.replace(/[A-Z0-9]/g, '•');
      var btn = el('button', { type: 'button', class: 'wl-code-value' + (shown ? '' : ' wl-code-hidden'), title: shown ? 'Tap to hide' : 'Tap to reveal', 'aria-label': shown ? 'Your wallet code, tap to hide' : 'Wallet code hidden, tap to reveal' },
        shown ? esc(code) : '<span class="wl-code-dots">' + masked + '</span><span class="wl-code-tap">Tap to reveal</span>');
      var copy = el('button', { type: 'button', class: 'wl-copy' }, 'Copy');
      btn.addEventListener('click', function() { if (big) { copyText(code, copy, 'Copy'); return; } state.codeShown = !state.codeShown; render(); });
      copy.addEventListener('click', function() { copyText(code, copy, 'Copy'); });
      wrap.appendChild(label);
      var row = el('div', { class: 'wl-code-row' }); row.appendChild(btn); row.appendChild(copy);
      wrap.appendChild(row);
      return wrap;
    }

    GamesAPI.me().then(function(w) {
      state.wallet = w;
      state.view = !w ? 'welcome' : (!w.hasPin ? 'pin' : (w.needsTerms ? 'terms' : 'ready'));
      render(); emit(w);
    }, function(x) {
      state.view = 'error'; state.error = x.message; render();
    });

    document.addEventListener('wallet:change', function(e) {
      if (e.detail && state.wallet && e.detail.code === state.wallet.code && e.detail !== state.wallet) {
        state.wallet = e.detail;
        if (state.view === 'ready') { if (state.activityOpen) loadActivity(); else render(); }
      }
    });
  }

  // ==========================================
  // LEADERBOARD UI: podium (2-1-3) with reign, ranks 4-10, your rank
  // ==========================================
  async function renderLeaderboard(container, boardKey) {
    var rows = await GamesAPI.leaderboard(boardKey);
    container.innerHTML = '';
    if (!rows.length) { container.appendChild(el('p', { class: 'lb-empty' }, 'No one on the board yet.')); return; }
    var podium = el('div', { class: 'lb-podium' });
    [1, 0, 2].forEach(function(i) {
      var r = rows[i];
      if (!r) return;
      var place = el('div', { class: 'lb-place lb-place-' + r.rank + (r.me ? ' lb-me' : '') },
        '<div class="lb-rank-icon">' + (r.rank === 1 ? '♛' : '') + '</div>' +
        '<div class="lb-name" style="color:' + colorHex(r.color) + '">' + esc(r.name) + '</div>' +
        '<div class="lb-reign">' + (r.rank === 1 ? 'Reigning ' : 'Held ') + r.reignDays + (r.reignDays === 1 ? ' day' : ' days') + '</div>' +
        '<div class="lb-step"><span>' + r.rank + '</span></div>');
      podium.appendChild(place);
    });
    container.appendChild(podium);
    var list = el('ol', { class: 'lb-list', start: '4' });
    rows.slice(3, 10).forEach(function(r) {
      list.appendChild(el('li', { class: r.me ? 'lb-me' : '' },
        '<span class="lb-num">' + r.rank + '</span><span class="lb-row-name" style="color:' + colorHex(r.color) + '">' + esc(r.name) + '</span>'));
    });
    if (list.children.length) container.appendChild(list);
    var me = rows.find(function(r) { return r.me; });
    container.appendChild(el('p', { class: 'lb-you' },
      me ? (me.rank <= 10 ? 'You&rsquo;re <strong>#' + me.rank + '</strong> ✦' : 'You&rsquo;re <strong>#' + me.rank + '</strong>. Keep going to reach the top 10.')
         : 'Play to get on the board.'));
  }

  // "My <game> activity" dropdown under each game: that game's rows from account activity
  async function renderGameActivity(el, label) {
    if (!el) return;
    var open = el.open;
    var rows = [];
    try { rows = (await GamesAPI.statement()).filter(function(r) { return r.label === label; }); } catch (x) {}
    el.innerHTML = '<summary>My ' + esc(label) + ' activity</summary>' + (rows.length ?
      '<ul class="wl-ledger">' + rows.slice(0, 30).map(function(r) {
        var d = new Date(r.at);
        return '<li><div class="wl-led-main"><span class="wl-led-label">' + esc(r.detail || label) + '</span><span class="wl-led-detail">' +
          esc(d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</span></div>' +
          '<div class="wl-led-amt"><span>' + money(r.cents) + '</span></div></li>';
      }).join('') + '</ul>' : '<p class="wl-muted">Nothing yet. Your ' + esc(label) + ' games will show up here.</p>');
    el.open = open;
    el.hidden = false;
  }
  document.addEventListener('wallet:change', function() {
    document.querySelectorAll('.game-activity[data-label]').forEach(function(el) { if (el.dataset.ready) renderGameActivity(el, el.dataset.label); });
  });

  // ==========================================
  // RESULT MOMENTS: a big, quick burst so wins and losses never feel flat.
  // kind: 'win' (confetti in their color), 'lose' (Gnomie's pink kisses),
  // 'tie', or 'double' (pink hearts). Never blocks clicks; gone in ~2.5 seconds.
  // ==========================================
  function celebrate(kind, title, sub) {
    var old = document.querySelector('.g-burst'); if (old) old.remove();
    var you = getComputedStyle(document.documentElement).getPropertyValue('--you').trim() || '#a78bfa';
    var wrap = el('div', { class: 'g-burst g-burst-' + kind, 'aria-live': 'polite' });
    var bits = '', n = kind === 'tie' ? 16 : 46;
    for (var i = 0; i < n; i++) {
      var x = Math.random() * 100, dx = (Math.random() - 0.5) * 160, rot = Math.random() * 720 - 360, delay = Math.random() * 180, dur = 1100 + Math.random() * 900;
      var color = kind === 'win' ? (i % 3 ? you : '#ffffff') : kind === 'tie' ? (i % 2 ? '#c0b0bf' : you) : (i % 3 ? '#ff5fa2' : '#ffc2dd');
      var shape = kind === 'lose' || kind === 'double' ? '<span class="g-kiss" style="color:' + color + '">' + (i % 4 ? '♥' : '💋') + '</span>' : '';
      bits += '<i class="g-bit' + (shape ? ' g-bit-shape' : '') + '" style="left:' + x + '%;--dx:' + dx + 'px;--rot:' + rot + 'deg;animation-delay:' + delay + 'ms;animation-duration:' + dur + 'ms;background:' + (shape ? 'none' : color) + '">' + shape + '</i>';
    }
    wrap.innerHTML = bits + '<div class="g-burst-card"><strong style="' + (kind === 'win' ? 'color:' + you : '') + '">' + title + '</strong>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>';
    document.body.appendChild(wrap);
    setTimeout(function() { wrap.classList.add('out'); }, 1900);
    setTimeout(function() { wrap.remove(); }, 2500);
  }

  // ==========================================
  // TYPED AMOUNT BOX (Dice Duel, Mancala, 5 in a Row, Too Far style)
  // worst = how many times the amount they could lose at most (e.g. 2 = Gnomie wins)
  // ==========================================
  var AMOUNT_MIN = 100, AMOUNT_MAX = 50000;
  function amountMax(bal, worst) { return Math.min(AMOUNT_MAX, Math.floor(bal / worst)); }
  function amountBoxHTML(chosen, bal, worst) {
    var max = amountMax(bal, worst);
    var val = chosen ? (chosen / 100).toFixed(2).replace(/\.00$/, '') : '';
    var chips = [100, 500, 1000, 2000].filter(function(c) { return c <= max; });
    return '<div class="tf-amount">' +
      '<label class="tf-amount-box"><span class="tf-amount-cur">$</span><input type="text" class="amt-input" inputmode="decimal" autocomplete="off" placeholder="0" value="' + val + '" aria-label="Amount to play for" /></label>' +
      (chips.length ? '<div class="tf-chips">' + chips.map(function(c) { return '<button type="button" class="tf-chip' + (chosen === c ? ' on' : '') + '" data-c="' + c + '">' + shortMoney(c) + '</button>'; }).join('') +
        (max >= AMOUNT_MIN ? '<button type="button" class="tf-chip" data-c="' + max + '">Max</button>' : '') + '</div>' : '') +
      '<p class="tf-amount-note">' + (max >= AMOUNT_MIN ? 'Suggested amounts above, or type your own: ' + money(AMOUNT_MIN) + ' up to ' + money(max) + '.' : 'Your wallet needs at least ' + money(AMOUNT_MIN * worst) + ' to play.') + '</p>' +
    '</div>';
  }
  function amountProblem(c, bal, worst) {
    if (!c) return 'Type an amount to play for.';
    if (c < AMOUNT_MIN) return 'The smallest amount is ' + money(AMOUNT_MIN) + '.';
    if (c > AMOUNT_MAX) return 'The biggest amount is ' + money(AMOUNT_MAX) + '.';
    if (Math.round(c * worst) > bal) return 'Your wallet covers up to ' + money(amountMax(bal, worst)) + ' here.';
    return '';
  }
  // Wires the box: onChange(cents, problem) runs as they type; chips call onPick(cents)
  function wireAmountBox(root, bal, worst, onChange, onPick) {
    var input = root.querySelector('.amt-input');
    if (!input) return;
    input.addEventListener('input', function() {
      var n = parseFloat(String(input.value).replace(/[$,\s]/g, '')), c = isFinite(n) ? Math.round(n * 100) : 0;
      root.querySelectorAll('.tf-chip').forEach(function(b) { b.classList.toggle('on', +b.dataset.c === c); });
      onChange(c, c ? amountProblem(c, bal, worst) : '');
    });
    root.querySelectorAll('.tf-chip').forEach(function(b) { b.addEventListener('click', function() { onPick(+b.dataset.c); }); });
  }

  // Game age gates are skipped for anyone signed in to a wallet that has money
  // in it: they already confirmed their age to get that far.
  async function autoPass(start) {
    try {
      var w = await GamesAPI.me();
      if (w && w.hasPin && !w.needsTerms && ((w.balanceCents || 0) > 0 || (w.heldCents || 0) > 0)) { try { window.AgeGate.setVerified(); } catch (e) {} start(); }
    } catch (x) {}
  }

  window.Games = {
    TOOFAR: TOOFAR, BOTTLE: BOTTLE, MANCALA: MANCALA, mancalaSow: mancalaSow, FIVE: FIVE,
    DUEL: DUEL, columnScore: columnScore, boardScore: boardScore,
    placeDie: placeDie, cloneBoard: cloneBoard, emptyBoard: emptyBoard, renderGameActivity: renderGameActivity, celebrate: celebrate, autoPass: autoPass,
    amountBoxHTML: amountBoxHTML, amountProblem: amountProblem, wireAmountBox: wireAmountBox,
    LOCAL: LOCAL, ROWS: ROWS, DRAINS: DRAINS, CENTER: CENTER, BOARDS: BOARDS, BOARD_ORDER: BOARD_ORDER,
    oddsFor: oddsFor, drainValue: drainValue, lossFor: lossFor, averageLoss: averageLoss,
    oneIn: oneIn, percent: percent, money: money, shortMoney: shortMoney, dropPath: dropPath,
    api: GamesAPI, mountWallet: mountWallet, renderLeaderboard: renderLeaderboard, esc: esc, COLORS: COLORS, colorHex: colorHex
  };
})();
