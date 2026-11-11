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

  // Chance of each drain (array of 13) for a given aim, exact.
  function oddsFor(aim) {
    var dist = new Array(MAX_H + 1).fill(0);
    dist[12 + 2 * aim] = 1;
    for (var r = 0; r < ROWS; r++) {
      var next = new Array(MAX_H + 1).fill(0);
      for (var h = 0; h <= MAX_H; h++) {
        var p = dist[h];
        if (!p) continue;
        if (h === 0) next[1] += p;
        else if (h === MAX_H) next[MAX_H - 1] += p;
        else { next[h - 1] += p / 2; next[h + 1] += p / 2; }
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
      if (h === 0) h = 1;
      else if (h === MAX_H) h = MAX_H - 1;
      else h += secureRandomBit() ? 1 : -1;
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
      if (DUEL.AMOUNTS.indexOf(amountCents) === -1) throw new Error('Pick an amount to play for.');
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
    }
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
    signIn: async function(code, pin, otp) { return (await call('POST', 'signin', { code: code, pin: pin, otp: otp || '' })).wallet; },
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
    leaderboard: async function(boardKey) { return (await call('GET', 'leaderboard?board=' + encodeURIComponent(boardKey))).rows; }
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

  function emit(wallet) { document.dispatchEvent(new CustomEvent('wallet:change', { detail: wallet })); }

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
            '<li>Paste your <strong>EXACT</strong> code</li>' +
          '</ol>' +
          '<div class="wl-load-grid">' + buttons(LOADS.throne, 'throne') + '</div>' +
        '</div>' +
        '<p class="wl-warning">&#9888; Paste your <strong>EXACT</strong> code in the gift message. If it&rsquo;s missing or wrong, the load can&rsquo;t reach your wallet and counts as a <strong>GIFT</strong>.</p>' +
        '<p class="wl-fine">Loads are in USD and usually appear within a minute. Your bank may add conversion fees.</p>' +
      '</div>';
  }

  // ==========================================
  // WALLET UI
  // mount(container, { compact: bool })
  // ==========================================
  function mountWallet(container, opts) {
    opts = opts || {};
    var state = { wallet: null, view: 'loading', loadOpen: false, settingsOpen: false, pinLen: 4 };

    function render() {
      var w = state.wallet;
      container.innerHTML = '';
      container.className = 'wallet-card' + (opts.compact ? ' wallet-compact' : '');

      if (state.view === 'loading') { container.appendChild(el('p', { class: 'wl-muted' }, 'Loading your wallet…')); return; }
      if (state.view === 'error') { container.appendChild(el('p', { class: 'wl-muted' }, esc(state.error) + ' <button type="button" class="wl-link" onclick="location.reload()">Try again</button>')); return; }

      // 1) No wallet yet: agreement first, no code until they agree
      if (state.view === 'agree') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Your wallet'));
        var form = el('form', { class: 'wl-agree', novalidate: '' },
          '<p class="wl-lead">Before you get your wallet code:</p>' +
          '<label><input type="checkbox" required /> <span>I am at least <strong>18 years old</strong> (21+ preferred).</span></label>' +
          '<label><input type="checkbox" required /> <span>I understand my <strong>wallet balance is shared across all games</strong>.</span></label>' +
          '<label><input type="checkbox" required /> <span>I understand the money I send through YouPay or Throne is real, but my <strong>wallet balance is not</strong>. It&rsquo;s a record of what I&rsquo;ve sent, used only to play games on this site, and it <strong>can&rsquo;t be refunded or withdrawn</strong>.</span></label>' +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">I Agree, Get My Code</button>' +
          '<button type="button" class="wl-link" data-act="signin">Already have a wallet? Sign in</button>');
        form.addEventListener('submit', async function(e) {
          e.preventDefault();
          var all = Array.prototype.every.call(form.querySelectorAll('input[type=checkbox]'), function(c) { return c.checked; });
          var err = form.querySelector('.wl-error');
          if (!all) { err.textContent = 'Please check every box to continue.'; return; }
          try { state.wallet = await GamesAPI.createWallet(true); state.view = 'pin'; render(); emit(state.wallet); }
          catch (x) { err.textContent = x.message; }
        });
        form.querySelector('[data-act=signin]').addEventListener('click', function() { state.view = 'signin'; render(); });
        container.appendChild(form);
        return;
      }

      // 2) Sign in on another device
      if (state.view === 'signin') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Sign in to your wallet'));
        var sform = el('form', { class: 'wl-form', novalidate: '' },
          '<label class="wl-field"><span>Wallet code</span><input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Paste your code" required /></label>' +
          '<label class="wl-field"><span>PIN</span><input type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 or 6 digits" required /></label>' +
          '<label class="wl-field wl-otp" hidden><span>Code from your authenticator app</span><input type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 digits" /></label>' +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">Sign In</button>' +
          '<button type="button" class="wl-link" data-act="back">I don&rsquo;t have a wallet yet</button>' +
          '<p class="wl-fine">Lost your code or your phone? DM me on Telegram with the Throne username you loaded from.</p>');
        sform.addEventListener('submit', async function(e) {
          e.preventDefault();
          var inputs = sform.querySelectorAll('input'), err = sform.querySelector('.wl-error'), otpBox = sform.querySelector('.wl-otp');
          try { state.wallet = await GamesAPI.signIn(inputs[0].value, inputs[1].value, inputs[2].value); state.view = 'ready'; render(); emit(state.wallet); }
          catch (x) {
            err.textContent = x.message;
            if (x.data && x.data.needsCode) { otpBox.hidden = false; inputs[2].focus(); }
          }
        });
        sform.querySelector('[data-act=back]').addEventListener('click', function() { state.view = 'agree'; render(); });
        container.appendChild(sform);
        return;
      }

      // 3) Fresh wallet: show the code, pick a PIN and a leaderboard name
      if (state.view === 'pin') {
        container.appendChild(el('h2', { class: 'wl-title' }, 'Your wallet code'));
        container.appendChild(codeBlock(w.code, true));
        var pform = el('form', { class: 'wl-form', novalidate: '' },
          '<p class="wl-lead">Save your code somewhere safe, then set your PIN. Your code + PIN is how you use your wallet on another phone or computer.</p>' +
          '<div class="wl-pinlen" role="group" aria-label="PIN length">' +
            '<button type="button" data-len="4" class="' + (state.pinLen === 4 ? 'on' : '') + '">4 digits</button>' +
            '<button type="button" data-len="6" class="' + (state.pinLen === 6 ? 'on' : '') + '">6 digits</button>' +
          '</div>' +
          '<label class="wl-field"><span>Choose your PIN</span><input type="password" inputmode="numeric" maxlength="' + state.pinLen + '" autocomplete="new-password" required /></label>' +
          '<label class="wl-field"><span>Type it again</span><input type="password" inputmode="numeric" maxlength="' + state.pinLen + '" autocomplete="new-password" required /></label>' +
          '<label class="wl-field"><span>Leaderboard name</span><input type="text" maxlength="24" autocomplete="off" placeholder="Pick a name" /></label>' +
          '<label class="wl-check"><input type="checkbox" class="wl-anon" /> <span>Stay anonymous (show me as Anonymous #' + w.anonNumber + ')</span></label>' +
          '<div class="age-error wl-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary wl-wide">Save &amp; Continue</button>');
        pform.querySelectorAll('.wl-pinlen button').forEach(function(b) {
          b.addEventListener('click', function() { state.pinLen = +b.dataset.len; render(); });
        });
        var nameInput = pform.querySelectorAll('input')[2], anon = pform.querySelector('.wl-anon');
        anon.addEventListener('change', function() { nameInput.disabled = anon.checked; });
        pform.addEventListener('submit', async function(e) {
          e.preventDefault();
          var ins = pform.querySelectorAll('input'), err = pform.querySelector('.wl-error');
          var pin = ins[0].value;
          if (!new RegExp('^\\d{' + state.pinLen + '}$').test(pin)) { err.textContent = 'Your PIN must be ' + state.pinLen + ' digits.'; return; }
          if (pin !== ins[1].value) { err.textContent = "Those PINs don't match."; return; }
          try {
            await GamesAPI.setPin(pin);
            state.wallet = await GamesAPI.setName(nameInput.value, anon.checked);
            state.view = 'ready'; render(); emit(state.wallet);
          } catch (x) { err.textContent = x.message; }
        });
        container.appendChild(pform);
        return;
      }

      // 4) Ready: balance, code, load
      var top = el('div', { class: 'wl-top' },
        '<div class="wl-balance"><span class="wl-label">Wallet balance</span>' +
          '<span class="wl-amount">' + money(w.balanceCents) + ' <small>USD</small></span>' +
          (w.heldCents ? '<span class="wl-held">+ ' + money(w.heldCents) + ' set aside for your Dice Duel game</span>' : '') + '</div>');
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
        container.appendChild(panel);
      }

      if (!opts.compact) {
        var settings = el('div', { class: 'wl-settings' });
        var st = el('button', { type: 'button', class: 'wl-link' }, (state.settingsOpen ? '▴' : '▾') + ' Wallet settings');
        st.addEventListener('click', function() { state.settingsOpen = !state.settingsOpen; render(); });
        settings.appendChild(st);
        if (state.settingsOpen) {
          var body = el('div', { class: 'wl-settings-body' },
            '<dl class="wl-rows">' +
              '<div><dt>Leaderboard name</dt><dd>' + esc(w.name || ('Anonymous #' + w.anonNumber)) + '</dd></div>' +
              '<div><dt>Other devices</dt><dd>Code + ' + (w.pinLength || 4) + '-digit PIN</dd></div>' +
              '<div><dt>Extra security</dt><dd>' + (w.twoFactor ? 'Authenticator app &#10003; <button type="button" class="wl-link wl-inline" data-act="tf-off">Turn off</button>'
                                                            : 'Off <button type="button" class="wl-link wl-inline" data-act="tf-on">Turn on</button>') + '</dd></div>' +
            '</dl>' +
            '<div class="wl-tf" hidden></div>' +
            '<button type="button" class="wl-link" data-act="signout">Sign out on this device</button>');
          body.querySelector('[data-act=signout]').addEventListener('click', async function() {
            await GamesAPI.signOut(); state.wallet = null; state.view = 'agree'; render(); emit(null);
          });
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

    function showQR(box, text) {
      function draw() { box.innerHTML = ''; new window.QRCode(box, { text: text, width: 168, height: 168, correctLevel: window.QRCode.CorrectLevel.M }); }
      if (window.QRCode) return draw();
      var sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      sc.onload = draw;
      sc.onerror = function() { box.hidden = true; };
      document.head.appendChild(sc);
    }

    function codeBlock(code, big) {
      var wrap = el('div', { class: 'wl-code' + (big ? ' wl-code-big' : '') });
      var label = el('span', { class: 'wl-label' }, 'Your code');
      var btn = el('button', { type: 'button', class: 'wl-code-value', title: 'Tap to copy' }, esc(code));
      var copy = el('button', { type: 'button', class: 'wl-copy' }, 'Copy');
      btn.addEventListener('click', function() { copyText(code, copy, 'Copy'); });
      copy.addEventListener('click', function() { copyText(code, copy, 'Copy'); });
      wrap.appendChild(label);
      var row = el('div', { class: 'wl-code-row' }); row.appendChild(btn); row.appendChild(copy);
      wrap.appendChild(row);
      return wrap;
    }

    GamesAPI.me().then(function(w) {
      state.wallet = w;
      state.view = !w ? 'agree' : (!w.hasPin ? 'pin' : 'ready');
      render(); emit(w);
    }, function(x) {
      state.view = 'error'; state.error = x.message; render();
    });

    document.addEventListener('wallet:change', function(e) {
      if (e.detail && state.wallet && e.detail.code === state.wallet.code && e.detail !== state.wallet) {
        state.wallet = e.detail; if (state.view === 'ready') render();
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
        '<div class="lb-name">' + esc(r.name) + '</div>' +
        '<div class="lb-reign">' + (r.rank === 1 ? 'Reigning ' : 'Held ') + r.reignDays + (r.reignDays === 1 ? ' day' : ' days') + '</div>' +
        '<div class="lb-step"><span>' + r.rank + '</span></div>');
      podium.appendChild(place);
    });
    container.appendChild(podium);
    var list = el('ol', { class: 'lb-list', start: '4' });
    rows.slice(3, 10).forEach(function(r) {
      list.appendChild(el('li', { class: r.me ? 'lb-me' : '' },
        '<span class="lb-num">' + r.rank + '</span><span class="lb-row-name">' + esc(r.name) + '</span>'));
    });
    if (list.children.length) container.appendChild(list);
    var me = rows.find(function(r) { return r.me; });
    container.appendChild(el('p', { class: 'lb-you' },
      me ? (me.rank <= 10 ? 'You&rsquo;re <strong>#' + me.rank + '</strong> ✦' : 'You&rsquo;re <strong>#' + me.rank + '</strong>. Keep going to reach the top 10.')
         : 'Play to get on the board.'));
  }

  window.Games = {
    DUEL: DUEL, columnScore: columnScore, boardScore: boardScore,
    placeDie: placeDie, cloneBoard: cloneBoard,
    LOCAL: LOCAL, ROWS: ROWS, DRAINS: DRAINS, CENTER: CENTER, BOARDS: BOARDS, BOARD_ORDER: BOARD_ORDER,
    oddsFor: oddsFor, drainValue: drainValue, lossFor: lossFor, averageLoss: averageLoss,
    oneIn: oneIn, percent: percent, money: money, shortMoney: shortMoney, dropPath: dropPath,
    api: GamesAPI, mountWallet: mountWallet, renderLeaderboard: renderLeaderboard, esc: esc
  };
})();
