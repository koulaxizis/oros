// ============================================
// orOS Writer — Unified Rich Text Editor
// Focus Mode (spotlight) + Typewriter + Toast Fix
// Smart Lists, Import RTF/DOC, Stats, Find/Replace
// Drag&Drop, Quick Format Toolbar
// ============================================

(function() {
  'use strict';

  var STORAGE_KEY = 'oros_writer_content';
  var STORAGE_TYPEWRITER = 'oros_typewriter_mode';
  var STORAGE_HIDE_STATS = 'oros_hide_stats';
  var STORAGE_HIDE_QUICK_TBAR = 'oros_hide_quick_tbar';
  var STORAGE_FOCUS_MODE = 'oros_focus_mode';

  var editorContainer = document.getElementById('editor-container');
  var richEditor = document.getElementById('rich-editor');
  var richWrapper = document.getElementById('rich-wrapper');
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
  var quickFormatToolbar = document.getElementById('quick-format-toolbar');

  var typewriterEnabled = localStorage.getItem(STORAGE_TYPEWRITER) === 'true';
  var hideStats = localStorage.getItem(STORAGE_HIDE_STATS) === 'true';
  var hideQuickTbar = localStorage.getItem(STORAGE_HIDE_QUICK_TBAR) === 'true';
  var focusModeEnabled = localStorage.getItem(STORAGE_FOCUS_MODE) !== 'false';
  var currentMatchIndex = -1;
  var matchRanges = [];

  // ========== STATS ==========
  function updateStats() {
    var text = getTextContent();
    var chars = text.length;
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    var readMinutes = Math.max(1, Math.ceil(words / 200));
    wordCountEl.textContent = formatNumber(words);
    charCountEl.textContent = formatNumber(chars);
    readTimeEl.textContent = readMinutes + 'm';
  }
  function formatNumber(num) {
    return num >= 1000 ? (num / 1000).toFixed(1) + 'k' : num.toString();
  }
  function getTextContent() { return richEditor.innerText || ''; }
  function getHTMLContent() { return richEditor.innerHTML || ''; }

  // ========== TYPEWRITER ==========
  function enableTypewriter() {
    if (!typewriterEnabled) return;
    setTimeout(function() {
      try {
        var selection = window.getSelection();
        if (selection.rangeCount === 0) return;
        var range = selection.getRangeAt(0);
        var rects = range.getClientRects();
        if (!rects || rects.length === 0) return;
        var caretRect = rects[0];
        var editorRect = richEditor.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        var targetPosition = viewportHeight * 0.45;
        var relativeCursorPos = caretRect.top - editorRect.top + richEditor.scrollTop;
        var desiredScrollTop = relativeCursorPos - targetPosition;
        var maxScroll = richEditor.scrollHeight - editorRect.height;
        if (desiredScrollTop < 0) desiredScrollTop = 0;
        if (desiredScrollTop > maxScroll) desiredScrollTop = maxScroll;
        richEditor.scrollTo({ top: desiredScrollTop, behavior: 'smooth' });
      } catch(e) {}
    }, 50);
  }

  // ========== FOCUS MODE (SPOTLIGHT) ==========
  var focusDebounceTimer = null;

  function initFocusMode() {
    if (!richEditor || !richWrapper) return;

    document.addEventListener('selectionchange', handleSelectionChange);

    richEditor.addEventListener('scroll', function() {
      if (document.getElementById('focus-spotlight')) {
        clearFocusMode();
      }
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

  // ========== VISIBILITY INIT ==========
  if (hideStats && statsOverlay) statsOverlay.style.display = 'none';
  if (hideQuickTbar && quickFormatToolbar) quickFormatToolbar.style.display = 'none';

  // ========== DRAG & DROP ==========
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) {
    editorContainer.addEventListener(eventName, preventDefaults, false);
  });
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  editorContainer.addEventListener('dragover', function() {
    editorContainer.style.boxShadow = 'inset 0 0 0 2px var(--accent)';
  });
  editorContainer.addEventListener('dragleave', function() {
    editorContainer.style.boxShadow = '';
  });
  editorContainer.addEventListener('drop', function(e) {
    var file = e.dataTransfer.files[0];
    if (!file) return;
    importFile(file);
  });

  function importFile(file) {
    var ext = '.' + file.name.split('.').pop().toLowerCase();
    var reader = new FileReader();
    reader.onload = function(ev) {
      var content = ev.target.result;
      if (ext === '.txt' || ext === '.md') {
        richEditor.innerHTML = markdownToHtml(content);
      } else if (ext === '.rtf') {
        richEditor.innerHTML = parseRtf(content);
      } else if (ext === '.doc') {
        richEditor.innerHTML = stripDocTags(content);
      } else {
        richEditor.innerText = content;
      }
      saveContent(false);
      updateStats();
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
    if (bulletMatch) {
      e.preventDefault();
      insertBlock((bulletMatch[1] || '') + '- ');
      autoBreakEmptyBullet(line);
    } else if (numberMatch) {
      e.preventDefault();
      insertBlock((numberMatch[1] || '') + (parseInt(numberMatch[2]) + 1) + '. ');
      autoBreakEmptyNumber(line);
    }
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
  function insertBlock(prefix) {
    document.execCommand('insertHTML', false, '<div><br/></div>');
    moveCursorToFront(prefix.length);
  }
  function autoBreakEmptyBullet(originalLine) {
    if (originalLine.trim() === '-' || originalLine.trim() === '*') {
      setTimeout(function() {
        if (getLineBeforeCursor().trim() === '-') deleteCurrentBlock();
      }, 30);
    }
  }
  function autoBreakEmptyNumber(originalLine) {
    if (/^\s*\d+\.$/.test(originalLine.trim())) {
      setTimeout(function() {
        if (/^\d+\.$/.test(getLineBeforeCursor().trim())) deleteCurrentBlock();
      }, 30);
    }
  }
  function deleteCurrentBlock() {
    var range = document.createRange();
    var sel = window.getSelection();
    range.selectNodeContents(richEditor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete');
  }
  function moveCursorToFront(pos) {
    var range = document.createRange();
    var sel = window.getSelection();
    var node = richEditor.firstChild;
    while (node && pos > getNodeLength(node)) {
      pos -= getNodeLength(node);
      node = node.nextSibling;
    }
    if (node) range.setStart(node, Math.min(pos, getNodeLength(node)));
    else range.setStart(richEditor, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
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

  // ========== OPEN FILE ==========
  btnOpen.onclick = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.markdown,.text,.rtf,.doc,.docx';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (file) importFile(file);
    };
    input.click();
  };

  // ========== CLEAR ==========
  btnClear.onclick = function() {
    if (!richEditor.innerText.trim()) return;
    var lang = getCurrentLang();
    var confirmText = lang === 'el' ? 'Εκκαθάριση περιεχομένου;' : 'Clear content? Cannot undo.';
    if (!confirm(confirmText)) return;
    richEditor.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
    saveContent(false);
    updateStats();
    showToast(lang === 'el' ? '✓ Καθαρίστηκε' : '✓ Cleared');
  };

  // ========== EXPORT ==========
  btnExport.onclick = function(e) { e.stopPropagation(); exportDropdown.classList.toggle('visible'); };
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.export-wrap')) exportDropdown.classList.remove('visible');
  });
  var dropdownButtons = exportDropdown.querySelectorAll('button');
  for (var i = 0; i < dropdownButtons.length; i++) {
    dropdownButtons[i].onclick = function() {
      exportContent(this.dataset.format);
      exportDropdown.classList.remove('visible');
    };
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

  // ========== HTML ↔ MARKDOWN ==========
  function htmlToMarkdown(html) {
    return html
      .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i>(.*?)<\/i>/gi, '*$1*')
      .replace(/<u>(.*?)<\/u>/gi, '$1')
      .replace(/<s>(.*?)<\/s>/gi, '~~$1~~')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`')
      .replace(/<blockquote>(.*?)<\/blockquote>/gi, '> $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<div>(.*?)<\/div>/gi, '$1\n')
      .replace(/<[^>]+>/g, '');
  }
  function markdownToHtml(md) {
    return md
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/gim, '<em>$1</em>')
      .replace(/`(.+?)`/gim, '<code>$1</code>')
      .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
      .replace(/\n/gim, '<br/>');
  }

  // ========== RTF / DOC IMPORT ==========
  function parseRtf(rtf) {
    rtf = rtf.replace(/\\\r?\n/g, '').replace(/{/g, '\\{').replace(/}/g, '\\}');
    var text = rtf.replace(/\\[^\s]* /g, '').replace(/\\par/g, '</p><p>')
      .replace(/\\b/i, '<b>').replace(/\\i/i, '<i>')
      .replace(/\\u\d+\?/g, '?').replace(/\\/g, '').replace(/{|}/g, '');
    return '<div>' + text + '</div>';
  }
  function stripDocTags(content) {
    return content.replace(/<html[^>]*>|<\/html>|<head[^>]*>|<\/head>|<w:[^>]+>|<\/w:[^>]+>|<o:[^>]+>|<\/o:[^>]+>/gi, '');
  }
  
    // ========== RTF EXPORT ==========
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
    var result = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], code = text.charCodeAt(i);
      if (ch === '\\' || ch === '{' || ch === '}') result += '\\' + ch;
      else if (code > 127) result += '\\u' + code + '?';
      else result += ch;
    }
    return result;
  }
  function applyInlineRtf(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '{\\b $1\\b0}').replace(/\*(.+?)\*/g, '{\\i $1\\i0}').replace(/`(.+?)`/g, '{\\f1 $1\\f0}');
  }

  // ========== PDF EXPORT ==========
  function exportPdf(content) {
    var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>orOS Export</title>\n<style>\nbody {\n  font-family: Calibri, Arial, sans-serif;\n  font-size: 12pt;\n  line-height: 1.7;\n  max-width: 700px;\n  margin: 2rem auto;\n  padding: 1cm;\n  color: #2b2723;\n}\nh1 { font-size: 1.8rem; }\nh2 { font-size: 1.4rem; }\nh3 { font-size: 1.15rem; }\nblockquote {\n  border-left: 3px solid #c8a96e;\n  padding-left: 1rem;\n  font-style: italic;\n  color: #756f68;\n}\ncode {\n  font-family: monospace;\n  background: #f6f5f1;\n  padding: 2px 5px;\n  border-radius: 3px;\n}\n@media print {\n  body { margin: 0; padding: 1cm; }\n}\n</style>\n</head>\n<body>\n<div class="content">' + content + '</div>\n<script>\nwindow.addEventListener("load", function() {\n  window.print();\n  setTimeout(function() { window.close(); }, 250);\n});\n<\/script>\n</body>\n</html>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    if (!window.open(url, '_blank')) {
      showToast(getCurrentLang() === 'el' ? '⚠ Επιτρέψτε τα pop-ups' : '⚠ Allow pop-ups');
      URL.revokeObjectURL(url);
    }
  }

  // ========== DOC EXPORT ==========
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
    clearHighlights(); matchRanges = []; currentMatchIndex = -1;
    if (!query) { frResults.textContent = '0 matches'; return; }
    var content = getTextContent();
    var regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var match;
    while ((match = regex.exec(content)) !== null) matchRanges.push([match.index, match.index + match[0].length]);
    frResults.textContent = matchRanges.length + ' matches';
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

  // ========== REPLACE BUTTONS ==========
  document.getElementById('btn-replace').onclick = function() {
    if (matchRanges.length === 0) return;
    var range = matchRanges[currentMatchIndex];
    var replaceText = replaceInput.value;
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
        document.execCommand('insertText', false, replaceText);
        break;
      }
      pos += nodeLen;
    }
    saveContent(false); updateStats(); setTimeout(findAndHighlight, 50);
  };
  document.getElementById('btn-replace-all').onclick = function() {
    if (matchRanges.length === 0) return;
    var content = getTextContent();
    var regex = new RegExp(findInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    richEditor.innerText = content.replace(regex, replaceInput.value);
    saveContent(false); updateStats(); setTimeout(findAndHighlight, 50);
    showToast(getCurrentLang() === 'el' ? '✓ Αντικαταστάθηκαν όλες' : '✓ All replaced');
  };

  // ========== QUICK FORMAT TOOLBAR ==========
  if (quickFormatToolbar) {
    var fmtButtons = quickFormatToolbar.querySelectorAll('.fmt-btn');
    for (var i = 0; i < fmtButtons.length; i++) {
      fmtButtons[i].addEventListener('mousedown', function(e) { e.preventDefault(); });
      fmtButtons[i].addEventListener('click', function() {
        document.execCommand(this.dataset.cmd, false, null);
        richEditor.focus(); saveContent(false); updateStats();
      });
    }
  }

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', function(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); showFindReplace(); return; }
    if (ctrl && e.key.toLowerCase() === 'h') { e.preventDefault(); findInput.focus(); return; }
    if (e.key === 'Escape' && findBar.style.display === 'flex') { hideFindReplace(); return; }
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      typewriterEnabled = !typewriterEnabled;
      localStorage.setItem(STORAGE_TYPEWRITER, typewriterEnabled ? 'true' : 'false');
      showToast(typewriterEnabled ? (getCurrentLang() === 'el' ? '🔡 Typewriter ΕΝΕΡΓΟ' : '🔡 Typewriter ON') : (getCurrentLang() === 'el' ? '⚫ Typewriter ΑΠΕΝΕΡΓΟ' : '⚫ Typewriter OFF'));
      if (typewriterEnabled) enableTypewriter();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'u') {
      if (document.activeElement === richEditor) { e.preventDefault(); document.execCommand('underline'); saveContent(false); updateStats(); }
      return;
    }
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

  // ========== AUTO-SAVE ==========
  var debounceTimer;
  richEditor.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { saveContent(false); }, 2000);
    updateStats(); enableTypewriter();
  });
  richEditor.addEventListener('paste', function() { setTimeout(updateStats, 0); });
  richEditor.addEventListener('keydown', checkSmartList);
  richEditor.addEventListener('keyup', function() { enableTypewriter(); });
  richEditor.addEventListener('mouseup', function() { enableTypewriter(); });
  setInterval(function() { saveContent(false); }, 30000);

  function saveContent(showMsg) {
    localStorage.setItem(STORAGE_KEY, getHTMLContent());
    if (showMsg) { saveStatus.textContent = '✓ Saved'; setTimeout(function() { saveStatus.textContent = ''; }, 3000); }
  }

  // ========== HELPERS ==========
  function getCurrentLang() { return localStorage.getItem('oros-language') || 'en'; }
  function showToast(msg) {
    clearTimeout(window.toastTimeout);
    var toast = document.querySelector('.zentool-toast:not(#zen-toast)');
    if (!toast) { toast = document.createElement('div'); toast.className = 'zentool-toast'; document.body.appendChild(toast); }
    toast.textContent = msg;
    toast.classList.add('visible');
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
    var L = getCurrentLang() === 'el' ? {
      bold:'Έντονα',italic:'Πλάγια',underline:'Υπογράμμιση',strike:'Διαγραφή',h1:'Τίτλος 1',h2:'Τίτλος 2',quote:'Παράθεση',ulist:'Λίστα κουκκίδων',olist:'Αριθμημένη λίστα',undo:'Αναίρεση',redo:'Επαναφορά'
    } : {
      bold:'Bold',italic:'Italic',underline:'Underline',strike:'Strikethrough',h1:'Heading 1',h2:'Heading 2',quote:'Quote',ulist:'Bullet List',olist:'Numbered List',undo:'Undo',redo:'Redo'
    };
    var items = [
      {action:'bold',icon:'B',label:L.bold},{action:'italic',icon:'I',label:L.italic},
      {action:'underline',icon:'U',label:L.underline},{action:'strikeThrough',icon:'S',label:L.strike},
      {divider:true},{action:'h1',icon:'#',label:L.h1},{action:'h2',icon:'##',label:L.h2},{action:'quote',icon:'>',label:L.quote},
      {divider:true},{action:'insertUnorderedList',icon:'•',label:L.ulist},{action:'insertOrderedList',icon:'1.',label:L.olist},
      {divider:true},{action:'undo',icon:'↶',label:L.undo},{action:'redo',icon:'↷',label:L.redo}
    ];
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
  richEditor.addEventListener('contextmenu', function(e) {
    if (e.altKey) { e.preventDefault(); createContextMenu(e.pageX, e.pageY); }
  });
  document.addEventListener('click', function(e) { if (!e.target.closest('.context-menu')) closeMenu(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeMenu(); });

  // ========== FR BAR ==========
  document.getElementById('btn-find-next').onclick = function() { if (matchRanges.length > 0) navigateToMatch(currentMatchIndex + 1); };
  document.getElementById('btn-find-prev').onclick = function() { if (matchRanges.length > 0) navigateToMatch(currentMatchIndex - 1); };
  document.getElementById('btn-close-fr').onclick = function() { hideFindReplace(); };
  findInput.addEventListener('keyup', function(e) {
    if (e.key === 'Enter') navigateToMatch(currentMatchIndex + 1);
    else findAndHighlight();
  });

  // ========== INIT ==========
  var saved = localStorage.getItem(STORAGE_KEY);
  if (saved) richEditor.innerHTML = saved;
  else {
    var ph = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[getCurrentLang()] && window.OROS_TRANSLATIONS[getCurrentLang()].placeholder_rich) || 'Start writing here...';
    richEditor.setAttribute('data-placeholder', ph);
  }
  updateStats();
  if (typewriterEnabled) enableTypewriter();
  initFocusMode();

})();