// ============================================
// orOS Writer — Extra Tools
// Zen Mode | Settings | Context Menu
// ============================================

(function() {
  'use strict';

  const STORAGE_KEY = 'oros_writer_content';
  const ZEN_MODE_KEY = 'oros_zen_mode_active';

  // Elements
  const editor = document.getElementById('editor');
  const saveStatus = document.getElementById('save-status');
  const btnNew = document.getElementById('btn-new');
  const btnSave = document.getElementById('btn-save');
  const btnLoad = document.getElementById('btn-load');
  const btnClear = document.getElementById('btn-clear');
  const btnExportMd = document.getElementById('btn-export-md');
  const btnCopyHtml = document.getElementById('btn-copy-html');

  let zenModeActive = false;

  // ========== CONTEXT MENU ==========
  function createContextMenu(x, y) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    const lang = localStorage.getItem('oros-language') || 'en';
    const t = window.OROS_TRANSLATIONS?.[lang] || {};
    
    menu.innerHTML = `
      <div class="cm-item" data-action="bold"><span class="cm-icon">B</span> ${t.cm_bold || '**Bold**'}</div>
      <div class="cm-item" data-action="italic"><span class="cm-icon">I</span> ${t.cm_italic || '*Italic*'}</div>
      <div class="cm-divider"></div>
      <div class="cm-item" data-action="h1"><span class="cm-icon">#</span> ${t.cm_h1 || 'Heading 1'}</div>
      <div class="cm-item" data-action="h2"><span class="cm-icon">##</span> ${t.cm_h2 || 'Heading 2'}</div>
      <div class="cm-item" data-action="quote"><span class="cm-icon">&gt;</span> ${t.cm_quote || '> Quote'}</div>
      <div class="cm-divider"></div>
      <div class="cm-item" data-action="undo"><span class="cm-icon">↶</span> ${t.cm_undo || 'Undo'}</div>
      <div class="cm-item" data-action="redo"><span class="cm-icon">↷</span> ${t.cm_redo || 'Redo'}</div>
    `;

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.cm-item');
      if (!item) return;
      
      const action = item.dataset.action;
      insertFormatting(action);
      closeMenu();
    });

    document.body.appendChild(menu);
  }

  function closeMenu() {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
  }

  function insertFormatting(action) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;
    const selected = text.substring(start, end);
    let formatted = '';
    let newPos = start;

    switch(action) {
      case 'bold':
        formatted = '**' + (selected || 'bold') + '**';
        newPos = start + 2;
        break;
      case 'italic':
        formatted = '*' + (selected || 'italic') + '*';
        newPos = start + 1;
        break;
      case 'h1':
        formatted = '# ' + (selected || 'Heading');
        newPos = start + 2;
        break;
      case 'h2':
        formatted = '## ' + (selected || 'Subheading');
        newPos = start + 3;
        break;
      case 'quote':
        formatted = '> ' + (selected || 'Quote here');
        newPos = start + 2;
        break;
      case 'undo':
        document.execCommand('undo');
        return;
      case 'redo':
        document.execCommand('redo');
        return;
    }

    if (formatted) {
      editor.setRangeText(formatted, start, end, 'select');
      editor.focus();
      
      // Move cursor position appropriately
      if (action === 'bold' || action === 'italic' && !selected) {
        editor.setSelectionRange(newPos, newPos);
      } else if (action.startsWith('h')) {
        const diff = formatted.indexOf(' ') + 1;
        editor.setSelectionRange(Math.max(0, startPos), Math.max(0, startPos));
      }
    }
  }

  // Enable custom context menu on textarea
  editor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeMenu();
    setTimeout(() => createContextMenu(e.pageX, e.pageY), 10);
  });

  // Close menu on any click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // ========== BUTTONS ==========
  btnNew.onclick = () => {
    if (editor.value.trim().length > 0) {
      const confirmText = getCurrentLang() === 'el' 
        ? 'Εκκαθάριση τρέχοντος περιεχομένου; Αυτό δεν μπορεί να αναιρεθεί.'
        : 'Clear current content? This cannot be undone.';
      if (!confirm(confirmText)) return;
    }
    editor.value = '';
    localStorage.removeItem(STORAGE_KEY);
    showToast(getCurrentLang() === 'el' ? 'Καθαρίστηκε' : 'Cleared');
  };

  btnSave.onclick = () => {
    downloadFile(editor.value, `orus-${new Date().toISOString().slice(0,10)}.md`, 'text/markdown;charset=utf-8');
    showToast(getCurrentLang() === 'el' ? '↓ Έγινε λήψη' : '↓ Downloaded');
  };

  btnLoad.onclick = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      editor.value = saved;
      showToast(getCurrentLang() === 'el' ? '✓ Φορτώθηκε αποθηκευμένο' : '✓ Loaded saved content');
    } else {
      showToast(getCurrentLang() === 'el' ? '⚠ Δεν υπάρχει αποθηκευμένο' : '⚠ No saved content');
    }
  };

  btnClear.onclick = () => {
    editor.value = '';
    localStorage.removeItem(STORAGE_KEY);
    showToast(getCurrentLang() === 'el' ? 'Καθαρίστηκε' : 'Cleared');
  };

  btnExportMd.onclick = () => {
    downloadFile(editor.value, `${Date.now()}.md`, 'text/markdown;charset=utf-8');
  };

  btnCopyHtml.onclick = () => {
    const md = editor.value;
    let html = md
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/gim, '<em>$1</em>')
      .replace(/`(.+?)`/gim, '<code>$1</code>')
      .replace(/\n/gim, '<br>');
    
    navigator.clipboard.writeText(html).then(() => {
      showToast(getCurrentLang() === 'el' ? '✓ Αντιγράφηκε HTML' : '✓ HTML copied');
    }).catch(() => {
      showToast(getCurrentLang() === 'el' ? '⚠ Απέτυχε η αντιγραφή' : '⚠ Copy failed');
    });
  };

  // Helper functions
  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
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

  // ========== ZEN MODE ==========
  function enableZenMode() {
    zenModeActive = true;
    document.documentElement.setAttribute('data-zen', 'true');
    localStorage.setItem(ZEN_MODE_KEY, 'true');
    
    // Show toast
    showToast(getCurrentLang() === 'el' ? 'Zen ενεργός • ESC για έξοδο' : 'Zen active • Press ESC to exit');
  }

  function disableZenMode() {
    zenModeActive = false;
    document.documentElement.removeAttribute('data-zen');
    localStorage.removeItem(ZEN_MODE_KEY);
    
    // Remove any lingering toast
    const toast = document.querySelector('.zentool-toast');
    if (toast) toast.remove();
  }

  // Toggle zen mode
  window.toggleZenMode = function(forceState = null) {
    const newState = forceState !== null ? forceState : !zenModeActive;
    if (newState) enableZenMode();
    else disableZenMode();
  };

  // Initialize zen mode state
  if (localStorage.getItem(ZEN_MODE_KEY) === 'true') {
    enableZenMode();
  }

  // Escape key exits zen mode
  document.addEventListener('keydown', (e) => {
    if (zenModeActive && e.key === 'Escape') {
      disableZenMode();
    }
  });

  // Toast notifications
  let toastTimeout;
  function showToast(msg) {
    clearTimeout(toastTimeout);
    let toast = document.querySelector('.zentool-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'zentool-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    toastTimeout = setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  // ========== SETTINGS MODAL ==========
  function createSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <header class="modal-header">
          <h2 data-i18n-settings="settings_title">Settings</h2>
          <button class="close-btn">×</button>
        </header>
        <nav class="modal-nav">
          <button class="tab-btn active" data-tab="shortcuts" data-i18n-settings="tab_shortcuts">Shortcuts</button>
        </nav>
        <div class="modal-body">
          <section id="tab-shortcuts" class="tab-panel active">
            <table class="shortcut-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Shortcut</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>${getCurrentLang() === 'el' ? 'Αποθήκευση αρχείου' : 'Save file'}</td><td><kbd>Ctrl+S</kbd></td></tr>
                <tr><td>${getCurrentLang() === 'el' ? 'Εισαγωγή σε Zen Mode' : 'Enter Zen Mode'}</td><td><kbd>F9</kbd></td></tr>
                <tr><td>${getCurrentLang() === 'el' ? 'Έξοδος από Zen Mode' : 'Exit Zen Mode'}</td><td><kbd>ESC</kbd></td></tr>
                <tr><td>${getCurrentLang() === 'el' ? 'Άνοιγμα αλίσκου' : 'Open menu'}</td><td><kbd>Right-click</kbd></td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    `;

    modal.querySelector('.close-btn').onclick = closeModal;
    modal.querySelector('.modal-backdrop').onclick = closeModal;

    function closeModal() {
      modal.remove();
    }

    document.body.appendChild(modal);
  }

  // Settings button handler
  function initSettingsButton() {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;

    const btn = document.createElement('button');
    btn.className = 'btn-control';
    btn.id = 'btn-settings';
    btn.innerHTML = '⚙️';
    btn.title = getCurrentLang() === 'el' ? 'Ρυθμίσεις' : 'Settings';
    btn.onclick = createSettingsModal;
    
    toolbar.insertBefore(btn, btnExportMd.nextSibling);
  }

  // Init
  initSettingsButton();

})();