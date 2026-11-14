// ==========================================
// Spell It Out (page script)
// Gnomie picks a word (with a category hint). Guess one letter at a time.
// Right letters are free; each wrong letter costs the amount you typed and
// a piece of clothing comes off the figure. Six misses and the round is over.
// The most a round can cost (6x) is set aside; the rest comes back.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var GAME = 'spell-it-out';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var MISSES = 6;
  var page = document.querySelector('.so-page');
  var root = document.getElementById('so-root');
  var KEYS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

  var state = { wallet: null, game: null, chosen: null, busy: false, result: null, final: null, error: '', demo: false, lastOff: -1, flash: null, look: null };

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

  // Give up: counts as a loss (the full amount set aside), then back to the start
  G.wireGiveUp(root, GAME, function() { return state.game && state.game.held; }, function() {
    state.game = null; state.result = null; state.final = null; state.busy = false;
    boards(); render();
  });

  var started = false;
  async function start() {
    if (started) return; started = true;
    document.getElementById('games-gate').style.display = 'none';
    page.classList.remove('games-lock');
    G.mountWallet(document.getElementById('wallet-root'), { compact: true });
    document.addEventListener('wallet:change', function(e) { state.wallet = e.detail; if (!state.busy && !state.game && !state.result) render(); });
    try { state.game = await G.api.spellState(); } catch (x) { state.game = null; }
    try { var lk = await fetch('/api/site/look'); if (lk.ok) state.look = await lk.json(); } catch (x) {}
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || !state.game || state.busy || state.demo) return;
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); guess(e.key.toUpperCase()); }
    });
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), 'Spell It Out');
  }
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('spell-it-out-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Spelled the most words: ' + list + '.' : '') +
      (w && w.spellWins ? '<span class="duel-wins-you">You&rsquo;ve spelled ' + (w.spellWins === 1 ? 'one word' : w.spellWins + ' words') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function cur() { return state.final || state.game; }

  // ---------- the figure (Gnomie): each miss, she puts a piece back on ----------
  // Drawn by gnomie-figure.js; her hair and lips come from Backstage.
  function figureHTML(misses) { return window.GnomieFigure.html(misses, { changed: state.lastOff, look: state.look }); }

  // ---------- 1) pick an amount ----------
  function payTable(a, small) {
    return '<div class="duel-pays duel-pays-two' + (small ? ' duel-pays-small' : '') + '">' +
      '<div class="win"><span>' + (small ? 'Each miss' : 'Each Wrong Letter') + '</span><strong>' + money(-a) + '</strong></div>' +
      '<div class="lose"><span>' + (small ? 'All 6' : 'All 6 Misses') + '</span><strong>' + money(-a * MISSES) + '</strong></div>' +
    '</div>';
  }
  function render() {
    if (state.result || state.game) return renderRound();
    renderSetup();
  }
  function renderSetup() {
    var w = state.wallet, bal = w ? w.balanceCents : 0, ready = w && w.hasPin;
    var problem = state.chosen ? G.amountProblem(state.chosen, bal, MISSES) : '';
    root.innerHTML =
      '<div class="so-intro">' + figureHTML(0) + '<p>Guess my word one letter at a time. <strong>Right letters are free.</strong> Each wrong letter costs your amount, and I put something back on.</p></div>' +
      '<h2 class="duel-title">Each wrong letter costs</h2>' +
      G.amountBoxHTML(state.chosen, bal, MISSES) +
      '<div class="amt-paybox">' + (state.chosen && !problem ? payTable(state.chosen) : '') + '</div>' +
      '<p class="duel-double">Spell it with no misses and it costs <strong>nothing</strong>.</p>' +
      '<button type="button" class="btn btn-primary duel-start" id="so-start"' + (state.chosen && !problem && ready ? '' : ' disabled') + '>' +
        (state.chosen && !problem ? 'Start at ' + money(state.chosen) + ' a miss' : 'Type an amount') + '</button>' +
      '<p class="duel-status amt-msg">' + (state.error || problem || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>' +
      '<button type="button" class="wl-link game-demo-btn" id="so-demo">&#9654; Watch a demo</button>';
    G.wireAmountBox(root, bal, MISSES, function(c, pr) {
      state.chosen = c; state.error = '';
      root.querySelector('.amt-paybox').innerHTML = c && !pr ? payTable(c) : '';
      var st = document.getElementById('so-start');
      st.disabled = !c || !!pr || !ready;
      st.textContent = c && !pr ? 'Start at ' + money(c) + ' a miss' : 'Type an amount';
      root.querySelector('.amt-msg').innerHTML = pr;
    }, function(c) { state.chosen = c; state.error = ''; render(); });
    document.getElementById('so-demo').addEventListener('click', runDemo);
    document.getElementById('so-start').addEventListener('click', async function() {
      if (!state.chosen || state.busy || G.amountProblem(state.chosen, state.wallet ? state.wallet.balanceCents : 0, MISSES)) return;
      state.busy = true;
      try {
        var res = await G.api.spellStart(state.chosen);
        state.game = res.game; state.error = ''; state.lastOff = -1;
        document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      } catch (x) { state.error = x.message; }
      state.busy = false;
      render();
    });
  }

  // ---------- 2) the round ----------
  function renderRound() {
    var g = cur(), done = !!state.result, live = !done && !state.busy && !state.demo;
    var word = state.final ? state.final.word : null;
    var tiles = g.mask.map(function(ch, i) {
      if (ch === ' ') return '<span class="so-gap"></span>';
      if (ch === '-') return '<span class="so-dash">-</span>';
      var shown = ch || (word ? word[i] : '');
      var cls = 'so-tile' + (ch ? ' got' : shown ? ' reveal' : '') + (state.flash && ch === state.flash ? ' just' : '');
      return '<span class="' + cls + '">' + shown + '</span>';
    }).join('');
    var keys = KEYS.map(function(row) {
      return '<div class="rm-krow">' + row.split('').map(function(L) {
        var used = g.guessed.indexOf(L) !== -1, inWord = used && (g.mask.indexOf(L) !== -1);
        return '<button type="button" class="rm-key so-key' + (used ? (inWord ? ' m-g' : ' m-x') : '') + '" data-k="' + L + '"' + (used || !live ? ' disabled' : '') + '>' + L + '</button>';
      }).join('') + '</div>';
    }).join('');
    root.innerHTML =
      (done ? resultHTML() : payTable(g.amount, true)) +
      '<div class="so-stage">' +
        '<div class="so-fig-wrap">' + figureHTML(g.misses) + '</div>' +
        '<div class="so-board">' +
          '<span class="so-cat">' + G.esc(g.category || 'Kink') + '</span>' +
          '<div class="so-word">' + tiles + '</div>' +
          '<p class="so-misses">' + (g.misses ? '<strong>' + g.misses + ' of ' + MISSES + '</strong> misses &middot; ' + money(-g.misses * g.amount) : 'No misses yet') + '</p>' +
        '</div>' +
      '</div>' +
      (done ? '' : '<div class="rm-keys">' + keys + '</div>') +
      (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>' : done ? '' : G.giveUpHTML());
    root.querySelectorAll('.so-key').forEach(function(b) { b.addEventListener('click', function() { guess(b.dataset.k); }); });
    var again = document.getElementById('so-again');
    if (again) again.addEventListener('click', function() { state.result = null; state.final = null; state.game = null; state.lastOff = -1; render(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    var stop = document.getElementById('demo-stop'); if (stop) stop.addEventListener('click', endDemo);
  }
  function resultHTML() {
    var r = state.result, win = r.outcome === 'solved';
    return '<div class="duel-result duel-result-' + (win ? 'win' : 'lose') + '">' +
      '<h2 class="duel-result-title">' + (win ? 'You Spelled It!' : 'Out of misses!') + '</h2>' +
      '<p class="duel-result-pay">' + (win ? (r.misses ? r.misses + (r.misses === 1 ? ' miss' : ' misses') + ' &middot; ' + money(-r.paidCents) : 'No misses &middot; ' + money(0)) : money(-r.paidCents)) + '</p>' +
    '</div>' +
    '<div class="duel-result-actions so-again-row"><button type="button" class="btn btn-primary" id="so-again">Clear Board &amp; Play Again</button><a class="btn btn-outline" href="games.html">All Games</a></div>';
  }

  async function guess(L) {
    var g = state.game;
    if (!g || state.busy || state.demo || state.result || g.guessed.indexOf(L) !== -1) return;
    state.busy = true;
    var res;
    try { res = await G.api.spellGuess(L); }
    catch (x) { state.busy = false; renderRound(); return; }
    document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
    var before = g.misses;
    if (res.result) { state.final = res.final; state.game = null; }
    else state.game = res.game;
    var after = cur().misses;
    state.lastOff = after > before ? after - 1 : -1;
    state.flash = res.hit ? L : null;
    state.busy = !!res.result;
    renderRound();
    state.flash = null;
    if (res.result) {
      await wait(900);
      var win = res.result.outcome === 'solved';
      G.celebrate(win ? 'win' : 'lose', win ? 'You Spelled It!' : 'It was ' + res.result.word, money(-res.result.paidCents));
      state.result = res.result; state.busy = false; state.lastOff = -1;
      boards(); renderRound();
    }
  }

  // ---------- demo: a pretend round with captions ----------
  var demoRun = 0, saved = null;
  function endDemo() { demoRun++; state.demo = false; if (saved) { state.game = saved.game; state.final = saved.final; state.result = saved.result; } saved = null; state.lastOff = -1; render(); }
  async function runDemo() {
    var run = ++demoRun;
    saved = { game: state.game, final: state.final, result: state.result };
    var WORD = 'COLLAR';
    state.demo = true; state.result = null; state.final = null;
    state.game = { amount: state.chosen || 100, category: 'Gear', mask: WORD.split('').map(function() { return null; }), guessed: [], misses: 0 };
    var say = function(t) { var b = root.querySelector('.so-misses'); if (b) b.innerHTML = t; };
    var step = async function(L, text, ms) {
      if (run !== demoRun) throw 0;
      if (L) {
        var g = state.game, before = g.misses;
        g.guessed.push(L);
        g.mask = WORD.split('').map(function(ch) { return g.guessed.indexOf(ch) !== -1 ? ch : null; });
        g.misses = g.guessed.filter(function(x) { return WORD.indexOf(x) === -1; }).length;
        state.lastOff = g.misses > before ? g.misses - 1 : -1; state.flash = WORD.indexOf(L) !== -1 ? L : null;
      }
      renderRound(); state.flash = null; say(text); await wait(ms);
    };
    try {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await step(null, 'I pick a word and give you a hint: <strong>Gear</strong>. Guess one letter at a time.', 2800);
      await step('E', 'No E. A wrong letter costs your amount&hellip; and on go my fishnets.', 2600);
      await step('L', '<strong>L is in it, twice!</strong> Right letters are free.', 2400);
      await step('O', '<strong>O!</strong> Getting there&hellip;', 1800);
      await step('S', 'No S. On goes the skirt.', 2200);
      await step('C', '<strong>C!</strong>', 1500);
      await step('A', '<strong>A!</strong> One letter left&hellip;', 1800);
      await step('R', '<strong>You spelled COLLAR!</strong> 2 misses = 2 &times; your amount.', 2800);
      await step(null, 'Six misses and the round is over. That&rsquo;s it: type an amount to play for real.', 2600);
    } catch (e) { return; }
    if (run === demoRun) endDemo();
  }
})();
