// ============================================
// orOS — Core Functionality
// Theme | Language | Back-to-top | Zen Mode | Settings
// ============================================

(function() {
  const STORAGE_KEY = {
    THEME: 'oros-theme',
    LANGUAGE: 'oros-language'
  };

  const scriptEl = document.querySelector('script[src$="main.js"]');
  const baseUrl = scriptEl ? scriptEl.src.replace(/main\.js$/, '') : 'assets/js/';

  let translations = {};
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
    initZenMode();
    initSettings();
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
      applyTheme(prefersDark ? 'dark' : 'light');
      renderThemeButton(prefersDark ? 'dark' : 'light');
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(STORAGE_KEY.THEME)) {
          applyTheme(e.matches ? 'dark' : 'light');
          renderThemeButton(e.matches ? 'dark' : 'light');
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
    btn.innerHTML = nextTheme === 'dark' ? '🌙' : '☀️';
    const lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    const t = (translations[lang] || translations.en) || {};
    btn.title = nextTheme === 'dark' ? (t.theme_dark || 'Dark') : (t.theme_light || 'Light');
    btn.onclick = () => { applyTheme(nextTheme); renderThemeButton(nextTheme); };
  }

  // ---------- Language ----------
  function initLanguage() {
    const savedLang = localStorage.getItem(STORAGE_KEY.LANGUAGE);
    let currentLang;
    if (savedLang && ['el','en'].includes(savedLang)) {
      currentLang = savedLang;
    } else {
      const bl = navigator.language.split('-')[0].toLowerCase();
      currentLang = ['el','en'].includes(bl) ? bl : 'en';
    }
    applyLanguage(currentLang);
    renderLangSelector(currentLang);
  }

  function applyLanguage(lang) {
    const trans = translations[lang] || translations.en;
    translatePage(trans, lang);
    localStorage.setItem(STORAGE_KEY.LANGUAGE, lang);
    updateSettingsModalLanguage(lang);
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
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (trans[key]) el.textContent = trans[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (trans[key]) el.placeholder = trans[key];
    });
    document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
      const key = el.getAttribute('data-i18n-tooltip');
      if (trans[key]) el.title = trans[key];
    });
  }

  function renderLangSelector(currentLang) {
    const select = document.getElementById('language-select');
    if (!select) return;
    select.innerHTML = '';
    [{value:'el',label:'EL'},{value:'en',label:'EN'}].forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === currentLang) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = (e) => applyLanguage(e.target.value);
  }

  // ---------- Back to Top ----------
  function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;
    window.addEventListener('scroll', () => {
      btn.classList.toggle('visible', window.scrollY > 300);
    }, { passive: true });
    btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Zen Mode (GLOBAL) ----------
  let zenActive = false;

  function initZenMode() {
    const btn = document.getElementById('btn-zen');
    if (!btn) return;

    zenActive = localStorage.getItem('oros-zen') === 'true';
    if (zenActive) {
      document.documentElement.setAttribute('data-zen', 'true');
    }

    btn.onclick = toggleZenMode;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        toggleZenMode();
      }
      if (e.key === 'Escape' && zenActive) {
        toggleZenMode();
      }
    });
  }

  function toggleZenMode() {
    zenActive = !zenActive;
    if (zenActive) {
      document.documentElement.setAttribute('data-zen', 'true');
      localStorage.setItem('oros-zen', 'true');
      showZenToast();
    } else {
      document.documentElement.removeAttribute('data-zen');
      localStorage.removeItem('oros-zen');
      removeZenToast();
    }
  }

  window.toggleZenMode = toggleZenMode;

  function showZenToast() {
    removeZenToast();
    const lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    const msg = lang === 'el'
      ? '🧘 Zen Mode — Πάτα ESC ή F9 για έξοδο'
      : '🧘 Zen Mode — Press ESC or F9 to exit';
    const toast = document.createElement('div');
    toast.className = 'zentool-toast visible';
    toast.id = 'zen-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { const t = document.getElementById('zen-toast'); if (t) t.classList.remove('visible'); }, 3500);
  }

  function removeZenToast() {
    const t = document.getElementById('zen-toast');
    if (t) t.remove();
  }

  // ---------- Settings Modal (GLOBAL) ----------
  function initSettings() {
    const btn = document.getElementById('btn-settings');
    if (!btn) return;
    btn.onclick = openSettingsModal;
  }

  function openSettingsModal() {
    const existing = document.querySelector('.settings-modal');
    if (existing) existing.remove();

    const lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    const isEditor = !!document.getElementById('editor') || !!document.getElementById('rich-editor');

    const globalShortcuts = lang === 'el' ? [
      ['Zen Mode', 'F9'],
      ['Έξοδος Zen', 'ESC']
    ] : [
      ['Zen Mode', 'F9'],
      ['Exit Zen', 'ESC']
    ];

    const editorShortcuts = lang === 'el' ? [
      ['Αποθήκευση', 'Ctrl+S'],
      ['Μορφοποίηση', 'Δεξί click']
    ] : [
      ['Save', 'Ctrl+S'],
      ['Format', 'Right-click']
    ];

    const allShortcuts = isEditor ? [...globalShortcuts, ...editorShortcuts] : globalShortcuts;

    const title = lang === 'el' ? 'Ρυθμίσεις' : 'Settings';
    const tabLabel = lang === 'el' ? 'Συντομεύσεις' : 'Shortcuts';
    const colAction = lang === 'el' ? 'Ενέργεια' : 'Action';
    const colKey = lang === 'el' ? 'Συντόμευση' : 'Shortcut';

    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <header class="modal-header">
          <h2>${title}</h2>
          <button class="close-btn">×</button>
        </header>
        <nav class="modal-nav">
          <button class="tab-btn active">${tabLabel}</button>
        </nav>
        <div class="tab-panel">
          <table class="shortcut-table">
            <thead><tr><th>${colAction}</th><th>${colKey}</th></tr></thead>
            <tbody>
              ${allShortcuts.map(([a,k]) => `<tr><td>${a}</td><td><kbd>${k}</kbd></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    const close = () => modal.remove();
    modal.querySelector('.close-btn').onclick = close;
    modal.querySelector('.modal-backdrop').onclick = close;
    document.body.appendChild(modal);
  }

  function updateSettingsModalLanguage(lang) {
    // If modal is open, rebuild it
    const existing = document.querySelector('.settings-modal');
    if (existing) {
      existing.remove();
      openSettingsModal();
    }
  }

})();