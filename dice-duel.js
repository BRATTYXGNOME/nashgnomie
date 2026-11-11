// ==========================================
// Dice Duel (page script)
// Pick an amount, then take turns against Gnomie: press Roll, tap a column.
// Win pays 1x, tie 1.5x, Gnomie wins 2x (set aside when the game starts).
// Rules and Gnomie's moves live in games.js; every roll comes from the
// server (the preview backend for now). This file only shows it all, one
// clear step at a time: rolls tumble beside each side's board, and knocked
// out dice shake, turn red and pop away before they disappear.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var GAME = 'dice-duel';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var page = document.querySelector('.duel-page');
  var root = document.getElementById('duel-root');

  // view: what's on screen right now (boards can differ from the server
  // state for a moment while a move is being shown)
  var state = { wallet: null, duel: null, chosen: null, busy: false, result: null, error: '', view: null };

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

  var started = false;
  async function start() {
    if (started) return; started = true;
    document.getElementById('games-gate').style.display = 'none';
    page.classList.remove('games-lock');
    G.mountWallet(document.getElementById('wallet-root'), { compact: true });
    document.addEventListener('wallet:change', function(e) { state.wallet = e.detail; if (!state.busy && !state.duel) render(); });
    state.duel = await G.api.duelState();   // resume a saved game
    if (state.duel) state.view = viewFromDuel(state.duel);
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
  }

  // Small, low-key "Most wins against Gnomie" strip (top 5 + your win count)
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('dice-duel-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Most wins against Gnomie: ' + list + '.' : '') +
      (w && w.duelWins ? '<span class="duel-wins-you">You&rsquo;ve beaten her ' + (w.duelWins === 1 ? 'once' : w.duelWins + ' times') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function pays(amount) {
    return { win: amount * G.DUEL.PAY.win, tie: Math.round(amount * G.DUEL.PAY.tie), lose: amount * G.DUEL.PAY.lose };
  }

  // ---------- dice ----------
  var PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  function dieHTML(d, extra) {
    var cells = '';
    for (var i = 1; i <= 9; i++) cells += '<i' + (PIPS[d.v].indexOf(i) !== -1 ? ' class="on"' : '') + '></i>';
    return '<span class="die' + (extra ? ' ' + extra : '') + '" aria-label="' + d.v + '">' + cells + '</span>';
  }

  // ---------- views ----------
  // A view is everything the game screen draws:
  // { player, gnome, yourDie, gnomieDie, rolling: 'you'|'gnomie'|null,
  //   status, newAt: {who, col}, knock: {who, col, v} }
  function viewFromDuel(d) {
    return { player: d.player, gnome: d.gnome, yourDie: d.die, gnomieDie: null, rolling: null,
             status: d.die ? placeText(d.die) : 'Your turn · Roll' };
  }
  function placeText(die) { return 'Place your ' + die.v + ' in a column'; }

  function render() {
    if (state.result) return renderResult();
    if (state.duel && state.view) return renderGame();
    renderSetup();
  }

  // Amount buttons: all three always show; ones the wallet can't cover are locked
  function amountsHTML() {
    var w = state.wallet, bal = w ? w.balanceCents : 0, ready = w && w.hasPin;
    if (state.chosen && !(ready && bal >= pays(state.chosen).lose)) state.chosen = null;
    return '<div class="duel-amounts">' + G.DUEL.AMOUNTS.map(function(a) {
      var p = pays(a), ok = ready && bal >= p.lose;
      return '<button type="button" class="duel-amount' + (state.chosen === a ? ' on' : '') + (ok ? '' : ' locked') + '" data-amt="' + a + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="da-amt">' + G.shortMoney(a) + '</span>' +
        (ok ? '<span class="da-sub">Lose = ' + money(p.lose) + '</span>' : '<span class="da-sub">\u{1F512} ' + G.shortMoney(p.lose) + '+ wallet</span>') +
      '</button>';
    }).join('') + '</div>';
  }

  // 1) Pick an amount
  function renderSetup() {
    var w = state.wallet, bal = w ? w.balanceCents : 0;
    var ready = w && w.hasPin;
    root.innerHTML =
      '<h2 class="duel-title">Play for</h2>' +
      amountsHTML() +
      (state.chosen ? payTable(state.chosen) : '') +
      '<p class="duel-double">If Gnomie wins, you pay <strong>DOUBLE</strong>.</p>' +
      '<button type="button" class="btn btn-primary duel-start" id="duel-start"' + (state.chosen ? '' : ' disabled') + '>' +
        (state.chosen ? 'Start for ' + money(state.chosen) : 'Pick an amount') + '</button>' +
      '<p class="duel-status">' + (state.error || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>';

    root.querySelectorAll('.duel-amount').forEach(function(b) {
      b.addEventListener('click', function() { state.chosen = +b.dataset.amt; state.error = ''; render(); });
    });
    document.getElementById('duel-start').addEventListener('click', async function() {
      if (!state.chosen || state.busy) return;
      state.busy = true;
      try {
        var res = await G.api.duelStart(state.chosen);
        state.duel = res.duel; state.view = viewFromDuel(res.duel); state.error = '';
        document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      } catch (x) { state.error = x.message; }
      state.busy = false;
      render();
    });
  }

  function payTable(a, small) {
    var p = pays(a);
    return '<div class="duel-pays' + (small ? ' duel-pays-small' : '') + '">' +
      '<div class="win"><span>' + (small ? 'Win' : 'You Won') + '</span><strong>pay ' + money(p.win) + '</strong></div>' +
      '<div class="tie"><span>Tie</span><strong>pay ' + money(p.tie) + '</strong></div>' +
      '<div class="lose"><span>' + (small ? 'Lose' : 'Gnomie Won') + '</span><strong>pay ' + money(p.lose) + '</strong></div>' +
    '</div>';
  }

  // 2) The duel
  function boardHTML(board, who, clickable, v) {
    return '<div class="duel-board duel-board-' + who + '">' + [0, 1, 2].map(function(c) {
      var col = board[c], open = clickable && col.length < 3;
      var cells = '';
      var flagged = false;
      for (var r = 0; r < 3; r++) {
        var d = col[r], cls = '', flag = '';
        if (d && col.filter(function(x) { return x.v === d.v; }).length > 1) cls = 'die-pink';
        if (d && v.newAt && v.newAt.who === who && v.newAt.col === c && r === col.length - 1) cls += ' die-new';
        if (d && v.knock && v.knock.who === who && v.knock.col === c && d.v === v.knock.v) {
          cls = 'die-knocked';
          // One "Knocked out!" pill, centered on the first knocked die
          if (!flagged) { flag = '<span class="duel-knock-flag">Knocked out!</span>'; flagged = true; }
        }
        cells += '<span class="duel-cell">' + (d ? dieHTML(d, cls) : '') + flag + '</span>';
      }
      return '<button type="button" class="duel-col' + (open ? ' open' : '') + '" data-col="' + c + '"' + (open ? '' : ' tabindex="-1"') + '>' +
        (who === 'you' ? '<span class="duel-colscore">' + G.columnScore(col) + '</span>' : '') +
        '<span class="duel-cells">' + cells + '</span>' +
        (who === 'gnomie' ? '<span class="duel-colscore">' + G.columnScore(col) + '</span>' : '') +
      '</button>';
    }).join('') + '</div>';
  }

  function trayHTML(die, rolling, side) {
    if (rolling) return '<span class="duel-tray duel-tray-rolling">' + dieHTML({ v: 1 + Math.floor(Math.random() * 6) }, 'die-rolling') + '</span>';
    if (die) return '<span class="duel-tray">' + dieHTML(die, 'die-landed') + '</span>';
    return '<span class="duel-tray duel-tray-empty"></span>';
  }

  function renderGame() {
    var d = state.duel, v = state.view, p = pays(d.amount);
    var yourTurnToRoll = !state.busy && !v.yourDie && !state.result;
    var canPlace = !state.busy && !!v.yourDie;
    root.innerHTML =
      payTable(d.amount, true) +
      // Gnomie's corner: pic, name, total, then her roll
      '<div class="duel-player duel-player-gnomie">' +
        '<span class="duel-who"><img class="duel-pfp" src="' + PFP + '" alt="" /><span class="duel-name">Gnomie</span><span class="duel-total">' + G.boardScore(v.gnome) + '</span></span>' +
        trayHTML(v.gnomieDie, v.rolling === 'gnomie') +
      '</div>' +
      boardHTML(v.gnome, 'gnomie', false, v) +
      '<p class="duel-status-line">' + v.status + '</p>' +
      boardHTML(v.player, 'you', canPlace, v) +
      // Your corner: your roll (or the Roll button), then name and total
      '<div class="duel-player duel-player-you">' +
        trayHTML(v.yourDie, v.rolling === 'you') +
        '<button type="button" class="btn btn-primary duel-roll-btn" id="duel-roll"' + (yourTurnToRoll ? '' : ' disabled') + '>Roll</button>' +
        '<span class="duel-who"><span class="duel-name">You</span><span class="duel-total">' + G.boardScore(v.player) + '</span></span>' +
      '</div>';

    var rollBtn = document.getElementById('duel-roll');
    if (rollBtn) rollBtn.addEventListener('click', roll);
    root.querySelectorAll('.duel-board-you .duel-col.open').forEach(function(btn) {
      btn.addEventListener('click', function() { place(+btn.dataset.col); });
    });
  }

  function show(changes) { Object.keys(changes).forEach(function(k) { state.view[k] = changes[k]; }); renderGame(); }

  // Roll: the die tumbles in your corner, then lands
  async function roll() {
    if (state.busy) return;
    state.busy = true;
    show({ rolling: 'you', status: 'Rolling…', newAt: null, knock: null });
    try {
      var res = await G.api.duelRoll();
      await wait(650);
      state.duel = res.duel;
      state.busy = false;
      show({ rolling: null, yourDie: res.duel.die, status: placeText(res.duel.die) });
    } catch (x) {
      state.busy = false; show({ rolling: null, status: x.message });
    }
  }

  // Place: show your move (and anything it knocks out), then Gnomie's turn
  async function place(col) {
    if (state.busy || !state.view.yourDie) return;
    state.busy = true;
    var player = G.cloneBoard(state.view.player), gnome = G.cloneBoard(state.view.gnome);
    try {
      var res = await G.api.duelPlace(col);

      // Your die goes in; Gnomie's matching dice in that column shake and pop
      var mine = res.you;
      player[col].push({ v: mine.die.v });
      var knockedTheirs = gnome[col].filter(function(x) { return x.v === mine.die.v; }).length;
      show({ player: player, gnome: gnome, yourDie: null, newAt: { who: 'you', col: col },
             knock: knockedTheirs ? { who: 'gnomie', col: col, v: mine.die.v } : null,
             status: knockedTheirs ? 'Your ' + mine.die.v + ' knocked out Gnomie’s ' + mine.die.v + (knockedTheirs > 1 ? 's' : '') + '!' : 'Nice.' });
      await wait(knockedTheirs ? 1100 : 450);
      gnome[col] = gnome[col].filter(function(x) { return x.v !== mine.die.v; });

      // Gnomie's turn: her die tumbles in her corner, then goes in
      if (res.gnomie) {
        var g = res.gnomie;
        show({ gnome: gnome, knock: null, newAt: null, rolling: 'gnomie', status: 'Gnomie’s turn…' });
        await wait(750);
        show({ rolling: null, gnomieDie: g.die, status: 'Gnomie rolled a ' + g.die.v });
        await wait(550);
        gnome[g.col].push({ v: g.die.v });
        var knockedYours = player[g.col].filter(function(x) { return x.v === g.die.v; }).length;
        show({ gnome: gnome, gnomieDie: null, newAt: { who: 'gnomie', col: g.col },
               knock: knockedYours ? { who: 'you', col: g.col, v: g.die.v } : null,
               status: knockedYours ? 'Gnomie knocked out your ' + g.die.v + (knockedYours > 1 ? 's' : '') + '!' : 'Gnomie placed her ' + g.die.v });
        await wait(knockedYours ? 1200 : 600);
      }

      document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      if (res.result) {
        state.duel = res.final;
        show({ player: res.final.player, gnome: res.final.gnome, knock: null, newAt: null, status: 'Board full!' });
        await wait(1000);
        state.result = res.result; state.duel = null; state.view = null;
        boards();
      } else {
        state.duel = res.duel;
        state.view = viewFromDuel(res.duel);
      }
      state.busy = false;
      render();
    } catch (x) {
      state.busy = false; show({ status: x.message });
    }
  }

  // 3) Result
  function renderResult() {
    var r = state.result;
    if (state.chosen == null) state.chosen = r.amount;
    var title = r.outcome === 'win' ? 'You Won!' : r.outcome === 'tie' ? 'It&rsquo;s a tie' : 'Gnomie Won!';
    var note = r.outcome === 'win' ? 'You pay ' + money(r.paidCents) + '.' :
               r.outcome === 'tie' ? 'Half a win each, so you pay ' + money(r.paidCents) + '.' :
               'You pay double: ' + money(r.paidCents) + '.';
    root.innerHTML =
      '<div class="duel-result duel-result-' + r.outcome + '">' +
        '<img class="duel-pfp duel-pfp-big" src="' + PFP + '" alt="" />' +
        '<h2 class="duel-result-title">' + title + '</h2>' +
        '<p class="duel-result-score">You <strong>' + r.you + '</strong> &middot; Gnomie <strong>' + r.gnomie + '</strong></p>' +
        '<p class="duel-result-pay">' + note + '</p>' +
      '</div>' +
      '<h3 class="duel-again-title">Play again for</h3>' +
      amountsHTML() +
      '<div class="duel-result-actions">' +
        '<button type="button" class="btn btn-primary" id="duel-again"' + (state.chosen ? '' : ' disabled') + '>' +
          (state.chosen ? 'Start for ' + money(state.chosen) : 'Pick an amount') + '</button>' +
        '<a class="btn btn-outline" href="games.html">All Games</a>' +
      '</div>';
    root.querySelectorAll('.duel-amount').forEach(function(b) {
      b.addEventListener('click', function() { state.chosen = +b.dataset.amt; render(); });
    });
    document.getElementById('duel-again').addEventListener('click', function() {
      if (!state.chosen) return;
      state.result = null; render();
      var startBtn = document.getElementById('duel-start');
      if (startBtn) startBtn.click();
    });
  }
})();
