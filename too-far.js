// ==========================================
// Too Far (page script)
// Get close to 31 without going over (Gnomie's birthday is Aug 31), then Gnomie
// plays by her own rule (decided on the server). Every card comes from the server; this file
// only shows it, one card at a time.
// You win (or Gnomie goes over) = pay 1x · tie 1.5x · Gnomie wins 2x ·
// you go over 31 = 2.5x (set aside when the game starts).
// ==========================================

(function() {
  'use strict';

  var G = window.Games;
  var T = G.TOOFAR;
  var GAME = 'too-far';
  var PFP = 'https://i.ibb.co/7Nj6352Q/pfp.jpg';
  var page = document.querySelector('.tf-page');
  var root = document.getElementById('tf-root');

  // view: what's on screen right now
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
    try { state.game = await G.api.tooFarState(); } catch (x) { state.game = null; } // resume a saved game
    if (state.game) state.view = viewFromGame(state.game, 0);
    boards();
    render();
  }

  function boards() {
    G.renderLeaderboard(document.getElementById('lb-game'), GAME);
    renderWins();
    G.renderGameActivity(document.getElementById('game-activity'), 'Don’t Bust');
  }

  // Small, low-key "Most wins against Gnomie" strip (this game only)
  async function renderWins() {
    var el = document.getElementById('lb-wins');
    var rows = await G.api.leaderboard('too-far-wins');
    var w = state.wallet;
    var names = rows.slice(0, 5).map(function(r) { return '<span class="duel-wins-name">' + G.esc(r.name) + '</span>'; });
    var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' &amp; ' + names[names.length - 1] : names.join('');
    el.innerHTML = (list ? 'Most wins against Gnomie: ' + list + '.' : '') +
      (w && w.tooFarWins ? '<span class="duel-wins-you">You&rsquo;ve beaten her ' + (w.tooFarWins === 1 ? 'once' : w.tooFarWins + ' times') + '.</span>' : '');
  }

  function money(c) { return G.money(c); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function pays(a) {
    return { win: a * T.PAY.win, tie: Math.round(a * T.PAY.tie), lose: a * T.PAY.lose, bust: Math.round(a * T.PAY.bust) };
  }
  function aOrAn(v) { return (v === 8 || v === 11 ? 'an ' : 'a ') + v; }
  function total(hand) { return hand.reduce(function(s, c) { return s + c.v; }, 0); }

  // ---------- cards ----------
  function cardHTML(c, isNew, delay) {
    return '<span class="tf-c' + (isNew ? ' tf-c-new' : '') + '"' + (delay ? ' style="animation-delay:' + delay + 'ms"' : '') + '>' +
      '<span class="tf-c-corner">' + c.v + '</span><span class="tf-c-num">' + c.v + '</span><span class="tf-c-mark">&#10022;</span></span>';
  }
  function handHTML(hand, newFrom, stagger) {
    if (!hand.length) return '<div class="tf-hand"><span class="tf-c tf-c-empty"></span></div>';
    return '<div class="tf-hand">' + hand.map(function(c, i) {
      var isNew = newFrom != null && i >= newFrom;
      return cardHTML(c, isNew, isNew && stagger ? (i - newFrom) * stagger : 0);
    }).join('') + '</div>';
  }

  // ---------- views ----------
  // { you, gnomie, newYou, newGnomie, stagger, status }
  function viewFromGame(g, newFrom) {
    return { you: g.you, gnomie: g.gnomie, newYou: newFrom, newGnomie: newFrom, stagger: 160, gnomieStayed: !!g.gnomieStayed, status: statusFor(total(g.you), g.gnomieStayed) };
  }
  function statusFor(t, gnomieStayed) {
    var her = gnomieStayed ? ' Gnomie is staying.' : '';
    if (t === T.TARGET) return T.TARGET + '! Perfect. Stay to finish.' + her;
    return 'Your turn: you have ' + t + '. Draw or Stay?' + her;
  }

  function render() {
    if (state.result) return renderResult();
    if (state.game && state.view) return renderGame();
    renderSetup();
  }

  // They type their own amount; the pay boxes update as they type.
  // The most they can play for is what their wallet covers if they go too far (2.5x).
  function maxFor(bal) { return Math.min(T.MAX_CENTS, Math.floor(bal / T.PAY.bust)); }
  function amountHTML() {
    var w = state.wallet, bal = w ? w.balanceCents : 0, max = maxFor(bal);
    var val = state.chosen ? (state.chosen / 100).toFixed(2).replace(/\.00$/, '') : '';
    var chips = [100, 500, 1000, 2000].filter(function(c) { return c <= max; });
    return '<div class="tf-amount">' +
        '<label class="tf-amount-box"><span class="tf-amount-cur">$</span><input type="text" id="tf-amt" inputmode="decimal" autocomplete="off" placeholder="0" value="' + val + '" aria-label="Amount to play for" /></label>' +
        (chips.length ? '<div class="tf-chips">' + chips.map(function(c) { return '<button type="button" class="tf-chip' + (state.chosen === c ? ' on' : '') + '" data-c="' + c + '">' + G.shortMoney(c) + '</button>'; }).join('') +
          (max >= T.MIN_CENTS ? '<button type="button" class="tf-chip" data-c="' + max + '">Max</button>' : '') + '</div>' : '') +
        '<p class="tf-amount-note">' + (max >= T.MIN_CENTS ? 'From ' + money(T.MIN_CENTS) + ' up to ' + money(max) + ' (your wallet covers a bust on that).' : 'Your wallet needs at least ' + money(Math.round(T.MIN_CENTS * T.PAY.bust)) + ' to play.') + '</p>' +
      '</div>';
  }
  function readAmount() {
    var el = document.getElementById('tf-amt');
    var n = parseFloat(String(el ? el.value : '').replace(/[$,\s]/g, ''));
    return isFinite(n) ? Math.round(n * 100) : 0;
  }
  function amountProblem(c) {
    var bal = state.wallet ? state.wallet.balanceCents : 0;
    if (!c) return 'Type an amount to play for.';
    if (c < T.MIN_CENTS) return 'The smallest amount is ' + money(T.MIN_CENTS) + '.';
    if (c > T.MAX_CENTS) return 'The biggest amount is ' + money(T.MAX_CENTS) + '.';
    if (Math.round(c * T.PAY.bust) > bal) return 'Your wallet covers up to ' + money(maxFor(bal)) + ' (a bust costs 2.5&times;).';
    return '';
  }

  function payTable(a, small) {
    var p = pays(a);
    return '<div class="duel-pays tf-pays' + (small ? ' duel-pays-small' : '') + '">' +
      '<div class="win"><span>' + (small ? 'Win' : 'If You Win') + '</span><strong>' + money(-p.win) + '</strong></div>' +
      '<div class="tie"><span>' + (small ? 'Tie' : 'If We Tie') + '</span><strong>' + money(-p.tie) + '</strong></div>' +
      '<div class="lose"><span>' + (small ? 'Lose' : 'If Gnomie Wins') + '</span><strong>' + money(-p.lose) + '</strong></div>' +
      '<div class="lose bust"><span>Bust</span><strong>' + money(-p.bust) + '</strong></div>' +
    '</div>';
  }

  // 1) Pick an amount
  function renderSetup() {
    var w = state.wallet, bal = w ? w.balanceCents : 0, ready = w && w.hasPin;
    var problem = state.chosen ? amountProblem(state.chosen) : '';
    root.innerHTML =
      '<h2 class="duel-title">Play for</h2>' +
      amountHTML() +
      '<div id="tf-paybox">' + (state.chosen && !problem ? payTable(state.chosen) : '') + '</div>' +
      '<p class="duel-double">If Gnomie wins, you lose <strong>DOUBLE</strong>. Go over ' + T.TARGET + ' and you lose <strong>2.5&times;</strong>.</p>' +
      '<button type="button" class="btn btn-primary duel-start" id="tf-start"' + (state.chosen && !problem && ready ? '' : ' disabled') + '>' +
        (state.chosen && !problem ? 'Start for ' + money(state.chosen) : 'Type an amount') + '</button>' +
      '<p class="duel-status" id="tf-amt-msg">' + (state.error || problem || (!ready ? 'Set up your wallet above to play.' : bal <= 0 ? 'Load your wallet to play.' : '')) + '</p>' +
      '<button type="button" class="wl-link game-demo-btn" id="tf-demo">&#9654; Watch a demo</button>';

    var amt = document.getElementById('tf-amt');
    // Update the pay boxes and button as they type, without redrawing the box they're typing in
    amt.addEventListener('input', function() {
      state.chosen = readAmount(); state.error = '';
      var pr = state.chosen ? amountProblem(state.chosen) : '';
      document.getElementById('tf-paybox').innerHTML = state.chosen && !pr ? payTable(state.chosen) : '';
      var st = document.getElementById('tf-start');
      st.disabled = !state.chosen || !!pr || !ready;
      st.textContent = state.chosen && !pr ? 'Start for ' + G.money(state.chosen) : 'Type an amount';
      document.getElementById('tf-amt-msg').innerHTML = pr;
      root.querySelectorAll('.tf-chip').forEach(function(b) { b.classList.toggle('on', +b.dataset.c === state.chosen); });
    });
    amt.addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('tf-start').click(); });
    root.querySelectorAll('.tf-chip').forEach(function(b) {
      b.addEventListener('click', function() { state.chosen = +b.dataset.c; state.error = ''; render(); });
    });
    document.getElementById('tf-demo').addEventListener('click', runDemo);
    document.getElementById('tf-start').addEventListener('click', async function() {
      if (!state.chosen || state.busy || amountProblem(state.chosen)) return;
      state.busy = true;
      try {
        var res = await G.api.tooFarStart(state.chosen);
        state.game = res.game; state.error = '';
        document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
        await dealIn(res.game);
      } catch (x) { state.error = x.message; state.busy = false; render(); }
    });
  }

  // 2) The game
  function renderGame() {
    var g = state.game, v = state.view;
    var yt = total(v.you), gt = total(v.gnomie);
    var canAct = !state.busy && !state.demo;
    root.innerHTML =
      payTable(g.amount, true) +
      '<div class="tf-side tf-side-gnomie">' +
        '<span class="duel-who"><img class="duel-pfp" src="' + PFP + '" alt="" /><span class="duel-name">Gnomie</span><span class="duel-total">' + gt + '</span></span>' +
        handHTML(v.gnomie, v.newGnomie, v.stagger) +
      '</div>' +
      '<p class="duel-status-line">' + v.status + '</p>' +
      '<div class="tf-side tf-side-you">' +
        handHTML(v.you, v.newYou, v.stagger) +
        '<span class="duel-who"><span class="duel-name">You</span><span class="duel-total' + (yt > T.TARGET ? ' tf-over' : '') + '">' + yt + '</span></span>' +
      '</div>' +
      '<div class="tf-actions">' +
        '<button type="button" class="btn btn-primary" id="tf-draw"' + (canAct && yt < T.TARGET ? '' : ' disabled') + '>Draw</button>' +
        '<button type="button" class="btn btn-outline" id="tf-stay"' + (canAct ? '' : ' disabled') + '>Stay</button>' +
      '</div>' +
      (state.demo ? '<div class="game-demo-bar"><span>Demo &middot; no money involved</span><button type="button" class="wl-link" id="demo-stop">End demo</button></div>' : '');
    var stopBtn = document.getElementById('demo-stop');
    if (stopBtn) stopBtn.addEventListener('click', endDemo);
    document.getElementById('tf-draw').addEventListener('click', draw);
    document.getElementById('tf-stay').addEventListener('click', stay);
  }

  function show(changes) { Object.keys(changes).forEach(function(k) { state.view[k] = changes[k]; }); renderGame(); }

  // The table starts empty; the opening cards are dealt one at a time
  async function dealIn(g) {
    state.view = { you: [], gnomie: [], newYou: null, newGnomie: null, stagger: 0, status: 'Dealing&hellip;' };
    renderGame();
    var order = [['you', g.you[0]], ['gnomie', g.gnomie[0]], ['you', g.you[1]]];
    for (var i = 0; i < order.length; i++) {
      await wait(i ? 520 : 380);
      if (!order[i][1]) continue;
      var side = order[i][0], hand = state.view[side].concat([order[i][1]]);
      var ch = { stagger: 0, newYou: null, newGnomie: null }; ch[side] = hand; ch[side === 'you' ? 'newYou' : 'newGnomie'] = hand.length - 1;
      show(ch);
    }
    for (var j = 1; j < g.gnomie.length; j++) { await wait(420); var gh = state.view.gnomie.concat([g.gnomie[j]]); show({ gnomie: gh, newGnomie: gh.length - 1, newYou: null }); }
    await wait(450);
    state.busy = false;
    show({ newYou: null, newGnomie: null, status: statusFor(total(g.you)) });
  }

  async function draw() {
    if (state.busy) return;
    state.busy = true;
    show({ status: 'Drawing…', newYou: null, newGnomie: null });
    try {
      var res = await G.api.tooFarDraw();
      var you = state.view.you.concat([res.card]);
      await wait(250);
      if (res.result && res.result.outcome === 'bust') {
        show({ you: you, newYou: you.length - 1, stagger: 0, status: 'You drew ' + aOrAn(res.card.v) + '… that&rsquo;s ' + total(you) + '. Bust!' });
        document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
        await wait(500);
        splat();
        await wait(1500);
        return finish(res.result);
      }
      show({ you: you, newYou: you.length - 1, newGnomie: null, stagger: 0, status: 'You drew ' + aOrAn(res.card.v) + '. That&rsquo;s ' + total(you) + '.' });
      await wait(900);
      // Gnomie's turn
      var t = res.gnomie || {};
      if (t.already) {
        show({ newYou: null, status: 'Gnomie is staying on ' + total(state.view.gnomie) + '.' });
        await wait(700);
      } else if (t.card) {
        show({ newYou: null, status: 'Gnomie&rsquo;s turn&hellip;' });
        await wait(600);
        var gh = state.view.gnomie.concat([t.card]);
        show({ gnomie: gh, newGnomie: gh.length - 1, status: 'Gnomie draws ' + aOrAn(t.card.v) + '. She has ' + total(gh) + (total(gh) > T.TARGET ? '!' : '.') + (t.stayed ? ' She&rsquo;ll stay there.' : '') });
        await wait(1000);
      } else if (t.stayed) {
        show({ newYou: null, status: 'Gnomie&rsquo;s turn&hellip; she stays on ' + total(state.view.gnomie) + '.' });
        await wait(1100);
      }
      if (res.result) { // Gnomie went over
        document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
        return finish(res.result);
      }
      state.game = res.game;
      state.busy = false;
      show({ newYou: null, newGnomie: null, gnomieStayed: res.game.gnomieStayed, status: statusFor(total(you), res.game.gnomieStayed) });
    } catch (x) { state.busy = false; show({ status: x.message }); }
  }

  async function stay() {
    if (state.busy) return;
    state.busy = true;
    show({ status: 'You stay on ' + total(state.view.you) + '.' + (state.view.gnomieStayed ? '' : ' Gnomie keeps playing&hellip;'), newYou: null, newGnomie: null });
    try {
      var res = await G.api.tooFarStay();
      var gnomie = state.view.gnomie.slice();
      await wait(700);
      for (var i = 0; i < res.gnomieDrew.length; i++) {
        gnomie = gnomie.concat([res.gnomieDrew[i]]);
        show({ gnomie: gnomie, newGnomie: gnomie.length - 1, stagger: 0, status: 'Gnomie draws ' + aOrAn(res.gnomieDrew[i].v) + '…' });
        await wait(800);
      }
      var gt = total(gnomie);
      show({ newGnomie: null, status: gt > T.TARGET ? 'Gnomie went over with ' + gt + '!' : 'Gnomie stays on ' + gt + '.' });
      document.dispatchEvent(new CustomEvent('wallet:change', { detail: res.wallet }));
      await wait(1100);
      finish(res.result);
    } catch (x) { state.busy = false; show({ status: x.message }); }
  }

  function finish(result) {
    state.finalView = { you: state.view.you, gnomie: state.view.gnomie };
    var oc = result.outcome;
    if (oc !== 'bust') G.celebrate(oc === 'win' || oc === 'gnomie_bust' ? 'win' : oc === 'tie' ? 'tie' : 'lose',
      oc === 'win' ? 'You Won!' : oc === 'gnomie_bust' ? 'Gnomie Busted!' : oc === 'tie' ? 'Tie!' : 'Gnomie Wins!', money(-result.paidCents));
    state.result = result; state.game = null; state.view = null; state.busy = false;
    boards();
    render();
  }

  // 3) Result: the final hands stay on the table under the result
  function renderResult() {
    var r = state.result, fv = state.finalView;
    if (state.chosen == null) state.chosen = r.amount;
    var titles = { win: 'You Won!', gnomie_bust: 'Gnomie Busted!', tie: 'It&rsquo;s a tie', lose: 'Gnomie Won!', bust: 'Bust!' };
    var notes = {
      win: money(-r.paidCents),
      gnomie_bust: 'She went over ' + T.TARGET + ', so you win: ' + money(-r.paidCents),
      tie: 'Half a win each: ' + money(-r.paidCents),
      lose: 'Double: ' + money(-r.paidCents),
      bust: 'You went over ' + T.TARGET + ', so it&rsquo;s 2.5&times;: ' + money(-r.paidCents)
    };
    var cls = r.outcome === 'gnomie_bust' ? 'win' : r.outcome === 'bust' ? 'lose' : r.outcome;
    root.innerHTML =
      '<div class="duel-result duel-result-' + cls + '">' +
        '<h2 class="duel-result-title">' + titles[r.outcome] + '</h2>' +
        '<p class="duel-result-score">You <strong>' + r.you + '</strong> &middot; Gnomie <strong>' + (r.outcome === 'bust' ? '&ndash;' : r.gnomie) + '</strong></p>' +
        '<p class="duel-result-pay">' + notes[r.outcome] + '</p>' +
      '</div>' +
      (fv ?
        '<div class="game-final">' +
          '<div class="tf-side tf-side-gnomie"><span class="duel-who"><img class="duel-pfp" src="' + PFP + '" alt="" /><span class="duel-name">Gnomie</span><span class="duel-total' + (total(fv.gnomie) > T.TARGET ? ' tf-over' : '') + '">' + total(fv.gnomie) + '</span></span>' + handHTML(fv.gnomie) + '</div>' +
          '<p class="duel-status-line">Final hands</p>' +
          '<div class="tf-side tf-side-you">' + handHTML(fv.you) + '<span class="duel-who"><span class="duel-name">You</span><span class="duel-total' + (total(fv.you) > T.TARGET ? ' tf-over' : '') + '">' + total(fv.you) + '</span></span></div>' +
        '</div>' : '') +
      '<div class="duel-result-actions">' +
        '<button type="button" class="btn btn-primary" id="tf-again">Clear Board &amp; Play Again</button>' +
        '<a class="btn btn-outline" href="games.html">All Games</a>' +
      '</div>';
    document.getElementById('tf-again').addEventListener('click', function() {
      state.result = null; state.finalView = null; render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- "Too far!" splatter: a big cartoon splash that drips away ----------
  function splat() {
    var old = document.querySelector('.tf-splat'); if (old) old.remove();
    // Irregular splash: a lumpy middle, streaks flying outward, droplets, then drips
    var R = function(lo, hi) { return lo + Math.random() * (hi - lo); };
    var shapes = '', d = 0;
    for (var i = 0; i < 9; i++) { // lumpy middle
      var a = R(0, Math.PI * 2), dist = R(0, 9);
      shapes += '<circle cx="' + (50 + Math.cos(a) * dist).toFixed(1) + '" cy="' + (48 + Math.sin(a) * dist * 0.8).toFixed(1) + '" r="' + R(7, 13).toFixed(1) + '" style="animation-delay:' + (d += 10) + 'ms" />';
    }
    for (var k = 0; k < 16; k++) { // streaks pointing outward
      var ang = (k / 16) * Math.PI * 2 + R(-0.15, 0.15), r1 = R(15, 27), len = R(5, 13);
      var cx = 50 + Math.cos(ang) * (r1 + len / 2), cy = 48 + Math.sin(ang) * (r1 + len / 2) * 0.85;
      shapes += '<g transform="rotate(' + (ang * 180 / Math.PI).toFixed(0) + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')"><ellipse cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (len / 2).toFixed(1) + '" ry="' + R(1.1, 2.6).toFixed(1) + '" style="animation-delay:' + (d += 12) + 'ms" /></g>';
    }
    for (var m = 0; m < 26; m++) { // droplets flung further out
      var ang2 = R(0, Math.PI * 2), r2 = R(24, 46);
      shapes += '<circle cx="' + (50 + Math.cos(ang2) * r2).toFixed(1) + '" cy="' + (48 + Math.sin(ang2) * r2 * 0.85).toFixed(1) + '" r="' + R(0.6, 2.6).toFixed(1) + '" style="animation-delay:' + (d += 6) + 'ms" />';
    }
    var drips = '';
    for (var n = 0; n < 7; n++) { // drips running down from the bottom edge
      var x = R(38, 62), y = R(52, 58), h = R(10, 34);
      drips += '<rect class="drip" x="' + (x - 1.3).toFixed(1) + '" y="' + y.toFixed(1) + '" width="2.6" height="' + h.toFixed(1) + '" rx="1.3" style="animation-delay:' + (360 + n * 80) + 'ms" />' +
               '<circle class="drip-end" cx="' + x.toFixed(1) + '" cy="' + (y + h).toFixed(1) + '" r="2.1" style="animation-delay:' + (360 + n * 80) + 'ms" />';
    }
    var shine = '<g transform="rotate(-25 44 41)"><ellipse class="shine" cx="44" cy="41" rx="6" ry="2.6" /></g>';
    var el = document.createElement('div');
    el.className = 'tf-splat';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><g class="goo">' + shapes + drips + '</g>' + shine + '</svg><span class="tf-splat-word">BUST!</span>';
    document.body.appendChild(el);
    setTimeout(function() { el.classList.add('fade'); }, 2300);
    setTimeout(function() { el.remove(); }, 3100);
  }

  // ---------- demo: a pretend hand with captions ----------
  var demoRun = 0;
  function endDemo() { demoRun++; state.demo = false; state.game = null; state.view = null; state.busy = false; render(); }
  async function runDemo() {
    var run = ++demoRun;
    state.demo = true; state.busy = true; state.result = null;
    state.game = { amount: state.chosen || 100 };
    state.view = { you: [], gnomie: [], newYou: null, newGnomie: null, stagger: 0, status: '' };
    var C = function(v) { return { v: v }; };
    var steps = [
      [{ status: 'You and Gnomie are dealt cards numbered 1 to 11.' }, 1600],
      [{ you: [C(9)], newYou: 0 }, 550], [{ gnomie: [C(7)], newGnomie: 0, newYou: null }, 550], [{ you: [C(9), C(8)], newYou: 1, newGnomie: null }, 900],
      [{ newYou: null, status: 'You have 17. Get as close to <strong>31</strong> as you can without going over.' }, 2600],
      [{ status: 'You take turns. Press <strong>Draw</strong> for another card&hellip;' }, 1600],
      [{ you: [C(9), C(8), C(6)], newYou: 2, status: 'You drew a 6. That&rsquo;s 23.' }, 1500],
      [{ gnomie: [C(7), C(10)], newGnomie: 1, newYou: null, status: 'Then Gnomie takes her turn: she draws a 10.' }, 1900],
      [{ you: [C(9), C(8), C(6), C(5)], newYou: 3, newGnomie: null, status: 'Your turn again: a 5. That&rsquo;s 28!' }, 1700],
      [{ gnomie: [C(7), C(10), C(4)], newGnomie: 2, newYou: null, status: 'Gnomie draws a 4. She has 21&hellip;' }, 1700],
      [{ newGnomie: null, status: 'Close enough. Press <strong>Stay</strong>, and Gnomie keeps playing by her own rule.' }, 2400],
      [{ gnomie: [C(7), C(10), C(4), C(8)], newGnomie: 3, status: 'Gnomie stops on 29. Closer to 31 wins, so she wins this one.' }, 2800],
      [{ newGnomie: null, status: 'If YOU go over 31, you <strong>bust</strong>, and you lose the most&hellip;' }, 2000],
      ['splat', 2600],
      [{ status: 'That&rsquo;s it! Pick an amount to play for real.' }, 2000]
    ];
    for (var i = 0; i < steps.length; i++) {
      if (run !== demoRun) return;
      if (steps[i][0] === 'splat') splat(); else show(steps[i][0]);
      await wait(steps[i][1]);
    }
    if (run === demoRun) endDemo();
  }
})();
