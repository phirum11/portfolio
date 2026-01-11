document.addEventListener('DOMContentLoaded', function () {
  var typed = new Typed('#typed-text', {
    strings: ['Frontend Developer', 'Creative Designer'],
    typeSpeed: 50,
    backSpeed: 50,
    backDelay: 1500,
    startDelay: 500,
    loop: true,
    showCursor: false
  });
});
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const targetId = this.getAttribute('href');
    if (targetId === '#') return;
    const targetElement = document.querySelector(targetId);
    if (targetElement) {
      window.scrollTo({
        top: targetElement.offsetTop - 70,
        behavior: 'smooth'
      });
    }
  });
});

// Navbar background on scroll
window.addEventListener('scroll', function () {
  const navbar = document.querySelector('.navbar');
  if (window.scrollY > 50) {
    navbar.style.backgroundColor = 'rgba(25, 25, 35, 0.95)';
  } else {
    navbar.style.backgroundColor = 'rgba(25, 25, 35, 0.9)';
  }
});

// Contact Form Submission
const form = document.getElementById('myForm');
const messageDiv = document.getElementById('formMessage');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  messageDiv.innerHTML = '<p class="text-info">Sending message...</p>';

  try {
    // Get form data
    const formData = new FormData(form);

    // Check if we're on localhost (development) or production
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    let success = false;

    if (isLocalhost) {
      // Try local backend first
      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.get('name'),
            email: formData.get('email'),
            subject: formData.get('subject'),
            message: formData.get('message')
          })
        });
        const result = await response.json();
        success = result.success || response.ok;
      } catch (e) {
        console.log('Local backend not available, using Cloudflare Worker');
      }
    }

    // Use Cloudflare Worker (for production or fallback)
    if (!success) {
      try {
        const response = await fetch(
          'https://telegram-proxy.ponphirum.workers.dev',
          {
            method: 'POST',
            body: formData
          }
        );
        const result = await response.json();
        success = result.ok;

        if (!success && result.error) {
          throw new Error(result.error);
        }
      } catch (workerError) {
        console.error('Worker error:', workerError);
        throw workerError;
      }
    }

    if (success) {
      messageDiv.innerHTML =
        '<p class="text-success">✅ Message sent successfully!</p>';
      form.reset();

      setTimeout(() => {
        messageDiv.innerHTML = '';
      }, 4000);
    }
  } catch (error) {
    messageDiv.innerHTML =
      '<p class="text-danger">Something went wrong. Please try again.</p>';
    console.error('Form error:', error);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
// Animate progress bars when in view
const progressBars = document.querySelectorAll('.progress-bar');
progressBars.forEach((bar) => {
  const width = bar.style.width;
  bar.style.width = '0%';
  setTimeout(() => {
    bar.style.width = width;
  }, 1000);
});
const offcanvasEl = document.getElementById('mobileMenu');
const menuBtn = document.getElementById('menuBtn');

offcanvasEl.addEventListener('show.bs.offcanvas', () => {
  menuBtn.classList.add('active');
});

offcanvasEl.addEventListener('hidden.bs.offcanvas', () => {
  menuBtn.classList.remove('active');
});
