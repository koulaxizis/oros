// ============================================
// orOS — Core Functionality
// Theme | Language | Zen Mode | Settings
// Settings: Global Tab + Writer Tab
// Smart Typography toggle
// ============================================

(function() {
  var STORAGE_KEY = {
    THEME: 'oros-theme',
    LANGUAGE: 'oros-language',
    HIDE_STATS: 'oros_hide_stats',
    HIDE_QUICK_TBAR: 'oros_hide_quick_tbar',
    FOCUS_MODE: 'oros_focus_mode',
    READING_PROGRESS: 'oros_reading_progress',
    SMART_TYPOGRAPHY: 'oros_smart_typography'
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
    btn.setAttribute('aria-label', nextTheme === 'dark' ? (t.theme_dark || 'Dark') : (t.theme_light || 'Light'));
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
    // Fix: Refresh theme button tooltip in new language immediately
    var currentTheme = localStorage.getItem(STORAGE_KEY.THEME) || 'light';
    renderThemeButton(currentTheme);
    // Notify editor to update language-dependent content
    window.dispatchEvent(new CustomEvent('oros-language-changed', { detail: { lang: lang } }));
  }

  function translatePage(trans, lang) {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (trans[key]) el.textContent = trans[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (trans[key]) { el.placeholder = trans[key]; el.setAttribute('data-placeholder', trans[key]); }
    });
    document.querySelectorAll('[data-i18n-alt]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-alt');
      if (trans[key]) el.alt = trans[key];
    });
    document.querySelectorAll('[data-i18n-tooltip]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-tooltip');
      if (trans[key]) el.title = trans[key];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-aria');
      if (trans[key]) el.setAttribute('aria-label', trans[key]);
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
      if (trans[key]) { el.placeholder = trans[key]; el.setAttribute('data-placeholder', trans[key]); }
    });
    document.querySelectorAll('[data-i18n-alt]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-alt');
      if (trans[key]) el.alt = trans[key];
    });
    document.querySelectorAll('[data-i18n-tooltip]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-tooltip');
      if (trans[key]) el.title = trans[key];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-aria');
      if (trans[key]) el.setAttribute('aria-label', trans[key]);
    });
  }

  function renderLangSelector(currentLang) {
    var select = document.getElementById('language-select');
    if (!select) return;
    select.innerHTML = '';
    [{value:'el',label:'EL'},{value:'en',label:'EN'}].forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      if (opt.value === currentLang) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = function(e) { applyLanguage(e.target.value); };
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
    btn.onclick = function() { window.scrollTo({ top: 0, behavior: 'smooth' }); };
  }

  // ---------- Zen Mode ----------
  var zenActive = false;

  function initZenMode() {
    var btn = document.getElementById('btn-zen');
    if (!btn) return;
    zenActive = localStorage.getItem('oros-zen') === 'true';
    if (zenActive) document.documentElement.setAttribute('data-zen', 'true');
    btn.onclick = toggleZenMode;
    document.addEventListener('keydown', function(e) {
      if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); toggleZenMode(); }
      if (e.key === 'Escape' && zenActive) { toggleZenMode(); }
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
    var msg = getLang() === 'el' ? '\uD83E\uDDD8 Zen Mode — Πάτα ESC ή F9 για έξοδο' : '\uD83E\uDDD8 Zen Mode — Press ESC or F9 to exit';
    var toast = document.createElement('div');
    toast.className = 'zentool-toast visible';
    toast.id = 'zen-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() { var t = document.getElementById('zen-toast'); if (t) t.classList.remove('visible'); }, 3500);
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
    var isEditor = !!document.getElementById('rich-editor');

    var globalShortcuts, editorShortcuts;

    if (lang === 'el') {
      globalShortcuts = [
        ['Focus Mode', 'F8'],
        ['Zen Mode', 'F9'],
        ['Έξοδος Zen', 'ESC']
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
        ['Focus Mode', 'F8'],
        ['Zen Mode', 'F9'],
        ['Exit Zen', 'ESC']
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

    var title = getTrans('settings');
    var tabGlobalLabel = getTrans('tab_global');
    var tabWriterLabel = getTrans('tab_writer');
    var colAction = lang === 'el' ? 'Ενέργεια' : 'Action';
    var colKey = lang === 'el' ? 'Συντόμευση' : 'Shortcut';
    var installLabel = getTrans('install_app');

    // Build global shortcuts HTML
    var globalShortcutsHtml = '';
    globalShortcuts.forEach(function(pair) {
      globalShortcutsHtml += '<tr><td>' + pair[0] + '</td><td><kbd>' + pair[1] + '</kbd></td></tr>';
    });

    // Zen Mode state
    var zenActive = localStorage.getItem('oros-zen') === 'true';

    // Global tab content
    var globalContent =
      '<div class="toggles-container">' +
        '<div class="toggle-row">' +
          '<span class="toggle-label">' + getTrans('toggle_zen') + '</span>' +
          '<label class="switch"><input type="checkbox" id="toggle-zen"' + (zenActive ? ' checked' : '') + '><span class="slider"></span></label>' +
        '</div>' +
      '</div>' +
      '<div class="settings-divider"></div>' +
      '<table class="shortcut-table">' +
        '<thead><tr><th>' + colAction + '</th><th>' + colKey + '</th></tr></thead>' +
        '<tbody>' + globalShortcutsHtml + '</tbody>' +
      '</table>' +
      '<div class="install-section">' +
        '<button class="btn-install" id="btn-install-pwa">\u2B07 ' + installLabel + '</button>' +
      '</div>';

    // Nav
    var navHtml = '<button class="tab-btn active" data-tab="global">' + tabGlobalLabel + '</button>';
    if (isEditor) {
      navHtml += '<button class="tab-btn" data-tab="writer">' + tabWriterLabel + '</button>';
    }

    // Panels
    var panelsHtml = '<div class="tab-panel" id="panel-global">' + globalContent + '</div>';

    if (isEditor) {
      var editorShortcutsHtml = '';
      editorShortcuts.forEach(function(pair) {
        editorShortcutsHtml += '<tr><td>' + pair[0] + '</td><td><kbd>' + pair[1] + '</kbd></td></tr>';
      });

      var hideQuickTbar = localStorage.getItem(STORAGE_KEY.HIDE_QUICK_TBAR) === 'true';
      var hideStats = localStorage.getItem(STORAGE_KEY.HIDE_STATS) === 'true';
      var focusModeOn = localStorage.getItem(STORAGE_KEY.FOCUS_MODE) !== 'false';
      var readingProgressOn = localStorage.getItem(STORAGE_KEY.READING_PROGRESS) !== 'false';
      var smartTypographyOn = localStorage.getItem(STORAGE_KEY.SMART_TYPOGRAPHY) !== 'false';

      var appearanceHtml =
        '<div class="toggle-row">' +
          '<span class="toggle-label">' + getTrans('toggle_quick_toolbar') + '</span>' +
          '<label class="switch"><input type="checkbox" id="toggle-quick-tbar"' + (hideQuickTbar ? '' : ' checked') + '><span class="slider"></span></label>' +
        '</div>' +
        '<div class="toggle-row">' +
          '<span class="toggle-label">' + getTrans('toggle_stats') + '</span>' +
          '<label class="switch"><input type="checkbox" id="toggle-stats"' + (hideStats ? '' : ' checked') + '><span class="slider"></span></label>' +
        '</div>' +
        '<div class="toggle-row">' +
          '<span class="toggle-label">' + getTrans('toggle_focus_mode') + '</span>' +
          '<label class="switch"><input type="checkbox" id="toggle-focus-mode"' + (focusModeOn ? ' checked' : '') + '><span class="slider"></span></label>' +
        '</div>' +
        '<div class="toggle-row">' +
          '<span class="toggle-label">' + getTrans('toggle_reading_progress') + '</span>' +
          '<label class="switch"><input type="checkbox" id="toggle-reading-progress"' + (readingProgressOn ? ' checked' : '') + '><span class="slider"></span></label>' +
        '</div>' +
        '<div class="toggle-row">' +
          '<span class="toggle-label">' + getTrans('toggle_smart_typography') + '</span>' +
          '<label class="switch"><input type="checkbox" id="toggle-smart-typography"' + (smartTypographyOn ? ' checked' : '') + '><span class="slider"></span></label>' +
        '</div>';

      panelsHtml +=
        '<div class="tab-panel" id="panel-writer" style="display:none;">' +
          '<div class="toggles-container">' + appearanceHtml + '</div>' +
          '<div class="settings-divider"></div>' +
          '<table class="shortcut-table">' +
            '<thead><tr><th>' + colAction + '</th><th>' + colKey + '</th></tr></thead>' +
            '<tbody>' + editorShortcutsHtml + '</tbody>' +
          '</table>' +
        '</div>';
    }

    var modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal-content">' +
        '<header class="modal-header">' +
          '<h2>' + title + '</h2>' +
          '<button class="close-btn">\u00D7</button>' +
        '</header>' +
        '<nav class="modal-nav">' + navHtml + '</nav>' +
        panelsHtml +
      '</div>';

    document.body.appendChild(modal);

    var closeFn = function() { modal.remove(); };
    modal.querySelector('.close-btn').onclick = closeFn;
    modal.querySelector('.modal-backdrop').onclick = closeFn;

    // Tab switching
    var tabBtns = modal.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(btn) {
      btn.onclick = function() {
        tabBtns.forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        var tabName = this.dataset.tab;
        var globalPanel = modal.querySelector('#panel-global');
        var writerPanel = modal.querySelector('#panel-writer');
        if (globalPanel) globalPanel.style.display = tabName === 'global' ? '' : 'none';
        if (writerPanel) writerPanel.style.display = tabName === 'writer' ? '' : 'none';
      };
    });

    // Zen Mode toggle
    var zenToggle = modal.querySelector('#toggle-zen');
    if (zenToggle) {
      zenToggle.onchange = function() {
        var shouldBeZen = this.checked;
        var isCurrentlyZen = localStorage.getItem('oros-zen') === 'true';
        if (shouldBeZen !== isCurrentlyZen) {
          toggleZenMode();
        }
      };
    }

    // Quick toolbar toggle
    var tbarToggle = modal.querySelector('#toggle-quick-tbar');
    if (tbarToggle) {
      tbarToggle.onchange = function() {
        var hide = !this.checked;
        localStorage.setItem(STORAGE_KEY.HIDE_QUICK_TBAR, hide ? 'true' : 'false');
        var qft = document.getElementById('quick-format-toolbar');
        if (qft) qft.style.display = hide ? 'none' : '';
      };
    }

    // Stats toggle
    var statsToggle = modal.querySelector('#toggle-stats');
    if (statsToggle) {
      statsToggle.onchange = function() {
        var hide = !this.checked;
        localStorage.setItem(STORAGE_KEY.HIDE_STATS, hide ? 'true' : 'false');
        var so = document.getElementById('stats-overlay');
        if (so) so.style.display = hide ? 'none' : '';
      };
    }

    // Focus mode toggle
    var focusToggle = modal.querySelector('#toggle-focus-mode');
    if (focusToggle) {
      focusToggle.onchange = function() {
        var enabled = this.checked;
        localStorage.setItem(STORAGE_KEY.FOCUS_MODE, enabled ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('oros-focus-mode-changed', { detail: { enabled: enabled } }));
      };
    }

    // Reading progress toggle
    var progressToggle = modal.querySelector('#toggle-reading-progress');
    if (progressToggle) {
      progressToggle.onchange = function() {
        var enabled = this.checked;
        localStorage.setItem(STORAGE_KEY.READING_PROGRESS, enabled ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('oros-reading-progress-changed', { detail: { enabled: enabled } }));
      };
    }

    // Smart typography toggle
    var smartTypeToggle = modal.querySelector('#toggle-smart-typography');
    if (smartTypeToggle) {
      smartTypeToggle.onchange = function() {
        var enabled = this.checked;
        localStorage.setItem(STORAGE_KEY.SMART_TYPOGRAPHY, enabled ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('oros-smart-typography-changed', { detail: { enabled: enabled } }));
      };
    }

    // Install button
    var installBtn = modal.querySelector('#btn-install-pwa');
    if (installBtn) {
      installBtn.onclick = async function() {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          var choice = await deferredPrompt.userChoice;
          deferredPrompt = null;
          installBtn.disabled = true;
          installBtn.textContent = getLang() === 'el' ? '\u2713 Εγκαταστάθηκε' : '\u2713 Installed';
        } else {
          installBtn.disabled = true;
          installBtn.textContent = getLang() === 'el' ? '\u26A0 Δεν υποστηρίζεται' : '\u26A0 Not supported';
        }
      };
    }

    if (!deferredPrompt && installBtn) {
      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        installBtn.disabled = true;
        installBtn.textContent = getLang() === 'el' ? '\u2713 Εγκατεστημένο' : '\u2713 Already installed';
      }
    }
  }

  function updateSettingsModalLanguage(lang) {
    var existing = document.querySelector('.settings-modal');
    if (existing) { existing.remove(); openSettingsModal(); }
  }

})();