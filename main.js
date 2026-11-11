// ==========================================
// NASH | Gnomie — Main JavaScript
// ==========================================

document.addEventListener('DOMContentLoaded', () => {

  // ==========================================
  // AGE GATE (homepage — always resets DOB)
  // ==========================================
  var ageGate = document.getElementById('age-gate');
  var ageForm = document.getElementById('age-form');
  var birthdateIn = document.getElementById('birthdate');
  var ageError = document.getElementById('age-error');
  var mainSite = document.getElementById('main-site');
  var mismatchWarning = document.getElementById('age-mismatch-warning');

  if (birthdateIn) {
    birthdateIn.max = new Date().toISOString().split('T')[0];
  }

  // Show mismatch warning if redirected
  if (mismatchWarning && window.location.search.indexOf('dob_mismatch') !== -1) {
    mismatchWarning.style.display = 'block';
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Skip age gate if already verified this session (e.g. clicking Home button)
  if (ageGate && mainSite && window.AgeGate && window.AgeGate.isVerified() && window.location.search.indexOf('dob_mismatch') === -1) {
    ageGate.classList.add('hidden');
    mainSite.style.display = 'block';
  }

  if (ageForm) {
    ageForm.addEventListener('submit', function(e) {
      e.preventDefault();
      ageError.textContent = '';

      if (!birthdateIn.value) {
        ageError.textContent = 'Please enter your birthdate.';
        return;
      }

      // Under 18 on the homepage gate always means a trip to the kids' show
      // (and a 6-hour timeout), even if a different date was saved before.
      if (window.AgeGate.calculateAge(birthdateIn.value) < 18) {
        window.AgeGate.sendAway();
        return;
      }

      var result = window.AgeGate.verify(birthdateIn.value);

      if (result.reason === 'mismatch') {
        window.AgeGate.redirectMismatch();
      } else if (result.success) {
        ageGate.classList.add('hidden');
        mainSite.style.display = 'block';
        document.body.style.overflow = '';
        window.AgeGate.setVerified();
      }
    });
  }

  // ==========================================
  // MOBILE NAV DRAWER (handled by components.js)
  // ==========================================

  // ==========================================
  // GALLERY NSFW GATE (DOB verification)
  // ==========================================
  var galleryAgeGate = document.getElementById('gallery-age-gate');
  var galleryAgeForm = document.getElementById('gallery-age-form');
  var galleryBirthdate = document.getElementById('gallery-birthdate');
  var galleryAgeError = document.getElementById('gallery-age-error');

  if (galleryBirthdate) {
    galleryBirthdate.max = new Date().toISOString().split('T')[0];
  }

  if (galleryAgeForm) {
    galleryAgeForm.addEventListener('submit', function(e) {
      e.preventDefault();
      galleryAgeError.textContent = '';

      if (!galleryBirthdate.value) {
        galleryAgeError.textContent = 'Please enter your birthdate.';
        return;
      }

      var result = window.AgeGate.verify(galleryBirthdate.value);

      if (result.success) {
        galleryAgeGate.style.display = 'none';
        galleryAgeGate.parentElement.classList.add('unlocked');
      } else {
        window.AgeGate.handleFailure(result, galleryAgeError);
      }
    });
  }

  // ==========================================
  // TEASER MODAL (Lightbox)
  // ==========================================
  const teaserImages = [
    "https://i.ibb.co/8gB2XFxh/teaser001.gif",
    "https://i.ibb.co/MkncchXh/teaser003.jpg",
    "https://i.ibb.co/yFpXf6pG/teaser004.png",
    "https://i.ibb.co/4ZQ57dLG/teaser005.png",
    "https://i.ibb.co/8Dx5khhJ/teaser006.png",
    "https://i.ibb.co/j9QgVSzS/teaser007.jpg"
  ];

  const teaserThumbs = document.querySelectorAll('.teaser-thumb');
  const teaserModal = document.getElementById('teaser-modal');
  const teaserModalImg = document.getElementById('teaser-modal-img');
  const teaserModalClose = document.getElementById('teaser-modal-close');
  const teaserArrowLeft = document.getElementById('teaser-arrow-left');
  const teaserArrowRight = document.getElementById('teaser-arrow-right');

  let currentTeaserIndex = 0;

  function openTeaserModal(index) {
    currentTeaserIndex = index;
    teaserModalImg.src = teaserImages[currentTeaserIndex];
    teaserModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeTeaserModal() {
    teaserModal.classList.remove('active');
    document.body.style.overflow = '';
    teaserModalImg.src = '';
  }

  function showPrevTeaser() {
    currentTeaserIndex = (currentTeaserIndex - 1 + teaserImages.length) % teaserImages.length;
    teaserModalImg.src = teaserImages[currentTeaserIndex];
  }

  function showNextTeaser() {
    currentTeaserIndex = (currentTeaserIndex + 1) % teaserImages.length;
    teaserModalImg.src = teaserImages[currentTeaserIndex];
  }

  teaserThumbs.forEach(function(img, idx) {
    img.addEventListener('click', function() { openTeaserModal(idx); });
  });

  if (teaserModalClose) teaserModalClose.addEventListener('click', closeTeaserModal);
  if (teaserArrowLeft) teaserArrowLeft.addEventListener('click', showPrevTeaser);
  if (teaserArrowRight) teaserArrowRight.addEventListener('click', showNextTeaser);

  if (teaserModal) {
    teaserModal.addEventListener('click', function(e) {
      if (e.target === teaserModal) closeTeaserModal();
    });
  }

  // Touch swipe for teaser modal
  let touchStartX = 0;
  let touchEndX = 0;
  const swipeThreshold = 75;

  if (teaserModal) {
    teaserModal.addEventListener('touchstart', function(e) {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    teaserModal.addEventListener('touchend', function(e) {
      touchEndX = e.changedTouches[0].screenX;
      const dist = touchEndX - touchStartX;
      if (Math.abs(dist) < swipeThreshold) return;
      if (dist > 0) {
        showPrevTeaser();
      } else {
        showNextTeaser();
      }
    }, { passive: true });

    teaserModal.addEventListener('wheel', function(e) {
      if (teaserModal.classList.contains('active')) e.preventDefault();
    }, { passive: false });

    teaserModal.addEventListener('touchmove', function(e) {
      if (teaserModal.classList.contains('active')) e.preventDefault();
    }, { passive: false });
  }

  // ==========================================
  // CONTACT POPUP
  // ==========================================
  const contactOverlay = document.getElementById('contact-popup-overlay');
  const contactClose = document.getElementById('contact-popup-close');
  const heroDmBtn = document.getElementById('hero-dm-btn');
  const aboutDmBtn = document.getElementById('about-dm-btn');

  function openContactPopup() {
    if (contactOverlay) {
      contactOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      if (window.closeDrawer) window.closeDrawer();
    }
  }

  function closeContactPopup() {
    if (contactOverlay) {
      contactOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // DM ME buttons are age-gated (class "age-gated" in index.html); components.js
  // asks for the birthdate, then opens this popup.
  if (contactClose) contactClose.addEventListener('click', closeContactPopup);
  if (contactOverlay) {
    contactOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeContactPopup();
    });
  }

  // ==========================================
  // TIP ME POPUP
  // ==========================================
  const tipOverlay = document.getElementById('tip-popup-overlay');
  const tipClose = document.getElementById('tip-popup-close');
  const tipBtn = document.getElementById('tip-btn');

  function openTipPopup() {
    tipOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeTipPopup() {
    tipOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (tipBtn) tipBtn.addEventListener('click', function(e) { e.preventDefault(); openTipPopup(); });
  if (tipClose) tipClose.addEventListener('click', closeTipPopup);
  if (tipOverlay) {
    tipOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeTipPopup();
    });
  }

  // Fill the Tip Me popup with the shared payment list (components.js)
  var tipLinks = document.getElementById('tip-popup-links');
  if (tipLinks && window.PaymentOptions) window.PaymentOptions.render(tipLinks);

  // ==========================================
  // ADOPT A BILL POPUP
  // Each bill has its own YouPay + Throne link; the rest of the
  // payment options come from PaymentOptions in components.js.
  // ==========================================
  const billPopupData = {
    rent: {
      title: 'Adopt: Rent',
      desc: 'Help cover my share of rent. Thank you for helping keep a roof over my head!',
      youpay: 'https://youpay.me/NashGnomie/gift/1101964',
      throne: 'https://throne.com/nashgnomie/item/95d2dcb8-7e1b-4520-9449-bc43a1e48791'
    },
    pet: {
      title: 'Adopt: Pet Expenses',
      desc: 'Food and care for 2 cats & 2 geckos.',
      youpay: 'https://youpay.me/NashGnomie/gift/1101963',
      throne: 'https://throne.com/nashgnomie/item/87ff0888-a476-490b-90ed-a36b0e050325'
    },
    phone: {
      title: 'Adopt: Phone Bill',
      desc: 'Mobile phone service & data.',
      youpay: 'https://youpay.me/NashGnomie/gift/1101959',
      throne: 'https://throne.com/nashgnomie/item/d2e95052-22c6-4f48-9951-bae90f869c88'
    },
    utilities: {
      title: 'Adopt: Utilities',
      desc: 'Electricity, water, internet, and extras.',
      youpay: 'https://youpay.me/NashGnomie/gift/1101962',
      throne: 'https://throne.com/nashgnomie/item/70f5146b-7d9f-4003-9439-7b456f88658c'
    },
    transportation: {
      title: 'Adopt: Transportation',
      desc: 'Bus pass & rideshare (e.g., Lyft).',
      youpay: 'https://youpay.me/NashGnomie/gift/1101958',
      throne: 'https://throne.com/nashgnomie/item/1076e82e-f3de-4f06-97ef-ec2702dfb8c3'
    },
    essentials: {
      title: 'Adopt: Essentials',
      desc: 'Toiletries, cleaning, and home supplies.',
      youpay: 'https://youpay.me/NashGnomie/gift/1101961',
      throne: 'https://throne.com/nashgnomie/item/6ec49a6c-1e04-4d19-bd65-addcd3c21bd5'
    },
    groceries: {
      title: 'Adopt: Groceries',
      desc: 'Food and pantry for one person.',
      youpay: 'https://youpay.me/NashGnomie/gift/1101960',
      throne: 'https://throne.com/nashgnomie/item/e4083dc8-1802-427d-bee8-999625a13d94'
    },
    total: {
      title: 'Adopt: All Bills',
      desc: 'Cover everything at once. You are incredible!',
      youpay: 'https://youpay.me/NashGnomie/gift/1101965',
      throne: 'https://throne.com/nashgnomie/item/4b4026a4-fd37-441d-ab9f-8df569ba653a'
    }
  };

  const billOverlay = document.getElementById('bill-popup-overlay');
  const billPopupClose = document.getElementById('bill-popup-close');

  function showBillPopup(billKey) {
    const data = billPopupData[billKey];
    if (!data) return;

    document.getElementById('bill-popup-title').textContent = data.title;
    document.getElementById('bill-popup-desc').textContent = data.desc;
    window.PaymentOptions.render(document.getElementById('bill-popup-links'), {
      youpay: data.youpay,
      throne: data.throne
    });

    billOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeBillPopup() {
    if (billOverlay) {
      billOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // Auto-calculate bill total
  function updateBillTotal() {
    var total = 0;
    document.querySelectorAll('#bill-table-body tr[data-amount]').forEach(function(row) {
      total += parseInt(row.getAttribute('data-amount'), 10) || 0;
    });
    var totalEl = document.getElementById('bill-total');
    if (totalEl) {
      totalEl.textContent = '$' + total.toLocaleString();
    }
  }
  updateBillTotal();

  document.querySelectorAll('.bill-table tbody tr[data-bill]').forEach(function(row) {
    row.addEventListener('click', function() {
      showBillPopup(this.getAttribute('data-bill'));
    });
  });

  if (billPopupClose) billPopupClose.addEventListener('click', closeBillPopup);
  if (billOverlay) {
    billOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeBillPopup();
    });
  }

  // ==========================================
  // GLOBAL KEYBOARD HANDLERS
  // ==========================================
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      // Close whatever modal is open
      if (teaserModal && teaserModal.classList.contains('active')) {
        closeTeaserModal();
      } else if (billOverlay && billOverlay.classList.contains('active')) {
        closeBillPopup();
      } else if (contactOverlay && contactOverlay.classList.contains('active')) {
        closeContactPopup();
      } else if (tipOverlay && tipOverlay.classList.contains('active')) {
        closeTipPopup();
      } else if (drawer && drawer.classList.contains('open')) {
        closeDrawer();
      }
    }

    // Arrow keys for teaser modal
    if (teaserModal && teaserModal.classList.contains('active')) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        showPrevTeaser();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        showNextTeaser();
      }
    }
  });

  // ==========================================
  // VIO BADGE TOOLTIP
  // ==========================================
  var vioTooltip = document.getElementById('vio-tooltip');
  document.querySelectorAll('.vio-badge').forEach(function(badge) {
    badge.addEventListener('click', function() {
      if (vioTooltip) {
        vioTooltip.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    });
  });
  if (vioTooltip) {
    vioTooltip.addEventListener('click', function(e) {
      if (e.target === this) {
        vioTooltip.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && vioTooltip.classList.contains('active')) {
        vioTooltip.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  }

}); // End DOMContentLoaded
