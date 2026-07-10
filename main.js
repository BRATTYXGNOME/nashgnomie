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
  var ageInputContainer = document.getElementById('age-input-container');
  var underageBlock = document.getElementById('underage-block');
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

      var result = window.AgeGate.verifyHomepage(birthdateIn.value);

      if (result.reason === 'underage') {
        ageInputContainer.style.display = 'none';
        underageBlock.style.display = 'block';
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
      } else if (result.reason === 'underage') {
        galleryAgeError.textContent = 'You must be 18 or older to view this content.';
      } else if (result.reason === 'mismatch') {
        window.AgeGate.redirectMismatch();
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

  if (heroDmBtn) heroDmBtn.addEventListener('click', function(e) { e.preventDefault(); openContactPopup(); });
  if (aboutDmBtn) aboutDmBtn.addEventListener('click', function(e) { e.preventDefault(); openContactPopup(); });
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

  // Copy-to-clipboard for tip badges
  document.querySelectorAll('.copy-badge').forEach(function(badge) {
    badge.addEventListener('click', function() {
      const copyText = this.getAttribute('data-copy');
      const valueEl = this.querySelector('.copy-badge-value');
      const originalText = valueEl.textContent;

      navigator.clipboard.writeText(copyText).then(function() {
        valueEl.textContent = 'Copied!';
        badge.classList.add('copied');
        setTimeout(function() {
          valueEl.textContent = originalText;
          badge.classList.remove('copied');
        }, 1200);
      });
    });
  });

  // ==========================================
  // ADOPT A BILL POPUP
  // ==========================================
  const billPopupData = {
    rent: {
      title: 'Adopt: Rent',
      desc: 'Help cover my share of rent. Thank you for helping keep a roof over my head!',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101964", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l6t6-unbtkc", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    },
    pet: {
      title: 'Adopt: Pet Expenses',
      desc: 'Food and care for 2 cats & 2 geckos.',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101963", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l74c-1npsse8", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    },
    phone: {
      title: 'Adopt: Phone Bill',
      desc: 'Mobile phone service & data.',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101959", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l75t-g6uwiw", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    },
    utilities: {
      title: 'Adopt: Utilities',
      desc: 'Electricity, water, internet, and extras.',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101962", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l6t6-unbtkc", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    },
    transportation: {
      title: 'Adopt: Transportation',
      desc: 'Bus pass & rideshare (e.g., Lyft).',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101958", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l768-1gsp6rd", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    },
    essentials: {
      title: 'Adopt: Essentials',
      desc: 'Toiletries, cleaning, and home supplies.',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101961", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l751-o7b7jq", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    },
    groceries: {
      title: 'Adopt: Groceries',
      desc: 'Food and pantry for one person.',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101960", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l74u-1x6s1gj", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    },
    total: {
      title: 'Adopt: All Bills',
      desc: 'Cover everything at once. You are incredible!',
      links: [
        { label: "YouPay", url: "https://youpay.me/NashGnomie/gift/1101965", type: "link" },
        { label: "AllMyLinks", url: "https://allmylinks.com/link/out?id=xsliz-3l6t6-unbtkc", type: "link" },
        { label: "Cash App", url: "https://cash.app/$pewpewser", type: "link" },
        { label: "Cashtag", value: "$pewpewser", type: "copy" },
        { label: "Amazon Gift Card", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Apple Pay", value: "nashgnomie@gmail.com", type: "copy" },
        { label: "Zelle", value: "nashgnomie@gmail.com", type: "copy" }
      ]
    }
  };

  const billOverlay = document.getElementById('bill-popup-overlay');
  const billPopupClose = document.getElementById('bill-popup-close');

  function showBillPopup(billKey) {
    const data = billPopupData[billKey];
    if (!data) return;

    var title = document.getElementById('bill-popup-title');
    var desc = document.getElementById('bill-popup-desc');
    var links = document.getElementById('bill-popup-links');

    title.textContent = data.title;
    desc.textContent = data.desc;
    links.innerHTML = '';

    data.links.forEach(function(item) {
      if (item.type === 'link') {
        var a = document.createElement('a');
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = item.label;
        links.appendChild(a);
      } else if (item.type === 'copy') {
        var div = document.createElement('div');
        div.className = 'copy-badge';
        div.setAttribute('data-copy', item.value);

        var labelSpan = document.createElement('span');
        labelSpan.className = 'copy-badge-label';
        labelSpan.textContent = item.label;

        var valueSpan = document.createElement('span');
        valueSpan.className = 'copy-badge-value';
        valueSpan.textContent = item.value;

        div.appendChild(labelSpan);
        div.appendChild(valueSpan);

        div.addEventListener('click', function() {
          var copyVal = this.getAttribute('data-copy');
          var valEl = this.querySelector('.copy-badge-value');
          var origText = valEl.textContent;

          navigator.clipboard.writeText(copyVal).then(function() {
            valEl.textContent = 'Copied!';
            div.classList.add('copied');
            setTimeout(function() {
              valEl.textContent = origText;
              div.classList.remove('copied');
            }, 1200);
          });
        });

        links.appendChild(div);
      }
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
