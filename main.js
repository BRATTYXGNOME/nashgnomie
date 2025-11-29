// ==========================================
// STAR TWINKLING (Consolidated & Enhanced)
// ==========================================
function initStars() {
  if (document.querySelector('#stars .star')) return;
  
  const stars = document.getElementById('stars');
  if (!stars) return;
  
  for (let i = 0; i < 180; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + 'vw';
    star.style.top = Math.random() * 100 + 'vh';
    const size = Math.random() * 2.5 + 0.5;
    star.style.width = star.style.height = size + 'px';
    star.style.opacity = Math.random();
    star.style.position = 'absolute';
    star.style.background = '#fff';
    star.style.borderRadius = '50%';
    star.style.boxShadow = '0 0 8px #ff5fa2, 0 0 12px #fff';
    star.style.transition = `opacity ${0.8 + Math.random() * 1.2}s ease-in-out`;
    stars.appendChild(star);
  }
  
  setInterval(() => {
    document.querySelectorAll('#stars .star').forEach((star, index) => {
      setTimeout(() => {
        star.style.opacity = Math.random() * 0.8 + 0.2;
      }, (index % 10) * 50);
    });
  }, 1200);
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ DOMContentLoaded fired');
  
  initStars();
  
  const ageForm           = document.getElementById('age-form');
  const birthdateIn       = document.getElementById('birthdate');
  const ageError          = document.getElementById('age-error');
  const ageModal          = document.getElementById('age-modal');
  const ageInputContainer = document.getElementById('age-input-container');
  const underageBlock     = document.getElementById('underage-block');
  const mainNav           = document.getElementById('main-nav');
  const mainContent       = document.querySelector('main');

  console.log('🔍 Age gate elements found:', {
    ageForm: !!ageForm,
    birthdateIn: !!birthdateIn,
    ageError: !!ageError,
    ageModal: !!ageModal,
    mainNav: !!mainNav,
    mainContent: !!mainContent
  });

  if (birthdateIn) {
    birthdateIn.max = new Date().toISOString().split('T')[0];
  }

  if (ageForm) {
    console.log('✅ Age form found, adding submit listener');
    ageForm.addEventListener('submit', e => {
      e.preventDefault();
      console.log('🎯 FORM SUBMITTED!');
      
      if (ageError) ageError.textContent = '';
      
      if (!birthdateIn.value) {
        console.log('❌ No birthdate entered');
        if (ageError) ageError.textContent = 'Please enter your birthdate.';
        return;
      }
      
      console.log('📅 Birthdate entered:', birthdateIn.value);
      
      const birthdate = new Date(birthdateIn.value);
      const today     = new Date();
      let age = today.getFullYear() - birthdate.getFullYear();
      const m = today.getMonth() - birthdate.getMonth();
      
      if (m < 0 || (m === 0 && today.getDate() < birthdate.getDate())) {
        age--;
      }
      
      console.log('🎂 Calculated age:', age);
      
      if (age < 18) {
        console.log('❌ Underage');
        if (ageInputContainer) ageInputContainer.style.display = 'none';
        if (underageBlock) underageBlock.style.display = 'block';
      } else {
        console.log('✅ Adult! Showing main site...');
        if (ageModal) {
          ageModal.classList.remove('active');
          console.log('  ✓ Removed active class from modal');
        }
        if (mainNav) {
          mainNav.style.display = 'flex';
          console.log('  ✓ Set nav to flex');
        }
        if (mainContent) {
          mainContent.style.display = 'block';
          console.log('  ✓ Set content to block');
        }
        document.body.style.overflow = '';
        console.log('  ✓ Reset body overflow');
        console.log('🎉 SHOULD BE VISIBLE NOW!');
      }
    });
  } else {
    console.error('❌ AGE FORM NOT FOUND!');
  }
});
