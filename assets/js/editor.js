// ============================================
// orOS Writer — Editor Logic
// Dual-mode (Markdown / Rich Text)
// Open, Clear, Export (TXT/MD/DOCX/PDF)
// Context Menu, Auto-save, Keyboard Shortcuts
// ============================================

(function() {
  'use strict';

  var STORAGE_KEY = 'oros_writer_content';
  var STORAGE_MODE = 'oros_writer_mode';

  var editor = document.getElementById('editor');
  var richEditor = document.getElementById('rich-editor');
  var mdWrapper = document.getElementById('md-wrapper');
  var richWrapper = document.getElementById('rich-wrapper');
  var saveStatus = document.getElementById('save-status');
  var btnOpen = document.getElementById('btn-open');
  var btnClear = document.getElementById('btn-clear');
  var btnExport = document.getElementById('btn-export');
  var exportDropdown = document.getElementById('export-dropdown');
  var modeMd = document.getElementById('mode-md');
  var modeRich = document.getElementById('mode-rich');

  var currentMode = localStorage.getItem(STORAGE_MODE) || 'md';

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
  }

  modeMd.onclick = function() { setMode('md'); };
  modeRich.onclick = function() { setMode('rich'); };

  // ========== MARKDOWN TO HTML ==========
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
        showToast(getCurrentLang() === 'el' ? '✓ Φορτώθηκε' : '✓ Opened');
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
      ? 'Εκκαθάριση περιεχομένου; Δεν αναιρείται.'
      : 'Clear content? Cannot undo.';
    if (!confirm(confirmText)) return;
    editor.value = '';
    richEditor.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
    showToast(getCurrentLang() === 'el' ? 'Καθαρίστηκε' : 'Cleared');
  };

  // ========== EXPORT DROPDOWN ==========
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
      case 'txt':
        downloadFile(content.replace(/[#*>`]/g, ''), 'oros-' + ts + '.txt', 'text/plain;charset=utf-8');
        break;
      case 'md':
        downloadFile(content, 'oros-' + ts + '.md', 'text/markdown;charset=utf-8');
        break;
      case 'docx':
        exportDocx(content, 'oros-' + ts + '.docx');
        break;
      case 'pdf':
        exportPdf(content);
        break;
    }
    showToast(getCurrentLang() === 'el' ? '↓ Έγινε λήψη' : '↓ Downloaded');
  }

  function exportDocx(mdContent, filename) {
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
      showToast(getCurrentLang() === 'el' ? '⚠ Άφησε pop-ups' : '⚠ Allow pop-ups');
      return;
    }
    win.document.write(
      '<html><head><title>orOS Export</title>' +
      '<style>' +
        'body { font-family: Calibri, sans-serif; font-size: 12pt; line-height: 1.7; max-width: 700px; margin: 2rem auto; padding: 0 1rem; color: #2b2723; }' +
        'h1 { font-size: 1.8rem; } h2 { font-size: 1.4rem; } h3 { font-size: 1.15rem; }' +
        'blockquote { border-left: 3px solid #c8a96e; padding-left: 1rem; font-style: italic; color: #756f68; }' +
        'code { font-family: monospace; background: #f6f5f1; padding: 2px 5px; border-radius: 3px; }' +
        '@media print { body { margin: 0; padding: 1cm; } }' +
      '</style></head><body>' + html + '</body></html>'
    );
    win.document.close();
    setTimeout(function() { win.print(); }, 500);
  }

  // ========== CONTEXT MENU ==========
  function createContextMenu(x, y) {
    closeMenu();
    var menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';

    var lang = getCurrentLang();
    var labels = lang === 'el' ? {
      bold: 'Έντονα', italic: 'Πλάγια',
      h1: 'Τίτλος 1', h2: 'Τίτλος 2', quote: 'Παράθεση',
      undo: 'Αναίρεση', redo: 'Επαναφορά'
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
      { action: 'undo', icon: '↶', label: labels.undo },
      { action: 'redo', icon: '↷', label: labels.redo }
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
  }

  editor.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    createContextMenu(e.pageX, e.pageY);
  });

  richEditor.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    createContextMenu(e.pageX, e.pageY);
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.context-menu')) closeMenu();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeMenu();
  });

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', function(e) {
    var ctrl = e.ctrlKey || e.metaKey;
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

  // ========== AUTO-SAVE ==========
  var debounceTimer;
  editor.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { saveContent(false); }, 2000);
  });

  richEditor.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { saveContent(false); }, 2000);
  });

  setInterval(function() { saveContent(false); }, 30000);

  function saveContent(showMsg) {
    var content = getContent();
    localStorage.setItem(STORAGE_KEY, content);
    if (showMsg) {
      showToast(getCurrentLang() === 'el' ? '✓ Αποθηκεύτηκε' : '✓ Saved');
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

  // ========== INIT ==========
  var saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    editor.value = saved;
    richEditor.innerHTML = markdownToHtml(saved);
  }

  setMode(currentMode);

})();