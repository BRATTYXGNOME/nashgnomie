// ==========================================
// FAN REVIEWS SYSTEM
// ==========================================

(function() {
  'use strict';

  // ==========================================
  // PRODUCTION API CONFIGURATION
  // ==========================================
  const BASE_URL = 'https://nashgnomie-reviews-api.onrender.com';
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
    
    // Round to nearest 0.5
    const roundedRating = Math.round(rating * 2) / 2;
    const fullStars = Math.floor(roundedRating);
    const hasHalfStar = roundedRating % 1 !== 0;
    
    let starsHTML = '';
    
    // Add full stars
    for (let i = 0; i < fullStars; i++) {
      starsHTML += fullStar;
    }
    
    // Add half star (rendered as full star for simplicity)
    if (hasHalfStar) {
      starsHTML += fullStar;
    }
    
    // Add empty stars
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
    
    return Math.round(avg * 10) / 10; // Round to 1 decimal place
  }

  // ==========================================
  // ESCAPE HTML (Security)
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
    
    // Clear loading skeletons
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
    
    // Render each review card
    reviews.forEach(review => {
      const card = renderReviewCard(review);
      reviewsScroll.appendChild(card);
    });
    
    // Update average rating display
    const avgRating = calculateAverageRating(reviews);
    if (avgStarsElement && avgRatingElement) {
      avgStarsElement.innerHTML = renderStars(avgRating);
      avgRatingElement.textContent = `${avgRating}/10`;
    }
    
    // Add scroll fade-in animation
    setTimeout(() => {
      const cards = reviewsScroll.querySelectorAll('.review-card');
      cards.forEach((card, index) => {
        setTimeout(() => {
          card.style.opacity = '0';
          card.style.transform = 'translateY(20px)';
          card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
          
          requestAnimationFrame(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
          });
        }, index * 100); // Stagger by 100ms
      });
    }, 50);
  }

  // ==========================================
  // SHOW ERROR STATE
  // ==========================================
  function showError(message) {
    if (!reviewsScroll) return;
    
    reviewsScroll.innerHTML = `
      <div class="reviews-error">
        ⚠️ ${escapeHTML(message || 'Could not load reviews. Please try again later.')}
      </div>
    `;
    
    // Hide average rating on error
    if (avgStarsElement && avgRatingElement) {
      avgStarsElement.innerHTML = '';
      avgRatingElement.textContent = 'N/A';
    }
  }

  // ==========================================
  // FETCH REVIEWS FROM API
  // ==========================================
  async function fetchReviews(retryCount = 0) {
    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-store' // Always get fresh data
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Validate data is an array
      if (!Array.isArray(data)) {
        throw new Error('Invalid API response format');
      }
      
      return data;
      
    } catch (error) {
      console.error('Error fetching reviews:', error);
      
      // Retry logic
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
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
    try {
      const reviews = await fetchReviews();
      renderReviews(reviews);
      initSwipeGestures();
    } catch (error) {
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
    
    // Not a swipe, just a tap
    if (Math.abs(swipeDistance) < swipeThreshold) return;
    
    const scrollAmount = 340; // Card width (320px) + gap (18px)
    
    if (swipeDistance > 0) {
      // Swiped right - scroll left (previous)
      reviewsScroll.scrollBy({
        left: -scrollAmount,
        behavior: 'smooth'
      });
    } else {
      // Swiped left - scroll right (next)
      reviewsScroll.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  }

  // ==========================================
  // MOUSE WHEEL HORIZONTAL SCROLL
  // ==========================================
  function initMouseWheelScroll() {
    if (!reviewsScroll) return;
    
    reviewsScroll.addEventListener('wheel', (e) => {
      // Only hijack vertical scroll if there's horizontal scrolling available
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
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    
    // Get DOM elements
    reviewsScroll = document.getElementById('reviews-scroll');
    avgStarsElement = document.getElementById('avg-stars');
    avgRatingElement = document.getElementById('avg-rating');
    
    // Check if reviews section exists on this page
    if (!reviewsScroll) {
      console.log('Reviews section not found on this page');
      return;
    }
    
    // Initialize mouse wheel horizontal scroll
    initMouseWheelScroll();
    
    // Load reviews
    loadReviews();
  }

  // Start initialization
  init();

})();