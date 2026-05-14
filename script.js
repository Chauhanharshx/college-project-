const menuToggle = document.getElementById('menuToggle');
const siteNav = document.getElementById('siteNav');
const yearSpan = document.getElementById('year');

yearSpan.textContent = new Date().getFullYear();

menuToggle.addEventListener('click', () => {
  siteNav.classList.toggle('open');
});

const navLinks = document.querySelectorAll('.site-nav a');
navLinks.forEach(link => {
  link.addEventListener('click', () => {
    siteNav.classList.remove('open');
  });
});
