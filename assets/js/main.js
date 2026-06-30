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

  // Store translations globally for other scripts
  window.OROS_TRANSLATIONS = translations;

  async function loadTranslations() {
    try {
      const resp = await fetch(baseUrl + 'translations.json');
      translations = await resp.json();
      window.OROS_TRANSLATIONS = translations;
    } catch(e) {
      console.warn('Could not load translations:', e);
      translations = { en: {}, el: {} };
      window.OROS_TRANSLATIONS = translations;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    initTheme();
    initLanguage();
    initBackToTop();
    applyTranslationsOnInit();
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

      // Listen for system theme changes only if no manual preference
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

    const lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    const t = translations[lang] || translations.en;
    btn.title = nextTheme === 'dark'
      ? (t.theme_light || 'Light mode')
      : (t.theme_dark || 'Dark mode');

    btn.onclick = () => {
      applyTheme(nextTheme);
      renderThemeButton(nextTheme);
    };
  }

  // ---------- Language ----------
  function initLanguage() {
    const savedLang = localStorage.getItem(STORAGE_KEY.LANGUAGE);

    let currentLang;
    if (savedLang && ['el', 'en'].includes(savedLang)) {
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
    const trans = translations[lang] || translations.en;
    translatePage(trans, lang);
    localStorage.setItem(STORAGE_KEY.LANGUAGE, lang);

    // Refresh any buttons/text that depend on language
    if (typeof window.updateAllLabels === 'function') {
      window.updateAllLabels(lang, trans);
    }
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

    document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
      const key = el.getAttribute('data-i18n-tooltip');
      if (trans[key]) el.title = trans[key];
    });
  }

  function applyTranslationsOnInit() {
    const lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    const trans = translations[lang] || translations.en;

    // Apply to all elements that need translation
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (trans[key]) el.textContent = trans[key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (trans[key]) el.placeholder = trans[key];
    });

    // Update tooltip/title attributes
    document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
      const key = el.getAttribute('data-i18n-tooltip');
      if (trans[key]) el.title = trans[key];
    });

    // Set theme button title
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      themeBtn.title = nextTheme === 'dark'
        ? (trans.theme_light || 'Light mode')
        : (trans.theme_dark || 'Dark mode');
    }
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

  // ========== GLOBAL SHORTCUTS ==========
  document.addEventListener('keydown', (e) => {
    // F9 = Zen mode toggle (works across all pages/applications)
    if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (typeof window.toggleZenMode === 'function') {
        window.toggleZenMode();
      }
    }

    // Ctrl/Cmd+S anywhere (for quick save in editor context)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      // Let the page handle its own save logic
      // This is just a placeholder - actual save happens in editor-tools.js
    }
  });

})();