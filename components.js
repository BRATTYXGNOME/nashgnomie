// ==========================================
// NASH | Gnomie — Shared Components
// Nav, Footer, Stars, Mobile Drawer, Contact Popup, Age Gate System
// Include on every page: <script src="components.js"></script>
// ==========================================

(function() {

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

    // Returns { success: true } or { success: false, reason: 'underage'|'mismatch' }
    verify: function(dob) {
      if (this.calculateAge(dob) < 18) {
        return { success: false, reason: 'underage' };
      }
      var stored = this.getStoredDOB();
      if (stored && stored !== dob) {
        this.clearDOB();
        return { success: false, reason: 'mismatch' };
      }
      if (!stored) {
        this.storeDOB(dob);
      }
      return { success: true };
    },

    // Homepage always resets DOB
    verifyHomepage: function(dob) {
      if (this.calculateAge(dob) < 18) {
        return { success: false, reason: 'underage' };
      }
      this.storeDOB(dob);
      return { success: true };
    },

    // Redirect to homepage with mismatch warning
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
        '<a href="#" id="contact-btn">Contact</a>' +
        '<a href="links.html">Links</a>' +
        '<a href="gallery.html">Gallery</a>' +
        '<a href="adopt-a-bill.html">Adopt a Bill</a>' +
        '<div class="nav-dropdown">' +
          '<a href="#" class="nav-dropdown-toggle">Services &#9662;</a>' +
          '<div class="nav-dropdown-menu">' +
            '<a href="coming-soon.html">Menu</a>' +
            '<a href="coming-soon.html">Shop</a>' +
            '<a href="coming-soon.html">Girlfriend Experience</a>' +
            '<a href="coming-soon.html">Domme Experience</a>' +
            '<a href="adopt-a-bill.html#reimbursement">Reimbursement Opportunities</a>' +
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
      '<a href="#" id="drawer-contact-btn">Contact</a>' +
      '<a href="links.html">Links</a>' +
      '<a href="gallery.html">Gallery</a>' +
      '<a href="adopt-a-bill.html">Adopt a Bill</a>' +
      '<a href="#" class="drawer-services-toggle" id="drawer-services-toggle">Services &#9662;</a>' +
      '<div class="drawer-services-sub" id="drawer-services-sub">' +
        '<a href="coming-soon.html">Menu</a>' +
        '<a href="coming-soon.html">Shop</a>' +
        '<a href="coming-soon.html">Girlfriend Experience</a>' +
        '<a href="coming-soon.html">Domme Experience</a>' +
        '<a href="adopt-a-bill.html#reimbursement">Reimbursement Opportunities</a>' +
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
          '<a href="https://t.me/nashgnomie" class="contact-featured" target="_blank" rel="noopener">' +
            'Telegram DM' +
            '<span class="contact-featured-sub">&#9733; Preferred method</span>' +
          '</a>' +
          '<p class="contact-dm-note"><em>Free to DM but users will be expected to spend money for my time.</em></p>' +
          '<a href="https://www.sextpanther.com/brattyxgnome" target="_blank" rel="noopener">SextPanther</a>' +
          '<a href="https://www.loyalfans.com/BrattyGnomie?ref=EsDvOGi-2BVwTKmTpvB-2FcuG-2BwZDrhfpPSPcEVnVrP3OyU" target="_blank" rel="noopener">LoyalFans</a>' +
          '<a href="https://fans.ly/brattyxgnome/t2" target="_blank" rel="noopener">Fansly</a>' +
        '</div>' +
        '<div class="contact-notice">' +
          '<strong>More money = more motivation.</strong> My time goes where the money flows.' +
        '</div>' +
      '</div>';
    return div;
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

    function openContactPopup() {
      contactOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      if (window.closeDrawer) window.closeDrawer();
    }

    function closeContactPopup() {
      contactOverlay.classList.remove('active');
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
    if (!isHomepage) {
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

    initDrawer();
    initContactPopup();
  });
})();