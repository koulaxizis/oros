// ============================================
// orOS Global Settings Manager
// Single source of truth for ALL apps
// Listens to localStorage events for real-time sync
// ============================================

(function() {
  'use strict';

  // Global app settings (shared by all pages)
  var SETTINGS = {
    // Theme & display
    zenModeEnabled: false,
    readingProgressEnabled: true,
    focusModeEnabled: true,
    quickTbarShow: true,
    smartTypographyEnabled: true,
    typewriterSoundEnabled: false,
    hideStatsOverlay: false,
    hideSaveIndicator: false,

    // Writer specific
    hideGoalBtn: false,
    hideOutlineBtn: false,
    hideMetadataBtn: false,
    hideFindBtn: false,
    hideWordFreqBtn: false,
    hideLoremBtn: false,

    // Converter specific
    hideCopyBtn: false,
    hideSaveBtn: false,
    hideOpenBtn: false,
    hideClearBtn: false,
    hideUndoBtn: false,
    hideRedoBtn: false,
    hideResetBtn: false,
    hideOptionsDropdown: false,
    hideStatsPanelBtn: false
  };

  // Storage keys
  var STORAGE_PREFIX = 'oros_';

  // Mapping of localStorage keys to SETTINGS properties
  var KEY_MAP = {
    'zen_mode': 'zenModeEnabled',
    'reading_progress': 'readingProgressEnabled',
    'focus_mode': 'focusModeEnabled',
    'quick_tbar_show': 'quickTbarShow',
    'smart_typography': 'smartTypographyEnabled',
    'typewriter_sound': 'typewriterSoundEnabled',
    'hide_stats': 'hideStatsOverlay',
    'hide_save_indicator': 'hideSaveIndicator',
    'hide_goal_btn': 'hideGoalBtn',
    'hide_outline_btn': 'hideOutlineBtn',
    'hide_metadata_btn': 'hideMetadataBtn',
    'hide_find_btn': 'hideFindBtn',
    'hide_wordfreq_btn': 'hideWordFreqBtn',
    'hide_lorem_btn': 'hideLoremBtn',
    'hide_converter_copy_btn': 'hideCopyBtn',
    'hide_converter_save_btn': 'hideSaveBtn',
    'hide_converter_open_btn': 'hideOpenBtn',
    'hide_converter_clear_btn': 'hideClearBtn',
    'hide_converter_undo_btn': 'hideUndoBtn',
    'hide_converter_redo_btn': 'hideRedoBtn',
    'hide_converter_reset_btn': 'hideResetBtn',
    'hide_converter_options': 'hideOptionsDropdown',
    'hide_converter_stats_btn': 'hideStatsPanelBtn'
  };

  // Event dispatchers for inter-app communication
  window.orosSettings = {
    getSetting: function(key) { return SETTINGS[key]; },
    setSetting: function(key, value) { 
      if (SETTINGS.hasOwnProperty(key)) {
        SETTINGS[key] = value;
        localStorage.setItem(STORAGE_PREFIX + key, value ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('oros-setting-changed', {
          detail: { key: key, value: value }
        }));
      }
    }
  };

  // ========== INITIALIZATION ==========

  function init() {
    loadAllSettings();
    setupLocalStorageListener();
    setupLiveVisibilityListeners();
    
    if (window.orosAppElements) {
      applyVisibility();
    }
  }

  // ========== LIVE VISIBILITY LISTENERS ==========
  // Listen for Writer/Converter settings changes in same tab
  
  function setupLiveVisibilityListeners() {
    var VIS_EVENTS = [
      'oros-reading-progress-changed',
      'oros-smart-typography-changed',
      'oros-focus-mode-changed',
      'oros-hide-stats-changed',
      'oros-hide-save-indicator-changed',
      'oros-hide-goal-btn-changed',
      'oros-hide-outline-btn-changed',
      'oros-hide-metadata-btn-changed',
      'oros-hide-find-btn-changed',
      'oros-hide-wordfreq-btn-changed',
      'oros-hide-lorem-btn-changed',
      'oros-typewriter-sound-changed',
      'oros-zen-mode-changed'
      // Note: quick_tbar changed event will be handled separately in Phase 4
    ];

    VIS_EVENTS.forEach(function(eventName) {
      window.addEventListener(eventName, function() {
        loadAllSettings();
        if (window.orosAppElements) {
          applyVisibility();
        }
      });
    });
  }

  // ========== LOAD SETTINGS ==========

  function loadAllSettings() {
    SETTINGS.zenModeEnabled = localStorage.getItem(STORAGE_PREFIX + 'zen_mode') === 'true';
    SETTINGS.readingProgressEnabled = localStorage.getItem(STORAGE_PREFIX + 'reading_progress') !== 'false';
    SETTINGS.focusModeEnabled = localStorage.getItem(STORAGE_PREFIX + 'focus_mode') !== 'false';
    SETTINGS.quickTbarShow = localStorage.getItem(STORAGE_PREFIX + 'quick_tbar_show') !== 'false';
    SETTINGS.smartTypographyEnabled = localStorage.getItem(STORAGE_PREFIX + 'smart_typography') !== 'false';
    SETTINGS.typewriterSoundEnabled = localStorage.getItem(STORAGE_PREFIX + 'typewriter_sound') === 'true';
    SETTINGS.hideStatsOverlay = localStorage.getItem(STORAGE_PREFIX + 'hide_stats') === 'true';
    SETTINGS.hideSaveIndicator = localStorage.getItem(STORAGE_PREFIX + 'hide_save_indicator') === 'true';

    SETTINGS.hideGoalBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_goal_btn') === 'true';
    SETTINGS.hideOutlineBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_outline_btn') === 'true';
    SETTINGS.hideMetadataBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_metadata_btn') === 'true';
    SETTINGS.hideFindBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_find_btn') === 'true';
    SETTINGS.hideWordFreqBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_wordfreq_btn') === 'true';
    SETTINGS.hideLoremBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_lorem_btn') === 'true';

    SETTINGS.hideCopyBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_copy_btn') === 'true';
    SETTINGS.hideSaveBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_save_btn') === 'true';
    SETTINGS.hideOpenBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_open_btn') === 'true';
    SETTINGS.hideClearBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_clear_btn') === 'true';
    SETTINGS.hideUndoBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_undo_btn') === 'true';
    SETTINGS.hideRedoBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_redo_btn') === 'true';
    SETTINGS.hideResetBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_reset_btn') === 'true';
    SETTINGS.hideOptionsDropdown = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_options') === 'true';
    SETTINGS.hideStatsPanelBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_converter_stats_btn') === 'true';
  }

  // ========== REAL-TIME SYNC ==========

  function setupLocalStorageListener() {
    window.addEventListener('storage', function(e) {
      var key = e.key;
      var value = e.newValue;

      if (!key || key.indexOf(STORAGE_PREFIX) !== 0) return;

      var strippedKey = key.replace(STORAGE_PREFIX, '');

      if (KEY_MAP[strippedKey]) {
        var settingProp = KEY_MAP[strippedKey];
        var defaultTrueKeys = [
          'reading_progress', 'focus_mode', 'quick_tbar_show', 'smart_typography'
        ];
        if (defaultTrueKeys.indexOf(strippedKey) !== -1) {
          SETTINGS[settingProp] = value !== 'false';
        } else {
          SETTINGS[settingProp] = value === 'true';
        }
      }

      window.dispatchEvent(new CustomEvent('oros-storage-sync', {
        detail: { key: strippedKey, value: value }
      }));

      if (window.orosAppElements) {
        applyVisibility();
      }
    });
  }

  // ========== VISIBILITY APPLICATION ==========

  function applyVisibility() {
    var btnGoal = document.getElementById('btn-goal');
    var btnOutline = document.getElementById('btn-outline');
    var btnMetadata = document.getElementById('btn-metadata');
    var btnFind = document.getElementById('btn-find');
    var btnWordFreq = document.getElementById('btn-wordfreq');
    var btnLorem = document.getElementById('btn-lorem');
    var progressBar = document.getElementById('reading-progress-bar');
    var statsOverlay = document.getElementById('stats-overlay');
    var saveIndicator = document.getElementById('save-indicator');

    if (btnGoal) btnGoal.style.display = SETTINGS.hideGoalBtn ? 'none' : '';
    if (btnOutline) btnOutline.style.display = SETTINGS.hideOutlineBtn ? 'none' : '';
    if (btnMetadata) btnMetadata.style.display = SETTINGS.hideMetadataBtn ? 'none' : '';
    if (btnFind) btnFind.style.display = SETTINGS.hideFindBtn ? 'none' : '';
    if (btnWordFreq) btnWordFreq.style.display = SETTINGS.hideWordFreqBtn ? 'none' : '';
    if (btnLorem) btnLorem.style.display = SETTINGS.hideLoremBtn ? 'none' : '';
    // NOTE: .toolbar-center is ALWAYS visible — removed quickTbarShow logic
    // The toggle-quick-tbar will control Quick Format Menu (Alt+Right-click) in Phase 4
    if (progressBar) progressBar.style.display = SETTINGS.readingProgressEnabled ? '' : 'none';
    if (statsOverlay) statsOverlay.style.display = SETTINGS.hideStatsOverlay ? 'none' : '';
    if (saveIndicator) saveIndicator.style.visibility = SETTINGS.hideSaveIndicator ? 'hidden' : 'visible';

    var btnCopy = document.getElementById('btn-conv-copy');
    var btnSaveConv = document.getElementById('btn-conv-save');
    var btnOpenConv = document.getElementById('btn-conv-open');
    var btnClearConv = document.getElementById('btn-conv-clear');
    var btnUndoConv = document.getElementById('btn-conv-undo');
    var btnRedoConv = document.getElementById('btn-conv-redo');
    var btnResetConv = document.getElementById('btn-conv-reset');
    var btnOptions = document.getElementById('btn-conv-options');
    var btnStatsConv = document.getElementById('btn-conv-stats');

    if (btnCopy) btnCopy.style.display = SETTINGS.hideCopyBtn ? 'none' : '';
    if (btnSaveConv) btnSaveConv.style.display = SETTINGS.hideSaveBtn ? 'none' : '';
    if (btnOpenConv) btnOpenConv.style.display = SETTINGS.hideOpenBtn ? 'none' : '';
    if (btnClearConv) btnClearConv.style.display = SETTINGS.hideClearBtn ? 'none' : '';
    if (btnUndoConv) btnUndoConv.style.display = SETTINGS.hideUndoBtn ? 'none' : '';
    if (btnRedoConv) btnRedoConv.style.display = SETTINGS.hideRedoBtn ? 'none' : '';
    if (btnResetConv) btnResetConv.style.display = SETTINGS.hideResetBtn ? 'none' : '';
    if (btnOptions) btnOptions.style.display = SETTINGS.hideOptionsDropdown ? 'none' : '';
    if (btnStatsConv) btnStatsConv.style.display = SETTINGS.hideStatsPanelBtn ? 'none' : '';
  }

  document.addEventListener('DOMContentLoaded', function() {
    window.orosAppElements = {};
    init();
  });

})();