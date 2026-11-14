// ==========================================
// 5 in a Row (page script)
// Type an amount, then take turns dropping pieces against Gnomie on an
// 8 x 7 board. First to line up 5 wins; a full board is a tie.
// Win = 1x, tie = 1.5x, Gnomie wins = 2x (set aside when the game starts).
// Every move is decided on the server; this file shows it.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var F = G.FIVE;
  var GAME = 'five-in-a-row';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var page = document.querySelector('.fv-page');
  var root = document.getElementById('fv-root');

  // view: { board, drop: {col,row}, line: [[c,r]...], status }
  var state = { wallet: null, game: null, chosen: null, busy: false, result: null, error: '', view: null, finalView: null, demo: false, hover: null };

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
    document.addEventListener('wallet:change', function(e) { state.wallet = e.detail; if (!state.busy && !state.game) render(); });
    try { state.game = await G.api.fiveState(); } catch (x) { state.game = null; }
    if (state.game) state.view = { board: state.game.board, status: 'Your turn: tap a column.' };
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), '5 in a Row');
  }
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('five-in-a-row-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Most wins against Gnomie: ' + list + '.' : '') +
      (w && w.fiveWins ? '<span class="duel-wins-you">You&rsquo;ve beaten her ' + (w.fiveWins === 1 ? 'once' : w.fiveWins + ' times') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function pays(a) { return { win: a * F.PAY.win, tie: Math.round(a * F.PAY.tie), lose: a * F.PAY.lose }; }
  function emptyBoard() { var b = []; for (var c = 0; c < F.COLS; c++) b.push([]); return b; }
  function copy(b) { return b.map(function(col) { return col.slice(); }); }

  function render() {
    if (state.result) return renderResult();
    if (state.game && state.view) return renderGame();
    renderSetup();
  }

  // ---------- 1) type an amount ----------
  function payTable(a, small) {
    var p = pays(a);
    return '<div class="duel-pays' + (small ? ' duel-pays-small' : '') + '">' +
      '<div class="win"><span>' + (small ? 'Win' : 'If You Win') + '</span><strong>' + money(-p.win) + '</strong></div>' +
      '<div class="tie"><span>' + (small ? 'Tie' : 'If We Tie') + '</span><strong>' + money(-p.tie) + '</strong></div>' +
      '<div class="lose"><span>' + (small ? 'Lose' : 'If Gnomie Wins') + '</span><strong>' + money(-p.lose) + '</strong></div>' +
    '</div>';
  }
  function renderSetup() {
    var w = state.wallet, bal = w ? w.balanceCents : 0, ready = w && w.hasPin;
    var problem = state.chosen ? G.amountProblem(state.chosen, bal, 2) : '';
    root.innerHTML =
      '<h2 class="duel-title">Play for</h2>' +
      G.amountBoxHTML(state.chosen, bal, 2) +
      '<div class="amt-paybox">' + (state.chosen && !problem ? payTable(state.chosen) : '') + '</div>' +
      '<p class="duel-double">If Gnomie wins, you lose <strong>DOUBLE</strong>.</p>' +
      '<button type="button" class="btn btn-primary duel-start" id="fv-start"' + (state.chosen && !problem && ready ? '' : ' disabled') + '>' +
        (state.chosen && !problem ? 'Start for ' + money(state.chosen) : 'Type an amount') + '</button>' +
      '<p class="duel-status amt-msg">' + (state.error || problem || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>' +
      '<button type="button" class="wl-link game-demo-btn" id="fv-demo">&#9654; Watch a demo</button>';
    G.wireAmountBox(root, bal, 2, function(c, pr) {
      state.chosen = c; state.error = '';
      root.querySelector('.amt-paybox').innerHTML = c && !pr ? payTable(c) : '';
      var st = document.getElementById('fv-start');
      st.disabled = !c || !!pr || !ready;
      st.textContent = c && !pr ? 'Start for ' + money(c) : 'Type an amount';
      root.querySelector('.amt-msg').innerHTML = pr;
    }, function(c) { state.chosen = c; state.error = ''; render(); });
    document.getElementById('fv-demo').addEventListener('click', runDemo);
    document.getElementById('fv-start').addEventListener('click', async function() {
      if (!state.chosen || state.busy || G.amountProblem(state.chosen, state.wallet ? state.wallet.balanceCents : 0, 2)) return;
      state.busy = true;
      try {
        var res = await G.api.fiveStart(state.chosen);
        state.game = res.game; state.error = '';
        state.view = { board: res.game.board, status: 'Your turn: tap a column.' };
        document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      } catch (x) { state.error = x.message; }
      state.busy = false;
      render();
    });
  }

  // ---------- 2) the board ----------
  function onLine(v, c, r) { return v.line && v.line.some(function(p) { return p[0] === c && p[1] === r; }); }
  function boardHTML(v, canPlay) {
    var html = '<div class="fv-board' + (canPlay ? ' live' : '') + '">';
    for (var c = 0; c < F.COLS; c++) {
      var col = v.board[c], open = canPlay && col.length < F.ROWS;
      html += '<button type="button" class="fv-col' + (open ? ' open' : '') + '" data-col="' + c + '"' + (open ? '' : ' tabindex="-1" disabled') + ' aria-label="Column ' + (c + 1) + '">';
      for (var r = F.ROWS - 1; r >= 0; r--) {
        var who = col[r], cls = 'fv-cell';
        var piece = '';
        if (who) {
          var isNew = v.drop && v.drop.col === c && v.drop.row === r;
          piece = '<i class="fv-piece ' + (who === 'y' ? 'you' : 'her') + (isNew ? ' drop' : '') + (onLine(v, c, r) ? ' win' : '') + '"' +
            (isNew ? ' style="--fall:' + (F.ROWS - r) + '"' : '') + '></i>';
        } else if (open && r === col.length) {
          piece = '<i class="fv-piece you ghost"></i>';
        }
        html += '<span class="' + cls + '">' + piece + '</span>';
      }
      html += '</button>';
    }
    return html + '</div>';
  }
  function renderGame() {
    var g = state.game, v = state.view;
    var canPlay = !state.busy && !state.demo;
    root.innerHTML =
      payTable(g.amount, true) +
      '<div class="fv-players"><span class="duel-who"><img class="duel-pfp" src="' + PFP + '" alt="" /><span class="duel-name">Gnomie</span><i class="fv-dot her"></i></span>' +
      '<span class="duel-who"><span class="duel-name">You</span><i class="fv-dot you"></i></span></div>' +
      boardHTML(v, canPlay) +
      '<p class="duel-status-line fv-status">' + v.status + '</p>' +
      (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>' : '');
    root.querySelectorAll('.fv-col.open').forEach(function(b) { b.addEventListener('click', function() { play(+b.dataset.col); }); });
    var stop = document.getElementById('demo-stop');
    if (stop) stop.addEventListener('click', endDemo);
  }
  function show(changes) { state.view = Object.assign({}, state.view, { drop: null }, changes); renderGame(); }

  async function play(col) {
    if (state.busy || state.demo) return;
    state.busy = true;
    var b = copy(state.view.board);
    b[col].push('y');
    show({ board: b, drop: { col: col, row: b[col].length - 1 }, status: 'Nice&hellip;' });
    var res;
    try { res = await G.api.fiveMove(col); }
    catch (x) { b[col].pop(); state.busy = false; show({ board: b, status: x.message }); return; }
    await wait(550);
    if (res.gnomie) {
      show({ status: 'Gnomie&rsquo;s turn&hellip;' });
      await wait(650);
      var b2 = copy(state.view.board);
      b2[res.gnomie.col].push('g');
      show({ board: b2, drop: { col: res.gnomie.col, row: res.gnomie.row }, status: 'Gnomie dropped in column ' + (res.gnomie.col + 1) + '.' });
      await wait(650);
    }
    document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
    if (res.result) {
      var oc = res.result.outcome;
      show({ board: res.final.board, line: res.line, status: oc === 'win' ? '<strong>Five in a row!</strong>' : oc === 'lose' ? '<strong>Gnomie got five in a row.</strong>' : 'The board is full.' });
      await wait(1300);
      state.finalView = { board: res.final.board, line: res.line };
      G.celebrate(oc === 'win' ? 'win' : oc === 'tie' ? 'tie' : 'lose', oc === 'win' ? 'You Won!' : oc === 'tie' ? 'Tie!' : 'Gnomie Wins!', money(-res.result.paidCents));
      state.result = res.result; state.game = null; state.view = null; state.busy = false;
      boards(); render();
      return;
    }
    state.game = res.game;
    state.busy = false;
    show({ board: res.game.board, status: 'Your turn: tap a column.' });
  }

  // ---------- 3) result: the final board stays ----------
  function renderResult() {
    var r = state.result, fv = state.finalView;
    if (state.chosen == null) state.chosen = r.amount;
    var title = r.outcome === 'win' ? 'You Won!' : r.outcome === 'tie' ? 'It&rsquo;s a tie' : 'Gnomie Won!';
    var note = r.outcome === 'win' ? money(-r.paidCents) : r.outcome === 'tie' ? 'Half a win each: ' + money(-r.paidCents) : 'Double: ' + money(-r.paidCents);
    root.innerHTML =
      '<div class="duel-result duel-result-' + r.outcome + '">' +
        '<h2 class="duel-result-title">' + title + '</h2>' +
        '<p class="duel-result-pay">' + note + '</p>' +
      '</div>' +
      (fv ? '<div class="game-final">' + boardHTML({ board: fv.board, line: fv.line }, false) + '<p class="duel-status-line">Final board</p></div>' : '') +
      '<div class="duel-result-actions">' +
        '<button type="button" class="btn btn-primary" id="fv-again">Clear Board &amp; Play Again</button>' +
        '<a class="btn btn-outline" href="games.html">All Games</a>' +
      '</div>';
    document.getElementById('fv-again').addEventListener('click', function() {
      state.result = null; state.finalView = null; render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- demo: a pretend game with captions ----------
  var demoRun = 0;
  function endDemo() { demoRun++; state.demo = false; state.game = null; state.view = null; state.busy = false; render(); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; state.busy = true; state.result = null;
    state.game = { amount: state.chosen || 100 };
    state.view = { board: emptyBoard(), status: '' };
    var b = emptyBoard();
    var step = async function(col, who, text, ms) {
      if (run !== demoRun) throw 0;
      if (col != null) { b[col].push(who); show({ board: copy(b), drop: { col: col, row: b[col].length - 1 }, status: text }); }
      else show({ status: text });
      await wait(ms);
    };
    try {
      await step(null, null, 'Tap a column to drop your piece. It falls to the lowest open spot.', 2400);
      await step(3, 'y', 'You dropped in the middle&hellip;', 1300);
      await step(4, 'g', 'Then Gnomie drops hers.', 1300);
      await step(2, 'y', 'Line up 5 in a row: across, up and down, or diagonal.', 1700);
      await step(2, 'g', 'Gnomie is watching your lines&hellip;', 1300);
      await step(4, 'y', '', 900);
      await step(5, 'g', '', 900);
      await step(1, 'y', 'You have 4 across (3 in a row on the bottom plus this one)&hellip;', 1600);
      await step(0, 'g', 'She blocks one end!', 1500);
      await step(null, null, 'Block her lines too. If the board fills up with no winner, it&rsquo;s a tie.', 2600);
      await step(null, null, 'That&rsquo;s it! Type an amount to play for real.', 2000);
    } catch (e) { return; }
    if (run === demoRun) endDemo();
  }
})();
