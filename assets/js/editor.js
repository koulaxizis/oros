// ============================================
// orOS Writer — Editor Logic
// Dual-mode (Markdown / Rich Text)
// Open, Clear, Export (TXT/MD/DOCX/PDF)
// Context Menu, Auto-save
// ============================================

(function() {
  'use strict';

  const STORAGE_KEY = 'oros_writer_content';
  const STORAGE_MODE = 'oros_writer_mode';

  // Elements
  const editor = document.getElementById('editor');
  const richEditor = document.getElementById('rich-editor');
  const mdWrapper = document.getElementById('md-wrapper');
  const richWrapper = document.getElementById('rich-wrapper');
  const saveStatus = document.getElementById('save-status');
  const btnOpen = document.getElementById('btn-open');
  const btnClear = document.getElementById('btn-clear');
  const btnExport = document.getElementById('btn-export');
  const exportDropdown = document.getElementById('export-dropdown');
  const modeMd = document.getElementById('mode-md');
  const modeRich = document.getElementById('mode-rich');

  let currentMode = localStorage.getItem(STORAGE_MODE) || 'md';

  // ========== MODE TOGGLE ==========
  function setMode(mode) {
    currentMode = mode;
    localStorage.setItem(STORAGE_MODE, mode);

    if (mode === 'md') {
      mdWrapper.style.display = '';
      richWrapper.style.display = 'none';
      modeMd.classList.add('active');
      modeRich.classList.remove('active');
      // Sync content rich → md
      if (richEditor.innerText.trim()) {
        editor.value = htmlToMarkdown(richEditor.innerHTML);
      }
    } else {
      mdWrapper.style.display = 'none';
      richWrapper.style.display = '';
      modeMd.classList.remove('active');
      modeRich.classList.add('active');
      // Sync content md → rich
      if (editor.value.trim()) {
        richEditor.innerHTML = markdownToHtml(editor.value);
      }
    }
    saveContent(false);
  }

  modeMd.onclick = () => setMode('md');
  modeRich.onclick = () => setMode('rich');

  // ========== MARKDOWN ↔ HTML CONVERTERS ==========
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
    let md = html
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
  btnOpen.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.markdown,.text';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target.result;
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
  btnClear.onclick = () => {
    const hasContent = currentMode === 'md'
      ? editor.value.trim()
      : richEditor.innerText.trim();
    if (!hasContent) return;
    const confirmText = getCurrentLang() === 'el'
      ? 'Εκκαθάριση περιεχομένου; Δεν αναιρείται.'
      : 'Clear content? Cannot undo.';
    if (!confirm(confirmText)) return;
    editor.value = '';
    richEditor.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
    showToast(getCurrentLang() === 'el' ? 'Καθαρίστηκε' : 'Cleared');
  };

  // ========== EXPORT DROPDOWN ==========
  btnExport.onclick = (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('visible');
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.export-wrap')) {
      exportDropdown.classList.remove('visible');
    }
  });

  exportDropdown.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      const format = btn.dataset.format;
      exportContent(format);
      exportDropdown.classList.remove('visible');
    };
  });

  function getContent() {
    return currentMode === 'md' ? editor.value : htmlToMarkdown(richEditor.innerHTML);
  }

  function exportContent(format) {
    const content = getContent();
    const ts = new Date().toISOString().slice(0, 10);

    switch(format) {
      case 'txt':
        downloadFile(content.replace(/[#*>`]/g, ''), `oros-${ts}.txt`, 'text/plain;charset=utf-8');
        break;
      case 'md':
        downloadFile(content, `oros-${ts}.md`, 'text/markdown;charset=utf-8');
        break;
      case 'docx':
        exportDocx(content, `oros-${ts}.docx`);
        break;
      case 'pdf':
        exportPdf(content);
        break;
    }
    showToast(getCurrentLang() === 'el' ? '↓ Έγινε λήψη' : '↓ Downloaded');
  }

  function exportDocx(mdContent, filename) {
    // Minimal DOCX (actually HTML with Word-compatible headers)
    const html = markdownToHtml(mdContent);
    const fullHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>Export</title></head><body style="font-family: 'Nunito', Calibri, sans-serif; font-size: 12pt;">${html}</body></html>`;
    const blob = new Blob(['\ufeff' + fullHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf(mdContent) {
    const html = markdownToHtml(mdContent);
    const win = window.open('', '_blank');
    if (!win) {
      showToast(getCurrentLang() === 'el' ? '⚠ Άφησε pop-ups' : '⚠ Allow pop-ups');
      return;
    }
    win.document.write(`
      <html><head><title>orOS Export</title>
      <style>
        body { font-family: 'Nunito', Calibri, sans-serif; font-size: 12pt; line-height: 1.7; max-width: 700px; margin: 2rem auto; padding: 0 1rem; color: #2b2723; }
        h1 { font-size: 1.8rem; } h2 { font-size: 1.4rem; } h3 { font-size: 1.15rem; }
        blockquote { border-left: 3px solid #c8a96e; padding-left: 1rem; font-style: italic; color: #756f68; }
        code { font-family: monospace; background: #f6f5f1; padding: 2px 5px; border-radius: 3px; }
        @media print { body { margin: 0; padding: 1cm; } }
      </style></head><body>${html}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  }

  // ========== CONTEXT MENU ==========
  function createContextMenu(x, y) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';

    const lang = getCurrentLang();
    const labels = lang === 'el' ? {
      bold: 'Έντονα', italic: 'Πλάγια',
      h1: 'Τίτλος 1', h2: 'Τίτλος 2', quote: 'Παράθεση',
      undo: 'Αναίρεση', redo: 'Επαναφορά'
    } : {
      bold: 'Bold', italic: 'Italic',
      h1: 'Heading 1', h2: 'Heading 2', quote: 'Quote',
      undo: 'Undo', redo: 'Redo'
    };

    const items = [
      { action: 'bold', icon: 'B', label: labels.bold },
      { action: 'italic', icon: 'I', label: labels.italic },
      { divider: true },
      { action: 'h1', icon: '#', label: labels.h1 },
      { action: 'h2', icon: '##', label: labels.h2 },
      { action: 'quote', icon: '>', label: labels.quote },
      { divider: true },
      { action: 'undo', icon: '↶', label: labels.undo },
      { action: 'redo', icon: '↷', label: labels.redo },
    ];

    items.forEach(item => {
      if (item.divider) {
        const div = document.createElement('div');
        div.className = 'cm-divider';
        menu.appendChild(div);
      } else {
        const el = document.createElement('div');
        el.className = 'cm-item';
        el.dataset.action = item.action;
        el.innerHTML = `<span class="cm-icon">${item.icon}</span> ${item.label}`;
        menu.appendChild(el);
      }
    });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.cm-item');
      if (!item) return;
      doFormat(item.dataset.action);
    });

    document.body.appendChild(menu);
  }

  function closeMenu() {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
  }

  function doFormat(action) {
    if (currentMode === 'rich') {
      // Rich text mode — use execCommand
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
      // Markdown mode — wrap selection
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const text = editor.value;
      const selected = text.substring(start, end);
      let formatted = '';

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

  // Bind context menu to both editors
  editor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    createContextMenu(e.pageX, e.pageY);
  });

  richEditor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    createContextMenu(e.pageX, e.pageY);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // ========== AUTO-SAVE ==========
  let debounceTimer;
  editor.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => saveContent(false), 2000);
  });

  richEditor.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => saveContent(false), 2000);
  });

  setInterval(() => saveContent(false), 30000);

  function saveContent(showMsg) {
    const content = getContent();
    localStorage.setItem(STORAGE_KEY, content);
    if (showMsg) {
      showToast(getCurrentLang() === 'el' ? '✓ Αποθηκεύτηκε' : '✓ Saved');
    }
  }

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveContent(true);
    }
  });

  // ========== HELPERS ==========
  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }

  function showToast(msg) {
    clearTimeout(window.toastTimeout);
    let toast = document.querySelector('.zentool-toast:not(#zen-toast)');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'zentool-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    window.toastTimeout = setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ========== INIT ==========
  // Restore saved content
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    editor.value = saved;
    richEditor.innerHTML = markdownToHtml(saved);
  }

  // Apply saved mode
  setMode(currentMode);

})();