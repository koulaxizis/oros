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
  const btnZen = document.getElementById('btn-zen');
  const btnSettings = document.getElementById('btn-settings');

  let zenModeActive = false;

  // ========== CONTEXT MENU ==========
  function createContextMenu(x, y) {
    closeMenu();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';
    
    const lang = getCurrentLang();
    
    const items = [
      { action: 'bold', icon: 'B', label_en: '**Bold**', label_el: '**Έντονα**' },
      { action: 'italic', icon: 'I', label_en: '*Italic*', label_el: '*Πλάγια*' },
      { divider: true },
      { action: 'h1', icon: '#', label_en: 'Heading 1', label_el: 'Τίτλος 1' },
      { action: 'h2', icon: '##', label_en: 'Heading 2', label_el: 'Υπότιτλος 2' },
      { action: 'quote', icon: '>', label_en: '> Quote', label_el: '> Παράθεση' },
      { divider: true },
      { action: 'undo', icon: '↶', label_en: 'Undo', label_el: 'Αναίρεση' },
      { action: 'redo', icon: '↷', label_en: 'Redo', label_el: 'Επαναφορά' },
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
        const label = lang === 'el' ? item.label_el : item.label_en;
        el.innerHTML = `<span class="cm-icon">${item.icon}</span> ${label}`;
        menu.appendChild(el);
      }
    });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.cm-item');
      if (!item) return;
      insertFormatting(item.dataset.action);
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
    }
  }

  editor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    createContextMenu(e.pageX, e.pageY);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // ========== BUTTONS ==========
  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }

  function showToast(msg) {
    clearTimeout(window.toastTimeout);
    let toast = document.querySelector('.zentool-toast');
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

  function saveContent(showMsg = false) {
    localStorage.setItem(STORAGE_KEY, editor.value);
    if (showMsg) {
      showToast(getCurrentLang() === 'el' ? '✓ Αποθηκεύτηκε' : '✓ Saved');
    }
  }

  btnNew.onclick = () => {
    if (editor.value.trim().length > 0) {
      const confirmText = getCurrentLang() === 'el' 
        ? 'Εκκαθάριση περιεχομένου; Δεν αναιρείται.'
        : 'Clear content? Cannot undo.';
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
      showToast(getCurrentLang() === 'el' ? '✓ Φορτώθηκε' : '✓ Loaded');
    } else {
      showToast(getCurrentLang() === 'el' ? '⚠ Κενό αποθηκευμένο' : '⚠ Empty');
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
      .replace(/\*\*(.+?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/gim, '<em>$1</em>')
      .replace(/`(.+?)`/gim, '<code>$1</code>')
      .replace(/\n/gim, '<br>');
    
    navigator.clipboard.writeText(html).then(() => {
      showToast(getCurrentLang() === 'el' ? '✓ Αντιγράφηκε HTML' : '✓ Copied');
    }).catch(() => {
      showToast(getCurrentLang() === 'el' ? '⚠ Απέτυχε' : '⚠ Failed');
    });
  };

  // Auto-save
  let debounceTimer;
  editor.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => saveContent(false), 2000);
  });

  setInterval(() => saveContent(false), 30000);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveContent(true);
    }
  });

  // ========== ZEN MODE ==========
  function enableZenMode() {
    zenModeActive = true;
    document.documentElement.setAttribute('data-zen', 'true');
    localStorage.setItem(ZEN_MODE_KEY, 'true');
    showToast(getCurrentLang() === 'el' ? 'Zen ενεργός • ESC για έξοδο' : 'Zen active • Press ESC');
  }

  function disableZenMode() {
    zenModeActive = false;
    document.documentElement.removeAttribute('data-zen');
    localStorage.removeItem(ZEN_MODE_KEY);
  }

  function toggleZenMode(forceState = null) {
    const newState = forceState !== null ? forceState : !zenModeActive;
    if (newState) enableZenMode();
    else disableZenMode();
  }

  window.toggleZenMode = toggleZenMode;

  if (localStorage.getItem(ZEN_MODE_KEY) === 'true') {
    enableZenMode();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && zenModeActive) {
      disableZenMode();
    }
    if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleZenMode();
    }
  });

  if (btnZen) {
    btnZen.onclick = () => toggleZenMode();
  }

  // ========== SETTINGS MODAL ==========
  function createSettingsModal() {
    closeMenu();
    
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    
    const lang = getCurrentLang();
    const shortcuts = lang === 'el' ? [
      ['Αποθήκευση', 'Ctrl+S'],
      ['Zen Mode', 'F9'],
      ['Έξοδος Zen', 'ESC'],
      ['Μένου μορφοποίησης', 'Δεξιό click']
    ] : [
      ['Save file', 'Ctrl+S'],
      ['Zen Mode', 'F9'],
      ['Exit Zen', 'ESC'],
      ['Format menu', 'Right-click']
    ];

    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <header class="modal-header">
          <h2>${lang === 'el' ? 'Ρυθμίσεις' : 'Settings'}</h2>
          <button class="close-btn">×</button>
        </header>
        <section class="tab-panel">
          <table class="shortcut-table">
            <thead>
              <tr><th>Action</th><th>Shortcut</th></tr>
            </thead>
            <tbody>
              ${shortcuts.map(([action, shortcut]) => 
                `<tr><td>${action}</td><td><kbd>${shortcut}</kbd></td></tr>`
              ).join('')}
            </tbody>
          </table>
        </section>
      </div>
    `;

    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('.modal-backdrop').onclick = () => modal.remove();

    document.body.appendChild(modal);
  }

  if (btnSettings) {
    btnSettings.onclick = createSettingsModal;
  }

})();