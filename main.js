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
// AGE VERIFICATION - SHARED CONSTANTS & HELPERS
// ==========================================
const AGE_STORAGE_KEY = 'nashgnomie_dob'; // Single source of truth for DOB

// Helper: Calculate age from DOB string (YYYY-MM-DD)
function calculateAge(dob) {
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return NaN;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
}

// ==========================================
// DOM READY
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  
  // Initialize stars
  initStars();
  
  // ==========================================
  // AGE GATE LOGIC - UNIFIED SYSTEM
  // ==========================================
  const ageForm           = document.getElementById('age-form');
  const birthdateIn       = document.getElementById('birthdate');
  const ageError          = document.getElementById('age-error');
  const ageModal          = document.getElementById('age-modal');
  const ageInputContainer = document.getElementById('age-input-container');
  const underageBlock     = document.getElementById('underage-block');
  const mainNav           = document.getElementById('main-nav');
  const mainContent       = document.querySelector('main');

  // Helpers to show/hide main site vs age gate
  function showMainSite() {
    if (ageModal) ageModal.classList.remove('active');
    if (ageInputContainer) ageInputContainer.style.display = 'none';
    if (underageBlock) underageBlock.style.display = 'none';
    if (mainNav) mainNav.style.display = 'flex';
    if (mainContent) mainContent.style.display = 'block';
    document.body.style.overflow = '';
  }

  function showAgeGate() {
    if (ageModal) ageModal.classList.add('active');
    if (ageInputContainer) ageInputContainer.style.display = 'block';
    if (underageBlock) underageBlock.style.display = 'none';
    if (mainNav) mainNav.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
    document.body.style.overflow = 'hidden';
  }

  // Make sure you can't pick a future date
  if (birthdateIn) {
    birthdateIn.max = new Date().toISOString().split('T')[0];
  }

  // On load: if we already have a valid adult DOB saved, skip the gate
  try {
    const storedDob  = localStorage.getItem(AGE_STORAGE_KEY);
    const storedAge  = storedDob ? calculateAge(storedDob) : NaN;
    const isAdult    = storedDob && Number.isFinite(storedAge) && storedAge >= 18;

    if (isAdult) {
      showMainSite();
    } else {
      showAgeGate();
    }
  } catch (e) {
    console.warn('Age gate storage error, defaulting to gate on each visit', e);
    showAgeGate();
  }

  // Handle age form submission
  if (ageForm) {
    ageForm.addEventListener('submit', e => {
      e.preventDefault();
      if (ageError) ageError.textContent = '';
      
      if (!birthdateIn || !birthdateIn.value) {
        if (ageError) ageError.textContent = 'Please enter your birthdate.';
        return;
      }
      
      const dob  = birthdateIn.value; // Raw YYYY-MM-DD string
      const age  = calculateAge(dob);

      if (!Number.isFinite(age)) {
        if (ageError) ageError.textContent = 'Please enter a valid date.';
        return;
      }
      
      if (age < 18) {
        if (ageInputContainer) ageInputContainer.style.display = 'none';
        if (underageBlock) underageBlock.style.display     = 'block';
      } else {
        // User is 18+, store DOB as single source of truth
        try {
          localStorage.setItem(AGE_STORAGE_KEY, dob);
        } catch (err) {
          console.warn('Could not persist age verification', err);
        }
        showMainSite();
      }
    });
  }

  // ==========================================
  // TEASER MODAL LOGIC
  // ==========================================
  const teaserImages = [
    "images/teaser001.gif",
    "images/teaser003.jpeg",
    "images/teaser004.png",
    "images/teaser005.png",
    "images/teaser006.png",
    "images/teaser007.jpg",
    "images/teaser002.gif"
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
  const swipeThreshold = 75; // Minimum swipe distance in pixels

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
    
    if (Math.abs(swipeDistance) < swipeThreshold) return; // Not a swipe, just a tap
    
    if (swipeDistance > 0) {
      // Swiped right - show previous
      showPrevTeaser();
    } else {
      // Swiped left - show next
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
  // ADOPT A BILL POP-UP LOGIC
  // ==========================================
  const billPopupData = {
    rent: {
      title: 'Adopt: Rent',
      desc: 'Help cover my share of rent. Thank you for helping keep a roof over my head!',
      links: [
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l6t6-unbtkc" },
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000427" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "PayPal", url: "https://paypal.me/gnomecrafts" },
        { label: "Wish.ly", url: "https://www.wish.ly/nashgnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/95d2dcb8-7e1b-4520-9449-bc43a1e48791" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@proton.me" },
        { label: "Apple Pay", url: "nashgnomie@proton.me" },
        { label: "Zelle", url: "nashgnomie@proton.me" },
        { label: "Wise", url: "@naomih250" },
        { label: "International IBAN", url: "#iban" }
      ]
    },
    utilities: {
      title: "Adopt: Utilities",
      desc: "Support electricity, water, internet, and extras.",
      links: [
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l6t6-unbtkc" },
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000449" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "PayPal", url: "https://paypal.me/gnomecrafts" },
        { label: "Wish.ly", url: "https://www.wish.ly/nashgnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/70f5146b-7d9f-4003-9439-7b456f88658c" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@proton.me" },
        { label: "Apple Pay", url: "nashgnomie@proton.me" },
        { label: "Zelle", url: "nashgnomie@proton.me" },
        { label: "Wise", url: "@naomih250" },
        { label: "International IBAN", url: "#iban" }
      ]
    },
    pet: {
      title: "Adopt: Pet Expenses",
      desc: "Food and care for 2 cats & 2 geckos.",
      links: [
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l74c-1npsse8" },
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000453" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "PayPal", url: "https://paypal.me/gnomecrafts" },
        { label: "Wish.ly", url: "https://www.wish.ly/nashgnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/87ff0888-a476-490b-90ed-a36b0e050325" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@proton.me" },
        { label: "Apple Pay", url: "nashgnomie@proton.me" },
        { label: "Zelle", url: "nashgnomie@proton.me" },
        { label: "Wise", url: "@naomih250" },
        { label: "International IBAN", url: "#iban" }
      ]
    },
    groceries: {
      title: "Adopt: Groceries",
      desc: "Food and pantry for one person.",
      links: [
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l74u-1x6s1gj" },
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000457" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "PayPal", url: "https://paypal.me/gnomecrafts" },
        { label: "Wish.ly", url: "https://www.wish.ly/nashgnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/e4083dc8-1802-427d-bee8-999625a13d94" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@proton.me" },
        { label: "Apple Pay", url: "nashgnomie@proton.me" },
        { label: "Zelle", url: "nashgnomie@proton.me" },
        { label: "Wise", url: "@naomih250" },
        { label: "International IBAN", url: "#iban" }
      ]
    },
    essentials: {
      title: "Adopt: Essentials",
      desc: "Toiletries, cleaning, and home supplies.",
      links: [
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l751-o7b7jq" },
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000460" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "PayPal", url: "https://paypal.me/gnomecrafts" },
        { label: "Wish.ly", url: "https://www.wish.ly/nashgnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/6ec49a6c-1e04-4d19-bd65-addcd3c21bd5" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@proton.me" },
        { label: "Apple Pay", url: "nashgnomie@proton.me" },
        { label: "Zelle", url: "nashgnomie@proton.me" },
        { label: "Wise", url: "@naomih250" },
        { label: "International IBAN", url: "#iban" }
      ]
    },
    phone: {
      title: "Adopt: Phone Bill",
      desc: "Mobile phone service & data.",
      links: [
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l75t-g6uwiw" },
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000462" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "PayPal", url: "https://paypal.me/gnomecrafts" },
        { label: "Wish.ly", url: "https://www.wish.ly/nashgnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/d2e95052-22c6-4f48-9951-bae90f869c88" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@proton.me" },
        { label: "Apple Pay", url: "nashgnomie@proton.me" },
        { label: "Zelle", url: "nashgnomie@proton.me" },
        { label: "Wise", url: "@naomih250" },
        { label: "International IBAN", url: "#iban" }
      ]
    },
    transportation: {
      title: "Adopt: Transportation",
      desc: "Bus pass & rideshare (e.g., Lyft).",
      links: [
        { label: "Cash App", url: "https://cash.app/$pewpewser" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l768-1gsp6rd" },
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1000464" },
        { label: "Revolut", url: "https://revolut.me/nashgnomie" },
        { label: "PayPal", url: "https://paypal.me/gnomecrafts" },
        { label: "Wish.ly", url: "https://www.wish.ly/nashgnomie" },
        { label: "Throne", url: "https://throne.com/nashgnomie/item/1076e82e-f3de-4f06-97ef-ec2702dfb8c3" },
        { label: "Chime", url: "$nashgnomie" },
        { label: "Amazon Gift Card", url: "nashgnomie@proton.me" },
        { label: "Apple Pay", url: "nashgnomie@proton.me" },
        { label: "Zelle", url: "nashgnomie@proton.me" },
        { label: "Wise", url: "@naomih250" },
        { label: "International IBAN", url: "#iban" }
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
      if (link.label === "International IBAN") {
        // Special button to open IBAN popup
        const a = document.createElement('a');
        a.href = "#";
        a.textContent = link.label;
        a.onclick = function(e) {
          e.preventDefault();
          closeBillPopup();
          openIBANPopup();
        };
        links.appendChild(a);
      } else if (link.label === "Chime") {
        // Show Chime as a copyable cashtag
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
      } else if (link.label === "Wise") {
        // Show Wise tag as a copyable badge
        const span = document.createElement('span');
        span.className = "copy-cashtag";
        span.textContent = link.url;
        span.setAttribute('data-wise', link.url);
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
        div.appendChild(document.createTextNode("Wise: "));
        div.appendChild(span);
        links.appendChild(div);
      } else if (
        link.label === "Amazon Gift Card" ||
        link.label === "Apple Pay" ||
        link.label === "Zelle"
      ) {
        // Show email as a copyable badge
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
    if (e.key === "Escape" && contactPopupOverlay && contactPopupOverlay.classList.contains('active')) {
      closeContactPopup();
    }
    if (e.key === "Escape" && ibanPopupOverlay && ibanPopupOverlay.classList.contains('active')) {
      closeIBANPopup();
    }
  });

  // ==========================================
  // IBAN POPUP LOGIC
  // ==========================================
  function openIBANPopup() {
    const overlay = document.getElementById('iban-popup-overlay');
    if (overlay) {
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeIBANPopup() {
    const overlay = document.getElementById('iban-popup-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // IBAN popup close button
  const ibanPopupCloseBtn = document.getElementById('iban-popup-close');
  if (ibanPopupCloseBtn) {
    ibanPopupCloseBtn.addEventListener('click', closeIBANPopup);
  }

  // IBAN popup overlay click-outside-to-close
  const ibanPopupOverlay = document.getElementById('iban-popup-overlay');
  if (ibanPopupOverlay) {
    ibanPopupOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeIBANPopup();
    });
  }

  // Make IBAN values copyable
  document.querySelectorAll('.copy-iban').forEach(span => {
    span.style.cursor = 'pointer';
    span.style.color = '#ffb6d5';
    span.style.textDecoration = 'underline';
    span.title = 'Click to copy';
    span.onclick = function() {
      const value = this.getAttribute('data-value');
      navigator.clipboard.writeText(value);
      const originalText = this.textContent;
      this.textContent = 'Copied!';
      this.style.color = '#4caf50';
      setTimeout(() => {
        this.textContent = originalText;
        this.style.color = '#ffb6d5';
      }, 1200);
    };
  });

  // ==========================================
  // CONTACT POPUP LOGIC
  // ==========================================
  const contactBtn = document.getElementById('contact-btn');
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

  // Contact button click
  if (contactBtn) {
    contactBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openContactPopup();
    });
  }

  // DM Me button (in About section) - same behavior as Contact
  const dmBtn = document.getElementById('dm-btn');
  if (dmBtn) {
    dmBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openContactPopup();
    });
  }

  // Contact popup close button
  if (contactPopupCloseBtn) {
    contactPopupCloseBtn.addEventListener('click', closeContactPopup);
  }

  // Contact popup overlay click-outside-to-close
  if (contactPopupOverlay) {
    contactPopupOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeContactPopup();
    });
  }

  // ==========================================
  // TIP ME POPUP LOGIC
  // ==========================================
  const tipBtn = document.getElementById('tip-btn');
  const tipPopupOverlay = document.getElementById('tip-popup-overlay');
  const tipPopupCloseBtn = document.getElementById('tip-popup-close');
  const revolutLink = document.getElementById('revolut-link');
  const paypalLink = document.getElementById('paypal-link');
  const tipIbanLink = document.getElementById('tip-iban-link');

  function openTipPopup() {
    if (tipPopupOverlay) {
      tipPopupOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeTipPopup() {
    if (tipPopupOverlay) {
      tipPopupOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // Tip button click
  if (tipBtn) {
    tipBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openTipPopup();
    });
  }

  // Tip popup close button
  if (tipPopupCloseBtn) {
    tipPopupCloseBtn.addEventListener('click', closeTipPopup);
  }

  // Tip popup overlay click-outside-to-close
  if (tipPopupOverlay) {
    tipPopupOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeTipPopup();
    });
  }

  // Revolut link handler
  if (revolutLink) {
    revolutLink.addEventListener('click', function(e) {
      e.preventDefault();
      const revolutTag = '@naomih282';
      navigator.clipboard.writeText(revolutTag).then(() => {
        const originalText = this.textContent;
        this.textContent = '✓ Copied: ' + revolutTag;
        setTimeout(() => {
          this.textContent = originalText;
        }, 2000);
      });
    });
  }

  // PayPal link handler
  if (paypalLink) {
    paypalLink.addEventListener('click', function(e) {
      e.preventDefault();
      const paypalEmail = 'nashgnomie@gmail.com';
      navigator.clipboard.writeText(paypalEmail).then(() => {
        const originalText = this.textContent;
        this.textContent = '✓ Copied: ' + paypalEmail;
        setTimeout(() => {
          this.textContent = originalText;
        }, 2000);
      });
    });
  }

  // IBAN link handler (open IBAN popup from tip popup)
  if (tipIbanLink) {
    tipIbanLink.addEventListener('click', function(e) {
      e.preventDefault();
      closeTipPopup();
      openIBANPopup();
    });
  }

  // ==========================================
  // CONTACT LINKS AGE VERIFICATION
  // ==========================================
  const CONTACT_LINK_URLS = {
    'telegram': 'https://t.me/nashgnomie',
    'loyalfans': 'https://www.loyalfans.com/BrattyGnomie?ref=EsDvOGi-2BVwTKmTpvB-2FcuG-2BwZDrhfpPSPcEVnVrP3OyU',
    'sextpanther': 'https://www.sextpanther.com/brattyxgnome',
    'flirtback': 'https://flirtback.com/BRATTYXGNOME'
  };

  const MISMATCH_KEY = 'nashgnomie_mismatches';
  const LOCKOUT_KEY = 'nashgnomie_lockout';
  const MISMATCH_FLAG_KEY = 'nashgnomie_has_mismatched';
  const MAX_MISMATCHES = 3;
  const LOCKOUT_HOURS = 24;

  let currentContactLink = null;

  const contactAgeModal = document.getElementById('contact-age-modal');
  const contactAgeForm = document.getElementById('contact-age-form');
  const contactBirthdate = document.getElementById('contact-birthdate');
  const contactAgeError = document.getElementById('contact-age-error');
  const contactAgeInputContainer = document.getElementById('contact-age-input-container');
  const contactAgeUnderage = document.getElementById('contact-age-underage');
  const contactMismatchWarning = document.getElementById('contact-mismatch-warning');
  const contactTelegramNotice = document.getElementById('contact-telegram-notice');

  if (contactBirthdate) {
    contactBirthdate.max = new Date().toISOString().split('T')[0];
  }

  // Age verification helper functions (using same keys as initial gate)
  function hasMismatched() {
    return localStorage.getItem(MISMATCH_FLAG_KEY) === 'true';
  }

  function setMismatchFlag() {
    localStorage.setItem(MISMATCH_FLAG_KEY, 'true');
  }

  function isLockedOut() {
    const lockoutUntil = localStorage.getItem(LOCKOUT_KEY);
    if (!lockoutUntil) return false;
    
    const now = new Date().getTime();
    const lockoutTime = parseInt(lockoutUntil);
    
    if (now < lockoutTime) {
      return true;
    } else {
      clearLockout();
      return false;
    }
  }

  function setLockout() {
    const now = new Date().getTime();
    const lockoutUntil = now + (LOCKOUT_HOURS * 60 * 60 * 1000);
    localStorage.setItem(LOCKOUT_KEY, lockoutUntil.toString());
  }

  function clearLockout() {
    localStorage.removeItem(LOCKOUT_KEY);
    localStorage.removeItem(MISMATCH_KEY);
  }

  function getStoredDOB() {
    return localStorage.getItem(AGE_STORAGE_KEY);
  }

  function storeDOB(dob) {
    localStorage.setItem(AGE_STORAGE_KEY, dob);
  }

  function getMismatchCount() {
    const count = localStorage.getItem(MISMATCH_KEY);
    return count ? parseInt(count) : 0;
  }

  function incrementMismatch() {
    const count = getMismatchCount() + 1;
    localStorage.setItem(MISMATCH_KEY, count.toString());
    setMismatchFlag();
    return count;
  }

  function verifyContactDOB(dob) {
    if (isLockedOut()) {
      return { success: false, reason: 'locked_out' };
    }

    const age = calculateAge(dob);
    if (age < 18) {
      return { success: false, reason: 'underage' };
    }

    const storedDOB = getStoredDOB();
    
    if (!storedDOB) {
      storeDOB(dob);
      return { success: true };
    }

    if (storedDOB !== dob) {
      const mismatchCount = incrementMismatch();
      
      if (mismatchCount >= MAX_MISMATCHES) {
        setLockout();
        return { success: false, reason: 'locked_out' };
      }
      
      return { success: false, reason: 'mismatch', count: mismatchCount };
    }

    return { success: true };
  }

  // Handle contact link clicks and apply Telegram highlight
  document.querySelectorAll('[data-contact-link]').forEach(link => {
    // Apply highlight to Telegram option
    if (link.getAttribute('data-contact-link') === 'telegram') {
      link.classList.add('contact-telegram-highlight');
    }
    
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      const linkKey = link.getAttribute('data-contact-link');
      currentContactLink = linkKey;
      
      if (isLockedOut()) {
        alert('You are temporarily locked out. Please try again later.');
        return;
      }

      // Show warning if they've mismatched before
      if (hasMismatched()) {
        contactMismatchWarning.classList.add('show');
      } else {
        contactMismatchWarning.classList.remove('show');
      }

      // Show Telegram notice only for Telegram
      if (linkKey === 'telegram') {
        contactTelegramNotice.style.display = 'block';
      } else {
        contactTelegramNotice.style.display = 'none';
      }

      // Close contact popup, open age modal
      closeContactPopup();
      contactAgeModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  // Handle age verification form submission
  if (contactAgeForm) {
    contactAgeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      contactAgeError.textContent = '';
      
      if (!contactBirthdate.value) {
        contactAgeError.textContent = 'Please enter your birthdate.';
        return;
      }

      const result = verifyContactDOB(contactBirthdate.value);

      if (result.success) {
        // Success - open link
        const url = CONTACT_LINK_URLS[currentContactLink];
        if (url) {
          window.open(url, '_blank', 'noopener');
        }
        contactAgeModal.classList.remove('active');
        document.body.style.overflow = '';
        // Reset form
        contactAgeInputContainer.style.display = 'block';
        contactAgeUnderage.style.display = 'none';
        contactAgeError.textContent = '';
        contactBirthdate.value = '';
        contactMismatchWarning.classList.remove('show');
        contactTelegramNotice.style.display = 'none';
      } else if (result.reason === 'underage') {
        // Show underage block
        contactAgeInputContainer.style.display = 'none';
        contactAgeUnderage.style.display = 'block';
      } else if (result.reason === 'mismatch') {
        // Show mismatch error
        contactAgeError.textContent = 'Birthdate does not match your previous entry. Please enter your actual birthdate accurately.';
        contactMismatchWarning.classList.add('show');
      } else if (result.reason === 'locked_out') {
        // Show lockout
        contactAgeModal.classList.remove('active');
        document.body.style.overflow = '';
        alert('You have been locked out due to multiple mismatched birthdates. Please try again in 24 hours.');
      }
    });
  }

  // Close contact age modal
  if (contactAgeModal) {
    contactAgeModal.addEventListener('click', (e) => {
      if (e.target === contactAgeModal) {
        contactAgeModal.classList.remove('active');
        document.body.style.overflow = '';
        // Reset form
        contactAgeInputContainer.style.display = 'block';
        contactAgeUnderage.style.display = 'none';
        contactAgeError.textContent = '';
        contactBirthdate.value = '';
        contactMismatchWarning.classList.remove('show');
        contactTelegramNotice.style.display = 'none';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && contactAgeModal.classList.contains('active')) {
        contactAgeModal.classList.remove('active');
        document.body.style.overflow = '';
        contactAgeInputContainer.style.display = 'block';
        contactAgeUnderage.style.display = 'none';
        contactAgeError.textContent = '';
        contactBirthdate.value = '';
        contactMismatchWarning.classList.remove('show');
        contactTelegramNotice.style.display = 'none';
      }
    });
  }

}); // End of DOMContentLoaded
