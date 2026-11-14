// ==========================================
// Mancala (page script)
// Pick an amount, then take turns sowing stones against Gnomie (Kalah rules).
// Win = 1x, tie = 1.5x, Gnomie wins = 2x (set aside when the game starts).
// Every move is decided on the server; this file replays each move one
// stone at a time with the same rules so you can watch it happen.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var M = G.MANCALA;
  var GAME = 'mancala';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var page = document.querySelector('.mc-page');
  var root = document.getElementById('mc-root');

  // view: { pits, hot (pit being dropped into), from (pit just emptied), cap: [pits captured], status }
  var state = { wallet: null, game: null, chosen: null, busy: false, result: null, error: '', view: null, finalView: null, demo: false };

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
    try { state.game = await G.api.mancalaState(); } catch (x) { state.game = null; }
    if (state.game) state.view = { beads: state.game.beads, status: 'Your turn: pick a pit on your side.' };
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), 'Mancala');
  }
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('mancala-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Most wins against Gnomie: ' + list + '.' : '') +
      (w && w.mancalaWins ? '<span class="duel-wins-you">You&rsquo;ve beaten her ' + (w.mancalaWins === 1 ? 'once' : w.mancalaWins + ' times') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function pays(a) { return { win: a * M.PAY.win, tie: Math.round(a * M.PAY.tie), lose: a * M.PAY.lose }; }
  function sum(p, from, to) { var s = 0; for (var i = from; i <= to; i++) s += p[i]; return s; }

  // ---------- one move, broken into steps to animate (same rules as the server) ----------
  // Beads remember whose they are: 'y' started on your side, 'g' on Gnomie's.
  function copyBeads(b) { return b.map(function(a) { return a.slice(); }); }
  function moveSteps(beads, side, i) {
    var b = copyBeads(beads), steps = [], own = side === 'you' ? 6 : 13, other = side === 'you' ? 13 : 6;
    var hand = b[i]; b[i] = []; var at = i;
    steps.push({ beads: copyBeads(b), from: i, hand: hand.length });
    var prev = i;
    while (hand.length) {
      at = (at + 1) % 14; if (at === other) continue;
      var bead = hand.shift(); b[at].push(bead);
      steps.push({ beads: copyBeads(b), hot: at, fly: { from: prev, to: at, bead: bead } });
      prev = at;
    }
    var mine = side === 'you' ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12], capture = null;
    if (at !== own && mine.indexOf(at) !== -1 && b[at].length === 1 && b[12 - at].length > 0) {
      capture = { pit: at, across: 12 - at, stones: b[12 - at].length + 1 };
      steps.push({ beads: copyBeads(b), cap: [at, 12 - at] });
      var taken = b[at].concat(b[12 - at]);
      b[own] = b[own].concat(taken); b[at] = []; b[12 - at] = [];
      steps.push({ beads: copyBeads(b), hot: own, flyMany: { from: [capture.pit, capture.across], to: own, beads: taken } });
    }
    var youLeft = [0, 1, 2, 3, 4, 5].some(function(k) { return b[k].length; }), gLeft = [7, 8, 9, 10, 11, 12].some(function(k) { return b[k].length; });
    var over = !youLeft || !gLeft;
    if (over) {
      for (var k = 0; k < 6; k++) { b[6] = b[6].concat(b[k]); b[k] = []; }
      for (k = 7; k < 13; k++) { b[13] = b[13].concat(b[k]); b[k] = []; }
      steps.push({ beads: copyBeads(b), sweep: true });
    }
    return { steps: steps, beads: b, again: !over && at === own, capture: capture, over: over };
  }
  function counts(b) { return b.map(function(a) { return a.length; }); }

  function render() {
    if (state.result) return renderResult();
    if (state.game && state.view) return renderGame();
    renderSetup();
  }

  // ---------- 1) pick an amount ----------
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
      '<button type="button" class="btn btn-primary duel-start" id="mc-start"' + (state.chosen && !problem && ready ? '' : ' disabled') + '>' +
        (state.chosen && !problem ? 'Start for ' + money(state.chosen) : 'Type an amount') + '</button>' +
      '<p class="duel-status amt-msg">' + (state.error || problem || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>' +
      '<button type="button" class="wl-link game-demo-btn" id="mc-demo">&#9654; Watch a demo</button>';
    G.wireAmountBox(root, bal, 2, function(c, pr) {
      state.chosen = c; state.error = '';
      root.querySelector('.amt-paybox').innerHTML = c && !pr ? payTable(c) : '';
      var st = document.getElementById('mc-start');
      st.disabled = !c || !!pr || !ready;
      st.textContent = c && !pr ? 'Start for ' + money(c) : 'Type an amount';
      root.querySelector('.amt-msg').innerHTML = pr;
    }, function(c) { state.chosen = c; state.error = ''; render(); });
    document.getElementById('mc-demo').addEventListener('click', runDemo);
    document.getElementById('mc-start').addEventListener('click', async function() {
      if (!state.chosen || state.busy || G.amountProblem(state.chosen, state.wallet ? state.wallet.balanceCents : 0, 2)) return;
      state.busy = true;
      try {
        var res = await G.api.mancalaStart(state.chosen);
        state.game = res.game; state.error = '';
        state.view = { beads: res.game.beads, status: 'Your turn: pick a pit on your side.' };
        document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      } catch (x) { state.error = x.message; }
      state.busy = false;
      render();
    });
  }

  // ---------- 2) the board ----------
  // Beads sit in a sunflower pattern so they never jump around as more are added
  function beadPos(k, store) {
    if (k === 0) return [50, 50];
    var a = k * 2.39996, r = Math.min(store ? 30 : 33, (store ? 7.5 : 10.5) * Math.sqrt(k));
    var x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r * (store ? 2.7 : 1);
    return [x, Math.max(store ? 8 : 18, Math.min(store ? 92 : 82, y))];
  }
  function beadsHTML(list, store) {
    return list.map(function(o, k) {
      var pos = beadPos(k, store);
      return '<i class="mc-bead ' + (o === 'y' ? 'you' : 'her') + '" style="left:' + pos[0].toFixed(1) + '%;top:' + pos[1].toFixed(1) + '%"></i>';
    }).join('');
  }
  function pitHTML(b, i, v, clickable) {
    var cls = 'mc-pit' + (i < 6 ? ' mc-you' : ' mc-her') + (v.hot === i ? ' hot' : '') + (v.from === i ? ' from' : '') + (v.cap && v.cap.indexOf(i) !== -1 ? ' cap' : '') + (clickable ? ' open' : '');
    return '<div class="mc-cell' + (i < 6 ? ' mc-cell-you' : ' mc-cell-her') + '">' +
      '<button type="button" class="' + cls + '" data-pit="' + i + '"' + (clickable ? '' : ' tabindex="-1" disabled') + ' aria-label="' + (i < 6 ? 'Your pit ' + (i + 1) : 'Gnomie pit') + ', ' + b[i].length + ' beads">' + beadsHTML(b[i], false) + '</button>' +
      '<span class="mc-count">' + b[i].length + '</span></div>';
  }
  function boardHTML(v, canPlay) {
    var b = v.beads, top = '', bottom = '';
    for (var i = 12; i >= 7; i--) top += pitHTML(b, i, v, false);
    for (i = 0; i <= 5; i++) bottom += pitHTML(b, i, v, canPlay && b[i].length > 0);
    return '<div class="mc-board">' +
      '<div class="mc-side mc-side-her"><span class="mc-store-label">Gnomie</span><div class="mc-store mc-store-her' + (v.hot === 13 ? ' hot' : '') + '" data-pit="13">' + beadsHTML(b[13], true) + '</div><span class="mc-store-count">' + b[13].length + '</span></div>' +
      '<div class="mc-rows"><div class="mc-row mc-row-her">' + top + '</div><div class="mc-row mc-row-you">' + bottom + '</div></div>' +
      '<div class="mc-side mc-side-you"><span class="mc-store-label">You</span><div class="mc-store mc-store-you' + (v.hot === 6 ? ' hot' : '') + '" data-pit="6">' + beadsHTML(b[6], true) + '</div><span class="mc-store-count">' + b[6].length + '</span></div>' +
    '</div>';
  }

  // A bead flying from one pit to the next (drawn above the page, then the board updates)
  function pitCenter(i) {
    var el = root.querySelector('[data-pit="' + i + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }
  function fly(fromPit, toPit, owner, ms) {
    var a = pitCenter(fromPit), z = pitCenter(toPit);
    if (!a || !z) return wait(ms);
    var bead = document.createElement('i');
    var size = Math.max(10, Math.min(18, a.w * 0.26));
    bead.className = 'mc-bead mc-fly ' + (owner === 'y' ? 'you' : 'her');
    bead.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (a.x - size / 2) + 'px;top:' + (a.y - size / 2) + 'px;transition:transform ' + ms + 'ms cubic-bezier(.3,.1,.3,1)';
    document.body.appendChild(bead);
    requestAnimationFrame(function() { requestAnimationFrame(function() { bead.style.transform = 'translate(' + (z.x - a.x) + 'px,' + (z.y - a.y) + 'px) scale(1.15)'; }); });
    return wait(ms).then(function() { bead.remove(); });
  }

  function renderGame() {
    var g = state.game, v = state.view;
    var canPlay = !state.busy && !state.demo;
    root.innerHTML =
      payTable(g.amount, true) +
      '<div class="duel-player duel-player-gnomie"><span class="duel-who"><img class="duel-pfp" src="' + PFP + '" alt="" /><span class="duel-name">Gnomie</span><span class="duel-total">' + v.beads[13].length + '</span></span></div>' +
      boardHTML(v, canPlay) +
      '<div class="duel-player duel-player-you"><span class="duel-who"><span class="duel-name">You</span><span class="duel-total">' + v.beads[6].length + '</span></span></div>' +
      '<p class="duel-status-line mc-status">' + v.status + '</p>' +
      (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>' : '');
    root.querySelectorAll('.mc-pit.open').forEach(function(b) { b.addEventListener('click', function() { play(+b.dataset.pit); }); });
    var stop = document.getElementById('demo-stop');
    if (stop) stop.addEventListener('click', endDemo);
  }
  function show(changes) { state.view = Object.assign({}, state.view, { hot: null, from: null, cap: null }, changes); renderGame(); }

  // Replays one move bead by bead
  async function animate(side, pit, run) {
    var mv = moveSteps(state.view.beads, side, pit), who = side === 'you' ? 'You' : 'Gnomie';
    for (var i = 0; i < mv.steps.length; i++) {
      if (run != null && run !== demoRun) return mv;
      var s = mv.steps[i];
      if (s.fly) await fly(s.fly.from, s.fly.to, s.fly.bead, 200);
      if (s.flyMany) await Promise.all(s.flyMany.beads.map(function(o, k) { return wait(k * 40).then(function() { return fly(k === 0 ? s.flyMany.from[0] : s.flyMany.from[1], s.flyMany.to, o, 420); }); }));
      var status = i === 0 ? (side === 'you' ? 'You scoop up ' : 'Gnomie scoops up ') + s.hand + ' bead' + (s.hand === 1 ? '' : 's') + '&hellip;'
        : s.cap ? '<strong>' + (side === 'you' ? 'You capture ' : 'Gnomie captures ') + mv.capture.stones + ' beads!</strong>'
        : s.sweep ? 'One side is empty! Everyone keeps what&rsquo;s left on their side.' : state.view.status;
      show({ beads: s.beads, hot: s.hot, from: s.from, cap: s.cap, status: status });
      await wait(s.cap ? 750 : s.sweep ? 1200 : i === 0 ? 320 : 40);
    }
    if (mv.again) { show({ status: '<strong>' + who + (side === 'you' ? ' get' : ' gets') + ' another turn!</strong> The last bead landed in ' + (side === 'you' ? 'your' : 'her') + ' store.' }); await wait(1000); }
    return mv;
  }

  async function play(pit) {
    if (state.busy || state.demo) return;
    state.busy = true;
    show({ status: '&hellip;' });
    var res;
    try { res = await G.api.mancalaMove(pit); }
    catch (x) { state.busy = false; show({ status: x.message }); return; }
    for (var i = 0; i < res.moves.length; i++) {
      var m = res.moves[i];
      if (m.side === 'gnomie' && (i === 0 || res.moves[i - 1].side === 'you')) { show({ status: 'Gnomie&rsquo;s turn&hellip;' }); await wait(700); }
      await animate(m.side, m.pit);
    }
    document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
    if (res.result) {
      state.view.beads = res.final.beads;
      state.finalView = { beads: res.final.beads };
      var oc = res.result.outcome;
      G.celebrate(oc === 'win' ? 'win' : oc === 'tie' ? 'tie' : 'lose', oc === 'win' ? 'You Won!' : oc === 'tie' ? 'Tie!' : 'Gnomie Wins!', money(-res.result.paidCents));
      state.result = res.result; state.game = null; state.view = null; state.busy = false;
      boards(); render();
      return;
    }
    state.game = res.game;
    state.busy = false;
    show({ beads: res.game.beads, status: 'Your turn: pick a pit on your side.' });
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
        '<p class="duel-result-score">You <strong>' + r.you + '</strong> &middot; Gnomie <strong>' + r.gnomie + '</strong></p>' +
        '<p class="duel-result-pay">' + note + '</p>' +
      '</div>' +
      (fv ? '<div class="game-final">' + boardHTML({ beads: fv.beads }, false) + '<p class="duel-status-line">Final board</p></div>' : '') +
      '<div class="duel-result-actions">' +
        '<button type="button" class="btn btn-primary" id="mc-again">Clear Board &amp; Play Again</button>' +
        '<a class="btn btn-outline" href="games.html">All Games</a>' +
      '</div>';
    document.getElementById('mc-again').addEventListener('click', function() {
      state.result = null; state.finalView = null; render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- demo: a few pretend moves with captions ----------
  var demoRun = 0;
  function endDemo() { demoRun++; state.demo = false; state.game = null; state.view = null; state.busy = false; render(); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; state.busy = true; state.result = null;
    state.game = { amount: state.chosen || 100 };
    var b0 = [];
    for (var k = 0; k < 14; k++) b0.push(k === 6 || k === 13 ? [] : ['y', 'y', 'y', 'y'].map(function() { return k < 6 ? 'y' : 'g'; }));
    state.view = { beads: b0, status: '' };
    var say = function(t) { show({ status: t }); };
    var step = async function(t, ms) { if (run !== demoRun) throw 0; say(t); await wait(ms); };
    try {
      await step('Your pits are the bottom row and your store is on the right. Your beads are your color; Gnomie&rsquo;s are pink.', 3000);
      await step('Pick a pit: all its beads get dropped one by one to the right&hellip;', 2000);
      await animate('you', 2, run); if (run !== demoRun) return;
      await step('That last bead landed in your store, so you go again. Try the far-right pit&hellip;', 2200);
      await animate('you', 5, run); if (run !== demoRun) return;
      await step('Beads go around the board into Gnomie&rsquo;s side too, so watch the colors move. Now it&rsquo;s her turn.', 2600);
      await animate('gnomie', 9, run); if (run !== demoRun) return;
      await step('Land your last bead in an <strong>empty pit on your side</strong> and you capture the pit across from it!', 3000);
      await step('When one side runs out, most beads in your store wins. That&rsquo;s it!', 2600);
    } catch (e) { return; }
    if (run === demoRun) endDemo();
  }
})();
