// ==========================================
// STAR TWINKLING (Consolidated & Enhanced)
// ==========================================
function initStars() {
  if (document.querySelector('#stars .star')) return; // Already initialized
  
  const stars = document.getElementById('stars');
  if (!stars) return;
  
  // Create 180 stars for more twinkly effect
  for (let i = 0; i < 180; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    
    // Random positioning
    star.style.left = Math.random() * 100 + 'vw';
    star.style.top = Math.random() * 100 + 'vh';
    
    // Varied sizes (more variety = more depth)
    const size = Math.random() * 2.5 + 0.5; // 0.5px to 3px
    star.style.width = star.style.height = size + 'px';
    
    // Random initial opacity
    star.style.opacity = Math.random();
    
    // Base styles
    star.style.position = 'absolute';
    star.style.background = '#fff';
    star.style.borderRadius = '50%';
    star.style.boxShadow = '0 0 8px #ff5fa2, 0 0 12px #fff';
    
    // Varied animation duration (0.8s to 2s)
    star.style.transition = `opacity ${0.8 + Math.random() * 1.2}s ease-in-out`;
    
    stars.appendChild(star);
  }
  
  // Staggered twinkling effect
  setInterval(() => {
    document.querySelectorAll('#stars .star').forEach((star, index) => {
      // Stagger the updates so not all stars change at once
      setTimeout(() => {
        star.style.opacity = Math.random() * 0.8 + 0.2; // 0.2 to 1.0
      }, (index % 10) * 50); // Stagger by 50ms per group
    });
  }, 1200);
}

// ==========================================
// DOM READY
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  
  // Initialize stars
  initStars();
  
  // ==========================================
  // AGE GATE LOGIC
  // ==========================================
  const AGE_GATE_PASSED_KEY = 'nashgnomie_index_verified';
  const ageForm           = document.getElementById('age-form');
  const birthdateIn       = document.getElementById('birthdate');
  const ageError          = document.getElementById('age-error');
  const ageModal          = document.getElementById('age-modal');
  const ageInputContainer = document.getElementById('age-input-container');
  const underageBlock     = document.getElementById('underage-block');
  const mainNav           = document.getElementById('main-nav');
  const mainContent       = document.querySelector('main');

  // Check if user already passed age gate
  if (ageModal && localStorage.getItem(AGE_GATE_PASSED_KEY) === 'true') {
    ageModal.classList.remove('active');
    if (mainNav) mainNav.style.display = 'flex';
    if (mainContent) mainContent.style.display = 'block';
    document.body.style.overflow = '';
  }

  if (birthdateIn) {
    birthdateIn.max = new Date().toISOString().split('T')[0];
  }

  if (ageForm) {
    ageForm.addEventListener('submit', e => {
      e.preventDefault();
      ageError.textContent = '';
      
      if (!birthdateIn.value) {
        ageError.textContent = 'Please enter your birthdate.';
        return;
      }
      
      const birthdate = new Date(birthdateIn.value);
      const today     = new Date();
      let age = today.getFullYear() - birthdate.getFullYear();
      const m = today.getMonth() - birthdate.getMonth();
      
      if (m < 0 || (m === 0 && today.getDate() < birthdate.getDate())) {
        age--;
      }
      
      if (age < 18) {
        ageInputContainer.style.display = 'none';
        underageBlock.style.display     = 'block';
      } else {
        // User is 18+, let them in and remember it
        localStorage.setItem(AGE_GATE_PASSED_KEY, 'true');
        ageModal.classList.remove('active');
        if (mainNav) mainNav.style.display = 'flex';
        if (mainContent) mainContent.style.display = 'block';
        document.body.style.overflow = '';
      }
    });
  }

  // ==========================================
  // MOBILE NAV TOGGLE
  // ==========================================
  const mobileNavToggle = document.getElementById('mobile-nav-toggle');
  
  if (mobileNavToggle && mainNav) {
    mobileNavToggle.addEventListener('click', () => {
      mainNav.classList.toggle('mobile-open');
      mobileNavToggle.classList.toggle('active');
    });

    // Close mobile nav when clicking a link
    const navLinks = mainNav.querySelectorAll('a');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          mainNav.classList.remove('mobile-open');
          mobileNavToggle.classList.remove('active');
        }
      });
    });

    // Close mobile nav when clicking outside
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && 
          mainNav.classList.contains('mobile-open') && 
          !mainNav.contains(e.target) && 
          !mobileNavToggle.contains(e.target)) {
        mainNav.classList.remove('mobile-open');
        mobileNavToggle.classList.remove('active');
      }
    });
  }

  // ==========================================
  // TEASER MODAL LOGIC
  // ==========================================
  const teaserImages = [
    "https://i.ibb.co/8gB2XFxh/teaser001.gif",
    "https://i.ibb.co/MkncchXh/teaser003.jpg",
    "https://i.ibb.co/yFpXf6pG/teaser004.png",
    "https://i.ibb.co/4ZQ57dLG/teaser005.png",
    "https://i.ibb.co/8Dx5khhJ/teaser006.png",
    "https://i.ibb.co/j9QgVSzS/teaser007.jpg",
    "https://i.ibb.co/yBmVHkP4/teaser002.gif"
  ];
  
  const teaserThumbs      = document.querySelectorAll('.teaser-thumb');
  const teaserModal       = document.getElementById('teaser-modal');
  const teaserModalImg    = document.getElementById('teaser-modal-img');
  const teaserModalClose  = document.getElementById('teaser-modal-close');
  const teaserArrowLeft   = document.getElementById('teaser-arrow-left');
  const teaserArrowRight  = document.getElementById('teaser-arrow-right');
  const mainSiteContainer = document.getElementById('main-site-container');
  
  let currentTeaserIndex = 0;

  function openTeaserModal(index) {
    currentTeaserIndex = index;
    teaserModalImg.src = teaserImages[currentTeaserIndex];
    teaserModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (mainSiteContainer) mainSiteContainer.style.display = 'none';
  }

  function closeTeaserModal() {
    teaserModal.classList.remove('active');
    document.body.style.overflow = '';
    teaserModalImg.src = '';
    if (mainSiteContainer) mainSiteContainer.style.display = 'block';
  }

  function showPrevTeaser() {
    currentTeaserIndex = (currentTeaserIndex - 1 + teaserImages.length) % teaserImages.length;
    teaserModalImg.src = teaserImages[currentTeaserIndex];
  }

  function showNextTeaser() {
    currentTeaserIndex = (currentTeaserIndex + 1) % teaserImages.length;
    teaserModalImg.src = teaserImages[currentTeaserIndex];
  }

  // Click handlers
  teaserThumbs.forEach((img, idx) => {
    img.addEventListener('click', () => openTeaserModal(idx));
  });

  if (teaserModalClose) {
    teaserModalClose.addEventListener('click', closeTeaserModal);
  }

  if (teaserArrowLeft) {
    teaserArrowLeft.addEventListener('click', showPrevTeaser);
  }

  if (teaserArrowRight) {
    teaserArrowRight.addEventListener('click', showNextTeaser);
  }

  if (teaserModal) {
    teaserModal.addEventListener('click', e => {
      if (e.target === teaserModal) {
        closeTeaserModal();
      }
    });
  }

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!teaserModal || !teaserModal.classList.contains('active')) return;

    switch(e.key) {
      case 'Escape':
        closeTeaserModal();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        showPrevTeaser();
        break;
      case 'ArrowRight':
        e.preventDefault();
        showNextTeaser();
        break;
    }
  });

  // Touch swipe gestures for teaser modal
  let touchStartX = 0;
  let touchEndX = 0;
  const swipeThreshold = 75;

  if (teaserModal) {
    teaserModal.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    teaserModal.addEventListener('touchend', e => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    }, { passive: true });
  }

  function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;
    
    if (Math.abs(swipeDistance) < swipeThreshold) return;
    
    if (swipeDistance > 0) {
      showPrevTeaser();
    } else {
      showNextTeaser();
    }
  }

  // Prevent scroll when modal is open
  if (teaserModal) {
    teaserModal.addEventListener('wheel', e => {
      if (teaserModal.classList.contains('active')) {
        e.preventDefault();
      }
    }, { passive: false });

    teaserModal.addEventListener('touchmove', e => {
      if (teaserModal.classList.contains('active')) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  // ==========================================
  // TEASER GALLERY AGE GATE OVERLAY
  // ==========================================
  const galleryAgeGate = document.getElementById('gallery-age-gate');
  const galleryAgeConfirm = document.getElementById('gallery-age-confirm');
  
  if (galleryAgeGate && galleryAgeConfirm) {
    galleryAgeConfirm.addEventListener('click', function() {
      galleryAgeGate.style.display = 'none';
    });
  }

  // ==========================================
  // ADOPT A BILL / TIP ME POP-UP LOGIC
  // ==========================================
  const billPopupData = {
    rent: {
      title: 'Adopt: Rent',
      desc: 'Help cover my share of rent. Thank you for helping keep a roof over my head!',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000427" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/95d2dcb8-7e1b-4520-9449-bc43a1e48791" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l6t6-unbtkc" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    },
    utilities: {
      title: "Adopt: Utilities",
      desc: "Support electricity, water, internet, and extras.",
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000449" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/70f5146b-7d9f-4003-9439-7b456f88658c" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l6t6-unbtkc" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    },
    pet: {
      title: "Adopt: Pet Expenses",
      desc: "Food and care for 2 cats & 2 geckos.",
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000453" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/87ff0888-a476-490b-90ed-a36b0e050325" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l74c-1npsse8" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    },
    groceries: {
      title: "Adopt: Groceries",
      desc: "Food and pantry for one person.",
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000457" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/e4083dc8-1802-427d-bee8-999625a13d94" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l74u-1x6s1gj" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    },
    essentials: {
      title: "Adopt: Essentials",
      desc: "Toiletries, cleaning, and home supplies.",
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000460" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/6ec49a6c-1e04-4d19-bd65-addcd3c21bd5" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l751-o7b7jq" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    },
    phone: {
      title: "Adopt: Phone Bill",
      desc: "Mobile phone service & data.",
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000462" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/d2e95052-22c6-4f48-9951-bae90f869c88" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l75t-g6uwiw" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    },
    transportation: {
      title: "Adopt: Transportation",
      desc: "Bus pass & rideshare (e.g., Lyft).",
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000464" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/1076e82e-f3de-4f06-97ef-ec2702dfb8c3" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l768-1gsp6rd" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    },
    tip: {
      title: "💸 Tip Me",
      desc: "Send me a tip! Every bit of support is appreciated. Choose your preferred payment method:",
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "AllMyLinks", url: "https://allmylinks.com/nashgnomie" },
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@gmail.com" },
        { label: "Apple Pay", url: "nashgnomie@gmail.com" },
        { label: "Zelle", url: "nashgnomie@gmail.com" }
      ]
    }
  };

  function showBillPopup(billKey) {
    const overlay = document.getElementById('bill-popup-overlay');
    const title = overlay.querySelector('.bill-popup-title');
    const desc = overlay.querySelector('.bill-popup-desc');
    const links = overlay.querySelector('.bill-popup-links');
    const data = billPopupData[billKey];
    if (!data) return;

    title.textContent = data.title;
    desc.textContent = data.desc;
    links.innerHTML = "";
    
    data.links.forEach(link => {
      if (link.label === "Chime") {
        const span = document.createElement('span');
        span.className = "copy-cashtag";
        span.textContent = link.url;
        span.setAttribute('data-cashtag', link.url);
        span.title = "Click to copy";
        span.onclick = function() {
          navigator.clipboard.writeText(link.url);
          span.textContent = "Copied!";
          span.classList.add('copied');
          setTimeout(() => {
            span.textContent = link.url;
            span.classList.remove('copied');
          }, 1200);
        };
        const div = document.createElement('div');
        div.appendChild(document.createTextNode("Chime: "));
        div.appendChild(span);
        links.appendChild(div);
      } else if (
        link.label === "Amazon Gift Card" ||
        link.label === "Apple Pay" ||
        link.label === "Zelle"
      ) {
        const span = document.createElement('span');
        span.className = "copy-cashtag copy-email";
        span.textContent = link.url;
        span.setAttribute('data-email', link.url);
        span.title = "Click to copy";
        span.onclick = function() {
          navigator.clipboard.writeText(link.url);
          span.textContent = "Copied!";
          span.classList.add('copied');
          setTimeout(() => {
            span.textContent = link.url;
            span.classList.remove('copied');
          }, 1200);
        };
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(link.label + ": "));
        div.appendChild(span);
        links.appendChild(div);
      } else {
        const a = document.createElement('a');
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = link.label;
        links.appendChild(a);
      }
    });

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeBillPopup() {
    const overlay = document.getElementById('bill-popup-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // Bill table row click handlers
  document.querySelectorAll('.bill-table tbody tr[data-bill]').forEach(row => {
    row.style.cursor = "pointer";
    row.addEventListener('click', function() {
      showBillPopup(this.getAttribute('data-bill'));
    });
  });

  // Tip Me button handler
  const tipBtn = document.getElementById('tip-btn');
  if (tipBtn) {
    tipBtn.addEventListener('click', function(e) {
      e.preventDefault();
      showBillPopup('tip');
    });
  }

  // Bill popup close button
  const billPopupCloseBtn = document.querySelector('.bill-popup-close');
  if (billPopupCloseBtn) {
    billPopupCloseBtn.addEventListener('click', closeBillPopup);
  }

  // Bill popup overlay click-outside-to-close
  const billPopupOverlay = document.getElementById('bill-popup-overlay');
  if (billPopupOverlay) {
    billPopupOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeBillPopup();
    });
  }

  // Bill popup escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === "Escape" && billPopupOverlay && billPopupOverlay.classList.contains('active')) {
      closeBillPopup();
    }
  });

  // ==========================================
  // IBAN POPUP LOGIC
  // ==========================================
  const ibanBtn = document.getElementById('iban-btn');
  const ibanPopupOverlay = document.getElementById('iban-popup-overlay');
  const ibanPopupCloseBtn = document.getElementById('iban-popup-close');

  function openIbanPopup() {
    if (ibanPopupOverlay) {
      // Close bill popup if open
      if (billPopupOverlay) billPopupOverlay.classList.remove('active');
      
      ibanPopupOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeIbanPopup() {
    if (ibanPopupOverlay) {
      ibanPopupOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  if (ibanBtn) {
    ibanBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openIbanPopup();
    });
  }

  if (ibanPopupCloseBtn) {
    ibanPopupCloseBtn.addEventListener('click', closeIbanPopup);
  }

  if (ibanPopupOverlay) {
    ibanPopupOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeIbanPopup();
    });
  }

  // IBAN copy functionality
  document.querySelectorAll('.copy-text').forEach(span => {
    span.style.cursor = 'pointer';
    span.style.textDecoration = 'underline';
    span.style.color = '#ff5fa2';
    span.title = 'Click to copy';
    
    span.addEventListener('click', function() {
      const textToCopy = this.getAttribute('data-copy');
      navigator.clipboard.writeText(textToCopy).then(() => {
        const originalText = this.textContent;
        this.textContent = '✓ Copied!';
        setTimeout(() => {
          this.textContent = originalText;
        }, 1500);
      });
    });
  });

  // ==========================================
  // CONTACT / DM POPUP LOGIC
  // ==========================================
  const contactBtn = document.getElementById('contact-btn');
  const dmBtn = document.getElementById('dm-btn');
  const contactPopupOverlay = document.getElementById('contact-popup-overlay');
  const contactPopupCloseBtn = document.getElementById('contact-popup-close');

  function openContactPopup() {
    if (contactPopupOverlay) {
      contactPopupOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeContactPopup() {
    if (contactPopupOverlay) {
      contactPopupOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  if (contactBtn) {
    contactBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openContactPopup();
    });
  }

  if (dmBtn) {
    dmBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openContactPopup();
    });
  }

  if (contactPopupCloseBtn) {
    contactPopupCloseBtn.addEventListener('click', closeContactPopup);
  }

  if (contactPopupOverlay) {
    contactPopupOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeContactPopup();
    });
  }

  // Escape key for all popups
  document.addEventListener('keydown', function(e) {
    if (e.key === "Escape") {
      if (contactPopupOverlay && contactPopupOverlay.classList.contains('active')) {
        closeContactPopup();
      }
      if (ibanPopupOverlay && ibanPopupOverlay.classList.contains('active')) {
        closeIbanPopup();
      }
    }
  });

}); // End of DOMContentLoaded
