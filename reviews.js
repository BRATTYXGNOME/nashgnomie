// ==========================================
// FAN REVIEWS (homepage)
// Loads reviews from the Render API (server.py), newest first, and shows them
// as a swipeable carousel. Every card is the same size; long reviews are cut
// off with a "Read full review" button that opens the whole thing in a popup.
// ==========================================

(function() {
  'use strict';

  const API_URL = 'https://nashgnomie.onrender.com/reviews';
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 1500;
  const MAX_STARS = 10; // fan.reviews rates out of 10

  let track, wrap, nav, prevBtn, nextBtn, progress, progressFill, progressText;
  let reviewsData = [];

  // ---------- helpers ----------

  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // Exact stars for a rating: full, half (if .5) and empty, out of 10
  function renderStars(rating) {
    const r = Math.max(0, Math.min(MAX_STARS, Math.round((Number(rating) || 0) * 2) / 2));
    const full = Math.floor(r);
    const half = r % 1 !== 0;
    let html = '';
    for (let i = 0; i < full; i++) html += '<span class="star full">&#9733;</span>';
    if (half) html += '<span class="star half">&#9733;</span>';
    for (let i = full + (half ? 1 : 0); i < MAX_STARS; i++) html += '<span class="star empty">&#9733;</span>';
    return html;
  }

  function formatRating(rating) {
    const n = Number(rating) || 0;
    return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + '/' + MAX_STARS;
  }

  function averageRating(reviews) {
    const rated = reviews.filter(r => typeof r.rating === 'number');
    if (!rated.length) return 0;
    return Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10;
  }

  function initial(name) {
    const ch = (name || '?').trim().charAt(0);
    return ch ? ch.toUpperCase() : '?';
  }

  function avatarHTML(review) {
    const letter = escapeHTML(initial(review.username));
    if (review.avatar_url) {
      return `<div class="review-avatar"><img src="${escapeHTML(review.avatar_url)}" alt="" loading="lazy"
                onerror="this.parentNode.textContent='${letter}'" /></div>`;
    }
    return `<div class="review-avatar">${letter}</div>`;
  }

  // ---------- cards ----------

  function cardHTML(review, index) {
    const name = escapeHTML(review.username || 'Anonymous');
    const rating = Number(review.rating) || 0;
    return `
      <div class="review-top">
        ${avatarHTML(review)}
        <div class="review-who">
          <div class="review-username">${name}</div>
          <div class="review-time">${escapeHTML(review.time_text || '')}</div>
        </div>
      </div>
      <div class="review-rating" aria-label="Rated ${formatRating(rating)}">
        <span class="review-stars">${renderStars(rating)}</span>
        <span class="review-score">${formatRating(rating)}</span>
      </div>
      ${review.review_title ? `<h3 class="review-title">${escapeHTML(review.review_title)}</h3>` : ''}
      <p class="review-body">${escapeHTML(review.review_text || '')}</p>
      <div class="review-actions">
        <button type="button" class="review-more" data-index="${index}" hidden>Read full review &#8250;</button>
        ${review.permalink ? `<a class="review-link" href="${escapeHTML(review.permalink)}" target="_blank" rel="noopener">View on Fan.Reviews &#8599;</a>` : ''}
      </div>`;
  }

  function renderReviews(reviews) {
    reviewsData = reviews;
    track.innerHTML = '';

    if (!reviews.length) {
      track.innerHTML = '<div class="reviews-empty">&#11088; No reviews yet. Be the first to leave one!</div>';
      setBadge(null);
      return;
    }

    reviews.forEach((review, i) => {
      const card = document.createElement('article');
      card.className = 'review-card';
      card.innerHTML = cardHTML(review, i);
      track.appendChild(card);
    });

    setBadge(reviews);
    markLongReviews();
    nav.hidden = false;
    progress.hidden = false;
    updateNav();
  }

  // Show "Read full review" only on cards whose text is actually cut off
  function markLongReviews() {
    track.querySelectorAll('.review-card').forEach(card => {
      const body = card.querySelector('.review-body');
      const more = card.querySelector('.review-more');
      if (body && more) more.hidden = body.scrollHeight <= body.clientHeight + 2;
    });
  }

  function setBadge(reviews) {
    const starsEl = document.getElementById('avg-stars');
    const avgEl = document.getElementById('avg-rating');
    const countEl = document.getElementById('reviews-count');
    if (!reviews) {
      if (starsEl) starsEl.textContent = '';
      if (avgEl) avgEl.textContent = 'N/A';
      if (countEl) countEl.textContent = '';
      return;
    }
    const avg = averageRating(reviews);
    if (starsEl) starsEl.innerHTML = renderStars(avg);
    if (avgEl) avgEl.textContent = formatRating(avg);
    if (countEl) countEl.textContent = '· ' + reviews.length + (reviews.length === 1 ? ' review' : ' reviews');
  }

  function showError(message) {
    track.innerHTML = `<div class="reviews-error">&#9888; ${escapeHTML(message)}</div>`;
    nav.hidden = true;
    progress.hidden = true;
    setBadge(null);
  }

  // ---------- carousel navigation ----------

  function step() {
    const card = track.querySelector('.review-card');
    if (!card) return track.clientWidth;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 12;
    const perView = Math.max(1, Math.floor((track.clientWidth + gap) / (card.offsetWidth + gap)));
    return perView * (card.offsetWidth + gap);
  }

  function updateNav() {
    const max = track.scrollWidth - track.clientWidth;
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft >= max - 2;
    prevBtn.disabled = atStart;
    nextBtn.disabled = atEnd;
    wrap.classList.toggle('at-start', atStart);
    wrap.classList.toggle('at-end', atEnd);

    const cards = track.querySelectorAll('.review-card');
    if (!cards.length) return;
    const cardW = cards[0].offsetWidth + (parseFloat(getComputedStyle(track).columnGap) || 12);
    const first = Math.min(cards.length, Math.round(track.scrollLeft / cardW) + 1);
    const visible = Math.max(1, Math.floor((track.clientWidth + 12) / cardW));
    const last = atEnd ? cards.length : Math.min(cards.length, first + visible - 1);
    progressText.textContent = (first === last ? first : first + '–' + last) + ' of ' + cards.length;
    const pct = max > 0 ? track.scrollLeft / max : 1;
    const thumb = Math.max(8, Math.min(100, (track.clientWidth / track.scrollWidth) * 100));
    progressFill.style.width = thumb + '%';
    progressFill.style.left = (pct * (100 - thumb)) + '%';
  }

  function initNav() {
    prevBtn.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    nextBtn.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
    let ticking = false;
    track.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { updateNav(); ticking = false; });
    }, { passive: true });
    window.addEventListener('resize', () => { markLongReviews(); updateNav(); });
    // Keyboard: arrow keys when the carousel has focus
    track.setAttribute('tabindex', '0');
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); nextBtn.click(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevBtn.click(); }
    });
  }

  // ---------- full review popup ----------

  let popup;

  function buildPopup() {
    popup = document.createElement('div');
    popup.className = 'modal-overlay review-popup-overlay';
    popup.innerHTML = `
      <div class="modal review-popup" role="dialog" aria-modal="true" aria-label="Full review">
        <button class="modal-close" aria-label="Close">&times;</button>
        <div class="review-popup-content"></div>
      </div>`;
    document.body.appendChild(popup);
    popup.addEventListener('click', e => { if (e.target === popup || e.target.closest('.modal-close')) closePopup(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && popup.classList.contains('active')) closePopup(); });
  }

  function openPopup(index) {
    const review = reviewsData[index];
    if (!review) return;
    if (!popup) buildPopup();
    const content = popup.querySelector('.review-popup-content');
    content.innerHTML = cardHTML(review, index);
    const more = content.querySelector('.review-more');
    if (more) more.remove();
    popup.classList.add('active');
    document.body.style.overflow = 'hidden';
    popup.querySelector('.modal-close').focus();
  }

  function closePopup() {
    popup.classList.remove('active');
    document.body.style.overflow = '';
  }

  // ---------- loading ----------

  async function fetchReviews(attempt = 0) {
    try {
      const res = await fetch(API_URL, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error('API returned ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Invalid API response');
      return data;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY));
        return fetchReviews(attempt + 1);
      }
      throw err;
    }
  }

  async function loadReviews() {
    try {
      renderReviews(await fetchReviews());
    } catch (err) {
      console.error('Error fetching reviews:', err);
      showError('Reviews are taking a nap. Check back soon!');
    }
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    track = document.getElementById('reviews-scroll');
    if (!track) return;
    wrap = document.getElementById('reviews-track-wrap');
    nav = document.getElementById('reviews-nav');
    prevBtn = document.getElementById('reviews-prev');
    nextBtn = document.getElementById('reviews-next');
    progress = document.getElementById('reviews-progress');
    progressFill = document.getElementById('reviews-progress-fill');
    progressText = document.getElementById('reviews-progress-text');

    track.addEventListener('click', e => {
      const btn = e.target.closest('.review-more');
      if (btn) openPopup(Number(btn.dataset.index));
    });
    initNav();
    loadReviews();
  }

  init();
})();
