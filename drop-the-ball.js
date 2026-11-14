// ==========================================
// Drop the Ball (page script)
// Draws the board and aim, and animates the path the server chose for each
// ball. How likely each drain is comes from Games.oddsFor (games.js), the
// same rule the server uses to drop the ball, shown here only as plain
// words (Very common ... Very rare), never as numbers.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var GAME = 'drop-the-ball';
  var page = document.querySelector('.drain-page');
  var canvas = document.getElementById('drain-canvas');
  var ctx = canvas.getContext('2d');
  var dropBtn = document.getElementById('drain-drop');
  var resultEl = document.getElementById('drain-result');
  var chanceEl = document.getElementById('drain-chance');
  var likelyEl = document.getElementById('drain-likely');
  var boardsEl = document.getElementById('drain-boards');
  var statusEl = document.getElementById('drain-status');

  var state = { wallet: null, board: 'sweet', aim: 0, ball: null, busy: false, flash: {}, selected: null, dragging: false, demo: false };
  var geo = {};

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
  function start() {
    if (started) return; started = true;
    document.getElementById('games-gate').style.display = 'none';
    page.classList.remove('games-lock');
    G.mountWallet(document.getElementById('wallet-root'), { compact: true });
    document.addEventListener('wallet:change', function(e) { state.wallet = e.detail; refresh(); });
    window.addEventListener('resize', function() { layout(); draw(); });
    // Aim: drag the ball along the top, or tap anywhere above the slots
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', function() { state.dragging = false; });
    canvas.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setAim(state.aim + (e.key === 'ArrowLeft' ? -1 : 1)); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop(); }
    });
    canvas.tabIndex = 0;
    dropBtn.addEventListener('click', drop);
    document.getElementById('drain-demo').addEventListener('click', function() { if (!state.demo) runDemo(); });
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    G.renderGameActivity(document.getElementById('game-activity'), 'Drop the Ball');
    layout(); refresh(); requestAnimationFrame(loop);
  }

  // ---------- helpers ----------
  function balance() { return state.wallet ? state.wallet.balanceCents : 0; }
  function unlocked(key) { return balance() >= G.BOARDS[key].unlockCents; }
  function drainLabel(slot) {
    return G.shortMoney(G.drainValue(state.board, slot, balance()).cents);
  }
  // Plain words instead of numbers
  function likelihood(p) {
    if (p >= 0.15) return 'Very common';
    if (p >= 0.05) return 'Common';
    if (p >= 0.01) return 'Sometimes';
    if (p >= 0.001) return 'Rare';
    return 'Very rare';
  }

  // ---------- geometry (responsive) ----------
  function layout() {
    var w = Math.min(canvas.parentElement.clientWidth, 600);
    var dpr = window.devicePixelRatio || 1;
    // Margins wide enough that the outer drains and their labels fit
    var half = (w - 16) / 25.9;
    var pad = half * 0.95 + 8;
    var rowH = Math.max(18, Math.min(30, half * 1.55));
    var narrow = half < 14;
    var top = 40;
    var drainY = top + 12 * rowH + (narrow ? 14 : 4);
    var h = drainY + 40;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geo = { w: w, h: h, pad: pad, half: half, rowH: rowH, top: top, drainY: drainY, narrow: narrow };
  }
  function xAt(hpos) { return geo.pad + hpos * geo.half; }
  function yAt(row) { return geo.top + row * geo.rowH; }

  // ---------- drawing ----------
  function draw() {
    var g = geo, now = performance.now();
    ctx.clearRect(0, 0, g.w, g.h);

    // aim guide: a faint line from the waiting ball to the first peg
    if (!state.ball || !state.ball.anim) {
      var ax = xAt(12 + 2 * state.aim);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax, 22); ctx.lineTo(ax, yAt(0) - 4); ctx.stroke(); ctx.setLineDash([]);
    }

    // pegs
    for (var r = 0; r < 12; r++) {
      for (var hp = r % 2; hp <= 24; hp += 2) {
        ctx.beginPath();
        ctx.arc(xAt(hp), yAt(r), Math.max(2.2, g.half * 0.15), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,95,162,0.5)';
        ctx.fill();
      }
    }

    // slots: plain dark cups with a soft pink floor; they glow when a ball lands
    for (var k = 0; k < 13; k++) {
      var cx = xAt(2 * k), w2 = g.half * 1.72, hgt = 22, yTop = g.drainY;
      var edge = k === 0 || k === 12;
      var f = state.flash[k] ? Math.max(0, 1 - (now - state.flash[k]) / 900) : 0;
      ctx.fillStyle = f > 0 ? 'rgba(255,95,162,' + (0.12 + f * 0.35) + ')' : '#0a0a0c';
      roundRect(cx - w2 / 2, yTop, w2, hgt, 5); ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = f > 0 ? 'rgba(255,255,255,' + (0.35 + f * 0.65) + ')' : (edge ? 'rgba(255,95,162,0.75)' : 'rgba(255,95,162,0.3)');
      roundRect(cx - w2 / 2, yTop, w2, hgt, 5); ctx.stroke();
      ctx.fillStyle = 'rgba(255,95,162,0.35)';
      ctx.fillRect(cx - w2 / 2 + 4, yTop + hgt - 4, w2 - 8, 1.5);
      // amount label (staggered on narrow boards so labels never overlap)
      ctx.fillStyle = edge ? '#ff5fa2' : '#e9dde8';
      ctx.font = '600 ' + (g.narrow ? 9 : 11) + 'px Inter, sans-serif';
      ctx.textAlign = 'center';
      var stagger = g.narrow && k % 2 === 1 ? 11 : 0;
      ctx.fillText(drainLabel(k), cx, yTop - 5 - stagger);
    }

    // the ball (metallic pink pinball); the highlight turns as it rolls
    if (state.ball) {
      var b = state.ball, rad = Math.max(6, g.half * 0.55), spin = b.spin || 0;
      var hx = b.x - rad * 0.35 + Math.sin(spin) * rad * 0.15, hy = b.y - rad * 0.4 + Math.cos(spin) * rad * 0.08;
      drawBall(b.x, b.y, rad, hx, hy, 1);
    } else {
      // Waiting ball at the top, where it will drop from
      var r0 = Math.max(6, g.half * 0.55), bx = xAt(12 + 2 * state.aim), by = 14;
      drawBall(bx, by, r0 * (state.dragging ? 1.15 : 1), bx - r0 * 0.35, by - r0 * 0.4, 1);
    }
  }
  // Metallic ball in the player's colour
  function shade(hex, t) { // t < 0 darker, t > 0 lighter
    var n = parseInt(hex.slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, bb = n & 255;
    var f = function(c) { return Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t); };
    return 'rgb(' + f(r) + ',' + f(gg) + ',' + f(bb) + ')';
  }
  function youColor() { return (getComputedStyle(document.documentElement).getPropertyValue('--you') || '#4ade80').trim(); }
  function drawBall(x, y, rad, hx, hy) {
    var c = youColor();
    var grad = ctx.createRadialGradient(hx, hy, rad * 0.1, x, y, rad);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, shade(c, 0.55));
    grad.addColorStop(0.6, c);
    grad.addColorStop(1, shade(c, -0.6));
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- animation: replays the server's path, pegboard-style ----------
  // Every ball follows exactly the path the server chose (b.path). Only the
  // look is random: how high it pops off each peg, a little wobble, speed
  // picking up as it falls, and a small settle bounce in the slot.
  function randBetween(lo, hi) { return lo + Math.random() * (hi - lo); }

  function makeBall(path) {
    var segs = [], t = 0;
    for (var i = 0; i < path.length; i++) {
      var dur = i === 0 ? 260 : Math.max(105, 205 - i * 7) * randBetween(0.88, 1.12);
      segs.push({ start: t, dur: dur, pop: i === 0 ? 0 : randBetween(0.25, 0.75), wob: randBetween(-0.12, 0.12) });
      t += dur;
    }
    return { path: path, segs: segs, total: t, settle: 320, x: xAt(path[0]), y: 14, spin: 0, anim: true, t0: performance.now() };
  }

  function loop(now) {
    var b = state.ball;
    if (b && b.anim) {
      var el = now - b.t0, slotY = geo.drainY + 11;
      if (el >= b.total + b.settle) {
        b.anim = false;
        b.x = xAt(b.path[b.path.length - 1]); b.y = slotY;
        landed();
      } else if (el >= b.total) {
        // settle: two little bounces in the slot
        var st = (el - b.total) / b.settle;
        b.x = xAt(b.path[b.path.length - 1]);
        b.y = slotY - Math.abs(Math.sin(st * Math.PI * 2)) * (1 - st) * 7;
      } else {
        var i = 0;
        while (i < b.segs.length - 1 && el >= b.segs[i + 1].start) i++;
        var sg = b.segs[i], t = Math.min(1, (el - sg.start) / sg.dur);
        var fromH, toH, fromY, toY;
        if (i === 0) { fromH = toH = b.path[0]; fromY = 14; toY = yAt(0); }
        else { fromH = b.path[i - 1]; toH = b.path[i]; fromY = yAt(i - 1); toY = i === 12 ? slotY : yAt(i); }
        var dx = toH - fromH;
        // sideways: quick kick off the peg that settles, plus a touch of wobble
        var ease = 1 - Math.pow(1 - t, 2.2);
        b.x = xAt(fromH + dx * ease + dx * sg.wob * Math.sin(Math.PI * t));
        // down: gravity (speeds up), with a pop upward right after each peg
        b.y = fromY + (toY - fromY) * (t * t) - Math.sin(Math.PI * t) * geo.rowH * sg.pop * (1 - t * 0.5);
        b.spin += dx * 0.18;
      }
    }
    draw();
    requestAnimationFrame(loop);
  }

  async function drop() {
    if (state.busy) return;
    if (!state.demo && (!state.wallet || !state.wallet.hasPin || balance() <= 0)) return;
    state.busy = true; dropBtn.disabled = true; resultEl.textContent = '';
    try {
      var res = state.demo ? fakeDrop() : await G.api.drop(GAME, state.board, state.aim);
      state.pending = res;
      state.ball = makeBall(res.path);
    } catch (x) {
      statusEl.textContent = x.message;
      state.busy = false; dropBtn.disabled = false;
    }
  }

  function landed() {
    var res = state.pending;
    state.flash[res.slot] = performance.now();
    resultEl.innerHTML = '<span class="drain-loss drain-loss-pop">' + G.money(-res.lossCents) + '</span>';
    // Every drop ends with a big moment
    if (res.slot === 0 || res.slot === 12) G.celebrate('lose', 'Ouch!', 'The edge: ' + G.money(-res.lossCents));
    else if (res.slot >= 5 && res.slot <= 7) G.celebrate('win', 'Lucky!', G.money(-res.lossCents));
    else G.celebrate('tie', 'Dropped!', G.money(-res.lossCents));
    if (state.demo) { setTimeout(function() { state.busy = false; refresh(); }, 250); return; }
    document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    setTimeout(function() { state.busy = false; refresh(); }, 250);
  }

  // ---------- boards, chances, status ----------
  function refresh() {
    if (!unlocked(state.board)) state.board = 'sweet';
    boardsEl.innerHTML = '';
    G.BOARD_ORDER.forEach(function(key) {
      var b = G.BOARDS[key], open = unlocked(key);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drain-board' + (state.board === key ? ' on' : '') + (open ? '' : ' locked');
      btn.innerHTML = '<span class="db-name">' + b.name + '</span>' +
        '<span class="db-sub">' + (open ? G.shortMoney(b.amounts[0]) + ' – ' + G.shortMoney(b.edgeCents) : '\u{1F512} ' + G.shortMoney(b.unlockCents) + '+ wallet') + '</span>';
      btn.disabled = !open;
      btn.addEventListener('click', function() { state.board = key; refresh(); });
      boardsEl.appendChild(btn);
    });

    var odds = G.oddsFor(state.aim);

    // Tapped drain: just its word (unreachable drains show nothing)
    if (state.selected != null && odds[state.selected] > 0) {
      chanceEl.innerHTML = '<strong>' + drainLabel(state.selected) + '</strong> · ' + likelihood(odds[state.selected]);
    } else {
      chanceEl.textContent = 'Tap a slot to see how often balls land there.';
    }

    // "How likely is each drain?": drains grouped by word, no numbers
    var tiers = ['Very common', 'Common', 'Sometimes', 'Rare', 'Very rare'], groups = {};
    odds.forEach(function(p, k) {
      if (p <= 0) return;
      var t = likelihood(p), label = drainLabel(k);
      groups[t] = groups[t] || [];
      if (groups[t].indexOf(label) === -1) groups[t].push(label);
    });
    likelyEl.innerHTML = tiers.filter(function(t) { return groups[t]; }).map(function(t) {
      return '<li><span class="dl-word">' + t + '</span><span class="dl-drains">' + groups[t].join(' · ') + '</span></li>';
    }).join('');

    var bal = balance();
    if (state.demo) { dropBtn.disabled = true; draw(); return; }
    if (!state.wallet || !state.wallet.hasPin) { statusEl.textContent = 'Set up your wallet above to play.'; dropBtn.disabled = true; }
    else if (bal <= 0) { statusEl.textContent = 'Your wallet is empty. Load it to play.'; dropBtn.disabled = true; }
    else { statusEl.textContent = ''; dropBtn.disabled = state.busy; }
    draw();
  }

  // ---------- aiming: drag the ball, or tap above the slots ----------
  function aimFromX(x) { return Math.max(-6, Math.min(6, Math.round(((x - geo.pad) / geo.half - 12) / 2))); }
  function setAim(a) {
    a = Math.max(-6, Math.min(6, a));
    if (a === state.aim) return;
    state.aim = a; state.selected = null; refresh();
  }
  function canAim() { return !state.busy && !state.demo; }
  function pointIn(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onPointerDown(e) {
    var p = pointIn(e);
    if (p.y >= geo.drainY - 30) { // tapped the slot row: show how often balls land there
      var k = Math.round((p.x - geo.pad) / (2 * geo.half));
      if (k >= 0 && k <= 12) { state.selected = k; refresh(); }
      return;
    }
    if (!canAim()) return;
    state.dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    setAim(aimFromX(p.x));
  }
  function onPointerMove(e) {
    var p = pointIn(e);
    canvas.style.cursor = p.y < geo.drainY - 30 && canAim() ? (state.dragging ? 'grabbing' : 'pointer') : 'default';
    if (state.dragging) setAim(aimFromX(p.x));
  }
  function onPointerUp() { state.dragging = false; draw(); }

  // ---------- demo: pretend drops with captions (no money) ----------
  function fakeDrop() {
    var r = G.dropPath(state.aim);
    return { path: r.path, slot: r.slot, lossCents: G.drainValue(state.board, r.slot, 1000000).cents };
  }
  var demoRun = 0;
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; state.selected = null; resultEl.textContent = '';
    var demoBtn = document.getElementById('drain-demo');
    demoBtn.textContent = 'End demo';
    demoBtn.onclick = function(e) { if (state.demo) { e.stopImmediatePropagation(); demoRun++; stopDemo(); } };
    var say = function(t) { statusEl.innerHTML = '<span class="game-demo-cap">Demo &middot; ' + t + '</span>'; };
    var steps = [
      function() { setAimDemo(0); say('Drag the ball (or tap) to choose where it drops.'); }, 2200,
      function() { setAimDemo(-3); say('Aim left&hellip;'); }, 1000,
      function() { setAimDemo(3); say('&hellip;or right. The middle slots are cheaper, the edges cost the most.'); }, 2600,
      function() { setAimDemo(0); say('Press <strong>Drop</strong>. The ball bounces down the pegs&hellip;'); state.busy = false; drop(); }, 4200,
      function() { say('&hellip;and the slot it lands in is what you lose.'); }, 2400,
      function() { setAimDemo(-6); say('Aiming at the edge makes the big slots more likely.'); state.busy = false; drop(); }, 4400,
      function() { say('That&rsquo;s it! Bigger boards unlock as your wallet grows.'); }, 2400
    ];
    for (var i = 0; i < steps.length; i += 2) {
      if (run !== demoRun) return;
      steps[i]();
      await wait(steps[i + 1]);
    }
    if (run === demoRun) stopDemo();
  }
  function setAimDemo(a) { state.aim = a; draw(); }
  function stopDemo() {
    state.demo = false; state.busy = false; state.ball = null; resultEl.textContent = '';
    var demoBtn = document.getElementById('drain-demo');
    demoBtn.innerHTML = '&#9654; Watch a demo'; demoBtn.onclick = null;
    refresh();
  }
})();
