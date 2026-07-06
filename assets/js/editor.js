// ============================================
// orOS Writer — Unified Rich Text Editor
// Focus Mode + Document Outline + Reading Progress
// Smart Typography + Auto-Save Timestamp
// Writing Goal Tracker (words/chars/paras + lock)
// Smart Lists, Import RTF/DOC, Stats, Find/Replace
// Drag&Drop, Quick Format Toolbar (incl. H1/H2/H3)
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

  var richEditor = document.getElementById('rich-editor');
  var richWrapper = document.getElementById('rich-wrapper');
  var editorContainer = richWrapper;
  var wordCountEl = document.getElementById('word_count');
  var charCountEl = document.getElementById('char_count');
  var readTimeEl = document.getElementById('read_time');
  var saveStatus = document.getElementById('save_status');
  var findBar = document.getElementById('find-replace-bar');
  var findInput = document.getElementById('find-find');
  var replaceInput = document.getElementById('find-replace');
  var frResults = document.getElementById('fr_results');
  var btnOpen = document.getElementById('btn-open');
  var btnClear = document.getElementById('btn-clear');
  var btnExport = document.getElementById('btn-export');
  var exportDropdown = document.getElementById('export-dropdown');
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

  var hideStats = localStorage.getItem(STORAGE_HIDE_STATS) === 'true';
  var hideQuickTbar = localStorage.getItem(STORAGE_HIDE_QUICK_TBAR) === 'true';
  var focusModeEnabled = localStorage.getItem(STORAGE_FOCUS_MODE) !== 'false';
  var readingProgressEnabled = localStorage.getItem(STORAGE_READING_PROGRESS) !== 'false';
  var smartTypographyEnabled = localStorage.getItem(STORAGE_SMART_TYPOGRAPHY) !== 'false';
  var lastSavedTime = parseInt(localStorage.getItem(STORAGE_LAST_SAVED)) || null;
  var goalTarget = parseInt(localStorage.getItem(STORAGE_GOAL_TARGET)) || null;
  var goalUnit = localStorage.getItem(STORAGE_GOAL_UNIT) || 'words';
  var goalLockEnabled = localStorage.getItem(STORAGE_GOAL_LOCK) === 'true';
  var goalReachedShown = false;
  var goalLockTriggered = false;
  var currentMatchIndex = -1;
  var matchRanges = [];

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
  function getHTMLContent() { return richEditor.innerHTML || ''; }

  // ========== STATS ==========
  function updateStats() {
    var text = getTextContent();
    var chars = text.length;
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    var readMinutes = Math.max(1, Math.ceil(words / 200));
    wordCountEl.textContent = formatNumber(words);
    charCountEl.textContent = formatNumber(chars);
    var minLabel = getCurrentLang() === 'el' ? ' λεπτά' : ' min';
    readTimeEl.textContent = readMinutes + minLabel;
    if (goalTarget) updateGoalProgress();
  }

  // ========== WRITING GOAL TRACKER ==========
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
      goalReachedShown = false;
      goalLockTriggered = false;
    }
  }

  function toggleGoalBar() {
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

  function unlockWriting() {
    goalLockTriggered = false;
    richEditor.contentEditable = 'true';
    showToast('✏️ Έκλεισμα γραφής ακυρώθηκε');
  }

  function triggerGoalLock() {
    if (!goalLockEnabled || goalLockTriggered) return;
    goalLockTriggered = true;
    richEditor.contentEditable = 'false';
    setTimeout(function() {
      var confirmUnlock = confirm(getTrans('text_goal_locked').replace('🔒', '').trim());
      if (confirmUnlock) unlockWriting();
    }, 500);
  }

  // ========== AUTO-SAVE TIMESTAMP INDICATOR ==========
  function getRelativeSaveTime() {
    var lang = getCurrentLang();
    var trans = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[lang]) || {};
    if (!lastSavedTime) return trans.text_not_saved || 'Not saved';
    var diff = Math.floor((Date.now() - lastSavedTime) / 1000);
    if (diff < 60) return trans.text_saved_just_now || 'Saved just now';
    if (diff < 3600) return (trans.text_saved_mins_ago || '{n}m ago').replace('{n}', Math.floor(diff / 60));
    return (trans.text_saved_hours_ago || '{n}h ago').replace('{n}', Math.floor(diff / 3600));
  }
  function updateSaveStatus() { if (saveStatus) saveStatus.textContent = getRelativeSaveTime(); }
  setInterval(updateSaveStatus, 30000);

  // ========== DOCUMENT OUTLINE ==========
  var outlineDebounceTimer = null;
  function toggleOutline() {
    if (outlinePanel.style.display === 'none' || !outlinePanel.style.display) {
      outlinePanel.style.display = 'flex'; outlinePanel.style.flexDirection = 'column'; updateOutline();
    } else { outlinePanel.style.display = 'none'; }
  }
  function updateOutline() {
    if (!outlineList || outlinePanel.style.display === 'none' || !outlinePanel.style.display) return;
    var headings = richEditor.querySelectorAll('h1, h2, h3');
    var emptyMsg = getCurrentLang() === 'el' ? 'Δεν βρέθηκαν τίτλοι' : 'No headings found';
    if (headings.length === 0) { outlineList.innerHTML = '<div class="outline-empty">' + emptyMsg + '</div>'; return; }
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
  richEditor.addEventListener('scroll', updateReadingProgress, { passive: true });
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
      var prevChar = before.length > 1 ? before[before.length - 2] : ' ';
      insert = /\w/.test(prevChar) ? '\u201D' : '\u201C';
      deleteLen = 1;
    }
    else if (last1 === "'") {
      var prevChar = before.length > 1 ? before[before.length - 2] : ' ';
      insert = /\w/.test(prevChar) ? '\u2019' : '\u2018';
      deleteLen = 1;
    }
    else return;
    isReplacing = true;
    for (var i = 0; i < deleteLen; i++) { document.execCommand('delete', false); }
    document.execCommand('insertText', false, insert);
    isReplacing = false;
  }
  window.addEventListener('oros-smart-typography-changed', function(e) { smartTypographyEnabled = e.detail.enabled; });

  // ========== LANGUAGE CHANGE LISTENER ==========
  window.addEventListener('oros-language-changed', function(e) { updateStats(); updateSaveStatus(); });

  // ========== FOCUS MODE ==========
  var focusDebounceTimer = null;
  function initFocusMode() {
    if (!richEditor || !richWrapper) return;
    document.addEventListener('selectionchange', handleSelectionChange);
    richEditor.addEventListener('scroll', function() { if (document.getElementById('focus-spotlight')) clearFocusMode(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && document.getElementById('focus-spotlight')) clearFocusMode(); });
    window.addEventListener('oros-focus-mode-changed', function(e) { focusModeEnabled = e.detail.enabled; if (!focusModeEnabled) clearFocusMode(); });
  }
  function handleSelectionChange() {
    if (!focusModeEnabled) return;
    clearTimeout(focusDebounceTimer);
    focusDebounceTimer = setTimeout(function() {
      var selection = window.getSelection();
      if (!selection.rangeCount || selection.isCollapsed) { clearFocusMode(); return; }
      var range = selection.getRangeAt(0);
      if (!richEditor.contains(range.commonAncestorContainer)) { clearFocusMode(); return; }
      var selRect = range.getBoundingClientRect();
      if (selRect.width === 0 || selRect.height === 0) { clearFocusMode(); return; }
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
  function clearFocusMode() { var spotlight = document.getElementById('focus-spotlight'); if (spotlight) spotlight.remove(); }

  // ========== VISIBILITY INIT ==========
  if (hideStats && statsOverlay) statsOverlay.style.display = 'none';
  if (hideQuickTbar && quickFormatToolbar) quickFormatToolbar.style.display = 'none';
  if (!readingProgressEnabled && progressBar) progressBar.style.display = 'none';
  if (statsGoalEl && statsDefaultEl) {
    if (goalTarget) { statsDefaultEl.style.display = 'none'; statsGoalEl.style.display = ''; }
    else { statsDefaultEl.style.display = ''; statsGoalEl.style.display = 'none'; }
  }

  // ========== DRAG & DROP ==========
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) { editorContainer.addEventListener(eventName, preventDefaults, false); });
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  editorContainer.addEventListener('dragover', function() { editorContainer.style.boxShadow = 'inset 0 0 0 2px var(--accent)'; });
  editorContainer.addEventListener('dragleave', function() { editorContainer.style.boxShadow = ''; });
  editorContainer.addEventListener('drop', function(e) { var file = e.dataTransfer.files[0]; if (file) importFile(file); });
  function importFile(file) {
    var ext = '.' + file.name.split('.').pop().toLowerCase();
    var reader = new FileReader();
    reader.onload = function(ev) {
      var content = ev.target.result;
      if (ext === '.txt' || ext === '.md') richEditor.innerHTML = markdownToHtml(content);
      else if (ext === '.rtf') richEditor.innerHTML = parseRtf(content);
      else if (ext === '.doc') richEditor.innerHTML = stripDocTags(content);
      else richEditor.innerText = content;
      saveContent(false); updateStats();
      showToast(getCurrentLang() === 'el' ? '✓ Άνοιγμα' : '✓ Opened');
    };
    if (['.txt','.md','.rtf','.doc'].includes(ext)) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }

  // ========== SMART LISTS ==========
  function checkSmartList(e) {
    if (e.key !== 'Enter') return;
    var line = getLineBeforeCursor();
    var bulletMatch = line.match(/^(\s*)[-*]\s/);
    var numberMatch = line.match(/^(\s*)(\d+)\.\s/);
    if (bulletMatch) { e.preventDefault(); insertBlock((bulletMatch[1] || '') + '- '); autoBreakEmptyBullet(line); }
    else if (numberMatch) { e.preventDefault(); insertBlock((numberMatch[1] || '') + (parseInt(numberMatch[2]) + 1) + '. '); autoBreakEmptyNumber(line); }
  }
  function getLineBeforeCursor() {
    var selection = window.getSelection();
    if (selection.rangeCount === 0) return '';
    var range = selection.getRangeAt(0);
    var preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(richEditor);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    var lines = preCaretRange.toString().split('\n');
    return lines[lines.length - 1] || '';
  }
  function insertBlock(prefix) { document.execCommand('insertHTML', false, '<div><br/></div>'); moveCursorToFront(prefix.length); }
  function autoBreakEmptyBullet(originalLine) {
    if (originalLine.trim() === '-' || originalLine.trim() === '*') {
      setTimeout(function() { if (getLineBeforeCursor().trim() === '-') deleteCurrentBlock(); }, 30);
    }
  }
  function autoBreakEmptyNumber(originalLine) {
    if (/^\s*\d+\.$/.test(originalLine.trim())) {
      setTimeout(function() { if (/^\d+\.$/.test(getLineBeforeCursor().trim())) deleteCurrentBlock(); }, 30);
    }
  }
  function deleteCurrentBlock() {
    var range = document.createRange();
    var sel = window.getSelection();
    range.selectNodeContents(richEditor);
    range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('delete');
  }
  function moveCursorToFront(pos) {
    var range = document.createRange();
    var sel = window.getSelection();
    var node = richEditor.firstChild;
    while (node && pos > getNodeLength(node)) { pos -= getNodeLength(node); node = node.nextSibling; }
    if (node) range.setStart(node, Math.min(pos, getNodeLength(node)));
    else range.setStart(richEditor, 0);
    range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
  }
  function getNodeLength(node) {
    if (node.nodeType === 3) return node.nodeValue.length;
    if (node.nodeType === 1) {
      var len = 0;
      for (var i = 0; i < node.childNodes.length; i++) len += getNodeLength(node.childNodes[i]);
      return len;
    }
    return 0;
  }

  // ========== OPEN / CLEAR ==========
  btnOpen.onclick = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.markdown,.text,.rtf,.doc,.docx';
    input.onchange = function(e) { var f = e.target.files[0]; if (f) importFile(f); };
    input.click();
  };
  btnClear.onclick = function() {
    if (!richEditor.innerText.trim()) return;
    var lang = getCurrentLang();
    if (!confirm(lang === 'el' ? 'Εκκαθάριση περιεχομένου;' : 'Clear content? Cannot undo.')) return;
    richEditor.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_LAST_SAVED);
    lastSavedTime = null;
    saveContent(false);
    updateStats();
    showToast(lang === 'el' ? '✓ Καθαρίστηκε' : '✓ Cleared');
  };

  // ========== EXPORT ==========
  btnExport.onclick = function(e) { e.stopPropagation(); exportDropdown.classList.toggle('visible'); };
  document.addEventListener('click', function(e) { if (!e.target.closest('.export-wrap')) exportDropdown.classList.remove('visible'); });
  var dropdownButtons = exportDropdown.querySelectorAll('button');
  for (var i = 0; i < dropdownButtons.length; i++) {
    dropdownButtons[i].onclick = function() { exportContent(this.dataset.format); exportDropdown.classList.remove('visible'); };
  }
  function exportContent(format) {
    var ts = new Date().toISOString().slice(0, 10);
    var raw = getTextContent();
    switch(format) {
      case 'md': downloadFile(htmlToMarkdown(getHTMLContent()), 'oros-' + ts + '.md', 'text/markdown;charset=utf-8'); break;
      case 'txt': downloadFile(raw.replace(/[#*>`]/g, ''), 'oros-' + ts + '.txt', 'text/plain;charset=utf-8'); break;
      case 'rtf': exportRtf(raw, 'oros-' + ts + '.rtf'); break;
      case 'pdf': exportPdf(raw); break;
      case 'doc': exportDoc(raw, 'oros-' + ts + '.doc'); break;
    }
    showToast(getCurrentLang() === 'el' ? '↓ Κατέβηκε' : '↓ Downloaded');
  }
  function htmlToMarkdown(html) {
    return html.replace(/<h1>(.*?)<\/h1>/gi, '# $1\n').replace(/<h2>(.*?)<\/h2>/gi, '## $1\n').replace(/<h3>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**').replace(/<b>(.*?)<\/b>/gi, '**$1**').replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i>(.*?)<\/i>/gi, '*$1*').replace(/<u>(.*?)<\/u>/gi, '$1').replace(/<s>(.*?)<\/s>/gi, '~~$1~~')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`').replace(/<blockquote>(.*?)<\/blockquote>/gi, '> $1\n').replace(/<br\s*\/?>/gi, '\n')
      .replace(/<div>(.*?)<\/div>/gi, '$1\n').replace(/<[^>]+>/g, '');
  }
  function markdownToHtml(md) {
    return md.replace(/^### (.*$)/gim, '<h3>$1</h3>').replace(/^## (.*$)/gim, '<h2>$1</h2>').replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/gim, '<strong>$1</strong>').replace(/\*(.+?)\*/gim, '<em>$1</em>').replace(/`(.+?)`/gim, '<code>$1</code>')
      .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>').replace(/\n/gim, '<br/>');
  }
  function parseRtf(rtf) {
    rtf = rtf.replace(/\\\r?\n/g, '').replace(/{/g, '\\{').replace(/}/g, '\\}');
    var text = rtf.replace(/\\[^\s]* /g, '').replace(/\\par/g, '</p><p>').replace(/\\b/i, '<b>').replace(/\\i/i, '<i>')
      .replace(/\\u\d+\?/g, '?').replace(/\\/g, '').replace(/{|}/g, '');
    return '<div>' + text + '</div>';
  }
  function stripDocTags(content) {
    return content.replace(/<html[^>]*>|<\/html>|<head[^>]*>|<\/head>|<w:[^>]+>|<\/w:[^>]+>|<o:[^>]+>|<\/o:[^>]+>/gi, '');
  }
  function exportRtf(content, filename) {
    var rtf = '{\\rtf1\\ansi\\deff0\n{\\fonttbl{\\f0 Nunito;}{\\f1 Courier New;}}\n{\\colortbl;\\red117\\green111\\blue104;}\n\\f0\\fs24\n';
    var lines = splitIntoLines(content);
    for (var i = 0; i < lines.length; i++) rtf += applyInlineRtf(escapeRtf(lines[i])) + '\\line\n';
    rtf += '}';
    downloadFile(rtf, filename, 'application/rtf;charset=utf-8');
  }
  function splitIntoLines(str) {
    var lines = str.split(/(?=<br\/>|<div>)|\n/g);
    var result = [], buffer = '';
    for (var i = 0; i < lines.length; i++) {
      buffer += lines[i];
      if (buffer.match(/<br\/>|<\/p>/) || lines[i].indexOf('</div>') !== -1) {
        result.push(buffer.replace(/<(?:br|\/p|\/div)>/gi, '')); buffer = '';
      }
    }
    if (buffer.trim()) result.push(buffer.trim().replace(/<[a-z][^>]*>|<\/[a-z]>$/gi, ''));
    return result;
  }
  function escapeRtf(text) {
    var r = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], code = text.charCodeAt(i);
      if (ch === '\\' || ch === '{' || ch === '}') r += '\\' + ch;
      else if (code > 127) r += '\\u' + code + '?';
      else r += ch;
    }
    return r;
  }
  function applyInlineRtf(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '{\\b $1\\b0}').replace(/\*(.+?)\*/g, '{\\i $1\\i0}').replace(/`(.+?)`/g, '{\\f1 $1\\f0}');
  }
  function exportPdf(content) {
    var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>orOS Export</title>\n<style>\nbody{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.7;max-width:700px;margin:2rem auto;padding:1cm;color:#2b2723;}\nh1{font-size:1.8rem;}h2{font-size:1.4rem;}h3{font-size:1.15rem;}\nblockquote{border-left:3px solid #c8a96e;padding-left:1rem;font-style:italic;color:#756f68;}\ncode{font-family:monospace;background:#f6f5f1;padding:2px 5px;border-radius:3px;}\n@media print{body{margin:0;padding:1cm;}}\n</style>\n</head>\n<body>\n<div class="content">' + content + '</div>\n<script>\nwindow.addEventListener("load",function(){window.print();setTimeout(function(){window.close();},250);});\n<\/script>\n</body>\n</html>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    if (!window.open(url, '_blank')) { showToast(getCurrentLang() === 'el' ? '⚠ Επιτρέψτε τα pop-ups' : '⚠ Allow pop-ups'); URL.revokeObjectURL(url); }
  }
  function exportDoc(content, filename) {
    var header = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Export</title></head><body style="font-family:Calibri,sans-serif;font-size:12pt;">';
    var blob = new Blob(['\ufeff' + header + content + '</body></html>'], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ========== FIND & REPLACE ==========
  function showFindReplace() { findBar.style.display = 'flex'; findInput.focus(); findAndHighlight(); }
  function hideFindReplace() { findBar.style.display = 'none'; clearHighlights(); currentMatchIndex = -1; matchRanges = []; }
  function findAndHighlight() {
    var query = findInput.value;
    var lang = getCurrentLang();
    var mw = lang === 'el' ? 'αντιστοιχίες' : 'matches';
    clearHighlights(); matchRanges = []; currentMatchIndex = -1;
    if (!query) { frResults.textContent = '0 ' + mw; return; }
    var content = getTextContent();
    var regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var match;
    while ((match = regex.exec(content)) !== null) matchRanges.push([match.index, match.index + match[0].length]);
    frResults.textContent = matchRanges.length + ' ' + mw;
    if (matchRanges.length > 0) navigateToMatch(0);
  }
  function navigateToMatch(index) {
    if (matchRanges.length === 0) return;
    currentMatchIndex = index % matchRanges.length;
    if (currentMatchIndex < 0) currentMatchIndex += matchRanges.length;
    var range = matchRanges[currentMatchIndex];
    richEditor.focus();
    var textNodes = getTextNodes(richEditor);
    var pos = 0;
    for (var i = 0; i < textNodes.length; i++) {
      var nodeLen = textNodes[i].nodeValue.length;
      if (pos <= range[0] && pos + nodeLen >= range[1]) {
        var selRange = document.createRange();
        selRange.setStart(textNodes[i], range[0] - pos);
        selRange.setEnd(textNodes[i], Math.min(range[1] - pos, nodeLen));
        var sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(selRange);
        break;
      }
      pos += nodeLen;
    }
  }
  function getTextNodes(node) {
    var nodes = [];
    if (node.nodeType === 3) nodes.push(node);
    else for (var i = 0; i < node.childNodes.length; i++) nodes = nodes.concat(getTextNodes(node.childNodes[i]));
    return nodes;
  }
  function clearHighlights() {}
  document.getElementById('btn-replace').onclick = function() {
    if (matchRanges.length === 0) return;
    var range = matchRanges[currentMatchIndex];
    richEditor.focus();
    var textNodes = getTextNodes(richEditor);
    var pos = 0;
    for (var i = 0; i < textNodes.length; i++) {
      var nodeLen = textNodes[i].nodeValue.length;
      if (pos <= range[0] && pos + nodeLen >= range[1]) {
        var selRange = document.createRange();
        selRange.setStart(textNodes[i], range[0] - pos);
        selRange.setEnd(textNodes[i], range[1] - pos);
        var sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(selRange);
        document.execCommand('insertText', false, replaceInput.value);
        break;
      }
      pos += nodeLen;
    }
    saveContent(false); updateStats(); setTimeout(findAndHighlight, 50);
  };
  document.getElementById('btn-replace-all').onclick = function() {
    if (matchRanges.length === 0) return;
    var regex = new RegExp(findInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    richEditor.innerText = getTextContent().replace(regex, replaceInput.value);
    saveContent(false); updateStats(); setTimeout(findAndHighlight, 50);
    showToast(getCurrentLang() === 'el' ? '✓ Αντικαταστάθηκαν όλες' : '✓ All replaced');
  };

  // ========== QUICK FORMAT TOOLBAR ==========
  if (quickFormatToolbar) {
    var fmtButtons = quickFormatToolbar.querySelectorAll('.fmt-btn');
    for (var i = 0; i < fmtButtons.length; i++) {
      fmtButtons[i].addEventListener('mousedown', function(e) { e.preventDefault(); });
      fmtButtons[i].addEventListener('click', function() {
        if (this.dataset.block) { document.execCommand('formatBlock', false, this.dataset.block); }
        else { document.execCommand(this.dataset.cmd, false, null); }
        richEditor.focus(); saveContent(false); updateStats();
      });
    }
  }

  // ========== OUTLINE EVENT LISTENERS ==========
  if (btnOutline) btnOutline.onclick = toggleOutline;
  if (btnCloseOutline) btnCloseOutline.onclick = function() { outlinePanel.style.display = 'none'; };

  // ========== GOAL EVENT LISTENERS ==========
  if (btnGoal) btnGoal.onclick = toggleGoalBar;
  if (btnSetGoal) btnSetGoal.onclick = setGoal;
  if (btnClearGoal) btnClearGoal.onclick = clearGoal;
  if (btnCloseGoal) btnCloseGoal.onclick = function() { goalBar.style.display = 'none'; };
  if (goalTargetInput) goalTargetInput.addEventListener('keyup', function(e) { if (e.key === 'Enter') setGoal(); });
  if (goalBar) {
    goalBar.querySelector('.close-fr-btn').onclick = function() { goalBar.style.display = 'none'; };
    goalBar.querySelector('#btn-set-goal').onclick = setGoal;
    goalBar.querySelector('#btn-clear-goal').onclick = clearGoal;
  }

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', function(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F8' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      focusModeEnabled = !focusModeEnabled;
      localStorage.setItem(STORAGE_FOCUS_MODE, focusModeEnabled ? 'true' : 'false');
      showToast(focusModeEnabled ? (getCurrentLang() === 'el' ? '🔦 Focus Mode ΕΝΕΡΓΟ' : '🔦 Focus Mode ON') : (getCurrentLang() === 'el' ? '⚫ Focus Mode ΑΠΕΝΕΡΓΟ' : '⚫ Focus Mode OFF'));
      if (!focusModeEnabled) clearFocusMode();
      return;
    }
    if (e.key === 'Escape') {
      if (outlinePanel && outlinePanel.style.display !== 'none') { outlinePanel.style.display = 'none'; return; }
      if (findBar.style.display === 'flex') { hideFindReplace(); return; }
      if (goalBar.style.display === 'flex') { goalBar.style.display = 'none'; return; }
      if (document.querySelector('.context-menu')) { closeMenu(); return; }
    }
    if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); toggleGoalBar(); return; }
    if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); showFindReplace(); return; }
    if (ctrl && e.key.toLowerCase() === 'h') { e.preventDefault(); findInput.focus(); return; }
    if (ctrl && e.key.toLowerCase() === 'u') { if (document.activeElement === richEditor) { e.preventDefault(); document.execCommand('underline'); saveContent(false); updateStats(); } return; }
    if (!ctrl) return;
    var activeInEditor = document.activeElement === richEditor;
    switch(e.key.toLowerCase()) {
      case 's': e.preventDefault(); saveContent(true); break;
      case 'b': if (activeInEditor) { e.preventDefault(); document.execCommand('bold'); saveContent(false); updateStats(); } break;
      case 'i': if (activeInEditor) { e.preventDefault(); document.execCommand('italic'); saveContent(false); updateStats(); } break;
      case 'z': if (activeInEditor) { e.preventDefault(); document.execCommand('undo'); } break;
      case 'y': if (activeInEditor) { e.preventDefault(); document.execCommand('redo'); } break;
    }
  });

  // ========== AUTO-SAVE + UPDATE ==========
  var debounceTimer;
  richEditor.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { saveContent(false); }, 2000);
    updateStats();
    clearTimeout(outlineDebounceTimer);
    outlineDebounceTimer = setTimeout(updateOutline, 500);
    handleSmartTypography();
  });
  richEditor.addEventListener('paste', function() { setTimeout(updateStats, 0); });
  richEditor.addEventListener('keydown', checkSmartList);
  setInterval(function() { saveContent(false); }, 30000);

  function saveContent(showMsg) {
    localStorage.setItem(STORAGE_KEY, getHTMLContent());
    lastSavedTime = Date.now();
    localStorage.setItem(STORAGE_LAST_SAVED, lastSavedTime.toString());
    updateSaveStatus();
    if (showMsg) { showToast(getCurrentLang() === 'el' ? '✓ Αποθηκεύτηκε' : '✓ Saved'); }
  }

  // ========== TOAST ==========
  function showToast(msg) {
    clearTimeout(window.toastTimeout);
    var toast = document.querySelector('.zentool-toast:not(#zen-toast)');
    if (!toast) { toast = document.createElement('div'); toast.className = 'zentool-toast'; document.body.appendChild(toast); }
    toast.textContent = msg; toast.classList.add('visible');
    window.toastTimeout = setTimeout(function() { toast.classList.remove('visible'); }, 3000);
  }
  function downloadFile(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ========== CONTEXT MENU ==========
  function createContextMenu(x, y) {
    closeMenu();
    var menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 340) + 'px';
    var L = getCurrentLang() === 'el' ? { bold:'Έντονα',italic:'Πλάγια',underline:'Υπογράμμιση',strike:'Διαγραφή',h1:'Τίτλος 1',h2:'Τίτλος 2',quote:'Παράθεση',ulist:'Λίστα κουκκίδων',olist:'Αριθμημένη λίστα',undo:'Αναίρεση',redo:'Επαναφορά' } : { bold:'Bold',italic:'Italic',underline:'Underline',strike:'Strikethrough',h1:'Heading 1',h2:'Heading 2',quote:'Quote',ulist:'Bullet List',olist:'Numbered List',undo:'Undo',redo:'Redo' };
    var items = [{action:'bold',icon:'B',label:L.bold},{action:'italic',icon:'I',label:L.italic},{action:'underline',icon:'U',label:L.underline},{action:'strikeThrough',icon:'S',label:L.strike},{divider:true},{action:'h1',icon:'#',label:L.h1},{action:'h2',icon:'##',label:L.h2},{action:'quote',icon:'>',label:L.quote},{divider:true},{action:'insertUnorderedList',icon:'•',label:L.ulist},{action:'insertOrderedList',icon:'1.',label:L.olist},{divider:true},{action:'undo',icon:'↶',label:L.undo},{action:'redo',icon:'↷',label:L.redo}];
    items.forEach(function(item) {
      if (item.divider) { var d = document.createElement('div'); d.className = 'cm-divider'; menu.appendChild(d); }
      else { var el = document.createElement('div'); el.className = 'cm-item'; el.dataset.action = item.action; el.innerHTML = '<span class="cm-icon">' + item.icon + '</span> ' + item.label; menu.appendChild(el); }
    });
    menu.addEventListener('click', function(e) { var item = e.target.closest('.cm-item'); if (item) doFormat(item.dataset.action); });
    document.body.appendChild(menu);
  }
  function closeMenu() { var ex = document.querySelector('.context-menu'); if (ex) ex.remove(); }
  function doFormat(action) {
    switch(action) {
      case 'bold': document.execCommand('bold'); break;
      case 'italic': document.execCommand('italic'); break;
      case 'underline': document.execCommand('underline'); break;
      case 'strikeThrough': document.execCommand('strikeThrough'); break;
      case 'h1': document.execCommand('formatBlock', false, 'H1'); break;
      case 'h2': document.execCommand('formatBlock', false, 'H2'); break;
      case 'quote': document.execCommand('formatBlock', false, 'BLOCKQUOTE'); break;
      case 'insertUnorderedList': document.execCommand('insertUnorderedList'); break;
      case 'insertOrderedList': document.execCommand('insertOrderedList'); break;
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
    }
    richEditor.focus(); saveContent(false); updateStats();
  }
  richEditor.addEventListener('contextmenu', function(e) { if (e.altKey) { e.preventDefault(); createContextMenu(e.pageX, e.pageY); } });
  document.addEventListener('click', function(e) { if (!e.target.closest('.context-menu')) closeMenu(); });

  // ========== FR BAR ==========
  document.getElementById('btn-find-next').onclick = function() { if (matchRanges.length > 0) navigateToMatch(currentMatchIndex + 1); };
  document.getElementById('btn-find-prev').onclick = function() { if (matchRanges.length > 0) navigateToMatch(currentMatchIndex - 1); };
  document.getElementById('btn-close-fr').onclick = function() { hideFindReplace(); };
  findInput.addEventListener('keyup', function(e) { if (e.key === 'Enter') navigateToMatch(currentMatchIndex + 1); else findAndHighlight(); });

  // ========== INIT ==========
  var saved = localStorage.getItem(STORAGE_KEY);
  if (saved) richEditor.innerHTML = saved;
  else {
    var ph = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[getCurrentLang()] && window.OROS_TRANSLATIONS[getCurrentLang()].placeholder_rich) || 'Start writing here...';
    richEditor.setAttribute('data-placeholder', ph);
  }
  updateStats();
  initFocusMode();
  updateReadingProgress();
  updateSaveStatus();
  if (statsGoalEl && statsDefaultEl) {
    if (goalTarget) { statsDefaultEl.style.display = 'none'; statsGoalEl.style.display = ''; updateGoalProgress(); }
    else { statsDefaultEl.style.display = ''; statsGoalEl.style.display = 'none'; }
  }

})();