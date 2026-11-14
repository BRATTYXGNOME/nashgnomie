// ==========================================
// Dots & Boxes (page script)
// Pick a board size and type an amount. A coin flip decides who starts.
// Take turns drawing a line between two dots. Close a box and it's yours,
// and you go again. Most boxes when the board is full wins.
// Win = 1x, tie = 1.5x (Medium only), Gnomie wins = 2x (set aside at the start).
// Every move is decided on the server; this file shows it.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var D = G.DOTS;
  var GAME = 'dots-and-boxes';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var page = document.querySelector('.dx-page');
  var root = document.getElementById('dx-root');
  var CELL = 60, PAD = 16, INSET = 13;   // INSET: the tap area for a line stops this far short of each dot
  var lastPointer = 'mouse';

  // view: { n, h, v, boxes, fresh: {line, boxes}, status }
  var state = { wallet: null, game: null, size: 4, chosen: null, busy: false, result: null, error: '', view: null, finalView: null, demo: false };

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
    try { state.game = await G.api.dotsState(); } catch (x) { state.game = null; }
    if (state.game) state.view = viewOf(state.game, 'Your turn: tap between two dots.');
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), 'Dots & Boxes');
  }
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('dots-and-boxes-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Most wins against Gnomie: ' + list + '.' : '') +
      (w && w.dotsWins ? '<span class="duel-wins-you">You&rsquo;ve beaten her ' + (w.dotsWins === 1 ? 'once' : w.dotsWins + ' times') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function pays(a) { return { win: a * D.PAY.win, tie: Math.round(a * D.PAY.tie), lose: a * D.PAY.lose }; }
  function grid(rows, cols) { var g = []; for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(0); g.push(row); } return g; }
  function blank(n) { return { n: n, h: grid(n + 1, n), v: grid(n, n + 1), boxes: grid(n, n) }; }
  function viewOf(g, status) { return { n: g.n, h: g.h, v: g.v, boxes: g.boxes, status: status }; }
  function copy(v) { return { n: v.n, h: v.h.map(function(r) { return r.slice(); }), v: v.v.map(function(r) { return r.slice(); }), boxes: v.boxes.map(function(r) { return r.slice(); }) }; }
  function score(v) { var y = 0, g = 0; v.boxes.forEach(function(r) { r.forEach(function(x) { if (x === 'y') y++; else if (x === 'g') g++; }); }); return { y: y, g: g }; }
  function sizeName(n) { var s = D.SIZES.filter(function(x) { return x[0] === n; })[0]; return s ? s[1] : ''; }
  // Draw a line (and fill boxes) on a copy of the view
  function apply(v, line, who, closed) {
    var b = copy(v);
    (line[0] === 'h' ? b.h : b.v)[line[1]][line[2]] = who;
    (closed || []).forEach(function(x) { b.boxes[x[0]][x[1]] = who; });
    return b;
  }

  function render() {
    if (state.result) return renderResult();
    if (state.game && state.view) return renderGame();
    renderSetup();
  }

  // ---------- 1) pick a size, type an amount ----------
  function payTable(a, small) {
    var p = pays(a);
    return '<div class="duel-pays' + (small ? ' duel-pays-small' : '') + '">' +
      '<div class="win"><span>' + (small ? 'Win' : 'If You Win') + '</span><strong>' + money(-p.win) + '</strong></div>' +
      (small && state.game && state.game.n !== 4 ? '' : '<div class="tie"><span>' + (small ? 'Tie' : 'If We Tie') + '</span><strong>' + money(-p.tie) + '</strong></div>') +
      '<div class="lose"><span>' + (small ? 'Lose' : 'If Gnomie Wins') + '</span><strong>' + money(-p.lose) + '</strong></div>' +
    '</div>';
  }
  function sizesHTML() {
    return '<div class="dx-sizes" role="group" aria-label="Board size">' + D.SIZES.map(function(s) {
      var n = s[0], dots = '';
      for (var i = 0; i < (n + 1) * (n + 1); i++) dots += '<i></i>';
      return '<button type="button" class="dx-size' + (state.size === n ? ' on' : '') + '" data-size="' + n + '">' +
        '<span class="dx-size-art" style="--n:' + (n + 1) + '">' + dots + '</span>' +
        '<strong>' + s[1] + '</strong><small>' + n + '&times;' + n + ' &middot; ' + (n * n) + ' boxes</small></button>';
    }).join('') + '</div>' +
    '<p class="dx-size-note">' + (state.size === 4 ? 'Medium is the only size that can end in a tie (8&ndash;8).' : 'There are an odd number of boxes, so someone always wins.') + '</p>';
  }
  function renderSetup() {
    var w = state.wallet, bal = w ? w.balanceCents : 0, ready = w && w.hasPin;
    var problem = state.chosen ? G.amountProblem(state.chosen, bal, 2) : '';
    root.innerHTML =
      '<h2 class="duel-title">Pick a board</h2>' +
      sizesHTML() +
      '<h2 class="duel-title">Play for</h2>' +
      G.amountBoxHTML(state.chosen, bal, 2) +
      '<div class="amt-paybox">' + (state.chosen && !problem ? payTable(state.chosen) : '') + '</div>' +
      '<p class="duel-double">If Gnomie wins, you lose <strong>DOUBLE</strong>.</p>' +
      '<button type="button" class="btn btn-primary duel-start" id="dx-start"' + (state.chosen && !problem && ready ? '' : ' disabled') + '>' +
        (state.chosen && !problem ? 'Start for ' + money(state.chosen) : 'Type an amount') + '</button>' +
      '<p class="duel-status amt-msg">' + (state.error || problem || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>' +
      '<button type="button" class="wl-link game-demo-btn" id="dx-demo">&#9654; Watch a demo</button>';
    root.querySelectorAll('.dx-size').forEach(function(b) {
      b.addEventListener('click', function() { state.size = +b.dataset.size; render(); });
    });
    G.wireAmountBox(root, bal, 2, function(c, pr) {
      state.chosen = c; state.error = '';
      root.querySelector('.amt-paybox').innerHTML = c && !pr ? payTable(c) : '';
      var st = document.getElementById('dx-start');
      st.disabled = !c || !!pr || !ready;
      st.textContent = c && !pr ? 'Start for ' + money(c) : 'Type an amount';
      root.querySelector('.amt-msg').innerHTML = pr;
    }, function(c) { state.chosen = c; state.error = ''; render(); });
    document.getElementById('dx-demo').addEventListener('click', runDemo);
    document.getElementById('dx-start').addEventListener('click', async function() {
      if (!state.chosen || state.busy || G.amountProblem(state.chosen, state.wallet ? state.wallet.balanceCents : 0, 2)) return;
      state.busy = true;
      var res;
      try { res = await G.api.dotsStart(state.size, state.chosen); }
      catch (x) { state.error = x.message; state.busy = false; render(); return; }
      state.game = res.game; state.error = '';
      document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      var first = res.game.first;
      state.view = viewOf(Object.assign({}, res.game, blank(res.game.n)), 'Coin toss&hellip;');
      state.view.coin = { first: first, landed: false };
      renderGame();
      await wait(1900);
      show({ coin: { first: first, landed: true } });
      await wait(1300);
      if (res.gnomie && res.gnomie.length) {
        show({ coin: null, status: '<strong>Gnomie goes first.</strong>' });
        await wait(700);
        await gnomiePlays(res.gnomie);
      } else {
        show({ coin: null, status: '<strong>You go first!</strong> Tap between two dots.' });
        await wait(300);
      }
      state.busy = false;
      show(Object.assign(viewOf(res.game, 'Your turn: tap between two dots.')));
    });
  }

  // ---------- 2) the board ----------
  function pt(r, c) { return [PAD + c * CELL, PAD + r * CELL]; }
  function lineEnds(k, r, c) { var a = pt(r, c), b = k === 'h' ? pt(r, c + 1) : pt(r + 1, c); return a.concat(b); }
  function isFresh(v, k, r, c) { var f = v.fresh && v.fresh.line; return f && f[0] === k && f[1] === r && f[2] === c; }
  function boardHTML(v, canPlay) {
    var n = v.n, size = PAD * 2 + n * CELL, html = '';
    html += '<svg class="dx-board' + (canPlay ? ' live' : '') + '" viewBox="0 0 ' + size + ' ' + size + '" role="group" aria-label="Dots and boxes board">';
    // boxes
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var who = v.boxes[r][c];
      if (!who) continue;
      var p = pt(r, c), fresh = v.fresh && v.fresh.boxes && v.fresh.boxes.some(function(x) { return x[0] === r && x[1] === c; });
      html += '<g class="dx-box ' + (who === 'y' ? 'you' : 'her') + (fresh ? ' pop' : '') + '" style="transform-origin:' + (p[0] + CELL / 2) + 'px ' + (p[1] + CELL / 2) + 'px">' +
        '<rect x="' + p[0] + '" y="' + p[1] + '" width="' + CELL + '" height="' + CELL + '" />' +
        '<text x="' + (p[0] + CELL / 2) + '" y="' + (p[1] + CELL / 2) + '" dominant-baseline="central">' + (who === 'y' ? '★' : 'G') + '</text></g>';
    }
    // lines
    function lines(k, rows, cols) {
      var out = '';
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var who = (k === 'h' ? v.h : v.v)[r][c], e = lineEnds(k, r, c);
        var xy = 'x1="' + e[0] + '" y1="' + e[1] + '" x2="' + e[2] + '" y2="' + e[3] + '"';
        if (who) out += '<line class="dx-line ' + (who === 'y' ? 'you' : 'her') + (isFresh(v, k, r, c) ? ' fresh' : '') + '" ' + xy + ' />';
        else {
          var key = k + ',' + r + ',' + c;
          out += '<line class="dx-slot" ' + xy + ' />';
          if (canPlay && state.pending === key) out += '<line class="dx-line you dx-pending" ' + xy + ' />';
          if (canPlay) {
            var in1 = k === 'h' ? [e[0] + INSET, e[1], e[2] - INSET, e[3]] : [e[0], e[1] + INSET, e[2], e[3] - INSET];
            out += '<line class="dx-hit" data-line="' + key + '" tabindex="0" role="button" aria-label="Draw this line" x1="' + in1[0] + '" y1="' + in1[1] + '" x2="' + in1[2] + '" y2="' + in1[3] + '" />';
          }
        }
      }
      return out;
    }
    html += lines('h', n + 1, n) + lines('v', n, n + 1);
    for (var rr = 0; rr <= n; rr++) for (var cc = 0; cc <= n; cc++) { var d = pt(rr, cc); html += '<circle class="dx-dot" cx="' + d[0] + '" cy="' + d[1] + '" r="4.5" />'; }
    return html + '</svg>';
  }
  function renderGame() {
    var g = state.game, v = state.view, s = score(v);
    var canPlay = !state.busy && !state.demo;
    root.innerHTML =
      payTable(g.amount, true) +
      '<div class="dx-players">' +
        '<span class="duel-who"><img class="duel-pfp" src="' + PFP + '" alt="" /><span class="duel-name">Gnomie</span><b class="dx-score her">' + s.g + '</b></span>' +
        '<span class="dx-size-tag">' + sizeName(v.n) + ' &middot; ' + v.n + '&times;' + v.n + '</span>' +
        '<span class="duel-who"><b class="dx-score you">' + s.y + '</b><span class="duel-name">You</span></span>' +
      '</div>' +
      '<div class="dx-wrap">' + boardHTML(v, canPlay) + (v.coin ? coinHTML(v.coin) : '') + '</div>' +
      '<p class="duel-status-line dx-status">' + v.status + '</p>' +
      (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>' : '');
    root.querySelectorAll('.dx-hit').forEach(function(el) {
      var key = el.getAttribute('data-line');
      var go = function() { state.pending = null; var p = key.split(','); play([p[0], +p[1], +p[2]]); };
      el.addEventListener('pointerdown', function(e) { lastPointer = e.pointerType; });
      el.addEventListener('click', function() {
        // A finger is less exact than a mouse: first tap shows the line, second tap draws it
        if (lastPointer === 'touch' && state.pending !== key) { state.pending = key; show({ status: 'Tap the same spot again to draw it.' }); return; }
        go();
      });
      el.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    var stop = document.getElementById('demo-stop');
    if (stop) stop.addEventListener('click', endDemo);
  }
  function show(changes) { state.view = Object.assign({}, state.view, { fresh: null }, changes); renderGame(); }
  // Heads = You (your color), tails = Gnomie (her picture). It spins, then lands on whoever starts.
  function coinHTML(c) {
    var you = c.first === 'y';
    return '<div class="dx-toss">' +
      '<p class="dx-toss-title">Coin toss: who goes first?</p>' +
      '<div class="dx-coin3d' + (c.landed ? ' landed' : '') + '" style="--end:' + (you ? 1800 : 1980) + 'deg">' +
        '<span class="dx-face you">You</span>' +
        '<span class="dx-face her"><img src="' + PFP + '" alt="Gnomie" /></span>' +
      '</div>' +
      '<p class="dx-toss-result">' + (c.landed ? (you ? 'You go first!' : 'Gnomie goes first') : '&nbsp;') + '</p>' +
    '</div>';
  }
  function boxWord(k) { return k === 1 ? 'a box' : k + ' boxes'; }

  async function gnomiePlays(turns) {
    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      show({ status: 'Gnomie&rsquo;s turn&hellip;' });
      await wait(i ? 420 : 650);
      var b = apply(state.view, t.line, 'g', t.closed);
      show(Object.assign(b, { fresh: { line: t.line, boxes: t.closed }, status: t.closed.length ? 'Gnomie closed ' + boxWord(t.closed.length) + ' and goes again&hellip;' : 'Gnomie drew a line.' }));
      await wait(t.closed.length ? 750 : 600);
    }
  }

  async function play(line) {
    if (state.busy || state.demo) return;
    state.busy = true;
    var before = state.view;
    show(Object.assign(apply(before, line, 'y'), { fresh: { line: line }, status: 'Nice&hellip;' }));
    var res;
    try { res = await G.api.dotsMove(line); }
    catch (x) { state.busy = false; state.view = before; show({ status: x.message }); return; }
    if (res.you.closed.length) {
      show(Object.assign(apply(before, line, 'y', res.you.closed), { fresh: { line: line, boxes: res.you.closed }, status: '<strong>You closed ' + boxWord(res.you.closed.length) + '!</strong>' + (res.result ? '' : ' Go again.') }));
      await wait(700);
    } else await wait(350);
    if (res.gnomie && res.gnomie.length) await gnomiePlays(res.gnomie);
    document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
    if (res.result) {
      var r = res.result, oc = r.outcome, f = res.final;
      show(Object.assign(viewOf(f, 'Every line is drawn. <strong>You ' + r.you + ', Gnomie ' + r.gnomie + '.</strong>')));
      await wait(1400);
      state.finalView = viewOf(f, '');
      G.celebrate(oc === 'win' ? 'win' : oc === 'tie' ? 'tie' : 'lose', oc === 'win' ? 'You Won!' : oc === 'tie' ? 'Tie!' : 'Gnomie Wins!', money(-r.paidCents));
      state.result = r; state.game = null; state.view = null; state.busy = false;
      boards(); render();
      return;
    }
    state.game = res.game;
    state.busy = false;
    show(Object.assign(viewOf(res.game, res.you.closed.length && !res.gnomie.length ? 'Your turn again: tap between two dots.' : 'Your turn: tap between two dots.')));
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
      (fv ? '<div class="game-final"><div class="dx-wrap">' + boardHTML(fv, false) + '</div><p class="duel-status-line">Final board &middot; You ' + r.you + ', Gnomie ' + r.gnomie + '</p></div>' : '') +
      '<div class="duel-result-actions">' +
        '<button type="button" class="btn btn-primary" id="dx-again">Clear Board &amp; Play Again</button>' +
        '<a class="btn btn-outline" href="games.html">All Games</a>' +
      '</div>';
    document.getElementById('dx-again').addEventListener('click', function() {
      state.result = null; state.finalView = null; render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- demo: a pretend game on the Small board, with captions ----------
  var demoRun = 0;
  function endDemo() { demoRun++; state.demo = false; state.game = null; state.view = null; state.busy = false; render(); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; state.busy = true; state.result = null;
    state.game = { amount: state.chosen || 100, n: 3 };
    state.view = Object.assign(blank(3), { status: '' });
    var step = async function(line, who, closed, text, ms) {
      if (run !== demoRun) throw 0;
      if (line) show(Object.assign(apply(state.view, line, who, closed), { fresh: { line: line, boxes: closed }, status: text }));
      else show({ status: text });
      await wait(ms);
    };
    try {
      await step(null, null, null, 'Tap between two dots to draw a line. A coin flip decides who starts.', 2600);
      await step(['h', 0, 0], 'y', null, 'You drew a line&hellip;', 1300);
      await step(['v', 0, 1], 'g', null, 'Then Gnomie draws one.', 1300);
      await step(['h', 3, 2], 'y', null, '', 900);
      await step(['h', 1, 0], 'g', null, 'Gnomie drew the 3rd side of the top-left box&hellip;', 1700);
      await step(null, null, null, 'A box with 3 sides is a gift for the next player.', 1900);
      await step(['v', 0, 0], 'y', [[0, 0]], '<strong>You closed it!</strong> It&rsquo;s yours, and <strong>you go again</strong>.', 2200);
      await step(['v', 2, 3], 'y', null, 'Your extra turn&hellip;', 1200);
      await step(['h', 2, 1], 'g', null, 'Back to Gnomie.', 1300);
      await step(null, null, null, 'When every line is drawn, whoever has <strong>more boxes</strong> wins.', 2400);
      await step(null, null, null, 'That&rsquo;s it! Pick a board, type an amount and play for real.', 2200);
    } catch (e) { return; }
    if (run === demoRun) endDemo();
  }
})();
