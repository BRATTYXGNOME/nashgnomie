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
  var state = { wallet: null, duel: null, chosen: null, busy: false, result: null, error: '', view: null, finalView: null, demo: false };

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
    document.addEventListener('wallet:change', function(e) { state.wallet = e.detail; if (!state.busy && !state.duel) render(); });
    state.duel = await G.api.duelState();   // resume a saved game
    if (state.duel) state.view = viewFromDuel(state.duel);
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), 'Dice Duel');
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


  // 1) Pick an amount
  function renderSetup() {
    var w = state.wallet, bal = w ? w.balanceCents : 0;
    var ready = w && w.hasPin;
    var problem = state.chosen ? G.amountProblem(state.chosen, bal, 2) : '';
    root.innerHTML =
      '<h2 class="duel-title">Play for</h2>' +
      G.amountBoxHTML(state.chosen, bal, 2) +
      '<div class="amt-paybox">' + (state.chosen && !problem ? payTable(state.chosen) : '') + '</div>' +
      '<p class="duel-double">If Gnomie wins, you lose <strong>DOUBLE</strong>.</p>' +
      '<button type="button" class="btn btn-primary duel-start" id="duel-start"' + (state.chosen && !problem && ready ? '' : ' disabled') + '>' +
        (state.chosen && !problem ? 'Start for ' + money(state.chosen) : 'Type an amount') + '</button>' +
      '<p class="duel-status amt-msg">' + (state.error || problem || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>' +
      '<button type="button" class="wl-link game-demo-btn" id="duel-demo">&#9654; Watch a demo</button>';
    G.wireAmountBox(root, bal, 2, function(c, pr) {
      state.chosen = c; state.error = '';
      root.querySelector('.amt-paybox').innerHTML = c && !pr ? payTable(c) : '';
      var st = document.getElementById('duel-start');
      st.disabled = !c || !!pr || !ready;
      st.textContent = c && !pr ? 'Start for ' + money(c) : 'Type an amount';
      root.querySelector('.amt-msg').innerHTML = pr;
    }, function(c) { state.chosen = c; state.error = ''; render(); });
    document.getElementById('duel-demo').addEventListener('click', runDemo);
    document.getElementById('duel-start').addEventListener('click', async function() {
      if (!state.chosen || state.busy || G.amountProblem(state.chosen, state.wallet ? state.wallet.balanceCents : 0, 2)) return;
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
      '<div class="win"><span>' + (small ? 'Win' : 'If You Win') + '</span><strong>' + money(-p.win) + '</strong></div>' +
      '<div class="tie"><span>' + (small ? 'Tie' : 'If We Tie') + '</span><strong>' + money(-p.tie) + '</strong></div>' +
      '<div class="lose"><span>' + (small ? 'Lose' : 'If Gnomie Wins') + '</span><strong>' + money(-p.lose) + '</strong></div>' +
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
    var yourTurnToRoll = !state.busy && !v.yourDie && !state.result && !state.demo;
    var canPlace = !state.busy && !!v.yourDie && !state.demo;
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
      '</div>' +
      (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>' : '');
    var stop = document.getElementById('demo-stop');
    if (stop) stop.addEventListener('click', endDemo);

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
        state.finalView = { player: res.final.player, gnome: res.final.gnome, yourDie: null, gnomieDie: null };
        var oc = res.result.outcome;
        G.celebrate(oc === 'win' ? 'win' : oc === 'tie' ? 'tie' : 'lose', oc === 'win' ? 'You Won!' : oc === 'tie' ? 'Tie!' : 'Gnomie Wins!', money(-res.result.paidCents));
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

  // 3) Result: the final board stays on screen under the result
  function renderResult() {
    var r = state.result, fv = state.finalView;
    if (state.chosen == null) state.chosen = r.amount;
    var title = r.outcome === 'win' ? 'You Won!' : r.outcome === 'tie' ? 'It&rsquo;s a tie' : 'Gnomie Won!';
    var note = r.outcome === 'win' ? money(-r.paidCents) :
               r.outcome === 'tie' ? 'Half a win each: ' + money(-r.paidCents) :
               'Double: ' + money(-r.paidCents);
    root.innerHTML =
      '<div class="duel-result duel-result-' + r.outcome + '">' +
        '<h2 class="duel-result-title">' + title + '</h2>' +
        '<p class="duel-result-score">You <strong>' + r.you + '</strong> &middot; Gnomie <strong>' + r.gnomie + '</strong></p>' +
        '<p class="duel-result-pay">' + note + '</p>' +
      '</div>' +
      (fv ?
        '<div class="game-final">' +
          '<div class="duel-player duel-player-gnomie"><span class="duel-who"><img class="duel-pfp" src="' + PFP + '" alt="" /><span class="duel-name">Gnomie</span><span class="duel-total">' + r.gnomie + '</span></span></div>' +
          boardHTML(fv.gnome, 'gnomie', false, fv) +
          '<p class="duel-status-line">Final board</p>' +
          boardHTML(fv.player, 'you', false, fv) +
          '<div class="duel-player duel-player-you"><span class="duel-who"><span class="duel-name">You</span><span class="duel-total">' + r.you + '</span></span></div>' +
        '</div>' : '') +
      '<div class="duel-result-actions">' +
        '<button type="button" class="btn btn-primary" id="duel-again">Clear Board &amp; Play Again</button>' +
        '<a class="btn btn-outline" href="games.html">All Games</a>' +
      '</div>';
    document.getElementById('duel-again').addEventListener('click', function() {
      state.result = null; state.finalView = null; render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- demo: a pretend round with captions (no money, no server) ----------
  var demoRun = 0;
  function endDemo() { demoRun++; state.demo = false; state.duel = null; state.view = null; state.busy = false; render(); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; state.busy = true; state.result = null;
    state.duel = { amount: state.chosen || 100 };
    var e = function() { return G.emptyBoard(); };
    state.view = { player: e(), gnome: e(), yourDie: null, gnomieDie: null, rolling: null, status: '' };
    var P = state.view.player, Gn = state.view.gnome;
    var steps = [
      [{ status: 'You and Gnomie each get a 3 &times; 3 board.' }, 2200],
      [{ rolling: 'you', status: 'Press <strong>Roll</strong> to roll your die&hellip;' }, 1300],
      [{ rolling: null, yourDie: { v: 5 }, status: 'You rolled a 5. Tap a column to place it.' }, 1800],
      [function() { P[0].push({ v: 5 }); return { yourDie: null, newAt: { who: 'you', col: 0 }, status: 'Placed in the left column.' }; }, 1600],
      [{ rolling: 'gnomie', newAt: null, status: 'Now it&rsquo;s Gnomie&rsquo;s turn&hellip;' }, 1200],
      [function() { Gn[2].push({ v: 3 }); return { rolling: null, newAt: { who: 'gnomie', col: 2 }, status: 'Gnomie placed a 3.' }; }, 1600],
      [{ rolling: 'you', newAt: null, status: 'Your turn again&hellip;' }, 1000],
      [function() { P[0].push({ v: 5 }); return { rolling: null, newAt: { who: 'you', col: 0 }, status: '<strong>Two 5s in one column light up</strong> and count double!' }; }, 2600],
      [{ rolling: 'gnomie', newAt: null, status: 'Gnomie rolls&hellip;' }, 1100],
      [function() { Gn[0].push({ v: 5 }); return { rolling: null, newAt: { who: 'gnomie', col: 0 }, knock: { who: 'you', col: 0, v: 5 }, status: 'Gnomie put a 5 across from yours: <strong>your 5s are knocked out!</strong>' }; }, 2600],
      [function() { P[0] = []; return { knock: null, newAt: null, status: 'When a board fills up, the bigger total wins. Win, tie or lose, the boxes show what you lose.' }; }, 3400],
      [{ status: 'That&rsquo;s it! Pick an amount to play for real.' }, 2200]
    ];
    for (var i = 0; i < steps.length; i++) {
      if (run !== demoRun) return;
      var st = steps[i][0], ch = typeof st === 'function' ? st() : st;
      ch.player = P; ch.gnome = Gn;
      show(ch);
      await wait(steps[i][1]);
    }
    if (run === demoRun) endDemo();
  }
})();

