// ============================================
// orOS — Core Functionality
// Theme | Language | Back-to-top | Zen Mode | Settings
// Settings: Shortcuts Tab + Appearance Tab (toggles)
// ============================================

(function() {
  var STORAGE_KEY = {
    THEME: 'oros-theme',
    LANGUAGE: 'oros-language',
    HIDE_STATS: 'oros_hide_stats',
    HIDE_QUICK_TBAR: 'oros_hide_quick_tbar',
    TYPEWRITER: 'oros_typewriter_mode'
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

  // ---------- Helpers ----------
  function getLang() {
    return localStorage.getItem(STORAGE_KEY.LANGUAGE) || 'en';
  }

  function getTrans(key) {
    var lang = getLang();
    var t = (translations[lang] || translations.en) || {};
    return t[key] || key;
  }

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
    var t = (translations[getLang()] || translations.en) || {};
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
    var lang = getLang();
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
    var trans = translations[getLang()] || translations.en;
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
    var msg = getLang() === 'el'
      ? '\uD83E\uDDD8 Zen Mode — Πάτα ESC ή F9 για έξοδο'
      : '\uD83E\uDDD8 Zen Mode — Press ESC or F9 to exit';
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

    var lang = getLang();
    var isEditor = !!document.getElementById('editor-container') || !!document.getElementById('rich-editor');

    // --- Shortcuts data ---
    var globalShortcuts, editorShortcuts;

    if (lang === 'el') {
      globalShortcuts = [
        ['Zen Mode', 'F9'],
        ['Έξοδος Zen', 'ESC'],
        ['Τυπογραφικό Ρυθμό', 'Ctrl+Enter']
      ];
      editorShortcuts = [
        ['Αποθήκευση', 'Ctrl+S'],
        ['Έντονα', 'Ctrl+B'],
        ['Πλάγια', 'Ctrl+I'],
        ['Υπογράμμιση', 'Ctrl+U'],
        ['Αναίρεση', 'Ctrl+Z'],
        ['Επαναφορά', 'Ctrl+Y'],
        ['Αναζήτηση', 'Ctrl+F'],
        ['Αντικατάσταση', 'Ctrl+H'],
        ['Μορφοποίηση', 'Alt + Δεξί click']
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
        ['Underline', 'Ctrl+U'],
        ['Undo', 'Ctrl+Z'],
        ['Redo', 'Ctrl+Y'],
        ['Find', 'Ctrl+F'],
        ['Replace', 'Ctrl+H'],
        ['Format', 'Alt + Right-click']
      ];
    }

    var allShortcuts = isEditor ? globalShortcuts.concat(editorShortcuts) : globalShortcuts;

    // --- Labels ---
    var title = getTrans('settings');
    var tabShortcutsLabel = getTrans('tab_shortcuts');
    var tabAppearanceLabel = getTrans('tab_appearance');
    var colAction = lang === 'el' ? 'Ενέργεια' : 'Action';
    var colKey = lang === 'el' ? 'Συντόμευση' : 'Shortcut';
    var installLabel = getTrans('install_app');

    // --- Shortcuts HTML ---
    var shortcutsHtml = '';
    allShortcuts.forEach(function(pair) {
      shortcutsHtml += '<tr><td>' + pair[0] + '</td><td><kbd>' + pair[1] + '</kbd></td></tr>';
    });

    // --- Toggle states ---
    var hideQuickTbar = localStorage.getItem(STORAGE_KEY.HIDE_QUICK_TBAR) === 'true';
    var hideStats = localStorage.getItem(STORAGE_KEY.HIDE_STATS) === 'true';
    var typewriterOn = localStorage.getItem(STORAGE_KEY.TYPEWRITER) === 'true';

    var toggleQuickLabel = getTrans('toggle_quick_toolbar');
    var toggleStatsLabel = getTrans('toggle_stats');
    var toggleTypewriterLabel = getTrans('toggle_typewriter');

    // --- Appearance toggles HTML ---
    var appearanceHtml =
      '<div class="toggle-row">' +
        '<span class="toggle-label">' + toggleQuickLabel + '</span>' +
        '<label class="switch"><input type="checkbox" id="toggle-quick-tbar"' + (hideQuickTbar ? '' : ' checked') + '><span class="slider"></span></label>' +
      '</div>' +
      '<div class="toggle-row">' +
        '<span class="toggle-label">' + toggleStatsLabel + '</span>' +
        '<label class="switch"><input type="checkbox" id="toggle-stats"' + (hideStats ? '' : ' checked') + '><span class="slider"></span></label>' +
      '</div>' +
      '<div class="toggle-row">' +
        '<span class="toggle-label">' + toggleTypewriterLabel + '</span>' +
        '<label class="switch"><input type="checkbox" id="toggle-typewriter"' + (typewriterOn ? ' checked' : '') + '><span class="slider"></span></label>' +
      '</div>';

    // --- Build modal ---
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
          '<button class="tab-btn active" data-tab="shortcuts">' + tabShortcutsLabel + '</button>' +
          '<button class="tab-btn" data-tab="appearance">' + tabAppearanceLabel + '</button>' +
        '</nav>' +
        '<div class="tab-panel" id="panel-shortcuts">' +
          '<table class="shortcut-table">' +
            '<thead><tr><th>' + colAction + '</th><th>' + colKey + '</th></tr></thead>' +
            '<tbody>' + shortcutsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
        '<div class="tab-panel" id="panel-appearance" style="display:none;">' +
          '<div class="toggles-container">' + appearanceHtml + '</div>' +
        '</div>' +
        '<div class="install-section">' +
          '<button class="btn-install" id="btn-install-pwa">\u2B07 ' + installLabel + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    // --- Close handlers ---
    var closeFn = function() { modal.remove(); };
    modal.querySelector('.close-btn').onclick = closeFn;
    modal.querySelector('.modal-backdrop').onclick = closeFn;

    // --- Tab switching ---
    var tabBtns = modal.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(btn) {
      btn.onclick = function() {
        tabBtns.forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        var tabName = this.dataset.tab;
        modal.querySelector('#panel-shortcuts').style.display = tabName === 'shortcuts' ? '' : 'none';
        modal.querySelector('#panel-appearance').style.display = tabName === 'appearance' ? '' : 'none';
      };
    });

    // --- Toggle handlers ---
    var tbarToggle = modal.querySelector('#toggle-quick-tbar');
    if (tbarToggle) {
      tbarToggle.onchange = function() {
        var hide = !this.checked;
        localStorage.setItem(STORAGE_KEY.HIDE_QUICK_TBAR, hide ? 'true' : 'false');
        var qft = document.getElementById('quick-format-toolbar');
        if (qft) qft.style.display = hide ? 'none' : '';
      };
    }

    var statsToggle = modal.querySelector('#toggle-stats');
    if (statsToggle) {
      statsToggle.onchange = function() {
        var hide = !this.checked;
        localStorage.setItem(STORAGE_KEY.HIDE_STATS, hide ? 'true' : 'false');
        var so = document.getElementById('stats-overlay');
        if (so) so.style.display = hide ? 'none' : '';
      };
    }

    var twToggle = modal.querySelector('#toggle-typewriter');
    if (twToggle) {
      twToggle.onchange = function() {
        var on = this.checked;
        localStorage.setItem(STORAGE_KEY.TYPEWRITER, on ? 'true' : 'false');
            };
    }

    // --- PWA Install handler ---
    var installBtn = modal.querySelector('#btn-install-pwa');
    if (installBtn) {
      installBtn.onclick = async function() {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          var choice = await deferredPrompt.userChoice;
          deferredPrompt = null;
          installBtn.disabled = true;
          installBtn.textContent = getLang() === 'el' ? '\u2713 \u0395\u03B3\u03BA\u03B1\u03C4\u03B1\u03C3\u03C4\u03AC\u03B8\u03B7\u03BA\u03B5' : '\u2713 Installed';
        } else {
          installBtn.disabled = true;
          installBtn.textContent = getLang() === 'el' ? '\u26A0 \u0394\u03B5\u03BD \u03C5\u03C0\u03BF\u03C3\u03C4\u03B7\u03C1\u03AF\u03B6\u03B5\u03C4\u03B1\u03B9' : '\u26A0 Not supported';
        }
      };
    }

    // Check if already installed
    if (!deferredPrompt) {
      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        installBtn.disabled = true;
        installBtn.textContent = getLang() === 'el' ? '\u2713 \u0395\u03B3\u03BA\u03B1\u03C4\u03B5\u03C3\u03C4\u03B7\u03BC\u03AD\u03BD\u03BF' : '\u2713 Already installed';
      }
    }
  }

  function updateSettingsModalLanguage(lang) {
    var existing = document.querySelector('.settings-modal');
    if (existing) {
      existing.remove();
      openSettingsModal();
    }
  }

})();