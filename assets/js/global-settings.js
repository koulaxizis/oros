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
    
    // Re-trigger visibility for this page
    if (window.orosAppElements) {
      applyVisibility();
    }
  }

  // ========== LOAD SETTINGS ==========

  function loadAllSettings() {
    // Theme & display
    // FIXED: Consistent zen_mode key
    SETTINGS.zenModeEnabled = localStorage.getItem(STORAGE_PREFIX + 'zen_mode') === 'true';
    SETTINGS.readingProgressEnabled = localStorage.getItem(STORAGE_PREFIX + 'reading_progress') !== 'false';
    SETTINGS.focusModeEnabled = localStorage.getItem(STORAGE_PREFIX + 'focus_mode') !== 'false';
    SETTINGS.quickTbarShow = localStorage.getItem(STORAGE_PREFIX + 'quick_tbar_show') !== 'false';
    SETTINGS.smartTypographyEnabled = localStorage.getItem(STORAGE_PREFIX + 'smart_typography') !== 'false';
    SETTINGS.typewriterSoundEnabled = localStorage.getItem(STORAGE_PREFIX + 'typewriter_sound') === 'true';
    SETTINGS.hideStatsOverlay = localStorage.getItem(STORAGE_PREFIX + 'hide_stats') === 'true';
    SETTINGS.hideSaveIndicator = localStorage.getItem(STORAGE_PREFIX + 'hide_save_indicator') === 'true';

    // Writer specific
    SETTINGS.hideGoalBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_goal_btn') === 'true';
    SETTINGS.hideOutlineBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_outline_btn') === 'true';
    SETTINGS.hideMetadataBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_metadata_btn') === 'true';
    SETTINGS.hideFindBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_find_btn') === 'true';
    SETTINGS.hideWordFreqBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_wordfreq_btn') === 'true';
    SETTINGS.hideLoremBtn = localStorage.getItem(STORAGE_PREFIX + 'hide_lorem_btn') === 'true';

    // Converter specific
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
      // Key changed in another tab/window
      var key = e.key;
      var value = e.newValue;

      // Update our in-memory state
      switch(key) {
        // FIXED: Consistent zen_mode key
        case STORAGE_PREFIX + 'zen_mode':
          SETTINGS.zenModeEnabled = value === 'true';
          break;
        case STORAGE_PREFIX + 'hide_goal_btn':
          SETTINGS.hideGoalBtn = value === 'true';
          break;
        case STORAGE_PREFIX + 'hide_outline_btn':
          SETTINGS.hideOutlineBtn = value === 'true';
          break;
        // ... add all cases as needed
      }

      // Notify this page
      window.dispatchEvent(new CustomEvent('oros-storage-sync', {
        detail: { key: key.replace(STORAGE_PREFIX, ''), value: value }
      }));

      // Apply visibility if elements exist
      if (window.orosAppElements) {
        applyVisibility();
      }
    });
  }

  // ========== VISIBILITY APPLICATION ==========

  function applyVisibility() {
    // Writer buttons
    var btnGoal = document.getElementById('btn-goal');
    var btnOutline = document.getElementById('btn-outline');
    var btnMetadata = document.getElementById('btn-metadata');
    var btnFind = document.getElementById('btn-find');
    var btnWordFreq = document.getElementById('btn-wordfreq');
    var btnLorem = document.getElementById('btn-lorem');
    var toolbarCenter = document.querySelector('.toolbar-center');
    var progressBar = document.getElementById('reading-progress-bar');
    var statsOverlay = document.getElementById('stats-overlay');
    var saveIndicator = document.getElementById('save-indicator');

    if (btnGoal) btnGoal.style.display = SETTINGS.hideGoalBtn ? 'none' : '';
    if (btnOutline) btnOutline.style.display = SETTINGS.hideOutlineBtn ? 'none' : '';
    if (btnMetadata) btnMetadata.style.display = SETTINGS.hideMetadataBtn ? 'none' : '';
    if (btnFind) btnFind.style.display = SETTINGS.hideFindBtn ? 'none' : '';
    if (btnWordFreq) btnWordFreq.style.display = SETTINGS.hideWordFreqBtn ? 'none' : '';
    if (btnLorem) btnLorem.style.display = SETTINGS.hideLoremBtn ? 'none' : '';
    if (toolbarCenter) toolbarCenter.style.display = SETTINGS.quickTbarShow ? 'flex' : 'none';
    if (progressBar) progressBar.style.display = SETTINGS.readingProgressEnabled ? '' : 'none';
    if (statsOverlay) statsOverlay.style.display = SETTINGS.hideStatsOverlay ? 'none' : '';
    if (saveIndicator) saveIndicator.style.visibility = SETTINGS.hideSaveIndicator ? 'hidden' : 'visible';

    // Converter buttons
    var btnCopy = document.getElementById('btn-copy');
    var btnSaveConv = document.getElementById('btn-save');
    var btnOpenConv = document.getElementById('btn-open');
    var btnClearConv = document.getElementById('btn-clear');
    var btnUndoConv = document.getElementById('btn-undo');
    var btnRedoConv = document.getElementById('btn-redo');
    var btnResetConv = document.getElementById('btn-reset');
    var btnOptions = document.getElementById('btn-options');
    var btnStatsConv = document.getElementById('btn-stats');

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

  // Register element map after DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    window.orosAppElements = {};
    init();
  });

})();