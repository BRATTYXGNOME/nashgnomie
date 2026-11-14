// ==========================================
// Sink My Ship (page script)
// Place ships of 4, 3, 3 and 2 on your 8 x 8 sea (drag them, or tap a ship
// then tap where it goes; Rotate turns it). Then race Gnomie: take turns
// firing at her sea. A hit fires again. First to sink the whole fleet wins.
// Win = 1x, Gnomie wins = 2x (set aside at the start). Her ships stay on the
// server until the game ends.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var GAME = 'sink-my-ship';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var N = 8, FLEET = [4, 3, 3, 2], PAY = { win: 1, lose: 2 };
  var page = document.querySelector('.sk-page');
  var root = document.getElementById('sk-root');

  // placed: [{ len, r, c, v }] per fleet slot (null = still in the dock)
  var state = {
    wallet: null, game: null, chosen: null, busy: false, result: null, final: null, error: '', demo: false,
    placed: [null, null, null, null], held: null, vertical: false, hover: null, status: '', flash: null
  };

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

  // Give up: counts as a loss (the amount set aside), then back to placing ships
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
    try { state.game = await G.api.shipsState(); } catch (x) { state.game = null; }
    if (state.game) state.status = 'Your turn: tap a square on Gnomie&rsquo;s sea to fire.';
    document.addEventListener('keydown', function(e) { if ((e.key === 'r' || e.key === 'R') && !state.game && !state.result && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) rotate(); });
    document.addEventListener('pointerup', onDrop);
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), 'Sink My Ship');
  }
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('sink-my-ship-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Sank Gnomie&rsquo;s fleet most: ' + list + '.' : '') +
      (w && w.shipsWins ? '<span class="duel-wins-you">You&rsquo;ve sunk her fleet ' + (w.shipsWins === 1 ? 'once' : w.shipsWins + ' times') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function cellsOf(p) { var out = []; for (var i = 0; i < p.len; i++) out.push(p.v ? [p.r + i, p.c] : [p.r, p.c + i]); return out; }
  function key(r, c) { return r * N + c; }
  function occupied(except) {
    var o = {};
    state.placed.forEach(function(p, i) { if (p && i !== except) cellsOf(p).forEach(function(x) { o[key(x[0], x[1])] = i; }); });
    return o;
  }
  function fits(len, r, c, v, except) {
    var o = occupied(except);
    for (var i = 0; i < len; i++) {
      var a = v ? r + i : r, b = v ? c : c + i;
      if (a < 0 || b < 0 || a >= N || b >= N || o[key(a, b)] != null) return false;
    }
    return true;
  }
  function allPlaced() { return state.placed.every(Boolean); }
  function fleetCells() { return state.placed.map(function(p) { return cellsOf(p); }); }
  function shuffle() {
    for (var t = 0; t < 200; t++) {
      state.placed = [null, null, null, null];
      var ok = true;
      for (var i = 0; i < FLEET.length && ok; i++) {
        var placed = false;
        for (var k = 0; k < 200 && !placed; k++) {
          var v = Math.random() < 0.5, r = Math.floor(Math.random() * (v ? N - FLEET[i] + 1 : N)), c = Math.floor(Math.random() * (v ? N : N - FLEET[i] + 1));
          if (fits(FLEET[i], r, c, v, i)) { state.placed[i] = { len: FLEET[i], r: r, c: c, v: v }; placed = true; }
        }
        ok = placed;
      }
      if (ok) break;
    }
    state.held = null;
  }
  function rotate() { state.vertical = !state.vertical; render(); paintPreview(); }
  function pays(a) { return { win: a * PAY.win, lose: a * PAY.lose }; }
  function payTable(a, small) {
    var p = pays(a);
    return '<div class="duel-pays duel-pays-two' + (small ? ' duel-pays-small' : '') + '">' +
      '<div class="win"><span>' + (small ? 'Win' : 'If You Win') + '</span><strong>' + money(-p.win) + '</strong></div>' +
      '<div class="lose"><span>' + (small ? 'Lose' : 'If Gnomie Wins') + '</span><strong>' + money(-p.lose) + '</strong></div>' +
    '</div>';
  }

  function render() {
    if (state.result) return renderResult();
    if (state.game) return renderBattle();
    renderSetup();
  }

  // ---------- 1) place your fleet ----------
  function setupBoardHTML() {
    var o = occupied(state.held), preview = {}, bad = false;
    if (state.held != null && state.hover) {
      var len = FLEET[state.held];
      bad = !fits(len, state.hover[0], state.hover[1], state.vertical, state.held);
      for (var i = 0; i < len; i++) {
        var a = state.vertical ? state.hover[0] + i : state.hover[0], b = state.vertical ? state.hover[1] : state.hover[1] + i;
        if (a < N && b < N) preview[key(a, b)] = 1;
      }
    }
    var html = '<div class="sk-sea sk-setup' + (state.held != null ? ' holding' : '') + '">';
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var k = key(r, c), ship = o[k], cls = 'sk-cell';
      if (ship != null) cls += ' ship' + shipEdge(state.placed[ship], r, c);
      if (preview[k]) cls += bad ? ' prev-bad' : ' prev-ok';
      html += '<button type="button" class="' + cls + '" data-r="' + r + '" data-c="' + c + '"' + (ship != null ? ' data-ship="' + ship + '"' : '') + ' aria-label="Row ' + (r + 1) + ', column ' + (c + 1) + '"></button>';
    }
    return html + '</div>';
  }
  // rounded ends so each ship reads as one piece
  function shipEdge(p, r, c) {
    if (!p) return '';
    var first = p.r === r && p.c === c, last = p.v ? (r === p.r + p.len - 1) : (c === p.c + p.len - 1);
    return (p.v ? ' v' : ' h') + (first ? ' first' : '') + (last ? ' last' : '');
  }
  function dockHTML() {
    return '<div class="sk-dock">' + FLEET.map(function(len, i) {
      var p = state.placed[i], on = state.held === i;
      var segs = ''; for (var k = 0; k < len; k++) segs += '<i></i>';
      return '<button type="button" class="sk-piece' + (p ? ' placed' : '') + (on ? ' held' : '') + '" data-piece="' + i + '" aria-label="Ship of ' + len + '">' + segs + '</button>';
    }).join('') + '</div>';
  }
  function renderSetup() {
    var keepY = window.scrollY;   // redrawing must never move the page while placing ships
    var w = state.wallet, bal = w ? w.balanceCents : 0, ready = w && w.hasPin;
    var problem = state.chosen ? G.amountProblem(state.chosen, bal, 2) : '';
    var left = state.placed.filter(function(p) { return !p; }).length;
    var canStart = allPlaced() && state.chosen && !problem && ready && !state.busy;
    root.innerHTML =
      '<h2 class="duel-title">Place your fleet</h2>' +
      '<p class="sk-help">' + (state.held != null ? 'Now tap where it goes' + (window.matchMedia('(pointer: fine)').matches ? ' (or drag it there)' : '') + '. Red means it doesn&rsquo;t fit.'
        : left ? 'Tap a ship below' + (window.matchMedia('(pointer: fine)').matches ? ' or drag it' : '') + ', then tap the sea to place it. Tap a placed ship to move it.' : 'All ships placed. Tap one to move it.') + '</p>' +
      '<div class="sk-setup-wrap">' + setupBoardHTML() + '</div>' +
      dockHTML() +
      '<div class="sk-tools">' +
        '<button type="button" class="btn btn-outline sk-tool" id="sk-rotate">&#8635; Rotate <small>' + (state.vertical ? '&#8597;' : '&#8596;') + '</small></button>' +
        '<button type="button" class="btn btn-outline sk-tool" id="sk-shuffle">&#127922; Place for me</button>' +
        (state.placed.some(Boolean) ? '<button type="button" class="wl-link sk-clear" id="sk-clear">Clear</button>' : '') +
      '</div>' +
      '<h2 class="duel-title">Play for</h2>' +
      G.amountBoxHTML(state.chosen, bal, 2) +
      '<div class="amt-paybox">' + (state.chosen && !problem ? payTable(state.chosen) : '') + '</div>' +
      '<p class="duel-double">If Gnomie wins, you lose <strong>DOUBLE</strong>.</p>' +
      '<button type="button" class="btn btn-primary duel-start" id="sk-start"' + (canStart ? '' : ' disabled') + '>' + startLabel(problem, left) + '</button>' +
      '<p class="duel-status amt-msg">' + (state.error || problem || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>' +
      '<button type="button" class="wl-link game-demo-btn" id="sk-demo">&#9654; Watch a demo</button>';
    wireSetup(bal);
    if (Math.abs(window.scrollY - keepY) > 1) window.scrollTo(0, keepY);
  }
  function startLabel(problem, left) {
    if (left) return 'Place ' + left + ' more ship' + (left === 1 ? '' : 's');
    if (!state.chosen || problem) return 'Type an amount';
    return 'Ready! Start for ' + money(state.chosen);
  }
  function wireSetup(bal) {
    root.querySelectorAll('[data-piece]').forEach(function(b) {
      b.addEventListener('pointerdown', function(e) {
        var i = +b.dataset.piece;
        state.held = i; state.dragFrom = { x: e.clientX, y: e.clientY, dragging: false };
        if (state.placed[i]) { state.vertical = state.placed[i].v; state.placed[i] = null; }
        renderSetup();
      });
    });
    // The sea: one listener for the whole board, and hovering only recolors
    // squares (never redraws them), so a tap always lands on a real square.
    var sea = root.querySelector('.sk-setup');
    sea.addEventListener('pointermove', function(e) {
      if (state.held == null) return;
      var cell = e.target.closest('.sk-cell');
      setHover(cell ? [+cell.dataset.r, +cell.dataset.c] : null);
    });
    sea.addEventListener('pointerleave', function() { if (!(state.dragFrom && state.dragFrom.dragging)) setHover(null); });
    sea.addEventListener('click', function(e) {
      var cell = e.target.closest('.sk-cell'); if (!cell) return;
      placeAt(+cell.dataset.r, +cell.dataset.c, cell);
    });
    // Dragging a ship from the dock (only while the button/finger is held down)
    document.onpointermove = function(e) {
      if (state.held == null || !state.dragFrom) return;
      if (Math.abs(e.clientX - state.dragFrom.x) + Math.abs(e.clientY - state.dragFrom.y) > 6) state.dragFrom.dragging = true;
      if (!state.dragFrom.dragging) return;
      var el = document.elementFromPoint(e.clientX, e.clientY), cell = el && el.closest && el.closest('.sk-setup .sk-cell');
      setHover(cell ? [+cell.dataset.r, +cell.dataset.c] : null);
    };
    document.getElementById('sk-rotate').addEventListener('click', rotate);
    document.getElementById('sk-shuffle').addEventListener('click', function() { shuffle(); state.error = ''; renderSetup(); });
    var clr = document.getElementById('sk-clear'); if (clr) clr.addEventListener('click', function() { state.placed = [null, null, null, null]; state.held = null; renderSetup(); });
    document.getElementById('sk-demo').addEventListener('click', runDemo);
    G.wireAmountBox(root, bal, 2, function(cents, pr) {
      state.chosen = cents; state.error = '';
      root.querySelector('.amt-paybox').innerHTML = cents && !pr ? payTable(cents) : '';
      var st = document.getElementById('sk-start'), left = state.placed.filter(function(p) { return !p; }).length;
      st.disabled = !(allPlaced() && cents && !pr && state.wallet && state.wallet.hasPin);
      st.textContent = startLabel(pr, left);
      root.querySelector('.amt-msg').innerHTML = pr;
    }, function(cents) { state.chosen = cents; state.error = ''; renderSetup(); });
    document.getElementById('sk-start').addEventListener('click', startGame);
  }
  // Show where the held ship would go: your color if it fits, red if it doesn't
  function setHover(h) {
    if (String(h) === String(state.hover)) return;
    state.hover = h; paintPreview();
  }
  function paintPreview() {
    var preview = {}, bad = false;
    if (state.held != null && state.hover) {
      var len = FLEET[state.held];
      bad = !fits(len, state.hover[0], state.hover[1], state.vertical, state.held);
      for (var i = 0; i < len; i++) {
        var a = state.vertical ? state.hover[0] + i : state.hover[0], b = state.vertical ? state.hover[1] : state.hover[1] + i;
        if (a < N && b < N) preview[key(a, b)] = 1;
      }
    }
    root.querySelectorAll('.sk-setup .sk-cell').forEach(function(cell) {
      var on = preview[key(+cell.dataset.r, +cell.dataset.c)];
      cell.classList.toggle('prev-ok', !!on && !bad);
      cell.classList.toggle('prev-bad', !!on && bad);
    });
  }
  function placeAt(r, c, cell) {
    if (state.held == null) {
      // tap a placed ship to pick it back up
      var s = cell && cell.dataset.ship;
      if (s != null && s !== '') { var i = +s; state.held = i; state.vertical = state.placed[i].v; state.placed[i] = null; state.hover = [r, c]; renderSetup(); }
      return;
    }
    var len = FLEET[state.held];
    if (!fits(len, r, c, state.vertical, state.held)) { state.hover = [r, c]; paintPreview(); var sea = root.querySelector('.sk-setup'); if (sea) { sea.classList.remove('nope'); void sea.offsetWidth; sea.classList.add('nope'); } return; }
    state.placed[state.held] = { len: len, r: r, c: c, v: state.vertical };
    // pick up the next ship still in the dock, so placing is quick
    var next = state.placed.findIndex(function(p) { return !p; });
    state.held = next === -1 ? null : next; state.hover = null; state.dragFrom = null;
    renderSetup();
  }
  function onDrop(e) {
    var drag = state.dragFrom; state.dragFrom = null;     // a plain tap on a ship just picks it up
    if (state.held == null || !drag || !drag.dragging) return;
    var el = document.elementFromPoint(e.clientX, e.clientY), cell = el && el.closest && el.closest('.sk-setup .sk-cell');
    if (cell) placeAt(+cell.dataset.r, +cell.dataset.c, cell); else setHover(null);
  }

  async function startGame() {
    var bal = state.wallet ? state.wallet.balanceCents : 0;
    if (state.busy || !allPlaced() || !state.chosen || G.amountProblem(state.chosen, bal, 2)) return;
    state.busy = true;
    try {
      var res = await G.api.shipsStart(state.chosen, fleetCells());
      document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      state.game = res.game; state.error = ''; state.status = 'You fire first. Tap a square on Gnomie&rsquo;s sea.';
      document.onpointermove = null;
    } catch (x) { state.error = x.message; }
    state.busy = false;
    render();
    if (state.game) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 2) the battle ----------
  function seaHTML(kind, g, live, reveal) {
    var html = '<div class="sk-sea sk-' + kind + (live ? ' live' : '') + '">';
    var mineAt = {}, sunkAt = {}, herAt = {};
    if (kind === 'mine') {
      g.mine.forEach(function(s, i) { s.forEach(function(x, j) { mineAt[key(x[0], x[1])] = { ship: s, j: j }; }); });
      var shot = {}; g.herShots.forEach(function(x) { shot[key(x[0], x[1])] = 1; });
      g.mine.forEach(function(s) { if (s.every(function(x) { return shot[key(x[0], x[1])]; })) s.forEach(function(x) { sunkAt[key(x[0], x[1])] = 1; }); });
    } else {
      (g.sunkHers || []).forEach(function(s) { s.forEach(function(x) { sunkAt[key(x[0], x[1])] = 1; }); });
      (reveal || []).forEach(function(s) { s.forEach(function(x) { herAt[key(x[0], x[1])] = s; }); });
    }
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var k = key(r, c), cls = 'sk-cell', mark = '';
      if (kind === 'mine') {
        var m = mineAt[k];
        if (m) cls += ' ship' + edgeOf(m.ship, r, c);
        var hitMe = g.herShots.some(function(x) { return x[0] === r && x[1] === c; });
        if (hitMe) { cls += m ? ' hit' : ' miss'; mark = m ? '<i class="sk-boom"></i>' : '<i class="sk-dot"></i>'; }
      } else {
        var v = g.herView[r][c];
        if (herAt[k] && !v) cls += ' ship ghost' + edgeOf(herAt[k], r, c);
        if (v === 'h' || v === 's') { cls += ' hit'; mark = '<i class="sk-boom"></i>'; }
        if (v === 'm') { cls += ' miss'; mark = '<i class="sk-dot"></i>'; }
      }
      if (sunkAt[k]) cls += ' sunk';
      if (state.flash && state.flash.kind === kind && state.flash.r === r && state.flash.c === c) cls += ' just';
      var canFire = live && kind === 'hers' && !g.herView[r][c];
      html += '<button type="button" class="' + cls + '"' + (canFire ? ' data-fire="' + r + ',' + c + '"' : ' tabindex="-1"') + ' aria-label="Row ' + (r + 1) + ', column ' + (c + 1) + '">' + mark + '</button>';
    }
    return html + '</div>';
  }
  function edgeOf(s, r, c) {
    var v = s.length > 1 && s[0][1] === s[1][1];
    var first = s[0][0] === r && s[0][1] === c, last = s[s.length - 1][0] === r && s[s.length - 1][1] === c;
    return (v ? ' v' : ' h') + (first ? ' first' : '') + (last ? ' last' : '');
  }
  function fleetLeft(ships, shots) {
    return ships.map(function(s) {
      var sunk = s.every(function(x) { return shots.some(function(y) { return y[0] === x[0] && y[1] === x[1]; }); });
      var segs = ''; for (var i = 0; i < s.length; i++) segs += '<i></i>';
      return '<span class="sk-mini' + (sunk ? ' sunk' : '') + '">' + segs + '</span>';
    }).join('');
  }
  function herFleetLeft(g) {
    var sunk = (g.sunkHers || []).map(function(s) { return s.length; }), out = '';
    FLEET.forEach(function(len) {
      var i = sunk.indexOf(len), isSunk = i !== -1; if (isSunk) sunk.splice(i, 1);
      var segs = ''; for (var k = 0; k < len; k++) segs += '<i></i>';
      out += '<span class="sk-mini her' + (isSunk ? ' sunk' : '') + '">' + segs + '</span>';
    });
    return out;
  }
  function renderBattle() {
    var g = state.game, live = !state.busy && !state.demo;
    root.innerHTML =
      payTable(g.amount, true) +
      '<p class="duel-status-line sk-status">' + state.status + '</p>' +
      '<div class="sk-battle">' +
        '<div class="sk-side">' +
          '<div class="sk-label"><img class="duel-pfp" src="' + PFP + '" alt="" /><span>Gnomie&rsquo;s sea</span><span class="sk-fleet">' + herFleetLeft(g) + '</span></div>' +
          seaHTML('hers', g, live) +
        '</div>' +
        '<div class="sk-side">' +
          '<div class="sk-label"><span>Your fleet</span><span class="sk-fleet">' + fleetLeft(g.mine, g.herShots) + '</span></div>' +
          seaHTML('mine', g, false) +
        '</div>' +
      '</div>' +
      (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>' : G.giveUpHTML());
    root.querySelectorAll('[data-fire]').forEach(function(b) {
      b.addEventListener('click', function() { var p = b.dataset.fire.split(','); fire(+p[0], +p[1]); });
    });
    var stop = document.getElementById('demo-stop'); if (stop) stop.addEventListener('click', endDemo);
  }
  function show(status, flash) { state.status = status; state.flash = flash || null; renderBattle(); }

  async function fire(r, c) {
    if (state.busy || state.demo) return;
    state.busy = true;
    var g = state.game;
    show('Firing&hellip;');
    var res;
    try { res = await G.api.shipsFire(r, c); }
    catch (x) { state.busy = false; show(x.message); return; }
    // your shot
    g.herView[r][c] = res.you.hit ? (res.you.sunk ? 's' : 'h') : 'm';
    if (res.you.sunk) g.sunkHers = (g.sunkHers || []).concat([res.you.sunk]);
    show(res.you.sunk ? '<strong>You sank one of her ships!</strong>' + (res.result ? '' : ' Fire again.') : res.you.hit ? '<strong>Hit!</strong> Fire again.' : 'Miss.', { kind: 'hers', r: r, c: c });
    await wait(res.you.hit ? 650 : 700);
    // her shots, one at a time
    for (var i = 0; i < res.gnomie.length; i++) {
      var s = res.gnomie[i];
      show('Gnomie is aiming&hellip;');
      await wait(i ? 450 : 600);
      g.herShots = g.herShots.concat([[s.r, s.c]]);
      show(s.sunk ? '<strong>Gnomie sank your ship!</strong>' : s.hit ? '<strong>Gnomie hit you!</strong> She fires again&hellip;' : 'Gnomie missed.', { kind: 'mine', r: s.r, c: s.c });
      await wait(s.hit ? 650 : 550);
    }
    document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
    if (res.result) {
      var oc = res.result.outcome;
      state.final = res.final;
      show(oc === 'win' ? '<strong>You sank her whole fleet!</strong>' : '<strong>Gnomie sank your whole fleet.</strong>');
      await wait(1200);
      G.celebrate(oc === 'win' ? 'win' : 'lose', oc === 'win' ? 'You Won!' : 'Gnomie Wins!', money(-res.result.paidCents));
      state.result = res.result; state.game = null; state.busy = false;
      boards(); render();
      return;
    }
    state.game = res.game; state.busy = false;
    show('Your turn: tap a square on Gnomie&rsquo;s sea.');
  }

  // ---------- 3) result: both seas stay, with her ships shown ----------
  function renderResult() {
    var r = state.result, f = state.final;
    if (state.chosen == null) state.chosen = r.amount;
    var win = r.outcome === 'win';
    root.innerHTML =
      '<div class="duel-result duel-result-' + (win ? 'win' : 'lose') + '">' +
        '<h2 class="duel-result-title">' + (win ? 'You Won!' : 'Gnomie Won!') + '</h2>' +
        '<p class="duel-result-pay">' + (win ? money(-r.paidCents) : 'Double: ' + money(-r.paidCents)) + '</p>' +
      '</div>' +
      (f ? '<div class="game-final"><div class="sk-battle">' +
        '<div class="sk-side"><div class="sk-label"><span>Gnomie&rsquo;s sea</span></div>' + seaHTML('hers', f, false, f.hers) + '</div>' +
        '<div class="sk-side"><div class="sk-label"><span>Your fleet</span></div>' + seaHTML('mine', f, false) + '</div>' +
      '</div><p class="duel-status-line">You sank ' + r.youSunk + ' of 4 &middot; she sank ' + r.gnomieSunk + ' of 4</p></div>' : '') +
      '<div class="duel-result-actions">' +
        '<button type="button" class="btn btn-primary" id="sk-again">Clear Board &amp; Play Again</button>' +
        '<a class="btn btn-outline" href="games.html">All Games</a>' +
      '</div>';
    document.getElementById('sk-again').addEventListener('click', function() {
      state.result = null; state.final = null; state.flash = null; render();   // your last placement stays, so you can play again fast
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- demo: a pretend game with captions ----------
  var demoRun = 0;
  function endDemo() { demoRun++; state.demo = false; state.game = null; state.busy = false; state.flash = null; render(); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; state.busy = true; state.result = null;
    var mine = [[[1, 1], [1, 2], [1, 3], [1, 4]], [[3, 6], [4, 6], [5, 6]], [[6, 1], [6, 2], [6, 3]], [[4, 2], [5, 2]]];
    var hers = [[[2, 2], [2, 3], [2, 4], [2, 5]], [[5, 0], [6, 0], [7, 0]], [[0, 7], [1, 7], [2, 7]], [[6, 4], [6, 5]]];
    var view = []; for (var r = 0; r < N; r++) { view.push(new Array(N).fill(0)); }
    state.game = { amount: state.chosen || 100, mine: mine, herShots: [], herView: view, sunkHers: [] };
    var g = state.game;
    function isHers(a, b) { return hers.some(function(s) { return s.some(function(x) { return x[0] === a && x[1] === b; }); }); }
    var step = async function(who, rc, text, ms) {
      if (run !== demoRun) throw 0;
      if (who === 'you') {
        var hit = isHers(rc[0], rc[1]); g.herView[rc[0]][rc[1]] = hit ? 'h' : 'm';
        var sunk = hers.filter(function(s) { return s.every(function(x) { return g.herView[x[0]][x[1]]; }); });
        sunk.forEach(function(s) { s.forEach(function(x) { g.herView[x[0]][x[1]] = 's'; }); });
        g.sunkHers = sunk;
        show(text, { kind: 'hers', r: rc[0], c: rc[1] });
      } else if (who === 'her') { g.herShots = g.herShots.concat([rc]); show(text, { kind: 'mine', r: rc[0], c: rc[1] }); }
      else show(text);
      await wait(ms);
    };
    try {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await step(null, null, 'First you place your fleet: ships of 4, 3, 3 and 2. Drag them, or tap a ship then tap the sea.', 3200);
      await step(null, null, 'Then you race Gnomie. Tap a square on <strong>her</strong> sea to fire.', 2600);
      await step('you', [4, 4], 'Miss. Now it&rsquo;s her turn.', 1600);
      await step('her', [3, 6], '<strong>She hit you!</strong> A hit means she fires again&hellip;', 2000);
      await step('her', [4, 6], 'Another hit&hellip;', 1500);
      await step('her', [2, 6], 'Miss. Your turn.', 1500);
      await step('you', [2, 3], '<strong>Hit!</strong> A hit means you fire again.', 1900);
      await step('you', [2, 4], '<strong>Hit!</strong> Follow the line&hellip;', 1500);
      await step('you', [2, 5], '<strong>Hit!</strong>', 1100);
      await step('you', [2, 2], '<strong>You sank her biggest ship!</strong> Watch her fleet up top.', 2600);
      await step(null, null, 'Sink all four of her ships before she sinks yours to win.', 2600);
      await step(null, null, 'That&rsquo;s it! Place your fleet and type an amount to play for real.', 2400);
    } catch (e) { return; }
    if (run === demoRun) endDemo();
  }
})();
