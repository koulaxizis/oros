// ============================================
// orOS Writer App - Local-only Markdown Editor
// Autosaves to localStorage
// ============================================

(function() {
  const STORAGE_KEY = 'oros_writer_content';
  const AUTO_SAVE_INTERVAL = 10000; // 10 seconds
  
  const editor = document.getElementById('editor');
  const statusEl = document.getElementById('save-status');
  
  // Load saved content
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    editor.value = saved;
  }
  
  // Auto-save interval
  setInterval(() => {
    saveContent(false); // silent save
  }, AUTO_SAVE_INTERVAL);
  
  editor.addEventListener('input', () => {
    debouncedSave();
  });
  
  function saveContent(showStatusMsg = true) {
    localStorage.setItem(STORAGE_KEY, editor.value);
    if (showStatusMsg) {
      showStatus(getCurrentLang() === 'el' ? '✓ Αποθηκεύτηκε' : '✓ Saved');
    }
  }
  
  let saveTimeout;
  function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveContent(true), 2000);
  }
  
  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }
  
  function showStatus(msg) {
    statusEl.textContent = msg;
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }
  
  // New document
  document.getElementById('btn-new').onclick = () => {
    if (editor.value.trim().length > 0) {
      const confirmText = getCurrentLang() === 'el' 
        ? 'Εκκαθάριση τρέχοντος περιεχομένου; Αυτό δεν μπορεί να αναιρεθεί.'
        : 'Clear current content? This cannot be undone.';
      
      if (!confirm(confirmText)) return;
    }
    editor.value = '';
    localStorage.removeItem(STORAGE_KEY);
    showStatus(getCurrentLang() === 'el' ? 'Καθαρίστηκε' : 'Cleared');
  };
  
  // Clear button
  document.getElementById('btn-clear').onclick = () => {
    editor.value = '';
    localStorage.removeItem(STORAGE_KEY);
    showStatus(getCurrentLang() === 'el' ? 'Καθαρίστηκε' : 'Cleared');
  };
  
  // Save to file
  document.getElementById('btn-save').onclick = () => {
    const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dt = new Date().toISOString().slice(0,10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orus-${dt}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(getCurrentLang() === 'el' ? '↓ Έγινε λήψη' : '↓ Downloaded');
  };
  
  // Export MD with timestamp
  document.getElementById('btn-export-md').onclick = () => {
    const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Copy converted HTML
  document.getElementById('btn-copy-html').onclick = () => {
    const md = editor.value;
    // Basic markdown → HTML conversion
    let html = md
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/gim, '<em>$1</em>')
      .replace(/`(.+?)`/gim, '<code>$1</code>')
      .replace(/\n/gim, '<br>');
    
    navigator.clipboard.writeText(html).then(() => {
      showStatus(getCurrentLang() === 'el' ? '✓ Αντιγράφηκε HTML' : '✓ HTML copied');
    }).catch(() => {
      showStatus(getCurrentLang() === 'el' ? '⚠ Απέτυχε η αντιγραφή' : '⚠ Copy failed');
    });
  };
  
  // Keyboard shortcut Ctrl/Cmd+S
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveContent(true);
    }
  });
  
  // Initial status
  showStatus(getCurrentLang() === 'el' ? 'Έτοιμος' : 'Ready');
})();