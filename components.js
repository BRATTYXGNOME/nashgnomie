// ==========================================
// NASH | Gnomie — Shared Components
// Nav, Footer, Stars, Mobile Drawer, Contact Popup, Age Gate System
// Include on every page: <script src="components.js"></script>
// ==========================================

(function() {

  // ==========================================
  // NASH'S BIRTHDAY / LIVE AGE
  // Any element with data-nash-age shows the current age, worked out from
  // the birthdate below using West Coast (Pacific) time. No manual updates.
  // ==========================================
  window.NashBirthday = {
    YEAR: 1993, MONTH: 8, DAY: 31,
    TIME_ZONE: 'America/Los_Angeles',

    // Today's date in Pacific time as { y, m, d } (m is 1-12)
    today: function() {
      var now = new Date();
      try {
        var parts = new Intl.DateTimeFormat('en-US', {
          timeZone: this.TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric'
        }).formatToParts(now);
        var out = {};
        parts.forEach(function(p) { if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10); });
        return { y: out.year, m: out.month, d: out.day };
      } catch (e) {
        return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
      }
    },

    age: function() {
      var t = this.today();
      var a = t.y - this.YEAR;
      if (t.m < this.MONTH || (t.m === this.MONTH && t.d < this.DAY)) a--;
      return a;
    },

    render: function() {
      var a = String(this.age());
      document.querySelectorAll('[data-nash-age]').forEach(function(el) { el.textContent = a; });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.NashBirthday.render(); });
  } else {
    window.NashBirthday.render();
  }
  // Keeps it right if someone has the page open over midnight on the birthday
  setInterval(function() { window.NashBirthday.render(); }, 60000);

  // ==========================================
  // PAYMENT OPTIONS (shared by Tip, Adopt a Bill & Reimburse popups)
  // PaymentOptions.render(container, { youpay: url, throne: url })
  // Fee-based options (YouPay, Throne) come first with a fee note,
  // then a "No Fees" divider and everything else.
  // ==========================================
  window.PaymentOptions = {
    THRONE_DEFAULT: 'https://throne.com/nashgnomie',
    YOUPAY_DEFAULT: 'https://youpay.me/NashGnomie',
    EMAIL: 'nashgnomie@gmail.com',
    CASHTAG: '$pewpewser',

    render: function(container, opts) {
      opts = opts || {};
      var self = this;
      container.innerHTML = '';

      function link(label, url, note) {
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = label;
        if (note) {
          var sub = document.createElement('span');
          sub.className = 'pay-fee-note';
          sub.textContent = '✦ ' + note;
          a.appendChild(sub);
        }
        container.appendChild(a);
      }

      function copy(label, value) {
        var div = document.createElement('div');
        div.className = 'copy-badge';
        div.innerHTML = '<span class="copy-badge-label"></span><span class="copy-badge-value"></span>';
        div.querySelector('.copy-badge-label').textContent = label;
        var valEl = div.querySelector('.copy-badge-value');
        valEl.textContent = value;
        div.addEventListener('click', function() {
          navigator.clipboard.writeText(value).then(function() {
            valEl.textContent = 'Copied!'; div.classList.add('copied');
            setTimeout(function() { valEl.textContent = value; div.classList.remove('copied'); }, 1200);
          });
        });
        container.appendChild(div);
      }

      link('YouPay', opts.youpay || self.YOUPAY_DEFAULT, 'Fees added at checkout · I get listed price');
      link('Throne', opts.throne || self.THRONE_DEFAULT, 'Price includes fees · I get listed price');

      var divider = document.createElement('div');
      divider.className = 'pay-divider';
      divider.textContent = '✦ No Fees ✦';
      container.appendChild(divider);

      link('Revolut', 'https://revolut.me/nashgnomie');
      link('Cash App', 'https://cash.app/' + self.CASHTAG);
      copy('Cashtag', self.CASHTAG);
      copy('Apple Pay', self.EMAIL);
      copy('Zelle', self.EMAIL);
    }
  };

  // ==========================================
  // UNCENSORED TELEGRAM OFFER (rotating sale, per visitor)
  // From a visitor's first visit: 7 days at the sale price, then 7 days at
  // full price, repeating. The start time is saved in their browser, so a
  // private window or cleared site data starts a fresh sale week.
  // ==========================================
  var DAY_MS = 24 * 60 * 60 * 1000;

  window.UncensoredOffer = {
    START_KEY: 'nashgnomie_tg_offer_start',
    CYCLE_DAYS: 7,
    SCREENING_ROOM: 'https://t.me/+jhttLu-S1U5iZTBh',
    SALE: {
      price: 175,
      youpay: 'https://youpay.me/NashGnomie/gift/1402556',
      throne: 'https://throne.com/nashgnomie/item/72599ca6-f056-4b94-834d-94f281151507'
    },
    FULL: {
      price: 350,
      youpay: 'https://youpay.me/NashGnomie/gift/1402574',
      throne: 'https://throne.com/nashgnomie/item/ab4e485a-6914-4346-b5c5-92152e9fa44b'
    },

    startTime: function() {
      var now = Date.now();
      try {
        var saved = parseInt(localStorage.getItem(this.START_KEY), 10);
        if (saved && saved <= now) return saved;
        localStorage.setItem(this.START_KEY, String(now));
      } catch (e) { /* storage blocked: treat this visit as day 1 */ }
      return now;
    },

    // { onSale, price, links, msLeft } where msLeft counts down to the next switch
    current: function() {
      var cycle = this.CYCLE_DAYS * DAY_MS;
      var elapsed = Date.now() - this.startTime();
      var onSale = Math.floor(elapsed / cycle) % 2 === 0;
      var plan = onSale ? this.SALE : this.FULL;
      return { onSale: onSale, price: plan.price, plan: plan, msLeft: cycle - (elapsed % cycle) };
    },

    formatLeft: function(ms) {
      var s = Math.max(0, Math.floor(ms / 1000));
      var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
      function pad(n) { return (n < 10 ? '0' : '') + n; }
      return (d ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm ' + pad(sec) + 's';
    }
  };

  // ==========================================
  // AGE GATE SYSTEM (shared across all pages)
  // ==========================================
  window.AgeGate = {
    STORAGE_KEY: 'nashgnomie_dob',
    SESSION_KEY: 'nashgnomie_verified',

    getStoredDOB: function() {
      return localStorage.getItem(this.STORAGE_KEY);
    },

    storeDOB: function(dob) {
      localStorage.setItem(this.STORAGE_KEY, dob);
    },

    clearDOB: function() {
      localStorage.removeItem(this.STORAGE_KEY);
    },

    setVerified: function() {
      sessionStorage.setItem(this.SESSION_KEY, 'true');
    },

    isVerified: function() {
      return sessionStorage.getItem(this.SESSION_KEY) === 'true';
    },

    clearSession: function() {
      sessionStorage.removeItem(this.SESSION_KEY);
    },

    calculateAge: function(dob) {
      var birth = new Date(dob);
      var today = new Date();
      var age = today.getFullYear() - birth.getFullYear();
      var m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
      return age;
    },

    // The FIRST birthdate someone enters is locked in (even if it's under 18).
    // Every gate after that, on every page, must get that exact same date.
    // Returns { success: true } or { success: false, reason: 'underage'|'mismatch' }
    verify: function(dob) {
      var stored = this.getStoredDOB();
      if (stored && stored !== dob) {
        return { success: false, reason: 'mismatch' };
      }
      if (!stored) {
        this.storeDOB(dob);
      }
      if (this.calculateAge(dob) < 18) {
        return { success: false, reason: 'underage' };
      }
      return { success: true };
    },

    // Kept so older code keeps working; the homepage follows the same rule now
    verifyHomepage: function(dob) {
      return this.verify(dob);
    },

    UNDERAGE_MSG: 'You must be 18 or older to access this content.',

    // Call after a failed verify(): a mismatch never locks anyone out (typos
    // happen), it starts them over at the homepage's first birthdate screen.
    // Under 18 just shows the message in errorEl.
    handleFailure: function(result, errorEl) {
      if (!result || result.success) return;
      if (result.reason === 'mismatch') {
        this.redirectMismatch();
      } else if (errorEl) {
        errorEl.textContent = this.UNDERAGE_MSG;
      }
    },

    // Forget the saved date and go back to the homepage gate with a warning
    redirectMismatch: function() {
      this.clearDOB();
      this.clearSession();
      window.location.href = 'index.html?warning=dob_mismatch';
    }
  };

  // ==========================================
  // NAV
  // ==========================================
  function buildNav() {
    var nav = document.createElement('nav');
    nav.className = 'main-nav';
    nav.id = 'main-nav';
    nav.innerHTML = 
      '<a href="index.html" class="nav-logo">NASH | Gnomie</a>' +
      '<div class="nav-links">' +
        '<a href="index.html">Home</a>' +
        '<a href="#" id="contact-btn" class="age-gated" data-age-action="contact">Contact</a>' +
        '<a href="links.html">Links</a>' +
        '<a href="gallery.html">Gallery</a>' +
        '<div class="nav-dropdown">' +
          '<a href="#" class="nav-dropdown-toggle">Expenses &#9662;</a>' +
          '<div class="nav-dropdown-menu">' +
            '<a href="adopt-a-bill.html">Adopt a Bill</a>' +
            '<a href="adopt-a-bill.html#reimbursement">Reimburse Me</a>' +
          '</div>' +
        '</div>' +
        '<div class="nav-dropdown">' +
          '<a href="#" class="nav-dropdown-toggle">Services &#9662;</a>' +
          '<div class="nav-dropdown-menu">' +
            '<a href="coming-soon.html">Menu</a>' +
            '<a href="coming-soon.html">Shop</a>' +
            '<a href="coming-soon.html">Girlfriend Experience</a>' +
            '<a href="coming-soon.html">Domme Experience</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="nav-hamburger" id="nav-hamburger" aria-label="Menu">' +
        '<span></span><span></span><span></span>' +
      '</button>';
    return nav;
  }

  // ==========================================
  // MOBILE DRAWER
  // ==========================================
  function buildDrawer() {
    var overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    overlay.id = 'nav-overlay';

    var drawer = document.createElement('div');
    drawer.className = 'nav-drawer';
    drawer.id = 'nav-drawer';
    drawer.innerHTML = 
      '<button class="nav-drawer-close" id="nav-drawer-close" aria-label="Close">&times;</button>' +
      '<a href="index.html">Home</a>' +
      '<a href="#" id="drawer-contact-btn" class="age-gated" data-age-action="contact">Contact</a>' +
      '<a href="links.html">Links</a>' +
      '<a href="gallery.html">Gallery</a>' +
      '<a href="#" class="drawer-services-toggle" id="drawer-expenses-toggle">Expenses &#9662;</a>' +
      '<div class="drawer-services-sub" id="drawer-expenses-sub">' +
        '<a href="adopt-a-bill.html">Adopt a Bill</a>' +
        '<a href="adopt-a-bill.html#reimbursement">Reimburse Me</a>' +
      '</div>' +
      '<a href="#" class="drawer-services-toggle" id="drawer-services-toggle">Services &#9662;</a>' +
      '<div class="drawer-services-sub" id="drawer-services-sub">' +
        '<a href="coming-soon.html">Menu</a>' +
        '<a href="coming-soon.html">Shop</a>' +
        '<a href="coming-soon.html">Girlfriend Experience</a>' +
        '<a href="coming-soon.html">Domme Experience</a>' +
      '</div>';

    return { overlay: overlay, drawer: drawer };
  }

  // ==========================================
  // FOOTER
  // ==========================================
  function buildFooter() {
    var footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = '<p>&copy; 2011 - Present &bull; NASH | Gnomie &bull; 18+ ONLY!</p>';
    return footer;
  }

  // ==========================================
  // CONTACT POPUP
  // ==========================================
  function buildContactPopup() {
    var div = document.createElement('div');
    div.id = 'contact-popup-overlay';
    div.className = 'modal-overlay';
    div.innerHTML = 
      '<div class="modal">' +
        '<button class="modal-close" id="contact-popup-close" aria-label="Close">&times;</button>' +
        '<div class="modal-title">Contact Me</div>' +
        '<div class="modal-desc">Choose your preferred way to reach me!</div>' +
        '<div class="modal-links">' +
          '<a href="https://t.me/nashgnomie" class="contact-featured contact-age-link" target="_blank" rel="noopener">' +
            'Telegram DM' +
            '<span class="contact-featured-sub">&#9733; Preferred method</span>' +
          '</a>' +
          '<p class="contact-dm-note"><em>Free to DM but users will be expected to spend money for my time.</em></p>' +
          '<a href="https://www.sextpanther.com/brattyxgnome" class="contact-age-link" target="_blank" rel="noopener">SextPanther</a>' +
          '<a href="https://www.loyalfans.com/BrattyGnomie?ref=EsDvOGi-2BVwTKmTpvB-2FcuG-2BwZDrhfpPSPcEVnVrP3OyU" class="contact-age-link" target="_blank" rel="noopener">LoyalFans</a>' +
          '<a href="https://fans.ly/brattyxgnome/t2" class="contact-age-link" target="_blank" rel="noopener">Fansly</a>' +
        '</div>' +
        '<div class="contact-notice">' +
          '<strong>More money = more motivation.</strong> My time goes where the money flows.' +
        '</div>' +
      '</div>';
    return div;
  }

  // ==========================================
  // SHARED AGE VERIFICATION MODAL (for contact popup + any page)
  // ==========================================
  function buildAgeVerifyModal() {
    var div = document.createElement('div');
    div.id = 'shared-age-overlay';
    div.className = 'modal-overlay';
    div.innerHTML =
      '<div class="modal">' +
        '<button class="modal-close" id="shared-age-close" aria-label="Close">&times;</button>' +
        '<div class="modal-title">Age Verification Required</div>' +
        '<div class="modal-desc" id="shared-age-desc"></div>' +
        '<form id="shared-age-form" autocomplete="off" style="display:flex;flex-direction:column;align-items:center;gap:8px;">' +
          '<input type="date" id="shared-age-bd" name="birthdate" required style="width:100%;max-width:240px;padding:10px 14px;background:var(--bg-card);border:1px solid var(--accent-border);border-radius:var(--radius);color:var(--text-light);font-size:14px;font-family:var(--font-body);" />' +
          '<div id="shared-age-error" class="age-error" aria-live="polite"></div>' +
          '<button type="submit" class="btn btn-primary" style="width:100%;max-width:240px;">Continue</button>' +
        '</form>' +
      '</div>';
    return div;
  }

  // ==========================================
  // UNCENSORED TELEGRAM POPUP
  // Opened (after the 18+ check) by anything with data-age-action="uncensored"
  // ==========================================
  function buildUncensoredPopup() {
    var div = document.createElement('div');
    div.id = 'uncensored-overlay';
    div.className = 'modal-overlay';
    div.innerHTML =
      '<div class="modal uncensored-modal" role="dialog" aria-modal="true" aria-labelledby="uncensored-title">' +
        '<button class="modal-close" id="uncensored-close" aria-label="Close">&times;</button>' +
        '<div class="uncensored-kicker">&#128520; Uncensored Telegram</div>' +
        '<div class="modal-title" id="uncensored-title">Lifetime Access</div>' +
        '<div class="uncensored-price" id="uncensored-price"></div>' +
        '<div class="uncensored-timer" id="uncensored-timer"></div>' +
        '<ul class="uncensored-perks">' +
          '<li><strong>Pay once, keep forever</strong> &middot; no monthly fees</li>' +
          '<li><strong>New content first</strong> &middot; plus exclusives</li>' +
          '<li><strong>Fastest line to me</strong> &middot; members get replies first</li>' +
          '<li><strong>Spoil me when YOU want</strong> &middot; $15 minimum</li>' +
        '</ul>' +
        '<div class="uncensored-tagline">Better than my OnlyFans!</div>' +
        '<div class="uncensored-steps">' +
          '<button type="button" class="uncensored-step" id="uncensored-pay-toggle" aria-expanded="false">' +
            '<span class="uncensored-step-num">1</span>' +
            '<span class="uncensored-step-text"><strong>Pay now</strong><small>Optional &middot; or chat with me first</small></span>' +
            '<span class="uncensored-step-arrow" aria-hidden="true">&#9662;</span>' +
          '</button>' +
          '<div class="uncensored-pay" id="uncensored-pay" hidden>' +
            '<p class="uncensored-note">&#10022; After you pay, join the &ldquo;Screening Room&rdquo; to verify payment!</p>' +
            '<div class="modal-links" id="uncensored-pay-links"></div>' +
          '</div>' +
          '<a class="uncensored-step uncensored-step-main" id="uncensored-join" target="_blank" rel="noopener">' +
            '<span class="uncensored-step-num">2</span>' +
            '<span class="uncensored-step-text"><strong>Join the screening room</strong><small>Everyone starts here &#12539; Answer the welcome questions immediately!</small></span>' +
            '<span class="uncensored-step-arrow" aria-hidden="true">&#8599;</span>' +
          '</a>' +
        '</div>' +
        '<p class="uncensored-fine">You must be 18 or older to purchase access to this content; 21 preferred. Lifetime access is for one Telegram account. Lose access &amp; you may be required to pay the full price to regain access. Honorable discounts may be given to individuals who have spent more than the access fee over time.</p>' +
      '</div>';
    return div;
  }

  function initUncensoredPopup() {
    var overlay = document.getElementById('uncensored-overlay');
    if (!overlay) return;
    var priceEl = document.getElementById('uncensored-price');
    var timerEl = document.getElementById('uncensored-timer');
    var payToggle = document.getElementById('uncensored-pay-toggle');
    var payBox = document.getElementById('uncensored-pay');
    var payLinks = document.getElementById('uncensored-pay-links');
    var tick = null, shownOnSale = null;

    document.getElementById('uncensored-join').href = window.UncensoredOffer.SCREENING_ROOM;

    function refresh() {
      var o = window.UncensoredOffer.current();
      if (o.onSale) {
        priceEl.innerHTML = '<s class="uncensored-was">$' + window.UncensoredOffer.FULL.price + '</s>' +
          '<span class="uncensored-now">$' + o.price + '</span>' +
          '<span class="uncensored-off">50% OFF</span>';
        timerEl.innerHTML = '&#9203; Deal ends in <strong>' + window.UncensoredOffer.formatLeft(o.msLeft) + '</strong>';
      } else {
        priceEl.innerHTML = '<span class="uncensored-now">$' + o.price + '</span><span class="uncensored-usd">USD</span>';
        timerEl.innerHTML = '&#9203; 50% off returns in <strong>' + window.UncensoredOffer.formatLeft(o.msLeft) + '</strong>';
      }
      timerEl.classList.toggle('is-sale', o.onSale);
      // Re-draw payment links only when the price changes (keeps "Copied!" states)
      if (shownOnSale !== o.onSale && window.PaymentOptions) {
        window.PaymentOptions.render(payLinks, { youpay: o.plan.youpay, throne: o.plan.throne });
        shownOnSale = o.onSale;
      }
    }

    function open() {
      refresh();
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      if (window.closeDrawer) window.closeDrawer();
      clearInterval(tick);
      tick = setInterval(refresh, 1000);
    }

    function close() {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
      clearInterval(tick);
    }

    payToggle.addEventListener('click', function() {
      var opening = payBox.hidden;
      payBox.hidden = !opening;
      payToggle.setAttribute('aria-expanded', String(opening));
      payToggle.classList.toggle('open', opening);
    });
    document.getElementById('uncensored-close').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && overlay.classList.contains('active')) close();
    });

    window.openUncensoredPopup = open;
  }

  // Ticker/menu links that open the offer say "50% OFF" only during the
  // visitor's sale week, so they never advertise a price that isn't running.
  function updateUncensoredLinks() {
    var links = document.querySelectorAll('[data-age-action="uncensored"][data-offer-text]');
    if (!links.length) return;
    var onSale = window.UncensoredOffer.current().onSale;
    links.forEach(function(a) {
      a.textContent = onSale
        ? '50% OFF LIFETIME ACCESS to my UNCENSORED Telegram channel (NO Monthly Fees)'
        : 'LIFETIME ACCESS to my UNCENSORED Telegram channel (NO Monthly Fees) • 50% off returns soon!';
    });
  }

  // ==========================================
  // TWINKLING STARS
  // ==========================================
  function buildStars() {
    var container = document.createElement('div');
    container.id = 'stars';
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden;';
    for (var i = 0; i < 50; i++) {
      var star = document.createElement('div');
      var size = Math.random() * 2 + 1;
      star.style.cssText = 
        'position:absolute;background:#fff;border-radius:50%;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'left:' + (Math.random() * 100) + 'vw;' +
        'top:' + (Math.random() * 100) + 'vh;' +
        'opacity:' + (Math.random() * 0.5 + 0.1) + ';';
      container.appendChild(star);
    }
    setInterval(function() {
      var stars = container.children;
      for (var j = 0; j < stars.length; j++) {
        stars[j].style.opacity = Math.random() * 0.5 + 0.05;
      }
    }, 1500);
    return container;
  }

  // ==========================================
  // DRAWER LOGIC
  // ==========================================
  function initDrawer() {
    var hamburger = document.getElementById('nav-hamburger');
    var drawer = document.getElementById('nav-drawer');
    var drawerClose = document.getElementById('nav-drawer-close');
    var navOverlay = document.getElementById('nav-overlay');

    function openDrawer() {
      drawer.classList.add('open');
      navOverlay.classList.add('open');
      hamburger.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      navOverlay.classList.remove('open');
      hamburger.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (hamburger) hamburger.addEventListener('click', openDrawer);
    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
    if (navOverlay) navOverlay.addEventListener('click', closeDrawer);

    document.querySelectorAll('.drawer-close-link').forEach(function(link) {
      link.addEventListener('click', closeDrawer);
    });

    var expensesToggle = document.getElementById('drawer-expenses-toggle');
    var expensesSub = document.getElementById('drawer-expenses-sub');
    if (expensesToggle && expensesSub) {
      expensesToggle.addEventListener('click', function(e) {
        e.preventDefault();
        expensesSub.classList.toggle('open');
        expensesToggle.innerHTML = expensesSub.classList.contains('open') ? 'Expenses &#9652;' : 'Expenses &#9662;';
      });
    }

    var servicesToggle = document.getElementById('drawer-services-toggle');
    var servicesSub = document.getElementById('drawer-services-sub');
    if (servicesToggle && servicesSub) {
      servicesToggle.addEventListener('click', function(e) {
        e.preventDefault();
        servicesSub.classList.toggle('open');
        servicesToggle.innerHTML = servicesSub.classList.contains('open') ? 'Services &#9652;' : 'Services &#9662;';
      });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) closeDrawer();
    });

    window.closeDrawer = closeDrawer;
  }

  // ==========================================
  // CONTACT POPUP WIRING
  // ==========================================
  function initContactPopup() {
    var contactOverlay = document.getElementById('contact-popup-overlay');
    if (!contactOverlay) return;

    // ageOk: true when the visitor just passed an age gate to get here (DM ME),
    // so the links inside don't ask a second time.
    function openContactPopup(ageOk) {
      contactOverlay.classList.toggle('age-ok', ageOk === true);
      contactOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      if (window.closeDrawer) window.closeDrawer();
    }

    function closeContactPopup() {
      contactOverlay.classList.remove('active', 'age-ok');
      document.body.style.overflow = '';
    }

    var contactBtn = document.getElementById('contact-btn');
    var drawerContactBtn = document.getElementById('drawer-contact-btn');
    if (contactBtn) contactBtn.addEventListener('click', function(e) { e.preventDefault(); openContactPopup(); });
    if (drawerContactBtn) drawerContactBtn.addEventListener('click', function(e) { e.preventDefault(); openContactPopup(); });

    var closeBtn = document.getElementById('contact-popup-close');
    if (closeBtn) closeBtn.addEventListener('click', closeContactPopup);
    contactOverlay.addEventListener('click', function(e) { if (e.target === this) closeContactPopup(); });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && contactOverlay.classList.contains('active')) closeContactPopup();
    });

    window.openContactPopup = openContactPopup;
  }

  // ==========================================
  // INJECT ALL COMPONENTS
  // ==========================================
  document.addEventListener('DOMContentLoaded', function() {
    var navTarget = document.getElementById('nav-inject');
    var footerTarget = document.getElementById('footer-inject');
    var contactTarget = document.getElementById('contact-popup-inject');

    // Stars — NOT on homepage
    var isHomepage = window.location.pathname === '/' || 
                     window.location.pathname.endsWith('index.html') || 
                     window.location.pathname === '';
    if (!isHomepage && !document.getElementById('stars')) {
      document.body.insertBefore(buildStars(), document.body.firstChild);
    }

    // Nav
    if (navTarget) {
      var nav = buildNav();
      var drawerParts = buildDrawer();
      navTarget.parentNode.replaceChild(nav, navTarget);
      nav.after(drawerParts.overlay);
      drawerParts.overlay.after(drawerParts.drawer);
    }

    // Footer
    if (footerTarget) {
      footerTarget.parentNode.replaceChild(buildFooter(), footerTarget);
    }

    // Contact popup
    if (contactTarget) {
      contactTarget.parentNode.replaceChild(buildContactPopup(), contactTarget);
    }

    // Shared age verification modal
    document.body.appendChild(buildAgeVerifyModal());

    // Uncensored Telegram offer popup
    document.body.appendChild(buildUncensoredPopup());

    initDrawer();
    initContactPopup();
    initUncensoredPopup();
    updateUncensoredLinks();
    initSharedAgeVerify();
  });

  // ==========================================
  // SHARED AGE VERIFICATION LOGIC
  // ==========================================
  function initSharedAgeVerify() {
    var overlay = document.getElementById('shared-age-overlay');
    var form = document.getElementById('shared-age-form');
    var bd = document.getElementById('shared-age-bd');
    var err = document.getElementById('shared-age-error');
    var closeBtn = document.getElementById('shared-age-close');
    // What to do once the birthdate checks out
    var pending = null; // { url, newTab } or { action: 'contact' }

    // Wording above the date box: DM gates vs. everything else
    var DM_TEXT = 'I prefer to chat with individuals 21 or older, but you must be 18+ to DM me. Please confirm your date of birth:';
    var DEFAULT_TEXT = 'This contains adult content (18+).<br />Please confirm your birthdate:';

    if (bd) bd.max = new Date().toISOString().split('T')[0];

    // Any link/button with .age-gated (or the contact popup's links) asks for a
    // birthdate first. data-age-action="contact" opens the Contact Me popup after.
    document.addEventListener('click', function(e) {
      var el = e.target.closest('.contact-age-link, .age-gated');
      if (!el) return;
      // Contact links skip a second check if the visitor came in through DM ME
      if (el.classList.contains('contact-age-link') && el.closest('.age-ok')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var desc = document.getElementById('shared-age-desc');
      var isDm = el.getAttribute('data-age-action') === 'contact' || /t\.me\/nashgnomie\/?$/.test(el.href || '');
      if (desc) {
        desc.innerHTML = isDm ? DM_TEXT : DEFAULT_TEXT;
        desc.classList.toggle('modal-desc-center', !isDm);
      }
      var action = el.getAttribute('data-age-action');
      if (action === 'contact' || action === 'uncensored') {
        pending = { action: action };
      } else {
        pending = { url: el.href, newTab: el.target === '_blank' || el.hostname !== location.hostname };
      }
      if (err) err.textContent = '';
      if (bd) bd.value = '';
      if (window.closeDrawer) window.closeDrawer(); // e.g. Contact tapped in the phone menu
      if (overlay) { overlay.classList.add('active'); document.body.style.overflow = 'hidden'; }
    }, true);

    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        err.textContent = '';
        if (!bd.value) { err.textContent = 'Please enter your birthdate.'; return; }
        var result = window.AgeGate.verify(bd.value);
        if (!result.success) {
          window.AgeGate.handleFailure(result, err);
          return;
        }
        var next = pending;
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        pending = null;
        if (!next) return;
        if (next.action === 'contact') {
          if (window.openContactPopup) window.openContactPopup(true);
        } else if (next.action === 'uncensored') {
          if (window.openUncensoredPopup) window.openUncensoredPopup();
        } else if (next.newTab) {
          window.open(next.url, '_blank', 'noopener');
        } else {
          window.location.href = next.url;
        }
      });
    }

    function closeSharedAge() {
      if (overlay) { overlay.classList.remove('active'); document.body.style.overflow = ''; }
      pending = null;
    }
    if (closeBtn) closeBtn.addEventListener('click', closeSharedAge);
    if (overlay) overlay.addEventListener('click', function(e) { if (e.target === this) closeSharedAge(); });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('active')) closeSharedAge();
    });
  }
})();
