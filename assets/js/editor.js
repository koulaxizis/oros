// ============================================
// orOS Writer — Editor Logic (Enhanced)
// Dual-mode, Autosave, Statistics, Find/Replace
// Drag&Drop, Typewriter Mode, Smart Lists
// ============================================

(function() {
  'use strict';

  var STORAGE_KEY = 'oros_writer_content';
  var STORAGE_MODE = 'oros_writer_mode';
  var STORAGE_TYPEWRITER = 'oros_typewriter_mode';

  // Elements
  var editor = document.getElementById('editor');
  var richEditor = document.getElementById('rich-editor');
  var mdWrapper = document.getElementById('md-wrapper');
  var richWrapper = document.getElementById('rich-wrapper');
  var wordCountEl = document.getElementById('word_count');
  var charCountEl = document.getElementById('char_count');
  var readTimeEl = document.getElementById('read_time');
  var saveStatus = document.getElementById('save_status');
  var findBar = document.getElementById('find-replace-bar');
  var findInput = document.getElementById('find-find');
  var replaceInput = document.getElementById('find-replace');
  var frResults = document.getElementById('fr_results');
  var editorContainer = document.getElementById('editor-container');

  var currentMode = localStorage.getItem(STORAGE_MODE) || 'md';
  var typewriterEnabled = localStorage.getItem(STORAGE_TYPEWRITER) === 'true';
  var currentMatchIndex = -1;
  var matchRanges = [];

  // ========== STATS CALCULATION ==========
  function updateStats() {
    var text = getTextContent();
    var chars = text.length;
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    var readMinutes = Math.ceil(words / 200);

    wordCountEl.textContent = formatNumber(words);
    charCountEl.textContent = formatNumber(chars);
    readTimeEl.textContent = readMinutes + (readMinutes === 1 ? 'm' : 'm');
  }

  function formatNumber(num) {
    return num >= 1000 ? (num / 1000).toFixed(1) + 'k' : num.toString();
  }

  function getTextContent() {
    return currentMode === 'md' ? editor.value : richEditor.innerText;
  }

  // ========== TYPWRITER MODE ==========
  function enableTypewriter(scrollToTop) {
    if (!typewriterEnabled) return;
    
    setTimeout(function() {
      var lineHeight = parseInt(getComputedStyle(editor).lineHeight) || 30;
      var visibleLines = Math.floor((window.innerHeight - 200) / lineHeight);
      var targetScroll = scrollToTop ? 0 : editor.scrollTop;
      
      var caretPosition = getCaretLineNumber();
      var offsetFromTop = caretPosition * lineHeight;
      var centerOffset = (window.innerHeight - 200) / 2 - (lineHeight / 2);
      
      var newScroll = caretPosition * lineHeight - centerOffset;
      if (newScroll < 0) newScroll = 0;
      
      if (currentMode === 'md') {
        editor.scrollTo({ top: newScroll, behavior: 'smooth' });
      } else {
        richEditor.scrollTo({ top: newScroll, behavior: 'smooth' });
      }
    }, 0);
  }

  function getCaretLineNumber() {
    if (currentMode === 'md') {
      var text = editor.value.substring(0, editor.selectionStart);
      return text.split('\n').length - 1;
    } else {
      var range = window.getSelection().getRangeAt(0);
      var preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(richEditor);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      var text = preCaretRange.toString();
      return text.split('\n').length - 1;
    }
  }

  // ========== DRAG & DROP ==========
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) {
    editorContainer.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  editorContainer.addEventListener('dragover', function() {
    editorContainer.style.borderColor = 'var(--accent)';
  });

  editorContainer.addEventListener('dragleave', function() {
    editorContainer.style.borderColor = '';
  });

  editorContainer.addEventListener('drop', function(e) {
    var file = e.dataTransfer.files[0];
    if (!file) return;
    
    var validTypes = ['.txt', '.md', '.markdown', '.text'];
    var ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validTypes.includes(ext)) {
      showToast('Unsupported file type');
      return;
    }
    
    var reader = new FileReader();
    reader.onload = function(ev) {
      var content = ev.target.result;
      if (currentMode === 'md') {
        editor.value = content;
      } else {
        richEditor.innerHTML = markdownToHtml(content);
      }
      saveContent(false);
      updateStats();
      showToast('\u2713 \u0395\u03af\u03ba\u03b1\u03c4\u03b5' + (getCurrentLang() === 'en' ? ' Opened' : ''));
    };
    reader.readAsText(file);
  });

  // ========== FIND & REPLACE ==========
  function showFindReplace(findFirstOnly) {
    findBar.style.display = 'flex';
    findInput.focus();
    if (!findFirstOnly && getCurrentLang() !== 'en') {
      // Show dialog for replace mode could be added
    }
    findAndHighlight();
  }

  function hideFindReplace() {
    findBar.style.display = 'none';
    clearHighlights();
    currentMatchIndex = -1;
    matchRanges = [];
  }

  function findAndHighlight() {
    var query = findInput.value;
    clearHighlights();
    matchRanges = [];
    currentMatchIndex = -1;
    
    if (!query) {
      frResults.textContent = '0 ' + (translations[getCurrentLang()] || {}).fr_matches || 'matches';
      return;
    }
    
    var content = getTextContent();
    var regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    var match;
    
    while ((match = regex.exec(content)) !== null) {
      matchRanges.push([match.index, match.index + match[0].length]);
    }
    
    frResults.textContent = matchRanges.length + ' ' + (translations[getCurrentLang()] || {}).fr_matches || 'matches';
    
    if (matchRanges.length > 0) {
      navigateToMatch(0);
    }
  }

  function navigateToMatch(index) {
    if (matchRanges.length === 0) return;
    currentMatchIndex = index % matchRanges.length;
    if (currentMatchIndex < 0) currentMatchIndex += matchRanges.length;
    
    var range = matchRanges[currentMatchIndex];
    var start = range[0];
    var end = range[1];
    
    if (currentMode === 'md') {
      editor.setSelectionRange(start, end);
      editor.focus();
      editor.scrollTop = editor.scrollHeight * (start / editor.value.length) - 50;
    } else {
      // For contentEditable, simplified positioning
      richEditor.focus();
      var textNodes = getTextNodes(richEditor);
      var pos = 0;
      for (var i = 0; i < textNodes.length; i++) {
        var nodeLen = textNodes[i].nodeValue.length;
        if (pos <= start && pos + nodeLen >= start) {
          var range = document.createRange();
          range.setStart(textNodes[i], start - pos);
          range.setEnd(textNodes[i], Math.min(end - pos, nodeLen));
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          break;
        }
        pos += nodeLen;
      }
    }
  }

  function getTextNodes(node) {
    var nodes = [];
    if (node.nodeType === 3) {
      nodes.push(node);
    } else {
      for (var i = 0; i < node.childNodes.length; i++) {
        nodes = nodes.concat(getTextNodes(node.childNodes[i]));
      }
    }
    return nodes;
  }

  function clearHighlights() {
    // Simplified clearing - would need proper highlighting implementation
  }

  function replaceOne() {
    if (matchRanges.length === 0 || currentMatchIndex === -1) return;
    
    var replacement = replaceInput.value;
    var range = matchRanges[currentMatchIndex];
    var start = range[0];
    var end = range[1];
    
    if (currentMode === 'md') {
      var before = editor.value.substring(0, start);
      var after = editor.value.substring(end);
      editor.value = before + replacement + after;
    } else {
      // Complex for rich text, simplified here
      showToast('\u0391\u03bd\u03c4\u03b9\u03ba\u03ac\u03c4\u03b1\u03c3\u03c4\u03b1\u03c3\u03b7 (\u03b1\u03bd\u03b1\u03b3\u03ba\u03b1\u03af\u03bf\u03bd MD mode)');
      return;
    }
    
    saveContent(false);
    updateStats();
    findAndHighlight();
  }

  function.replaceAll() {
    if (matchRanges.length === 0) return;
    
    var replacement = replaceInput.value;
    var query = findInput.value;
    var regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    
    if (currentMode === 'md') {
      editor.value = editor.value.replace(regex, replacement);
    }
    
    saveContent(false);
    updateStats();
    showToast(matchRanges.length + '\u00a0replacements done');
  }

  // ========== SMART LISTS (AUTO CONTINUE) ==========
  function checkSmartList(e) {
    if (e.key !== 'Enter') return;
    
    var prefix = '';
    var currentLine = '';
    
    if (currentMode === 'md') {
      var text = editor.value;
      var caretPos = editor.selectionStart;
      var lines = text.substring(0, caretPos).split('\n');
      currentLine = lines[lines.length - 1];
      
      if (currentLine.match(/^[-*]\s/)) {
        prefix = '- ';
      } else if (currentLine.match(/^\d+\.\s/)) {
        var numMatch = currentLine.match(/^(\d+)\.\s/);
        if (numMatch) {
          prefix = (parseInt(numMatch[1]) + 1) + '. ';
        }
      }
    }
    
    if (prefix && !currentLine.endsWith(prefix)) {
      e.preventDefault();
      
      if (currentMode === 'md') {
        var startPos = editor.selectionStart;
        var before = editor.value.substring(0, startPos);
        var after = editor.value.substring(editor.selectionEnd);
        
        var newPrefix = before.substring(before.lastIndexOf('\n') + 1);
        var trimmedNewPrefix = newPrefix.trim();
        
        editor.value = before.replace(/[\r\n]+$/, '') + '\n' + prefix + after;
        editor.selectionStart = editor.selectionEnd = before.lastIndexOf('\n') + prefix.length + 1;
      }
      
      saveContent(false);
    }
  }

  // ========== MODE TOGGLE ==========
  function setMode(mode) {
    currentMode = mode;
    localStorage.setItem(STORAGE_MODE, mode);

    if (mode === 'md') {
      mdWrapper.style.display = '';
      richWrapper.style.display = 'none';
      modeMd.classList.add('active');
      modeRich.classList.remove('active');
      if (richEditor.innerText.trim()) {
        editor.value = htmlToMarkdown(richEditor.innerHTML);
      }
    } else {
      mdWrapper.style.display = 'none';
      richWrapper.style.display = '';
      modeMd.classList.remove('active');
      modeRich.classList.add('active');
      if (editor.value.trim()) {
        richEditor.innerHTML = markdownToHtml(editor.value);
      }
    }
    saveContent(false);
    updateStats();
  }

  modeMd.onclick = function() { setMode('md'); };
  modeRich.onclick = function() { setMode('rich'); };

  // ========== MARKDOWN FUNCTIONS ==========
  function markdownToHtml(md) {
    return md
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/gim, '<em>$1</em>')
      .replace(/`(.+?)`/gim, '<code>$1</code>')
      .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
      .replace(/\n/gim, '<br>');
  }

  function htmlToMarkdown(html) {
    var md = html
      .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i>(.*?)<\/i>/gi, '*$1*')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`')
      .replace(/<blockquote>(.*?)<\/blockquote>/gi, '> $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    return md;
  }

  // ========== OPEN FILE ==========
  btnOpen.onclick = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.markdown,.text';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var content = ev.target.result;
        if (currentMode === 'md') {
          editor.value = content;
        } else {
          richEditor.innerHTML = markdownToHtml(content);
        }
        saveContent(false);
        updateStats();
        showToast('\u2713 Opened');
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // ========== CLEAR ==========
  btnClear.onclick = function() {
    var hasContent = currentMode === 'md'
      ? editor.value.trim()
      : richEditor.innerText.trim();
    if (!hasContent) return;
    var confirmText = getCurrentLang() === 'el'
      ? '\u0395\u03ba\u03ba\u03b1\u03b8\u03ac\u03c1\u03b9\u03c3\u03b7 \u03c0\u03b5\u03c1\u03b9\u03b5\u03c7\u03bf\u03bc\u03ad\u03bd\u03bf\u03c5;'
      : 'Clear content? Cannot undo.';
    if (!confirm(confirmText)) return;
    editor.value = '';
    richEditor.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
    saveContent(false);
    updateStats();
    showToast('\u039a\u03b1\u03b8\u03b1\u03c1\u03af\u03c3\u03c4\u03b7\u03ba\u03b5');
  };

  // ========== EXPORT ==========
  btnExport.onclick = function(e) {
    e.stopPropagation();
    exportDropdown.classList.toggle('visible');
  };

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.export-wrap')) {
      exportDropdown.classList.remove('visible');
    }
  });

  var dropdownButtons = exportDropdown.querySelectorAll('button');
  for (var i = 0; i < dropdownButtons.length; i++) {
    dropdownButtons[i].onclick = function() {
      var format = this.dataset.format;
      exportContent(format);
      exportDropdown.classList.remove('visible');
    };
  }

  function getContent() {
    return currentMode === 'md' ? editor.value : htmlToMarkdown(richEditor.innerHTML);
  }

  function exportContent(format) {
    var content = getContent();
    var ts = new Date().toISOString().slice(0, 10);

    switch(format) {
      case 'md': downloadFile(content, 'oros-' + ts + '.md', 'text/markdown;charset=utf-8'); break;
      case 'txt': downloadFile(content.replace(/[#*>`]/g, ''), 'oros-' + ts + '.txt', 'text/plain;charset=utf-8'); break;
      case 'rtf': exportRtf(content, 'oros-' + ts + '.rtf'); break;
      case 'pdf': exportPdf(content); break;
      case 'doc': exportDoc(content, 'oros-' + ts + '.doc'); break;
    }
    showToast('\u2193 Downloaded');
  }

  function exportRtf(mdContent, filename) {
    var rtf = '{\\rtf1\\ansi\\deff0\n';
    rtf += '{\\fonttbl{\\f0 Nunito;}{\\f1 Courier New;}}\n';
    rtf += '{\\colortbl;\\red117\\green111\\blue104;}\n';
    rtf += '\\f0\\fs24\n';
    var lines = mdContent.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = escapeRtf(lines[i]);
      if (line.startsWith('### ')) {
        rtf += '{\\pard\\fs32\\b ' + applyInlineRtf(line.slice(4)) + '\\par}\n';
      } else if (line.startsWith('## ')) {
        rtf += '{\\pard\\fs28\\b ' + applyInlineRtf(line.slice(3)) + '\\par}\n';
      } else if (line.startsWith('# ')) {
        rtf += '{\\pard\\fs40\\b ' + applyInlineRtf(line.slice(2)) + '\\par}\n';
      } else if (line.startsWith('> ')) {
        rtf += '{\\pard\\li720\\ri720\\i\\cf1 ' + applyInlineRtf(line.slice(2)) + '\\par}\n';
      } else if (line.trim() === '') {
        rtf += '{\\par}\n';
      } else {
        rtf += applyInlineRtf(line) + '\\line\n';
      }
    }
    rtf += '}';
    downloadFile(rtf, filename, 'application/rtf;charset=utf-8');
  }

  function escapeRtf(text) {
    var result = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var code = text.charCodeAt(i);
      if (ch === '\\' || ch === '{' || ch === '}') {
        result += '\\' + ch;
      } else if (code > 127) {
        result += '\\u' + code + '?';
      } else {
        result += ch;
      }
    }
    return result;
  }

  function applyInlineRtf(text) {
    var c = text;
    c = c.replace(/\*\*(.+?)\*\*/g, '{\\b $1\\b0}');
    c = c.replace(/\*(.+?)\*/g, '{\\i $1\\i0}');
    c = c.replace(/`(.+?)`/g, '{\\f1 $1\\f0}');
    return c;
  }

  function exportDoc(mdContent, filename) {
    var html = markdownToHtml(mdContent);
    var fullHtml = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Export</title></head><body style="font-family: Calibri, sans-serif; font-size: 12pt;">' + html + '</body></html>';
    var blob = new Blob(['\ufeff' + fullHtml], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf(mdContent) {
    var html = markdownToHtml(mdContent);
    var win = window.open('', '_blank');
    if (!win) {
      showToast('\u26a0 Allow pop-ups');
      return;
    }
    win.document.write('<html><head><title>orOS Export</title>' +
      '<style>body { font-family: Calibri, sans-serif; font-size: 12pt; line-height: 1.7; max-width: 700px; margin: 2rem auto; padding: 0 1rem; color: #2b2723; }</style>' +
      '</head><body>' + html + '</body></html>');
    win.document.close();
    setTimeout(function() { win.print(); }, 500);
  }

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', function(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    
    // Find & Replace shortcuts
    if (ctrl && e.key === 'f') {
      e.preventDefault();
      showFindReplace(true);
      return;
    }
    if (ctrl && e.key === 'h') {
      e.preventDefault();
      findInput.focus();
      return;
    }
    if (e.key === 'Escape' && findBar.style.display === 'flex') {
      hideFindReplace();
      return;
    }
    
    // Typewriter toggle
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      typewriterEnabled = !typewriterEnabled;
      localStorage.setItem(STORAGE_TYPEWRITER, typewriterEnabled ? 'true' : 'false');
      showToast(typewriterEnabled ? '\ud83d\udd22 Typewriter ON' : '\u26ab Typewriter OFF');
      return;
    }
    
    // Standard editor shortcuts
    if (!ctrl) return;
    var activeInEditor = document.activeElement === editor || document.activeElement === richEditor;
    
    switch(e.key.toLowerCase()) {
      case 's':
        e.preventDefault();
        saveContent(true);
        break;
      case 'b':
        if (activeInEditor) {
          e.preventDefault();
          doFormat('bold');
        }
        break;
      case 'i':
        if (activeInEditor) {
          e.preventDefault();
          doFormat('italic');
        }
        break;
      case 'z':
        if (activeInEditor) {
          e.preventDefault();
          doFormat('undo');
        }
        break;
      case 'y':
        if (activeInEditor) {
          e.preventDefault();
          doFormat('redo');
        }
        break;
    }
  });

  // ========== AUTO-SAVE & INPUT EVENTS ==========
  var debounceTimer;
  var inputHandler = function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { saveContent(false); }, 2000);
    updateStats();
    enableTypewriter(false);
  };
  
  editor.addEventListener('input', inputHandler);
  editor.addEventListener('keydown', checkSmartList);
  editor.addEventListener('keyup', function() {
    enableTypewriter(false);
  });
  richEditor.addEventListener('input', inputHandler);
  richEditor.addEventListener('paste', function() { setTimeout(updateStats, 0); });

  setInterval(function() { saveContent(false); }, 30000);

  // ========== SAVE FUNCTION ==========
  function saveContent(showMsg) {
    var content = getContent();
    localStorage.setItem(STORAGE_KEY, content);
    if (showMsg) {
      saveStatus.textContent = '\u2713 Saved';
      setTimeout(function() { saveStatus.textContent = ''; }, 3000);
    }
  }

  // ========== HELPERS ==========
  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }

  function showToast(msg) {
    clearTimeout(window.toastTimeout);
    var toast = document.querySelector('.zentool-toast:not(#zen-toast)');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'zentool-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    window.toastTimeout = setTimeout(function() {
      toast.classList.remove('visible');
    }, 3000);
  }

  function downloadFile(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ========== CONTEXT MENU ==========
  function createContextMenu(x, y) {
    closeMenu();
    var menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';

    var labels = getCurrentLang() === 'el' ? {
      bold: '\u0388\u03bd\u03c4\u03bf\u03bd\u03b1', italic: '\u03a0\u03bb\u03ac\u03b3\u03b9\u03b1',
      h1: '\u03a4\u03af\u03c4\u03bb\u03bf\u03c2 1', h2: '\u03a4\u03af\u03c4\u03bb\u03bf\u03c2 2', quote: '\u03a0\u03b1\u03c1\u03ac\u03b8\u03b5\u03c3\u03b7',
      undo: '\u0391\u03bd\u03b1\u03af\u03c1\u03b5\u03c3\u03b7', redo: '\u0395\u03c0\u03b1\u03bd\u03b1\u03c6\u03bf\u03c1\u03ac'
    } : {
      bold: 'Bold', italic: 'Italic',
      h1: 'Heading 1', h2: 'Heading 2', quote: 'Quote',
      undo: 'Undo', redo: 'Redo'
    };

    var items = [
      { action: 'bold', icon: 'B', label: labels.bold },
      { action: 'italic', icon: 'I', label: labels.italic },
      { divider: true },
      { action: 'h1', icon: '#', label: labels.h1 },
      { action: 'h2', icon: '##', label: labels.h2 },
      { action: 'quote', icon: '>', label: labels.quote },
      { divider: true },
      { action: 'undo', icon: '\u21b6', label: labels.undo },
      { action: 'redo', icon: '\u21b7', label: labels.redo }
    ];

    items.forEach(function(item) {
      if (item.divider) {
        var div = document.createElement('div');
        div.className = 'cm-divider';
        menu.appendChild(div);
      } else {
        var el = document.createElement('div');
        el.className = 'cm-item';
        el.dataset.action = item.action;
        el.innerHTML = '<span class="cm-icon">' + item.icon + '</span> ' + item.label;
        menu.appendChild(el);
      }
    });

    menu.addEventListener('click', function(e) {
      var item = e.target.closest('.cm-item');
      if (!item) return;
      doFormat(item.dataset.action);
    });

    document.body.appendChild(menu);
  }

  function closeMenu() {
    var existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
  }

  function doFormat(action) {
    if (currentMode === 'rich') {
      switch(action) {
        case 'bold': document.execCommand('bold'); break;
        case 'italic': document.execCommand('italic'); break;
        case 'h1': document.execCommand('formatBlock', false, 'H1'); break;
        case 'h2': document.execCommand('formatBlock', false, 'H2'); break;
        case 'quote': document.execCommand('formatBlock', false, 'BLOCKQUOTE'); break;
        case 'undo': document.execCommand('undo'); break;
        case 'redo': document.execCommand('redo'); break;
      }
      richEditor.focus();
    } else {
      var start = editor.selectionStart;
      var end = editor.selectionEnd;
      var text = editor.value;
      var selected = text.substring(start, end);
      var formatted = '';

      switch(action) {
        case 'bold': formatted = '**' + (selected || 'bold') + '**'; break;
        case 'italic': formatted = '*' + (selected || 'italic') + '*'; break;
        case 'h1': formatted = '# ' + (selected || 'Heading'); break;
        case 'h2': formatted = '## ' + (selected || 'Subheading'); break;
        case 'quote': formatted = '> ' + (selected || 'Quote'); break;
        case 'undo': document.execCommand('undo'); return;
        case 'redo': document.execCommand('redo'); return;
      }

      if (formatted) {
        editor.setRangeText(formatted, start, end, 'end');
        editor.focus();
      }
    }
    saveContent(false);
    updateStats();
  }

  editor.addEventListener('contextmenu', function(e) {
    if (e.altKey) {
      e.preventDefault();
      createContextMenu(e.pageX, e.pageY);
    }
  });

  richEditor.addEventListener('contextmenu', function(e) {
    if (e.altKey) {
      e.preventDefault();
      createContextMenu(e.pageX, e.pageY);
    }
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.context-menu')) closeMenu();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeMenu();
  });

  // ========== FR BAR BUTTONS ==========
  document.getElementById('btn-find-next').onclick = function() {
    if (matchRanges.length > 0) {
      navigateToMatch(currentMatchIndex + 1);
    }
  };

  document.getElementById('btn-find-prev').onclick = function() {
    if (matchRanges.length > 0) {
      navigateToMatch(currentMatchIndex - 1);
    }
  };

  document.getElementById('btn-replace').onclick = function() {
    replaceOne();
  };

  document.getElementById('btn-replace-all').onclick = function() {
    if (confirm('Replace all occurrences?')) {
      .replaceAll();
    }
  };

  document.getElementById('btn-close-fr').onclick = function() {
    hideFindReplace();
  };

  findInput.addEventListener('keyup', function(e) {
    if (e.key === 'Enter') {
      navigateToMatch(currentMatchIndex + 1);
    } else {
      findAndHighlight();
    }
  });

  // ========== INIT ==========
  var saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    editor.value = saved;
    richEditor.innerHTML = markdownToHtml(saved);
  }

  setMode(currentMode);
  updateStats();
  
  if (typewriterEnabled) {
    enableTypewriter(true);
  }

})();