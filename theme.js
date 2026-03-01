// theme.js
(function(){
  const themeToggle = document.getElementById('themeToggle');
  const bgToggle = document.getElementById('bgToggle');

  const themes = [
    { name: 'light', icon: '☀️', btn: 'rgba(255,255,255,0.08)', btnHover: 'rgba(255,255,255,0.16)' },
    { name: 'dark',  icon: '🌙', btn: 'rgba(255,255,255,0.06)', btnHover: 'rgba(255,255,255,0.12)' },
    { name: 'grey',  icon: '🌫', btn: 'rgba(255,255,255,0.08)', btnHover: 'rgba(255,255,255,0.18)' }
  ];

  let currentThemeIndex = localStorage.getItem('themeIndex') ? parseInt(localStorage.getItem('themeIndex')) : 1;
  if (Number.isNaN(currentThemeIndex)) currentThemeIndex = 1;

  // Try to apply saved bg mode if bg is available
  const savedBg = localStorage.getItem('bgMode');
  if (savedBg !== null && window.bg && typeof window.bg.setMode === 'function') {
    try { window.bg.setMode(parseInt(savedBg)); } catch(e){}
  }

  applyTheme(currentThemeIndex);

  if (themeToggle) themeToggle.addEventListener('click', () => {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    localStorage.setItem('themeIndex', String(currentThemeIndex));
    applyTheme(currentThemeIndex);
  });

  if (bgToggle) bgToggle.addEventListener('click', () => {
    if (window.bg && typeof window.bg.nextMode === 'function') {
      window.bg.nextMode();
      localStorage.setItem('bgMode', String(window.bg.getCurrentMode()));
    }
  });

  function applyTheme(index) {
    const t = themes[index] || themes[1];
    // Force body colors to maintain contrast (your design forces white text)
    document.body.style.color = '#fff';
    document.documentElement.style.setProperty('--text', '#fff');
    document.documentElement.style.setProperty('--btn-bg', t.btn);
    document.documentElement.style.setProperty('--btn-hover', t.btnHover);

    // update theme toggle icon
    if (themeToggle) themeToggle.textContent = t.icon;

    // update background toggle text/icon if needed
    if (bgToggle) bgToggle.title = 'Change Background';
  }
})();
