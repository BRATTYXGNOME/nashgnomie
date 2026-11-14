// ==========================================
// Spin the Bottle (page script)
// Pick a wedge blind (amounts hidden and shuffled every spin), then
// "Lock in & Spin": the server shuffles the amounts into the wedges and picks
// where the bottle lands (each wedge 1 in 8). The page then reveals every
// amount and spins the bottle to that wedge.
// Lands on your wedge = lose double your wedge; anywhere else = lose that wedge.
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var B = G.BOTTLE;
  var ORDER = ['sweet', 'spicy', 'savage'];
  var GAME = 'spin-the-bottle';
  var page = document.querySelector('.stb-page');
  var wheel = document.getElementById('stb-wheel');
  var boardsEl = document.getElementById('stb-boards');
  var statusEl = document.getElementById('stb-status');
  var spinBtn = document.getElementById('stb-spin');
  var demoBtn = document.getElementById('stb-demo');

  // amounts: null while hidden, else the 8 revealed amounts in wedge order
  var state = { wallet: null, board: 'sweet', pick: null, busy: false, angle: 0, landed: null, amounts: null, message: '', done: false, demo: false };

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
  function start() {
    if (started) return; started = true;
    document.getElementById('games-gate').style.display = 'none';
    page.classList.remove('games-lock');
    G.mountWallet(document.getElementById('wallet-root'), { compact: true });
    document.addEventListener('wallet:change', function(e) { state.wallet = e.detail; if (!state.busy) refresh(); });
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    G.renderGameActivity(document.getElementById('game-activity'), 'Spin the Bottle');
    spinBtn.addEventListener('click', onButton);
    demoBtn.addEventListener('click', function() { if (state.demo) endDemo(); else runDemo(); });
    buildWheel();
    refresh();
  }

  function balance() { return state.wallet ? state.wallet.balanceCents : 0; }
  function worst(key) { return 2 * Math.max.apply(null, B[key].slices); }
  function unlocked(key) { return balance() >= B[key].unlockCents; }
  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // ---------- the circle ----------
  var CX = 160, CY = 160, R = 150, LABEL_R = 108;
  var NS = 'http://www.w3.org/2000/svg';
  function pt(r, deg) { var a = (deg - 90) * Math.PI / 180; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
  function svg(tag, attrs) { var e = document.createElementNS(NS, tag); Object.keys(attrs).forEach(function(k) { e.setAttribute(k, attrs[k]); }); return e; }

  var sliceEls = [], labelEls = [], bottle, hubAmt;
  function buildWheel() {
    wheel.innerHTML = '';
    sliceEls = []; labelEls = [];
    for (var i = 0; i < 8; i++) {
      var a0 = i * 45 - 22.5, a1 = a0 + 45, p0 = pt(R, a0), p1 = pt(R, a1);
      var path = svg('path', {
        d: 'M' + CX + ',' + CY + ' L' + p0[0] + ',' + p0[1] + ' A' + R + ',' + R + ' 0 0,1 ' + p1[0] + ',' + p1[1] + ' Z',
        class: 'stb-slice' + (i % 2 ? ' alt' : ''), 'data-i': i, tabindex: 0, role: 'button', 'aria-label': 'Wedge ' + (i + 1)
      });
      (function(idx) {
        path.addEventListener('click', function() { pickWedge(idx); });
        path.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickWedge(idx); } });
      })(i);
      wheel.appendChild(path);
      sliceEls.push(path);
      var lp = pt(LABEL_R, i * 45);
      var t = svg('text', { x: lp[0], y: lp[1], class: 'stb-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      wheel.appendChild(t);
      labelEls.push(t);
    }
    wheel.appendChild(svg('circle', { cx: CX, cy: CY, r: 46, class: 'stb-hub' }));
    // Picked wedges pop outward, so remember each wedge's outward direction
    sliceEls.forEach(function(p, i) { var a = (i * 45 - 90) * Math.PI / 180; p.style.setProperty('--px', (Math.cos(a) * 10).toFixed(1) + 'px'); p.style.setProperty('--py', (Math.sin(a) * 10).toFixed(1) + 'px'); });
    bottle = svg('g', { class: 'stb-bottle' });
    bottle.appendChild(svg('path', {
      d: 'M154,98 L166,98 L166,122 Q186,132 186,152 L186,206 Q186,218 174,218 L146,218 Q134,218 134,206 L134,152 Q134,132 154,122 Z',
      class: 'stb-glass'
    }));
    bottle.appendChild(svg('rect', { x: 152, y: 92, width: 16, height: 9, rx: 2, class: 'stb-cap' }));
    bottle.appendChild(svg('path', { d: 'M142,160 Q142,146 152,140', class: 'stb-shine' }));
    bottle.style.transformOrigin = '160px 160px';
    bottle.style.transform = 'rotate(' + state.angle + 'deg)';
    wheel.appendChild(bottle);
    // What they pay pops up in the middle once the bottle stops
    hubAmt = svg('text', { x: CX, y: CY, class: 'stb-hub-amt', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    wheel.appendChild(hubAmt);
  }

  function paintWheel(revealDelay) {
    labelEls.forEach(function(t, i) {
      var shown = state.amounts ? G.shortMoney(state.amounts[i]) : '?';
      if (t.textContent !== shown) {
        t.textContent = shown;
        t.classList.toggle('hidden-amt', !state.amounts);
        if (state.amounts && revealDelay != null) { t.classList.remove('stb-reveal'); void t.getBBox(); t.style.animationDelay = (i * revealDelay) + 'ms'; t.classList.add('stb-reveal'); }
      }
    });
    sliceEls.forEach(function(p, i) {
      p.classList.toggle('picked', state.pick === i);
      p.classList.toggle('landed', state.landed === i);
      p.classList.toggle('locked-in', state.busy || state.done);
    });
  }

  function pickWedge(i) {
    if (state.busy || state.demo) return;
    if (state.done) clearBoard();
    state.pick = i;
    refresh();
    var el = sliceEls[i]; el.classList.remove('just-picked'); void el.getBBox(); el.classList.add('just-picked');
  }

  function clearBoard() {
    state.done = false; state.amounts = null; state.landed = null; state.message = '';
    if (hubAmt) { hubAmt.textContent = ''; hubAmt.classList.remove('show', 'double'); }
  }

  // ---------- boards + status ----------
  function refresh() {
    if (!unlocked(state.board)) {
      var open = ORDER.filter(unlocked);
      state.board = open.length ? open[0] : 'sweet';
    }
    boardsEl.innerHTML = '';
    ORDER.forEach(function(key) {
      var b = B[key], open = unlocked(key), lo = Math.min.apply(null, b.slices), hi = Math.max.apply(null, b.slices);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drain-board' + (state.board === key ? ' on' : '') + (open ? '' : ' locked');
      btn.innerHTML = '<span class="db-name">' + b.name + '</span>' +
        '<span class="db-sub">' + (open ? G.shortMoney(lo) + ' – ' + G.shortMoney(hi) : '\u{1F512} ' + G.shortMoney(b.unlockCents) + '+ wallet') + '</span>';
      btn.disabled = !open || state.busy || state.demo;
      btn.addEventListener('click', function() { state.board = key; clearBoard(); refresh(); });
      boardsEl.appendChild(btn);
    });
    paintWheel();

    var w = state.wallet, ready = w && w.hasPin;
    if (state.message) statusEl.innerHTML = state.message;
    else if (state.demo) statusEl.textContent = '';
    else if (!ready) statusEl.textContent = 'Set up your wallet above to play.';
    else if (!unlocked(state.board)) statusEl.innerHTML = 'Your wallet needs at least <strong>' + money(worst('sweet')) + '</strong> to play (double the biggest wedge).';
    else if (state.pick == null) statusEl.innerHTML = 'Tap a wedge to pick it. The amounts stay hidden until you lock in.';
    else statusEl.innerHTML = 'Wedge ' + (state.pick + 1) + ' picked. If the bottle lands on it, you lose <strong>double</strong>.';

    if (state.done) { spinBtn.textContent = 'Clear Board & Spin Again'; spinBtn.disabled = state.demo; }
    else {
      spinBtn.textContent = state.busy ? 'Spinning…' : 'Lock in & Spin';
      spinBtn.disabled = state.busy || state.demo || !ready || !unlocked(state.board) || state.pick == null;
    }
    demoBtn.innerHTML = state.demo ? 'End demo' : '&#9654; Watch a demo';
    demoBtn.disabled = state.busy && !state.demo;
  }

  async function onButton() {
    if (state.done) { clearBoard(); state.pick = null; refresh(); return; }
    if (state.busy || state.pick == null) return;
    state.busy = true; state.message = '';
    refresh();
    var res;
    try { res = await G.api.bottleSpin(state.board, state.pick); }
    catch (x) { state.busy = false; state.message = G.esc(x.message); refresh(); return; }
    await play(res);
    document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
  }

  // Reveal every amount, then spin the bottle to the chosen wedge
  async function play(res) {
    state.amounts = res.amounts;
    paintWheel(70);
    statusEl.innerHTML = 'Your wedge is <strong>' + money(res.amounts[state.pick]) + '</strong>. Spinning&hellip;';
    await wait(900);
    var jitter = (Math.random() - 0.5) * 30;
    var target = res.slot * 45 + jitter;
    var base = state.angle - (((state.angle % 360) + 360) % 360);
    state.angle = base + 360 * (4 + Math.floor(Math.random() * 2)) + target;
    bottle.style.transform = 'rotate(' + state.angle + 'deg)';
    await wait(3300);
    state.landed = res.slot;
    state.busy = false; state.done = true;
    hubAmt.textContent = G.money(-res.paidCents);
    hubAmt.classList.toggle('double', !!res.hit);
    hubAmt.classList.remove('show'); void hubAmt.getBBox(); hubAmt.classList.add('show');
    var sorted = res.amounts.slice().sort(function(a, b) { return a - b; });
    // Every spin ends with a big moment
    if (res.hit) G.celebrate('double', 'Double!', 'It landed on your wedge: ' + money(-res.paidCents));
    else if (res.sliceCents >= sorted[6]) G.celebrate('lose', 'Ouch!', money(-res.paidCents));
    else if (res.sliceCents <= sorted[1]) G.celebrate('win', 'Lucky!', money(-res.paidCents));
    else G.celebrate('tie', 'Spun!', money(-res.paidCents));
    state.message = res.hit
      ? '&#128165; It landed on <strong>your wedge</strong>! Double ' + money(res.sliceCents) + ': <strong>' + money(-res.paidCents) + '</strong>'
      : 'Landed on <strong>' + money(res.sliceCents) + '</strong>: <strong>' + money(-res.paidCents) + '</strong>';
    refresh();
  }

  // ---------- demo: two pretend spins (no money) ----------
  var demoRun = 0;
  function endDemo() { demoRun++; state.demo = false; state.busy = false; clearBoard(); state.pick = null; refresh(); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; clearBoard(); state.pick = null; refresh();
    var say = function(t) { statusEl.innerHTML = '<span class="game-demo-cap">Demo &middot; ' + t + '</span>'; };
    var slices = B[state.board].slices;
    var fake = function(pick, slot) {
      var order = slices.slice().sort(function() { return Math.random() - 0.5; });
      var hit = slot === pick, pay = hit ? order[slot] * 2 : order[slot];
      return { amounts: order, slot: slot, hit: hit, sliceCents: order[slot], paidCents: pay };
    };
    say('Every wedge hides an amount. They&rsquo;re shuffled every spin.'); await wait(2400); if (run !== demoRun) return;
    state.pick = 2; paintWheel(); say('Tap a wedge to pick it&hellip;'); await wait(1800); if (run !== demoRun) return;
    say('Press <strong>Lock in &amp; Spin</strong>. Now there&rsquo;s no backing out.'); await wait(2000); if (run !== demoRun) return;
    state.busy = true; await play(fake(2, 5)); if (run !== demoRun) return;
    say('It landed somewhere else, so you lose that wedge.'); await wait(2600); if (run !== demoRun) return;
    clearBoard(); state.pick = 6; refresh(); say('One more: picking wedge 7&hellip;'); await wait(1800); if (run !== demoRun) return;
    state.busy = true; await play(fake(6, 6)); if (run !== demoRun) return;
    say('It landed on <strong>your</strong> wedge, so you lose <strong>double</strong> it.'); await wait(3000); if (run !== demoRun) return;
    say('That&rsquo;s it! Pick a wedge to play for real.'); await wait(2000);
    if (run === demoRun) endDemo();
  }
})();
