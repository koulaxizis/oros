// ============================================
// orOS — Core Functionality
// Theme Toggle | Language Switcher | Back-to-top
// System Preferences Respect
// ============================================

(function() {
  const STORAGE_KEY = {
    THEME: 'oros-theme',
    LANGUAGE: 'oros-language'
  };

  // Compute base path from this script's location
  const scriptEl = document.querySelector('script[src$="main.js"]');
  const baseUrl = scriptEl ? scriptEl.src.replace(/main\.js$/, '') : 'assets/js/';

  let translations = {};
  
  async function loadTranslations() {
    try {
      const resp = await fetch(baseUrl + 'translations.json');
      translations = await resp.json();
    } catch(e) {
      console.warn('Could not load translations:', e);
      translations = { en: {}, el: {} };
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    initTheme();
    initLanguage();
    initBackToTop();
  });

  // ---------- Theme ----------
  function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEY.THEME);
    
    if (savedTheme) {
      applyTheme(savedTheme);
      renderThemeButton(savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const systemTheme = prefersDark ? 'dark' : 'light';
      applyTheme(systemTheme);
      renderThemeButton(systemTheme);
      
      // Listen for system theme changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const newTheme = e.matches ? 'dark' : 'light';
        if (!localStorage.getItem(STORAGE_KEY.THEME)) {
          applyTheme(newTheme);
          renderThemeButton(newTheme);
        }
      });
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY.THEME, theme);
  }

  function renderThemeButton(currentTheme) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    btn.innerHTML = nextTheme === 'dark' 
      ? '<span class="icon">🌙</span>' 
      : '<span class="icon">☀️</span>';
    
    btn.title = nextTheme === 'dark' ? 'Light mode' : 'Dark mode';
    btn.onclick = () => {
      applyTheme(nextTheme);
      renderThemeButton(nextTheme);
    };
  }

  // ---------- Language ----------
  function initLanguage() {
    const savedLang = localStorage.getItem(STORAGE_KEY.LANGUAGE);
    
    let currentLang;
    if (savedLang) {
      currentLang = savedLang;
    } else {
      const browserLang = navigator.language.split('-')[0].toLowerCase();
      const supportedLanguages = ['el', 'en'];
      currentLang = supportedLanguages.includes(browserLang) ? browserLang : 'en';
    }
    
    applyLanguage(currentLang);
    renderLangSelector(currentLang);
  }

  function applyLanguage(lang) {
    const t = translations[lang] || translations.en;
    translatePage(t, lang);
    localStorage.setItem(STORAGE_KEY.LANGUAGE, lang);
  }

  function translatePage(trans, lang) {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (trans[key]) el.textContent = trans[key];
    });
    
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (trans[key]) el.placeholder = trans[key];
    });
    
    document.querySelectorAll('[data-i18n-alt]').forEach(el => {
      const key = el.getAttribute('data-i18n-alt');
      if (trans[key]) el.alt = trans[key];
    });
  }

  function renderLangSelector(currentLang) {
    const select = document.getElementById('language-select');
    if (!select) return;
    
    select.innerHTML = '';
    
    [
      { value: 'el', label: 'EL' },
      { value: 'en', label: 'EN' }
    ].forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === currentLang) option.selected = true;
      select.appendChild(option);
    });
    
    select.onchange = (e) => {
      applyLanguage(e.target.value);
    };
  }

  // ---------- Back to Top ----------
  function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;
    
    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    }, { passive: true });
    
    btn.onclick = () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

})();