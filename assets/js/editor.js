// ============================================
// orOS Writer — Unified Rich Text Editor v0.4
// Focus Mode + Document Outline + Reading Progress
// Smart Typography + Auto-Save Timestamp
// Writing Goal Tracker (words/chars/paras + lock)
// Document Metadata Panel (title/author/tags/category)
// Typewriter Mode + Context Menu + Content Persistence
// Smart Lists, Import RTF/DOC, Stats, Find/Replace
// Quick Format Toolbar + Flexible UI Toggles
// ============================================

(function() {
  'use strict';

  var STORAGE_KEY = 'oros_writer_content';
  var STORAGE_HIDE_STATS = 'oros_hide_stats';
  var STORAGE_HIDE_QUICK_TBAR = 'oros_hide_quick_tbar';
  var STORAGE_FOCUS_MODE = 'oros_focus_mode';
  var STORAGE_READING_PROGRESS = 'oros_reading_progress';
  var STORAGE_SMART_TYPOGRAPHY = 'oros_smart_typography';
  var STORAGE_LAST_SAVED = 'oros_writer_last_saved';
  var STORAGE_GOAL_TARGET = 'oros_goal_target';
  var STORAGE_GOAL_UNIT = 'oros_goal_unit';
  var STORAGE_GOAL_LOCK = 'oros_goal_lock';
  var STORAGE_HIDE_GOAL_BTN = 'oros_hide_goal_btn';
  var STORAGE_HIDE_OUTLINE_BTN = 'oros_hide_outline_btn';
  var STORAGE_HIDE_METADATA_BTN = 'oros_hide_metadata_btn';
  var STORAGE_HIDE_FIND_BTN = 'oros_hide_find_btn';
  var STORAGE_METADATA = 'oros_writer_metadata';

  var richEditor = document.getElementById('rich-editor');
  var richWrapper = document.getElementById('rich-wrapper');
  var findBar = document.getElementById('find-replace-bar');
  var findInput = document.getElementById('find-find');
  var replaceInput = document.getElementById('find-replace');
  var frResults = document.getElementById('fr_results');
  var btnOpen = document.getElementById('btn-open');
  var btnClear = document.getElementById('btn-clear');
  var btnExport = document.getElementById('btn-export');
  var exportDropdown = document.getElementById('export-dropdown');
  var fileInput = document.getElementById('file-input');
  var statsOverlay = document.getElementById('stats-overlay');
  var statsDefaultEl = document.getElementById('stats-default');
  var statsGoalEl = document.getElementById('stats-goal');
  var quickFormatToolbar = document.getElementById('quick-format-toolbar');
  var outlinePanel = document.getElementById('outline-panel');
  var outlineList = document.getElementById('outline-list');
  var btnOutline = document.getElementById('btn-outline');
  var btnCloseOutline = document.getElementById('btn-close-outline');
  var progressBar = document.getElementById('reading-progress-bar');
  var goalBar = document.getElementById('goal-bar');
  var goalUnitSelect = document.getElementById('goal-unit');
  var goalTargetInput = document.getElementById('goal-target-input');
  var goalLockCheckbox = document.getElementById('goal-lock');
  var btnGoal = document.getElementById('btn-goal');
  var btnSetGoal = document.getElementById('btn-set-goal');
  var btnClearGoal = document.getElementById('btn-clear-goal');
  var btnCloseGoal = document.getElementById('btn-close-goal');
  var btnFind = document.getElementById('btn-find');
  var btnCloseFR = document.getElementById('btn-close-fr');
  var metadataPanel = document.getElementById('metadata-panel');
  var btnMetadata = document.getElementById('btn-metadata');
  var btnCloseMetadata = document.getElementById('btn-close-metadata');
  var metaTitle = document.getElementById('meta-title');
  var metaAuthor = document.getElementById('meta-author');
  var metaTags = document.getElementById('meta-tags');
  var metaCategory = document.getElementById('meta-category');
  var metaCreated = document.getElementById('meta-created');
  var metaModified = document.getElementById('meta-modified');

  var hideStats = localStorage.getItem(STORAGE_HIDE_STATS) === 'true';
  var hideQuickTbar = localStorage.getItem(STORAGE_HIDE_QUICK_TBAR) === 'true';
  var focusModeEnabled = localStorage.getItem(STORAGE_FOCUS_MODE) !== 'false';
  var readingProgressEnabled = localStorage.getItem(STORAGE_READING_PROGRESS) !== 'false';
  var smartTypographyEnabled = localStorage.getItem(STORAGE_SMART_TYPOGRAPHY) !== 'false';
  var lastSavedTime = parseInt(localStorage.getItem(STORAGE_LAST_SAVED)) || null;
  var goalTarget = parseInt(localStorage.getItem(STORAGE_GOAL_TARGET)) || null;
  var goalUnit = localStorage.getItem(STORAGE_GOAL_UNIT) || 'words';
  var goalLockEnabled = localStorage.getItem(STORAGE_GOAL_LOCK) === 'true';
  var hideGoalBtn = localStorage.getItem(STORAGE_HIDE_GOAL_BTN) === 'true';
  var hideOutlineBtn = localStorage.getItem(STORAGE_HIDE_OUTLINE_BTN) === 'true';
  var hideMetadataBtn = localStorage.getItem(STORAGE_HIDE_METADATA_BTN) === 'true';
  var hideFindBtn = localStorage.getItem(STORAGE_HIDE_FIND_BTN) === 'true';
  var goalReachedShown = false;
  var goalLockTriggered = false;
  var currentMatchIndex = -1;
  var matchRanges = [];
  var typewriterMode = false;

  // ========== HELPERS ==========
  function getCurrentLang() { return localStorage.getItem('oros-language') || 'en'; }
  function getTrans(key) {
    var lang = getCurrentLang();
    var t = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[lang]) || {};
    return t[key] || key;
  }
  function formatNumber(num) {
    return num >= 1000 ? (num / 1000).toFixed(1) + 'k' : num.toString();
  }
  function getTextContent() { return richEditor.innerText || ''; }

  // ========== TOAST ==========
  function showToast(message) {
    var toast = document.getElementById('zen-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zen-toast';
      toast.className = 'zentool-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = '';
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
      toast.classList.remove('visible');
    }, 2500);
  }

  // ========== CONTENT PERSISTENCE ==========
  function saveContent() {
    localStorage.setItem(STORAGE_KEY, richEditor.innerHTML);
    lastSavedTime = Date.now();
    localStorage.setItem(STORAGE_LAST_SAVED, lastSavedTime.toString());
  }

  function loadContent() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      richEditor.innerHTML = saved;
    }
  }

  if (richEditor) {
    richEditor.addEventListener('input', function() {
      saveContent();
      updateStats();
      if (outlinePanel && outlinePanel.style.display !== 'none') {
        clearTimeout(outlineDebounceTimer);
        outlineDebounceTimer = setTimeout(updateOutline, 300);
      }
    });
  }

  // ========== METADATA ==========
  var metadata = loadMetadata();

  function loadMetadata() {
    try { return JSON.parse(localStorage.getItem(STORAGE_METADATA)) || {}; }
    catch(e) { return {}; }
  }

  function saveMetadata(triggerSaveIndicator) {
    metadata.title = metaTitle ? metaTitle.value || '' : '';
    metadata.author = metaAuthor ? metaAuthor.value || '' : '';
    metadata.tags = metaTags ? metaTags.value || '' : '';
    metadata.category = metaCategory ? metaCategory.value || '' : '';
    if (!metadata.created) {
      metadata.created = new Date().toISOString();
    }
    metadata.modified = new Date().toISOString();
    localStorage.setItem(STORAGE_METADATA, JSON.stringify(metadata));
    renderMetaDates();
    if (triggerSaveIndicator) {
      lastSavedTime = Date.now();
      localStorage.setItem(STORAGE_LAST_SAVED, lastSavedTime.toString());
    }
  }

  function parseFrontmatter(content) {
    var fmRegex = /^---\n([\s\S]*?)\n---\n/;
    var match = content.match(fmRegex);
    if (!match) return null;
    var fmLines = match[1].split('\n');
    var parsed = {};
    for (var i = 0; i < fmLines.length; i++) {
      var line = fmLines[i].trim();
      if (!line) continue;
      var colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      var key = line.substring(0, colonIdx).trim();
      var value = line.substring(colonIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      if (key === 'tags' && value.startsWith('[') && value.endsWith(']')) {
        var tagStr = value.substring(1, value.length - 1);
        var tags = tagStr.split(',').map(function(t) {
          return t.trim().replace(/["']/g, '');
        }).filter(Boolean);
        value = tags.join(', ');
      }
      parsed[key] = value;
    }
    return parsed;
  }

  function importFrontmatter(content) {
    var parsed = parseFrontmatter(content);
    if (!parsed) return content;
    if (parsed.title && metaTitle) metaTitle.value = parsed.title;
    if (parsed.author && metaAuthor) metaAuthor.value = parsed.author;
    if (parsed.tags && metaTags) metaTags.value = parsed.tags;
    if (parsed.category && metaCategory) metaCategory.value = parsed.category;
    if (parsed.created) metadata.created = parsed.created;
    if (parsed.modified) metadata.modified = parsed.modified;
    metadata.title = parsed.title || '';
    metadata.author = parsed.author || '';
    metadata.tags = parsed.tags || '';
    metadata.category = parsed.category || '';
    localStorage.setItem(STORAGE_METADATA, JSON.stringify(metadata));
    renderMetaDates();
    var fmRegex = /^---\n[\s\S]*?\n---\n/;
    return content.replace(fmRegex, '');
  }

  function buildFrontmatter() {
    var fm = '---\n';
    if (metadata.title) fm += 'title: "' + metadata.title.replace(/"/g, '\\"') + '"\n';
    if (metadata.author) fm += 'author: "' + metadata.author.replace(/"/g, '\\"') + '"\n';
    if (metadata.tags) {
      var tagArr = metadata.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      fm += 'tags: [' + tagArr.map(function(t) { return '"' + t + '"'; }).join(', ') + ']\n';
    }
    if (metadata.category) fm += 'category: "' + metadata.category.replace(/"/g, '\\"') + '"\n';
    if (metadata.created) fm += 'created: ' + metadata.created + '\n';
    if (metadata.modified) fm += 'modified: ' + metadata.modified + '\n';
    fm += '---\n\n';
    return fm;
  }

  function renderMetaDates() {
    var lang = getCurrentLang();
    var createdLabel = getTrans('meta_label_created');
    var modifiedLabel = getTrans('meta_label_modified');
    if (metaCreated) {
      if (metadata.created) {
        var cd = new Date(metadata.created);
        metaCreated.textContent = createdLabel + ' ' + formatDate(cd);
      } else {
        metaCreated.textContent = createdLabel + ' —';
      }
    }
    if (metaModified) {
      if (metadata.modified) {
        var md = new Date(metadata.modified);
        metaModified.textContent = modifiedLabel + ' ' + formatDate(md);
      } else {
        metaModified.textContent = modifiedLabel + ' —';
      }
    }
  }

  function formatDate(d) {
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var year = d.getFullYear();
    var time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return day + '/' + month + '/' + year + ' ' + time;
  }

  function toggleMetadataPanel() {
    if (!metadataPanel) return;
    if (metadataPanel.style.display === 'none' || !metadataPanel.style.display) {
      metadataPanel.style.display = 'flex';
      metadataPanel.style.flexDirection = 'column';
      if (metaTitle) metaTitle.value = metadata.title || '';
      if (metaAuthor) metaAuthor.value = metadata.author || '';
      if (metaTags) metaTags.value = metadata.tags || '';
      if (metaCategory) metaCategory.value = metadata.category || '';
      renderMetaDates();
    } else {
      saveMetadata(false);
      metadataPanel.style.display = 'none';
    }
  }

  // ========== STATS ==========
  function updateStats() {
    if (!richEditor) return;
    var text = getTextContent();
    var chars = text.length;
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    if (statsDefaultEl) {
      var statsText = formatNumber(words) + ' ' + getTrans('text_words') + ' · ' + formatNumber(chars) + ' ' + getTrans('text_chars');
      statsDefaultEl.textContent = statsText;
    }
    if (goalTarget) updateGoalProgress();
  }

  // ========== GOAL TRACKER ==========
  function getParagraphCount() {
    var text = richEditor.innerText.trim();
    if (!text) return 0;
    return text.split(/\n/).filter(function(l) { return l.trim(); }).length;
  }

  function getGoalCount() {
    var text = getTextContent();
    if (goalUnit === 'words') return text.trim().split(/\s+/).filter(Boolean).length;
    if (goalUnit === 'chars') return text.length;
    return getParagraphCount();
  }

  function getGoalUnitLabel() {
    if (goalUnit === 'words') return getTrans('text_words');
    if (goalUnit === 'chars') return getTrans('text_chars');
    return getTrans('text_paras');
  }

  function updateGoalProgress() {
    if (!goalTarget || !statsGoalEl || !statsDefaultEl) return;
    var count = getGoalCount();
    var pct = Math.min(100, Math.round((count / goalTarget) * 100));
    statsGoalEl.textContent = formatNumber(count) + ' / ' + formatNumber(goalTarget) + ' ' + getGoalUnitLabel() + ' · ' + pct + '%';
    if (count >= goalTarget && !goalReachedShown) {
      goalReachedShown = true;
      var msg = getTrans('text_goal_reached');
      if (goalLockEnabled) {
        msg += ' ' + getTrans('text_goal_locked');
        triggerGoalLock();
      }
      showToast(msg);
    } else if (count < goalTarget) {
      if (goalLockTriggered) {
        goalLockTriggered = false;
        richEditor.contentEditable = 'true';
      }
      goalReachedShown = false;
    }
  }

  function toggleGoalBar() {
    if (!goalBar) return;
    if (goalBar.style.display === 'flex') {
      goalBar.style.display = 'none';
    } else {
      goalBar.style.display = 'flex';
      if (goalTarget) goalTargetInput.value = goalTarget;
      goalUnitSelect.value = goalUnit;
      goalLockCheckbox.checked = goalLockEnabled;
      goalTargetInput.focus();
    }
  }

  function setGoal() {
    var target = parseInt(goalTargetInput.value);
    if (!target || target < 1) return;
    goalTarget = target;
    goalUnit = goalUnitSelect.value;
    goalLockEnabled = goalLockCheckbox.checked;
    goalReachedShown = false;
    goalLockTriggered = false;
    richEditor.contentEditable = 'true';
    localStorage.setItem(STORAGE_GOAL_TARGET, goalTarget.toString());
    localStorage.setItem(STORAGE_GOAL_UNIT, goalUnit);
    localStorage.setItem(STORAGE_GOAL_LOCK, goalLockEnabled ? 'true' : 'false');
    if (statsDefaultEl) statsDefaultEl.style.display = 'none';
    if (statsGoalEl) statsGoalEl.style.display = '';
    updateGoalProgress();
    goalBar.style.display = 'none';
    showToast(getTrans('text_goal_set') + ': ' + goalTarget + ' ' + getGoalUnitLabel());
  }

  function clearGoal() {
    goalTarget = null;
    goalUnit = 'words';
    goalLockEnabled = false;
    goalReachedShown = false;
    goalLockTriggered = false;
    richEditor.contentEditable = 'true';
    localStorage.removeItem(STORAGE_GOAL_TARGET);
    localStorage.removeItem(STORAGE_GOAL_UNIT);
    localStorage.removeItem(STORAGE_GOAL_LOCK);
    if (statsDefaultEl) statsDefaultEl.style.display = '';
    if (statsGoalEl) statsGoalEl.style.display = 'none';
    goalBar.style.display = 'none';
    goalTargetInput.value = '';
    goalLockCheckbox.checked = false;
    showToast(getTrans('text_goal_cleared'));
  }

  function triggerGoalLock() {
    if (!goalLockEnabled || goalLockTriggered) return;
    goalLockTriggered = true;
    richEditor.contentEditable = 'false';
  }

  // ========== AUTO-SAVE TIMESTAMP ==========
  function getRelativeSaveTime() {
    var trans = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[getCurrentLang()]) || {};
    if (!lastSavedTime) return trans.text_not_saved || 'Not saved';
    var diff = Math.floor((Date.now() - lastSavedTime) / 1000);
    if (diff < 60) return trans.text_saved || 'Saved just now';
    if (diff < 3600) return (trans.text_saved_minutes_ago || '{n}m ago').replace('{n}', Math.floor(diff / 60));
    return (trans.text_saved_hours_ago || '{n}h ago').replace('{n}', Math.floor(diff / 3600));
  }

  // ========== DOCUMENT OUTLINE ==========
  var outlineDebounceTimer = null;
  function toggleOutline() {
    if (!outlinePanel) return;
    if (outlinePanel.style.display === 'none' || !outlinePanel.style.display) {
      outlinePanel.style.display = 'flex';
      outlinePanel.style.flexDirection = 'column';
      updateOutline();
    } else {
      outlinePanel.style.display = 'none';
    }
  }

  function updateOutline() {
    if (!outlineList || !outlinePanel || outlinePanel.style.display === 'none') return;
    var headings = richEditor.querySelectorAll('h1, h2, h3');
    if (headings.length === 0) {
      outlineList.innerHTML = '<div class="outline-empty">' + getTrans('outline_empty') + '</div>';
      return;
    }
    outlineList.innerHTML = '';
    for (var i = 0; i < headings.length; i++) {
      (function(h) {
        var item = document.createElement('div');
        item.className = 'outline-item outline-item-' + h.tagName.toLowerCase();
        item.textContent = h.textContent || '(empty)';
        item.onclick = function() {
          h.scrollIntoView({ behavior: 'smooth', block: 'center' });
          h.classList.add('outline-flash');
          setTimeout(function() { h.classList.remove('outline-flash'); }, 1200);
          richEditor.focus();
        };
        outlineList.appendChild(item);
      })(headings[i]);
    }
  }

  // ========== READING PROGRESS BAR ==========
  function updateReadingProgress() {
    if (!progressBar || !readingProgressEnabled) return;
    var max = richEditor.scrollHeight - richEditor.clientHeight;
    if (max <= 0) { progressBar.style.width = '0%'; return; }
    var pct = (richEditor.scrollTop / max) * 100;
    progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }
  if (richEditor) {
    richEditor.addEventListener('scroll', updateReadingProgress, { passive: true });
  }
  window.addEventListener('oros-reading-progress-changed', function(e) {
    readingProgressEnabled = e.detail.enabled;
    if (progressBar) {
      progressBar.style.display = readingProgressEnabled ? '' : 'none';
      if (!readingProgressEnabled) progressBar.style.width = '0%';
    }
    if (readingProgressEnabled) updateReadingProgress();
  });

  // ========== SMART TYPOGRAPHY ==========
  var isReplacing = false;
  function handleSmartTypography() {
    if (!smartTypographyEnabled || isReplacing || goalLockTriggered) return;
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    if (!richEditor.contains(range.endContainer)) return;
    var preRange = range.cloneRange();
    preRange.selectNodeContents(richEditor);
    preRange.setEnd(range.endContainer, range.endOffset);
    var before = preRange.toString();
    if (!before) return;
    var deleteLen = 0;
    var insert = '';
    var last4 = before.slice(-4);
    var last3 = before.slice(-3);
    var last2 = before.slice(-2);
    var last1 = before.slice(-1);
    if (last4 === '(tm)') { deleteLen = 4; insert = '\u2122'; }
    else if (last3 === '(c)') { deleteLen = 3; insert = '\u00A9'; }
    else if (last3 === '(r)') { deleteLen = 3; insert = '\u00AE'; }
    else if (last3 === '...') { deleteLen = 3; insert = '\u2026'; }
    else if (last2 === '--') { deleteLen = 2; insert = '\u2014'; }
    else if (last1 === '"') {
      var pc = before.length > 1 ? before[before.length - 2] : ' ';
      insert = /\w/.test(pc) ? '\u201D' : '\u201C';
      deleteLen = 1;
    }
    else if (last1 === "'") {
      var pc2 = before.length > 1 ? before[before.length - 2] : ' ';
      insert = /\w/.test(pc2) ? '\u2019' : '\u2018';
      deleteLen = 1;
    }
    else return;
    isReplacing = true;
    for (var i = 0; i < deleteLen; i++) { document.execCommand('delete', false); }
    document.execCommand('insertText', false, insert);
    isReplacing = false;
  }
  window.addEventListener('oros-smart-typography-changed', function(e) { smartTypographyEnabled = e.detail.enabled; });
  
    // ========== METADATA INPUT HANDLERS ==========
  function setupMetadataHandlers() {
    var inputs = [metaTitle, metaAuthor, metaTags, metaCategory];
    for (var i = 0; i < inputs.length; i++) {
      (function(input) {
        if (!input) return;
        input.addEventListener('blur', function() {
          saveMetadata(true);
        });
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveMetadata(true);
            // Move focus cyclically
            if (input === metaTitle && metaAuthor) metaAuthor.focus();
            else if (input === metaAuthor && metaCategory) metaCategory.focus();
            else if (input === metaCategory && metaTags) metaTags.focus();
            else if (input === metaTags && metaTitle) metaTitle.focus();
          }
        });
      })(inputs[i]);
    }
  }

  // ========== FIND & REPLACE ==========
  function toggleFindBar() {
    if (!findBar || !findInput) return;
    if (findBar.style.display === 'flex') {
      findBar.style.display = 'none';
      findInput.value = '';
      replaceInput.value = '';
      currentMatchIndex = -1;
      matchRanges = [];
    } else {
      findBar.style.display = 'flex';
      findInput.focus();
      highlightMatches();
    }
  }

  function highlightMatches() {
    if (!findInput || !richEditor) return;
    var searchTerm = findInput.value.toLowerCase();
    if (!searchTerm) {
      if (frResults) frResults.textContent = getTrans('fr_no_matches');
      return;
    }
    var content = richEditor.innerText.toLowerCase();
    var matches = 0;
    var idx = content.indexOf(searchTerm);
    while (idx !== -1) {
      matches++;
      idx = content.indexOf(searchTerm, idx + 1);
    }
    if (frResults) {
      if (matches > 0) {
        frResults.textContent = matches + ' ' + getTrans('fr_results_matches');
      } else {
        frResults.textContent = getTrans('fr_no_matches');
      }
    }
  }

  // ========== FOCUS MODE ==========
  var focusDebounceTimer = null;
  function initFocusMode() {
    if (!richEditor || !richWrapper) return;
    document.addEventListener('selectionchange', handleSelectionChange);
    richEditor.addEventListener('scroll', function() {
      if (document.getElementById('focus-spotlight')) clearFocusMode();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && document.getElementById('focus-spotlight')) {
        clearFocusMode();
      }
    });
    window.addEventListener('oros-focus-mode-changed', function(e) {
      focusModeEnabled = e.detail.enabled;
      if (!focusModeEnabled) clearFocusMode();
    });
  }

  function handleSelectionChange() {
    if (!focusModeEnabled) return;
    clearTimeout(focusDebounceTimer);
    focusDebounceTimer = setTimeout(function() {
      var selection = window.getSelection();
      if (!selection.rangeCount || selection.isCollapsed) {
        clearFocusMode();
        return;
      }
      var range = selection.getRangeAt(0);
      if (!richEditor.contains(range.commonAncestorContainer)) {
        clearFocusMode();
        return;
      }
      var selRect = range.getBoundingClientRect();
      if (selRect.width === 0 || selRect.height === 0) {
        clearFocusMode();
        return;
      }
      clearFocusMode();
      var wrapperRect = richWrapper.getBoundingClientRect();
      var spotlight = document.createElement('div');
      spotlight.id = 'focus-spotlight';
      spotlight.className = 'focus-spotlight';
      spotlight.style.top = (selRect.top - wrapperRect.top) + 'px';
      spotlight.style.left = (selRect.left - wrapperRect.left) + 'px';
      spotlight.style.width = selRect.width + 'px';
      spotlight.style.height = selRect.height + 'px';
      richWrapper.appendChild(spotlight);
    }, 150);
  }

  function clearFocusMode() {
    var spotlight = document.getElementById('focus-spotlight');
    if (spotlight) spotlight.remove();
  }

  // ========== CONTEXT MENU ==========
  var contextMenu = null;
  function showContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Remove existing menu
    if (contextMenu) {
      contextMenu.remove();
      contextMenu = null;
    }
    
    var menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = '' +
      '<div class="cm-item" data-cmd="bold"><span class="cm-icon">B</span>Bold</div>' +
      '<div class="cm-item" data-cmd="italic"><span class="cm-icon">I</span>Italic</div>' +
      '<div class="cm-item" data-cmd="underline"><span class="cm-icon">U</span>Underline</div>' +
      '<div class="cm-divider"></div>' +
      '<div class="cm-item" data-cmd="strikeThrough"><span class="cm-icon">S</span>Strike</div>' +
      '<div class="cm-item" data-cmd="formatBlock;H1"><span class="cm-icon">#</span>H1</div>' +
      '<div class="cm-item" data-cmd="formatBlock;H2"><span class="cm-icon">##</span>H2</div>' +
      '<div class="cm-item" data-cmd="formatBlock;H3"><span class="cm-icon">###</span>H3</div>' +
      '<div class="cm-divider"></div>' +
      '<div class="cm-item" data-cmd="insertUnorderedList"><span class="cm-icon">•</span>Bullets</div>' +
      '<div class="cm-item" data-cmd="insertOrderedList"><span class="cm-icon">1.</span>Numbers</div>' +
      '<div class="cm-divider"></div>' +
      '<div class="cm-item" data-cmd="undo"><span class="cm-icon">↶</span>Undo</div>' +
      '<div class="cm-item" data-cmd="redo"><span class="cm-icon">↷</span>Redo</div>';
    
    menu.style.position = 'fixed';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    
    var items = menu.querySelectorAll('.cm-item');
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        item.onclick = function() {
          var cmdData = item.getAttribute('data-cmd');
          var parts = cmdData.split(';');
          var cmd = parts[0];
          var val = parts[1] || null;
          document.execCommand(cmd, false, val);
          contextMenu.remove();
          contextMenu = null;
          richEditor.focus();
        };
      })(items[i]);
    }
    
    document.body.appendChild(menu);
    contextMenu = menu;
    
    // Close on ESC
    var closeHandler = function(ev) {
      if (ev.key === 'Escape' && contextMenu) {
        contextMenu.remove();
        contextMenu = null;
        document.removeEventListener('keydown', closeHandler);
      }
    };
    document.addEventListener('keydown', closeHandler);
  }

  // ========== QUICK FORMAT TOOLBAR ==========
  function setupQuickFormatToolbar() {
    if (!quickFormatToolbar) return;
    var fmtBtns = quickFormatToolbar.querySelectorAll('.fmt-btn');
    for (var i = 0; i < fmtBtns.length; i++) {
      (function(btn) {
        btn.onclick = function() {
          var cmd = btn.getAttribute('data-cmd');
          var block = btn.getAttribute('data-block');
          
          // Check if already active
          if (cmd && document.queryCommandState(cmd)) {
            // Toggle off - this requires custom handling
            // For simplicity, we'll just re-run the command
            document.execCommand(cmd, false);
          } else if (block) {
            document.execCommand('formatBlock', false, block);
          } else if (cmd) {
            document.execCommand(cmd, false);
          }
        };
      })(fmtBtns[i]);
    }
  }

  // ========== TYPWRITER MODE ==========
  function toggleTypewriterMode() {
    typewriterMode = !typewriterMode;
    if (!richWrapper || !richEditor) return;
    
    if (typewriterMode) {
      scrollToCenter();
    }
    // You can add a visual indicator here if desired
  }

  function scrollToCenter() {
    if (!richEditor || !richWrapper) return;
    var selection = window.getSelection();
    if (!selection.rangeCount) return;
    var range = selection.getRangeAt(0);
    if (range.collapsed) return;
    
    var rect = range.getBoundingClientRect();
    var wrapperRect = richWrapper.getBoundingClientRect();
    var editorHeight = richEditor.offsetHeight;
    
    // Calculate scroll position to place cursor at ~45% of viewport
    var targetScroll = wrapperRect.top - wrapperRect.y + (rect.top - wrapperRect.top) - (editorHeight * 0.45);
    richWrapper.scrollTop = Math.max(0, targetScroll);
  }

  // ========== FILE OPEN ==========
  function openFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var content = e.target.result;
      
      // Try to import frontmatter if .md
      if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
        content = importFrontmatter(content);
      }
      
      // Set content
      richEditor.innerHTML = content;
      saveContent();
      updateStats();
      showToast(getTrans('toast_opened'));
    };
    reader.onerror = function() {
      showToast('Error reading file');
    };
    reader.readAsText(file);
  }

  // ========== EXPORT ==========
  function downloadFile(format) {
    var content = richEditor.innerHTML;
    var textContent = richEditor.innerText;
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var filenamePrefix = timestamp;
    var ext = '';
    var mime = 'text/plain;charset=utf-8';
    var data = '';
    
    switch (format) {
      case 'md':
        var hasMetadata = metadata.title || metadata.author || metadata.tags || metadata.category;
        data = hasMetadata ? buildFrontmatter() : '';
        data += convertHTMLtoMarkdown(content);
        ext = '.md';
        mime = 'text/markdown;charset=utf-8';
        break;
      case 'txt':
        data = textContent;
        ext = '.txt';
        break;
      case 'rtf':
        data = convertToRTF(textContent);
        ext = '.rtf';
        mime = 'application/rtf;charset=utf-8';
        break;
      case 'pdf':
        window.print();
        return;
      case 'doc':
        data = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>' + content + '</body></html>';
        ext = '.doc';
        mime = 'application/msword;charset=utf-8';
        break;
    }
    
    var blob = new Blob([data], { type: mime });
    triggerDownload(blob, filenamePrefix + ext);
    showToast(getTrans('toast_downloaded'));
  }

  function convertHTMLtoMarkdown(html) {
    var md = html;
    md = md.replace(/<[^>]+>/g, '');
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    md = md.replace(/&quot;/g, '"');
    md = md.replace(/&#39;/g, "'");
    return md;
  }

  function convertToRTF(text) {
    var escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/{/g, '\\{').replace(/}/g, '\\}');
    return "{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033{\\fonttbl{\\f0\\fnil\\fcharset0 Nunito;}}\\f0\\fs24 " + escaped + "}";
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', function(e) {
    // Ctrl+S - Save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveContent();
      showToast(getTrans('text_saved'));
    }
    // Ctrl+G - Goal
    else if (e.ctrlKey && e.key === 'g') {
      e.preventDefault();
      toggleGoalBar();
    }
    // Ctrl+F - Find
    else if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      toggleFindBar();
    }
    // Ctrl+Enter - Typewriter
    else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      toggleTypewriterMode();
    }
    // F8 - Focus Mode
    else if (e.key === 'F8' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      // Handled in main.js via settings
    }
    // Escape - Close panels
    else if (e.key === 'Escape') {
      if (metadataPanel && metadataPanel.style.display !== 'none') {
        saveMetadata(false);
        metadataPanel.style.display = 'none';
      }
      if (outlinePanel && outlinePanel.style.display !== 'none') {
        outlinePanel.style.display = 'none';
      }
      if (findBar && findBar.style.display === 'flex') {
        findBar.style.display = 'none';
      }
      if (goalBar && goalBar.style.display === 'flex') {
        goalBar.style.display = 'none';
      }
      if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
      }
    }
  });

  // ========== VISIBILITY INIT ==========
  if (hideStats && statsOverlay) statsOverlay.style.display = 'none';
  if (hideQuickTbar && quickFormatToolbar) quickFormatToolbar.style.display = 'none';
  if (!readingProgressEnabled && progressBar) progressBar.style.display = 'none';
  if (hideGoalBtn && btnGoal) btnGoal.style.display = 'none';
  if (hideOutlineBtn && btnOutline) btnOutline.style.display = 'none';
  if (hideMetadataBtn && btnMetadata) btnMetadata.style.display = 'none';
  if (hideFindBtn && btnFind) btnFind.style.display = 'none';

  // ========== CUSTOM EVENTS ==========
  window.addEventListener('oros-hide-goal-btn-changed', function(e) {
    hideGoalBtn = e.detail.hidden;
    if (btnGoal) btnGoal.style.display = hideGoalBtn ? 'none' : '';
  });
  window.addEventListener('oros-hide-outline-btn-changed', function(e) {
    hideOutlineBtn = e.detail.hidden;
    if (btnOutline) btnOutline.style.display = hideOutlineBtn ? 'none' : '';
  });
  window.addEventListener('oros-hide-metadata-btn-changed', function(e) {
    hideMetadataBtn = e.detail.hidden;
    if (btnMetadata) btnMetadata.style.display = hideMetadataBtn ? 'none' : '';
  });
  window.addEventListener('oros-hide-find-btn-changed', function(e) {
    hideFindBtn = e.detail.hidden;
    if (btnFind) btnFind.style.display = hideFindBtn ? 'none' : '';
  });
  window.addEventListener('oros-language-changed', function(e) {
    updateStats();
    renderMetaDates();
  });

  // ========== EVENT LISTENERS ==========
  if (btnMetadata) btnMetadata.addEventListener('click', toggleMetadataPanel);
  if (btnCloseMetadata) btnCloseMetadata.addEventListener('click', function() {
    saveMetadata(false);
    metadataPanel.style.display = 'none';
  });

  if (btnOutline) btnOutline.addEventListener('click', toggleOutline);
  if (btnCloseOutline) btnCloseOutline.addEventListener('click', function() {
    outlinePanel.style.display = 'none';
  });

  if (btnGoal) btnGoal.addEventListener('click', toggleGoalBar);
  if (btnSetGoal) btnSetGoal.addEventListener('click', setGoal);
  if (btnClearGoal) btnClearGoal.addEventListener('click', clearGoal);
  if (btnCloseGoal) btnCloseGoal.addEventListener('click', function() {
    goalBar.style.display = 'none';
  });

  if (btnFind) btnFind.addEventListener('click', toggleFindBar);
  if (findBar) {
    findInput.addEventListener('input', highlightMatches);
    if (btnCloseFR) btnCloseFR.addEventListener('click', function() {
      findBar.style.display = 'none';
      findInput.value = '';
    });
  }

  if (btnOpen) btnOpen.addEventListener('click', function() {
    if (fileInput) fileInput.click();
  });
  if (fileInput) fileInput.addEventListener('change', function() {
    if (this.files && this.files[0]) {
      openFile(this.files[0]);
      this.value = '';
    }
  });

  if (btnClear) btnClear.addEventListener('click', function() {
    if (confirm('Are you sure? All unsaved content will be lost.')) {
      richEditor.innerHTML = '';
      saveContent();
      updateStats();
      showToast(getTrans('toast_cleared'));
    }
  });

  if (btnExport) {
    btnExport.addEventListener('click', function(e) {
      e.stopPropagation();
      if (exportDropdown) exportDropdown.classList.toggle('visible');
    });
  }
  document.addEventListener('click', function() {
    if (exportDropdown) exportDropdown.classList.remove('visible');
  });
  if (exportDropdown) {
    var expBtns = exportDropdown.querySelectorAll('button');
    for (var j = 0; j < expBtns.length; j++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var fmt = btn.getAttribute('data-format');
          downloadFile(fmt);
        });
      })(expBtns[j]);
    }
  }

  // Click on richEditor to dismiss context menu
  if (richEditor) {
    richEditor.addEventListener('click', function(e) {
      if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
      }
    });
    
    // Alt+Right-click for context menu
    richEditor.addEventListener('contextmenu', function(e) {
      if (e.altKey) {
        showContextMenu(e);
      }
    });
    
    // Smart typography
    richEditor.addEventListener('keyup', handleSmartTypography);
  }

  // ========== INITIALIZE ==========
  loadContent();
  loadMetadata();
  renderMetaDates();
  setupMetadataHandlers();
  setupQuickFormatToolbar();
  initFocusMode();
  updateStats();
  
})();