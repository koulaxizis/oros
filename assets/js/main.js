// ============================================
// orOS — Core Functionality
// Theme | Language | Back-to-top | Zen Mode | Settings
// ============================================

(function() {
  var STORAGE_KEY = {
    THEME: 'oros-theme',
    LANGUAGE: 'oros-language'
  };

  var scriptEl = document.querySelector('script[src$="main.js"]');
  var baseUrl = scriptEl ? scriptEl.src.replace(/main\.js$/, '') : 'assets/js/';

  var translations = {};
  window.OROS_TRANSLATIONS = translations;

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  async function loadTranslations() {
    try {
      var resp = await fetch(baseUrl + 'translations.json');
      translations = await resp.json();
      window.OROS_TRANSLATIONS = translations;
    } catch(e) {
      console.warn('Could not load translations:', e);
      translations = { en: {}, el: {} };
      window.OROS_TRANSLATIONS = translations;
    }
  }

  document.addEventListener('DOMContentLoaded', async function() {
    await loadTranslations();
    initTheme();
    initLanguage();
    initBackToTop();
    initZenMode();
    initSettings();
    applyTranslationsOnInit();
    updateFooterCredits();
  });

  // ---------- Theme ----------
  function initTheme() {
    var savedTheme = localStorage.getItem(STORAGE_KEY.THEME);
    if (savedTheme) {
      applyTheme(savedTheme);
      renderThemeButton(savedTheme);
    } else {
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
      renderThemeButton(prefersDark ? 'dark' : 'light');
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
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
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    btn.innerHTML = nextTheme === 'dark' ? '\uD83C\uDF19' : '\u2600\uFE0F';
    var lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    var t = (translations[lang] || translations.en) || {};
    btn.title = nextTheme === 'dark' ? (t.theme_dark || 'Dark') : (t.theme_light || 'Light');
    btn.onclick = function() {
      applyTheme(nextTheme);
      renderThemeButton(nextTheme);
    };
  }

  // ---------- Language ----------
  function initLanguage() {
    var savedLang = localStorage.getItem(STORAGE_KEY.LANGUAGE);
    var currentLang;
    if (savedLang && ['el', 'en'].indexOf(savedLang) !== -1) {
      currentLang = savedLang;
    } else {
      var bl = navigator.language.split('-')[0].toLowerCase();
      currentLang = ['el', 'en'].indexOf(bl) !== -1 ? bl : 'en';
    }
    applyLanguage(currentLang);
    renderLangSelector(currentLang);
  }

  function applyLanguage(lang) {
    var trans = translations[lang] || translations.en;
    translatePage(trans, lang);
    localStorage.setItem(STORAGE_KEY.LANGUAGE, lang);
    updateFooterCredits();
    updateSettingsModalLanguage(lang);
  }

  function translatePage(trans, lang) {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (trans[key]) el.textContent = trans[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (trans[key]) {
        el.placeholder = trans[key];
        el.setAttribute('data-placeholder', trans[key]);
      }
    });
    document.querySelectorAll('[data-i18n-alt]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-alt');
      if (trans[key]) el.alt = trans[key];
    });
    document.querySelectorAll('[data-i18n-tooltip]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-tooltip');
      if (trans[key]) el.title = trans[key];
    });
  }

  function applyTranslationsOnInit() {
    var lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    var trans = translations[lang] || translations.en;
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (trans[key]) el.textContent = trans[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (trans[key]) {
        el.placeholder = trans[key];
        el.setAttribute('data-placeholder', trans[key]);
      }
    });
    document.querySelectorAll('[data-i18n-tooltip]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-tooltip');
      if (trans[key]) el.title = trans[key];
    });
  }

  function renderLangSelector(currentLang) {
    var select = document.getElementById('language-select');
    if (!select) return;
    select.innerHTML = '';
    var opts = [
      { value: 'el', label: 'EL' },
      { value: 'en', label: 'EN' }
    ];
    opts.forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === currentLang) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = function(e) {
      applyLanguage(e.target.value);
    };
  }

  // ---------- Footer Credits ----------
  function updateFooterCredits() {
    var lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    var trans = translations[lang] || translations.en;
    var creditEl = document.querySelector('.footer-credits');
    if (!creditEl) return;
    var linkText = trans.footer_credits_link || 'Christos Koulaxizis';
    var suffix = trans.footer_credits_suffix || '. Built with \u2665 for artists.';
    creditEl.innerHTML = '\u00A9 2026 <a href="https://koulaxizis.gr" target="_blank" rel="noopener" class="footer-link">' + linkText + '</a>' + suffix;
  }

  // ---------- Back to Top ----------
  function initBackToTop() {
    var btn = document.getElementById('back-to-top');
    if (!btn) return;
    window.addEventListener('scroll', function() {
      btn.classList.toggle('visible', window.scrollY > 300);
    }, { passive: true });
    btn.onclick = function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  // ---------- Zen Mode ----------
  var zenActive = false;

  function initZenMode() {
    var btn = document.getElementById('btn-zen');
    if (!btn) return;
    zenActive = localStorage.getItem('oros-zen') === 'true';
    if (zenActive) {
      document.documentElement.setAttribute('data-zen', 'true');
    }
    btn.onclick = toggleZenMode;
    document.addEventListener('keydown', function(e) {
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
    var lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    var msg = lang === 'el'
      ? '\uD83E\uDDD8 Zen Mode \u2014 \u03A0\u03AC\u03C4\u03B1 ESC \u03AE F9 \u03B3\u03B9\u03B1 \u03AD\u03BE\u03BF\u03B4\u03BF'
      : '\uD83E\uDDD8 Zen Mode \u2014 Press ESC or F9 to exit';
    var toast = document.createElement('div');
    toast.className = 'zentool-toast visible';
    toast.id = 'zen-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() {
      var t = document.getElementById('zen-toast');
      if (t) t.classList.remove('visible');
    }, 3500);
  }

  function removeZenToast() {
    var t = document.getElementById('zen-toast');
    if (t) t.remove();
  }

  // ---------- Settings Modal ----------
  function initSettings() {
    var btn = document.getElementById('btn-settings');
    if (!btn) return;
    btn.onclick = openSettingsModal;
  }

  function openSettingsModal() {
    var existing = document.querySelector('.settings-modal');
    if (existing) existing.remove();

    var lang = localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
    var isEditor = !!document.getElementById('editor') || !!document.getElementById('rich-editor');

    var globalShortcuts, editorShortcuts;

    if (lang === 'el') {
      globalShortcuts = [
        ['Zen Mode', 'F9'],
        ['\u0388\u03BE\u03BF\u03B4\u03BF\u03C2 Zen', 'ESC'],
        ['\u03A4\u03C5\u03C0\u03BF\u03B3\u03C1\u03B1\u03C6\u03B9\u03BA\u03CC \u03C1\u03C5\u03B8\u03BC\u03CC', 'Ctrl+Enter']
      ];
      editorShortcuts = [
        ['\u0391\u03C0\u03BF\u03B8\u03AE\u03BA\u03B5\u03C5\u03C3\u03B7', 'Ctrl+S'],
        ['\u0388\u03BD\u03C4\u03BF\u03BD\u03B1', 'Ctrl+B'],
        ['\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1', 'Ctrl+I'],
        ['\u0391\u03BD\u03B1\u03AF\u03C1\u03B5\u03C3\u03B7', 'Ctrl+Z'],
        ['\u0395\u03C0\u03B1\u03BD\u03B1\u03C6\u03BF\u03C1\u03AC', 'Ctrl+Y'],
        ['\u0391\u03BD\u03B1\u03B6\u03AE\u03C4\u03B7\u03C3\u03B7', 'Ctrl+F'],
        ['\u0391\u03BD\u03C4\u03B9\u03BA\u03B1\u03C4\u03AC\u03C3\u03C4\u03B1\u03C3\u03B7', 'Ctrl+H'],
        ['\u039C\u03BF\u03C1\u03C6\u03BF\u03C0\u03BF\u03AF\u03B7\u03C3\u03B7', 'Alt + \u0394\u03B5\u03BE\u03AF click']
      ];
    } else {
      globalShortcuts = [
        ['Zen Mode', 'F9'],
        ['Exit Zen', 'ESC'],
        ['Typewriter mode', 'Ctrl+Enter']
      ];
      editorShortcuts = [
        ['Save', 'Ctrl+S'],
        ['Bold', 'Ctrl+B'],
        ['Italic', 'Ctrl+I'],
        ['Undo', 'Ctrl+Z'],
        ['Redo', 'Ctrl+Y'],
        ['Find', 'Ctrl+F'],
        ['Replace', 'Ctrl+H'],
        ['Format', 'Alt + Right-click']
      ];
    }

    var allShortcuts = isEditor ? globalShortcuts.concat(editorShortcuts) : globalShortcuts;

    var title = lang === 'el' ? '\u03A1\u03C5\u03B8\u03BC\u03AF\u03C3\u03B5\u03B9\u03C2' : 'Settings';
    var tabLabel = lang === 'el' ? '\u03A3\u03C5\u03BD\u03C4\u03BF\u03BC\u03B5\u03CD\u03C3\u03B5\u03B9\u03C2' : 'Shortcuts';
    var colAction = lang === 'el' ? '\u0395\u03BD\u03AD\u03C1\u03B3\u03B5\u03B9\u03B1' : 'Action';
    var colKey = lang === 'el' ? '\u03A3\u03C5\u03BD\u03C4\u03CC\u03BC\u03B5\u03C5\u03C3\u03B7' : 'Shortcut';
    var installLabel = lang === 'el' ? '\u0395\u03B3\u03BA\u03B1\u03C4\u03AC\u03C3\u03C4\u03B1\u03C3\u03B7' : 'Install App';

    var shortcutsHtml = '';
    allShortcuts.forEach(function(pair) {
      shortcutsHtml += '<tr><td>' + pair[0] + '</td><td><kbd>' + pair[1] + '</kbd></td></tr>';
    });

    var modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal-content">' +
        '<header class="modal-header">' +
          '<h2>' + title + '</h2>' +
          '<button class="close-btn">\u00D7</button>' +
        '</header>' +
        '<nav class="modal-nav">' +
          '<button class="tab-btn active">' + tabLabel + '</button>' +
        '</nav>' +
        '<div class="tab-panel">' +
          '<table class="shortcut-table">' +
            '<thead><tr><th>' + colAction + '</th><th>' + colKey + '</th></tr></thead>' +
            '<tbody>' + shortcutsHtml + '</tbody>' +
          '</table>' +
          '<div class="install-section">' +
            '<button class="btn-install" id="btn-install-pwa">\u2B07 ' + installLabel + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var closeFn = function() { modal.remove(); };
    modal.querySelector('.close-btn').onclick = closeFn;
    modal.querySelector('.modal-backdrop').onclick = closeFn;

    var installBtn = modal.querySelector('#btn-install-pwa');
    installBtn.onclick = async function() {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        var choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.disabled = true;
        installBtn.textContent = lang === 'el' ? '\u2713 \u0395\u03B3\u03BA\u03B1\u03C4\u03B1\u03C3\u03C4\u03AC\u03B8\u03B7\u03BA\u03B5' : '\u2713 Installed';
      } else {
        installBtn.disabled = true;
        installBtn.textContent = lang === 'el' ? '\u26A0 \u0394\u03B5\u03BD \u03C5\u03C0\u03BF\u03C3\u03C4\u03B7\u03C1\u03AF\u03B6\u03B5\u03C4\u03B1\u03B9' : '\u26A0 Not supported';
      }
    };

    if (!deferredPrompt) {
      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        installBtn.disabled = true;
        installBtn.textContent = lang === 'el' ? '\u2713 \u0395\u03B3\u03BA\u03B1\u03C4\u03B5\u03C3\u03C4\u03B7\u03BC\u03AD\u03BD\u03BF' : '\u2713 Already installed';
      }
    }

    document.body.appendChild(modal);
  }

  function updateSettingsModalLanguage(lang) {
    var existing = document.querySelector('.settings-modal');
    if (existing) {
      existing.remove();
      openSettingsModal();
    }
  }

})();