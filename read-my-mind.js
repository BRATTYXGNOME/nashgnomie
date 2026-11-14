// ==========================================
// Read My Mind (page script)
// Gnomie is thinking of a 6-letter word. You get 6 tries. Before each guess
// you choose how much that guess is worth (pennies are fine); every guess,
// right or wrong, takes its amount. Tiles show which letters are right.
// The word is kept on the server until the game ends.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var GAME = 'read-my-mind';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var LEN = 6, TRIES = 6, MAX = 50000;
  var page = document.querySelector('.rm-page');
  var root = document.getElementById('rm-root');
  var KEYS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

  // view: { guesses: [{word, marks, cents}], typing, reveal: rowIndex }
  var state = { wallet: null, game: null, typing: '', amount: null, busy: false, result: null, final: null, error: '', demo: false, reveal: -1, shake: false };

  // ---------- 18+ gate ----------
  (function gate() {
    var form = document.getElementById('games-gate-form');
    var bd = document.getElementById('games-gate-birthdate');
    var err = document.getElementById('games-gate-error');
    bd.max = new Date().toISOString().split('T')[0];
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      err.textContent = '';
      if (!bd.value) { err.textContent = 'Please enter your birthdate.'; return; }
      var result = window.AgeGate.verify(bd.value);
      if (result.success) start(); else window.AgeGate.handleFailure(result, err);
    });
  })();
  G.autoPass(function() { start(); });

  var started = false;
  async function start() {
    if (started) return; started = true;
    document.getElementById('games-gate').style.display = 'none';
    page.classList.remove('games-lock');
    G.mountWallet(document.getElementById('wallet-root'), { compact: true });
    document.addEventListener('wallet:change', function(e) { state.wallet = e.detail; if (!state.busy) render(); });
    try { state.game = await G.api.mindState(); } catch (x) { state.game = null; }
    document.addEventListener('keydown', onKey);
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), 'Read My Mind');
  }
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('read-my-mind-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Read her mind most often: ' + list + '.' : '') +
      (w && w.mindWins ? '<span class="duel-wins-you">You&rsquo;ve read her mind ' + (w.mindWins === 1 ? 'once' : w.mindWins + ' times') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function guesses() { return state.final ? state.final.guesses : state.game ? state.game.guesses : []; }
  // Low suggestions that fit the wallet: about 1%, 2% and 5% of the balance
  function suggestions(bal) {
    var out = [];
    [0.01, 0.02, 0.05].forEach(function(p) {
      var c = Math.max(1, Math.round(bal * p));
      c = c >= 100 ? Math.round(c / 25) * 25 : c >= 10 ? Math.round(c / 5) * 5 : c;
      if (c >= 1 && c <= Math.min(bal, MAX) && out.indexOf(c) === -1) out.push(c);
    });
    return out;
  }
  function amountProblem(c, bal) {
    if (!c) return 'Pick how much this guess is worth.';
    if (c > MAX) return 'The most for one guess is ' + money(MAX) + '.';
    if (c > bal) return 'Your wallet has ' + money(bal) + '.';
    return '';
  }

  // ---------- the board ----------
  function letterStates() {
    var best = {};
    guesses().forEach(function(g) {
      g.word.split('').forEach(function(ch, i) {
        var m = g.marks[i], rank = { g: 3, y: 2, x: 1 }[m];
        if (!best[ch] || rank > best[ch].rank) best[ch] = { m: m, rank: rank };
      });
    });
    return best;
  }
  function boardHTML(live) {
    var gs = guesses(), html = '<div class="rm-board' + (state.shake ? ' shake' : '') + '">';
    for (var r = 0; r < TRIES; r++) {
      var g = gs[r], typing = live && r === gs.length;
      html += '<div class="rm-row' + (typing ? ' current' : '') + '">';
      for (var i = 0; i < LEN; i++) {
        var ch = g ? g.word[i] : typing ? (state.typing[i] || '') : '';
        var cls = g ? ' m-' + g.marks[i] + (state.reveal === r ? ' flip' : '') : ch ? ' typed' : '';
        html += '<span class="rm-tile' + cls + '"' + (g && state.reveal === r ? ' style="--d:' + (i * 0.16) + 's"' : '') + '>' + ch + '</span>';
      }
      html += '<span class="rm-cost">' + (g ? money(-g.cents) : '') + '</span></div>';
    }
    return html + '</div>';
  }
  function keyboardHTML() {
    var st = letterStates();
    return '<div class="rm-keys">' + KEYS.map(function(row, i) {
      return '<div class="rm-krow">' + (i === 2 ? '<button type="button" class="rm-key wide" data-k="ENTER">Enter</button>' : '') +
        row.split('').map(function(ch) { return '<button type="button" class="rm-key' + (st[ch] ? ' m-' + st[ch].m : '') + '" data-k="' + ch + '">' + ch + '</button>'; }).join('') +
        (i === 2 ? '<button type="button" class="rm-key wide" data-k="BACK" aria-label="Delete">&#9003;</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function amountHTML(bal) {
    var chips = suggestions(bal), c = state.amount;
    var val = c ? (c / 100).toFixed(2).replace(/\.00$/, '') : '';
    return '<div class="rm-amount">' +
      '<span class="rm-amount-label">This guess is worth</span>' +
      '<label class="rm-amount-box"><span>$</span><input type="text" class="rm-amt" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + val + '" aria-label="How much this guess is worth" /></label>' +
      (chips.length ? '<div class="tf-chips">' + chips.map(function(x) { return '<button type="button" class="tf-chip' + (c === x ? ' on' : '') + '" data-amt="' + x + '">' + money(x) + '</button>'; }).join('') + '</div>' : '') +
    '</div>';
  }

  function render() {
    var w = state.wallet, bal = w ? w.balanceCents : 0, ready = w && w.hasPin;
    var gs = guesses(), done = !!state.result, live = !done && !state.demo;
    var head = '<div class="rm-head"><img class="duel-pfp" src="' + PFP + '" alt="" /><p>' +
      (done ? (state.result.outcome === 'solved' ? 'You read my mind &#128527;' : 'My word was <strong>' + state.result.word + '</strong>') :
        state.demo ? 'I&rsquo;m thinking of a 6-letter word&hellip;' : gs.length ? 'Try ' + (gs.length + 1) + ' of ' + TRIES + '&hellip;' : 'I&rsquo;m thinking of a 6-letter word. Can you read my mind?') + '</p></div>';
    var problem = amountProblem(state.amount, bal);
    var canGuess = live && ready && !state.busy && state.typing.length === LEN && !problem;
    root.innerHTML =
      (done ? resultHTML() : '') +
      head +
      boardHTML(live) +
      '<div class="rm-legend"><span><i class="m-g"></i>Right spot</span><span><i class="m-y"></i>In the word</span><span><i class="m-x"></i>Not in it</span></div>' +
      (done ? '' :
        (state.demo ? '' : amountHTML(bal) +
          '<button type="button" class="btn btn-primary duel-start" id="rm-go"' + (canGuess ? '' : ' disabled') + '>' +
            (state.typing.length < LEN ? 'Type a 6-letter word' : problem ? 'Pick an amount' : 'Guess for ' + money(state.amount)) + '</button>' +
          '<p class="duel-status rm-msg">' + (state.error || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : state.amount && problem ? problem : '')) + '</p>') +
        keyboardHTML() +
        (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>'
          : (state.game && gs.length ? '<button type="button" class="wl-link game-giveup" id="rm-giveup">Give up this game</button>' : '<button type="button" class="wl-link game-demo-btn" id="rm-demo">&#9654; Watch a demo</button>')));
    wire(bal);
  }
  function resultHTML() {
    var r = state.result;
    var title = r.outcome === 'solved' ? 'You Read My Mind!' : r.outcome === 'gave_up' ? 'You gave up' : 'Not this time!';
    var sub = r.outcome === 'solved' ? 'In ' + r.tries + (r.tries === 1 ? ' try' : ' tries') + ' &middot; ' + money(-r.paidCents) : money(-r.paidCents);
    return '<div class="duel-result duel-result-' + (r.outcome === 'solved' ? 'win' : 'lose') + '"><h2 class="duel-result-title">' + title + '</h2><p class="duel-result-pay">' + sub + '</p></div>' +
      '<div class="duel-result-actions rm-again"><button type="button" class="btn btn-primary" id="rm-again">Clear Board &amp; Play Again</button><a class="btn btn-outline" href="games.html">All Games</a></div>';
  }
  function wire(bal) {
    root.querySelectorAll('.rm-key').forEach(function(b) { b.addEventListener('click', function() { press(b.dataset.k); }); });
    var amt = root.querySelector('.rm-amt');
    if (amt) amt.addEventListener('input', function() {
      var n = parseFloat(String(amt.value).replace(/[$,\s]/g, '')); state.amount = isFinite(n) && n > 0 ? Math.round(n * 100) : null; state.error = '';
      root.querySelectorAll('[data-amt]').forEach(function(x) { x.classList.toggle('on', +x.dataset.amt === state.amount); });
      refreshGo(bal);
    });
    root.querySelectorAll('[data-amt]').forEach(function(b) { b.addEventListener('click', function() { state.amount = +b.dataset.amt; state.error = ''; render(); }); });
    var go = document.getElementById('rm-go'); if (go) go.addEventListener('click', submit);
    var again = document.getElementById('rm-again');
    if (again) again.addEventListener('click', function() { state.result = null; state.final = null; state.game = null; state.typing = ''; state.reveal = -1; render(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    var demo = document.getElementById('rm-demo'); if (demo) demo.addEventListener('click', runDemo);
    var stop = document.getElementById('demo-stop'); if (stop) stop.addEventListener('click', endDemo);
    var gu = document.getElementById('rm-giveup'); if (gu) gu.addEventListener('click', giveUp);
  }
  function refreshGo(bal) {
    var go = document.getElementById('rm-go'), msg = root.querySelector('.rm-msg'); if (!go) return;
    var w = state.wallet, ready = w && w.hasPin, problem = amountProblem(state.amount, bal);
    go.disabled = !(ready && !state.busy && state.typing.length === LEN && !problem);
    go.textContent = state.typing.length < LEN ? 'Type a 6-letter word' : problem ? 'Pick an amount' : 'Guess for ' + money(state.amount);
    if (msg) msg.textContent = state.amount && problem ? problem : '';
  }

  // ---------- typing ----------
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement && document.activeElement.classList.contains('rm-amt')) { if (e.key === 'Enter') submit(); return; }
    if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (!document.querySelector('.rm-row.current')) return;
    if (/^[a-zA-Z]$/.test(e.key)) { press(e.key.toUpperCase()); e.preventDefault(); }
    else if (e.key === 'Backspace') { press('BACK'); e.preventDefault(); }
    else if (e.key === 'Enter') { press('ENTER'); e.preventDefault(); }
  }
  function press(k) {
    if (state.busy || state.result || state.demo) return;
    if (k === 'ENTER') return submit();
    if (k === 'BACK') state.typing = state.typing.slice(0, -1);
    else if (state.typing.length < LEN) state.typing += k;
    state.error = '';
    var row = root.querySelector('.rm-row.current');
    if (row) row.querySelectorAll('.rm-tile').forEach(function(t, i) { t.textContent = state.typing[i] || ''; t.classList.toggle('typed', !!state.typing[i]); });
    refreshGo(state.wallet ? state.wallet.balanceCents : 0);
  }

  async function submit() {
    var bal = state.wallet ? state.wallet.balanceCents : 0;
    if (state.busy || state.result || state.demo) return;
    if (state.typing.length < LEN) { state.shake = true; render(); state.shake = false; return; }
    var problem = amountProblem(state.amount, bal);
    if (problem) { state.error = problem; render(); return; }
    state.busy = true;
    try {
      if (!state.game) state.game = (await G.api.mindStart()).game;
      var res = await G.api.mindGuess(state.typing, state.amount);
      document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      state.typing = '';
      if (res.result) { state.final = res.final; state.game = null; } else state.game = res.game;
      state.reveal = guesses().length - 1;
      state.busy = true; render();
      await wait(LEN * 160 + 450);
      state.reveal = -1;
      if (res.result) {
        state.result = res.result;
        var solved = res.result.outcome === 'solved';
        G.celebrate(solved ? 'win' : 'lose', solved ? 'You Read My Mind!' : 'It was ' + res.result.word, money(-res.result.paidCents));
        boards();
      }
    } catch (x) { state.error = x.message; }
    state.busy = false;
    render();
  }

  async function giveUp() {
    var paid = state.game ? state.game.paid : 0;
    var ok = await uiConfirm('Give up this game? You&rsquo;ll see the word. Nothing more comes off your balance: your guesses (' + money(paid) + ') were already taken as you made them.');
    if (!ok) return;
    try {
      var res = await G.api.mindGiveUp();
      state.final = res.final; state.result = res.result; state.game = null; state.typing = '';
      G.celebrate('lose', 'It was ' + res.result.word, money(-res.result.paidCents));
      boards(); render();
    } catch (x) { state.error = x.message; render(); }
  }
  function uiConfirm(html) {
    return new Promise(function(resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'dlg-wrap';
      wrap.innerHTML = '<div class="dlg" role="dialog" aria-modal="true"><p class="dlg-msg">' + html + '</p><div class="dlg-btns"><button type="button" class="ghost" data-x>Keep playing</button><button type="button" data-ok>Give up</button></div></div>';
      function done(v) { wrap.remove(); resolve(v); }
      wrap.querySelector('[data-ok]').addEventListener('click', function() { done(true); });
      wrap.querySelector('[data-x]').addEventListener('click', function() { done(false); });
      wrap.addEventListener('click', function(e) { if (e.target === wrap) done(false); });
      document.body.appendChild(wrap);
    });
  }

  // ---------- demo: a pretend game with captions ----------
  var demoRun = 0, saved = null;
  function endDemo() { demoRun++; state.demo = false; if (saved) { state.game = saved.game; state.final = saved.final; state.result = saved.result; } saved = null; state.reveal = -1; render(); }
  async function runDemo() {
    var run = ++demoRun;
    saved = { game: state.game, final: state.final, result: state.result };
    state.demo = true; state.result = null; state.final = null; state.game = { guesses: [] };
    var cap = function(t) { var h = root.querySelector('.rm-head p'); if (h) h.innerHTML = t; };
    var step = async function(word, marks, cents, text, ms) {
      if (run !== demoRun) throw 0;
      if (word) { state.game.guesses.push({ word: word, marks: marks, cents: cents }); state.reveal = state.game.guesses.length - 1; render(); }
      cap(text); await wait(ms); state.reveal = -1;
    };
    try {
      render();
      await step(null, null, null, 'I&rsquo;m thinking of a 6-letter word. You get 6 tries.', 2400);
      await step(null, null, null, 'Before each guess, pick how much it&rsquo;s worth. Pennies are fine.', 2600);
      await step('PLANET', 'xxyygx', 5, '<strong>Gold</strong> letters are in my word, but in another spot.', 2800);
      await step('GARDEN', 'xyyxgy', 10, '<strong>Your color</strong> means the right letter in the right spot.', 2800);
      await step('BOTTLE', 'xxxxxy', 5, 'Dark letters aren&rsquo;t in my word at all.', 2400);
      await step('SEASON', 'yyyxxy', 25, 'Every guess takes its amount, right or wrong.', 2600);
      await step('RAVENS', 'yyxyyy', 10, 'Getting close&hellip;', 1800);
      await step('ANSWER', 'gggggg', 50, 'You read my mind! That&rsquo;s it: type a word to play for real.', 3000);
    } catch (e) { return; }
    if (run === demoRun) endDemo();
  }
})();
