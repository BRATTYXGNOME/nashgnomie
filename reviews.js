// ==========================================
// FAN REVIEWS SYSTEM
// ==========================================

(function() {
  'use strict';

  // ==========================================
  // PRODUCTION API CONFIGURATION
  // ==========================================
  const BASE_URL = 'https://nashgnomie.onrender.com';
  const API_URL = BASE_URL + '/reviews';
  
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 1000; // 1 second

  // DOM Elements
  let reviewsScroll = null;
  let avgStarsElement = null;
  let avgRatingElement = null;

  // Touch swipe variables
  let touchStartX = 0;
  let touchEndX = 0;
  const swipeThreshold = 50;

  // ==========================================
  // RENDER PINK STARS FROM RATING
  // ==========================================
  function renderStars(rating) {
    const fullStar = '★';
    const emptyStar = '☆';
    const maxStars = 10;
    
    const roundedRating = Math.round(rating * 2) / 2;
    const fullStars = Math.floor(roundedRating);
    const hasHalfStar = roundedRating % 1 !== 0;
    
    let starsHTML = '';
    
    for (let i = 0; i < fullStars; i++) {
      starsHTML += fullStar;
    }
    
    if (hasHalfStar) {
      starsHTML += fullStar;
    }
    
    const emptyCount = maxStars - Math.ceil(roundedRating);
    for (let i = 0; i < emptyCount; i++) {
      starsHTML += emptyStar;
    }
    
    return starsHTML;
  }

  // ==========================================
  // CALCULATE AVERAGE RATING
  // ==========================================
  function calculateAverageRating(reviews) {
    if (!reviews || reviews.length === 0) return 0;
    const sum = reviews.reduce((acc, review) => acc + (review.rating || 0), 0);
    const avg = sum / reviews.length;
    return Math.round(avg * 10) / 10;
  }

  // ==========================================
  // ESCAPE HTML
  // ==========================================
  function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==========================================
  // RENDER SINGLE REVIEW CARD
  // ==========================================
  function renderReviewCard(review) {
    const card = document.createElement('article');
    card.className = 'review-card';
    
    const stars = renderStars(review.rating || 0);
    const username = escapeHTML(review.username || 'Anonymous');
    const timeText = escapeHTML(review.time_text || '');
    const reviewTitle = review.review_title ? escapeHTML(review.review_title) : '';
    const reviewText = escapeHTML(review.review_text || '');
    const avatarUrl = escapeHTML(review.avatar_url || '');
    const permalink = escapeHTML(review.permalink || '');
    
    card.innerHTML = `
  <div class="review-header">
    <img class="review-avatar" 
         src="${avatarUrl}" 
         alt="${username}" 
         onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ccircle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22%231b1b1b%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22%23ff5fa2%22%3E${username.charAt(0).toUpperCase()}%3C/text%3E%3C/svg%3E'" />
    <div class="review-user-info">
      <div class="review-username">${username}</div>
      <div class="review-time">${timeText}</div>
      <div class="review-rating-stars">${stars}</div>
    </div>
  </div>
  ${reviewTitle ? `<h3 class="review-title">${reviewTitle}</h3>` : ''}
  <p class="review-body">${reviewText}</p>
  <div class="review-footer">
    ${permalink ? `<a class="review-link" href="${permalink}" target="_blank" rel="noopener">View on Fan.Reviews →</a>` : ''}
  </div>
`;
    
    return card;
  }

  // ==========================================
  // RENDER ALL REVIEWS
  // ==========================================
  function renderReviews(reviews) {
    if (!reviewsScroll) return;
    
    reviewsScroll.innerHTML = '';
    
    if (!reviews || reviews.length === 0) {
      reviewsScroll.innerHTML = `
        <div class="reviews-empty">
          <div class="reviews-empty-icon">⭐</div>
          <p>No reviews yet. Be the first to leave one!</p>
        </div>
      `;
      return;
    }
    
    reviews.forEach(review => {
      const card = renderReviewCard(review);
      reviewsScroll.appendChild(card);
    });
    
    const avgRating = calculateAverageRating(reviews);
    if (avgStarsElement && avgRatingElement) {
      avgStarsElement.innerHTML = renderStars(avgRating);
      avgRatingElement.textContent = `${avgRating}/10`;
    }
  }

  // ==========================================
  // SHOW ERROR STATE
  // ==========================================
  function showError(message) {
    if (!reviewsScroll) return;
    
    reviewsScroll.innerHTML = `
      <div class="reviews-error">
        ⚠️ ${escapeHTML(message || 'Could not load reviews.')}
      </div>
    `;
    
    if (avgStarsElement && avgRatingElement) {
      avgStarsElement.innerHTML = '';
      avgRatingElement.textContent = 'N/A';
    }
  }

  // ==========================================
  // FETCH REVIEWS FROM API (WITH SAFE DEBUG LOGS)
  // ==========================================
  async function fetchReviews(retryCount = 0) {

    console.log('[reviews.js] Fetching:', API_URL);

    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });

      console.log('[reviews.js] Status:', response.status);

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      console.log('[reviews.js] Received items:', Array.isArray(data) ? data.length : 'NOT ARRAY');

      if (!Array.isArray(data)) {
        throw new Error('Invalid API format');
      }

      return data;

    } catch (error) {
      console.error('[reviews.js] Fetch error:', error);

      if (retryCount < MAX_RETRIES) {
        console.log(`[reviews.js] Retry ${retryCount + 1}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return fetchReviews(retryCount + 1);
      }

      throw error;
    }
  }

  // ==========================================
  // LOAD AND DISPLAY REVIEWS
  // ==========================================
  async function loadReviews() {
    console.log('[reviews.js] loadReviews() called');

    try {
      const reviews = await fetchReviews();
      console.log('[reviews.js] Rendering reviews…');
      renderReviews(reviews);
      initSwipeGestures();

    } catch (error) {
      console.log('[reviews.js] loadReviews() FAILED');
      showError('Unable to load reviews at this time.');
    }
  }

  // ==========================================
  // TOUCH SWIPE GESTURES
  // ==========================================
  function initSwipeGestures() {
    if (!reviewsScroll) return;
    
    reviewsScroll.addEventListener('touchstart', handleTouchStart, { passive: true });
    reviewsScroll.addEventListener('touchend', handleTouchEnd, { passive: true });
  }

  function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
  }

  function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }

  function handleSwipe() {
    if (!reviewsScroll) return;
    
    const swipeDistance = touchEndX - touchStartX;
    if (Math.abs(swipeDistance) < swipeThreshold) return;
    
    const scrollAmount = 340;
    
    if (swipeDistance > 0) {
      reviewsScroll.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
      reviewsScroll.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  }

  // ==========================================
  // MOUSE WHEEL HORIZONTAL SCROLL
  // ==========================================
  function initMouseWheelScroll() {
    if (!reviewsScroll) return;
    
    reviewsScroll.addEventListener('wheel', (e) => {
      if (reviewsScroll.scrollWidth > reviewsScroll.clientWidth) {
        e.preventDefault();
        reviewsScroll.scrollBy({
          left: e.deltaY,
          behavior: 'smooth'
        });
      }
    }, { passive: false });
  }

  // ==========================================
  // INITIALIZE
  // ==========================================
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    
    reviewsScroll = document.getElementById('reviews-scroll');
    avgStarsElement = document.getElementById('avg-stars');
    avgRatingElement = document.getElementById('avg-rating');
    
    if (!reviewsScroll) {
      console.log('[reviews.js] No #reviews-scroll element found');
      return;
    }
    
    initMouseWheelScroll();
    loadReviews();
  }

  init();

})();
