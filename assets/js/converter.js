// ============================================
// orOS Case Converter — Full Implementation
// v2.3 — FIXED: sentencePreserve, wordPreserve,
// ID mismatches (btn-conv-*), clearAll i18n
// ============================================

(function() {
  'use strict';

  // Storage keys
  var STORAGE_INPUT = 'oros_converter_input';
  var STORAGE_OUTPUT = 'oros_converter_output';
  var STORAGE_OPTIONS = 'oros_converter_options';
  var HISTORY_KEY = 'oros_converter_history';
  var HISTORY_INDEX_KEY = 'oros_converter_history_index';

  // DOM elements
  var inputArea = document.getElementById('input-area');
  var outputArea = document.getElementById('output-area');
  var converterToolbar = document.getElementById('converter-toolbar');
  var statsPanel = document.getElementById('stats-panel');

  // History for undo/redo
  var history = [];
  var historyIndex = -1;

  // Options state
  var options = {
    sentencePreserve: false,
    wordPreserve: false,
    acronyms: false,
    roman: false,
    trim: false,
    collapse: false,
    removelinebreaks: false,
    removechars: false,
    stripaccents: false,
    stripformatting: false
  };

  // ========== HELPER FUNCTIONS ==========

  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }

  function getTrans(key) {
    var lang = getCurrentLang();
    var t = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[lang]) || {};
    return t[key] || key;
  }

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
    }, 3000);
  }

  // ========== HISTORY (UNDO/REDO) ==========

  function saveState() {
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    history.push({ input: inputArea.value, output: outputArea.value });
    if (history.length > 50) history.shift();
    else historyIndex++;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(HISTORY_INDEX_KEY, historyIndex.toString());
    localStorage.setItem(STORAGE_INPUT, inputArea.value);
    localStorage.setItem(STORAGE_OUTPUT, outputArea.value);
    updateStats();
  }

  function loadHistory() {
    try {
      var saved = localStorage.getItem(HISTORY_KEY);
      var idx = localStorage.getItem(HISTORY_INDEX_KEY);
      if (saved) {
        history = JSON.parse(saved);
        historyIndex = idx ? parseInt(idx) : history.length - 1;
      }
    } catch(e) { history = []; historyIndex = -1; }
  }

  function undo() {
    if (historyIndex <= 0) return;
    var state = history[--historyIndex];
    inputArea.value = state.input;
    outputArea.value = state.output;
    updateStats();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    var state = history[++historyIndex];
    inputArea.value = state.input;
    outputArea.value = state.output;
    updateStats();
  }

  // ========== OPTIONS ==========

  function loadOptions() {
    try {
      var saved = localStorage.getItem(STORAGE_OPTIONS);
      if (saved) {
        var parsed = JSON.parse(saved);
        for (var key in parsed) {
          if (options.hasOwnProperty(key)) options[key] = parsed[key];
        }
      }
    } catch(e) {}

    var optMap = {
      'opt-sentence-preserve': 'sentencePreserve',
      'opt-word-preserve': 'wordPreserve',
      'opt-acronyms': 'acronyms',
      'opt-roman': 'roman',
      'opt-trim': 'trim',
      'opt-collapse': 'collapse',
      'opt-removelinebreaks': 'removelinebreaks',
      'opt-removechars': 'removechars',
      'opt-stripaccents': 'stripaccents',
      'opt-stripformatting': 'stripformatting'
    };

    for (var id in optMap) {
      var el = document.getElementById(id);
      if (el) el.checked = options[optMap[id]];
    }
  }

  function saveOptions() {
    localStorage.setItem(STORAGE_OPTIONS, JSON.stringify(options));
  }

  function setupOptionListeners() {
    var optMap = {
      'opt-sentence-preserve': 'sentencePreserve',
      'opt-word-preserve': 'wordPreserve',
      'opt-acronyms': 'acronyms',
      'opt-roman': 'roman',
      'opt-trim': 'trim',
      'opt-collapse': 'collapse',
      'opt-removelinebreaks': 'removelinebreaks',
      'opt-removechars': 'removechars',
      'opt-stripaccents': 'stripaccents',
      'opt-stripformatting': 'stripformatting'
    };

    for (var id in optMap) {
      (function(elId, optKey) {
        var el = document.getElementById(elId);
        if (el) {
          el.addEventListener('change', function() {
            options[optKey] = this.checked;
            saveOptions();
            if (inputArea.value) processConversion(currentMode);
          });
        }
      })(id, optMap[id]);
    }
  }

  // ========== GREEK ACCENT STRIPPING ==========

  function stripGreekAccents(text) {
    return text
      .replace(/Ά/g, 'Α').replace(/ά/g, 'α')
      .replace(/Έ/g, 'Ε').replace(/έ/g, 'ε')
      .replace(/Ή/g, 'Η').replace(/ή/g, 'η')
      .replace(/Ί/g, 'Ι').replace(/ί/g, 'ι')
      .replace(/Ϊ/g, 'Ι').replace(/ϊ/g, 'ι')
      .replace(/ΐ/g, 'ι')
      .replace(/Ό/g, 'Ο').replace(/ό/g, 'ο')
      .replace(/Ύ/g, 'Υ').replace(/ύ/g, 'υ')
      .replace(/Ϋ/g, 'Υ').replace(/ϋ/g, 'υ')
      .replace(/ΰ/g, 'υ')
      .replace(/Ώ/g, 'Ω').replace(/ώ/g, 'ω')
      .replace(/[\u0300-\u036f]/g, ''); // combining diacritical marks
  }

  // ========== FORMAT STRIPPING ==========

  function stripFormatting(text) {
    var result = text;
    result = result.replace(/<[^>]+>/g, '');
    result = result.replace(/\*\*(.+?)\*\*/g, '$1');
    result = result.replace(/__(.+?)__/g, '$1');
    result = result.replace(/\*(.+?)\*/g, '$1');
    result = result.replace(/_(.+?)_/g, '$1');
    result = result.replace(/^#{1,6}\s+/gm, '');
    result = result.replace(/```[\s\S]*?```/g, function(m) {
      return m.replace(/```/g, '').trim();
    });
    result = result.replace(/`(.+?)`/g, '$1');
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    result = result.replace(/^>\s+/gm, '');
    result = result.replace(/^[-*_]{3,}\s*$/gm, '');
    result = result.replace(/^---[\s\S]*?---\n?/, '');
    return result;
  }

  // ========== PRE-PROCESSING ==========

  function preProcess(text) {
    if (!text) return '';
    var processed = text;

    if (options.stripformatting) {
      processed = stripFormatting(processed);
    }

    if (options.trim) {
      processed = processed.split('\n').map(function(line) {
        return line.trim();
      }).join('\n');
    }

    if (options.collapse) {
      processed = processed.replace(/[ \t]+/g, ' ');
    }

    if (options.removelinebreaks) {
      processed = processed.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (options.removechars) {
      processed = processed.replace(/[^\w\s\u0370-\u03FF\u0300-\u036f]/g, '');
    }

    return processed;
  }

  // ========== POST-PROCESSING ==========

  function postProcess(text) {
    if (!text) return '';
    var result = text;

    if (options.stripaccents) {
      result = stripGreekAccents(result);
    }

    return result;
  }

  // ========== GREEK HELPERS ==========

  function isGreekLetter(char) {
    return /[\u0370-\u03FF]/.test(char);
  }

  function toGreekUpper(char) {
    var tonedToUpper = {
      'ά': 'Ά', 'έ': 'Έ', 'ή': 'Ή', 'ί': 'Ί',
      'ό': 'Ό', 'ύ': 'Ύ', 'ώ': 'Ώ',
      'ϊ': 'Ϊ', 'ϋ': 'Ϋ', 'ΐ': 'Ϊ', 'ΰ': 'Ϋ'
    };
    if (tonedToUpper[char]) return tonedToUpper[char];
    return char.toUpperCase();
  }

  function isRomanNumeral(str) {
    var trimmed = str.trim();
    if (!trimmed) return false;
    return /^[MDCLXVI]+$/.test(trimmed) && trimmed.length <= 4;
  }

  function isAcronym(word) {
    if (word.length < 2) return false;
    return /^[A-Z0-9]+$/.test(word);
  }

  // ========== CASE CONVERSION FUNCTIONS ==========

  function uppercase(text) {
    var processed = preProcess(text);
    return processed.split('').map(function(c) {
      return isGreekLetter(c) ? toGreekUpper(c) : c.toUpperCase();
    }).join('');
  }

  function lowercase(text) {
    var processed = preProcess(text);
    
    // FIRST convert everything to lowercase
    var result = processed.toLowerCase();
    
    // THEN preserve sentence starts if enabled
    if (options.sentencePreserve) {
      result = result.replace(/(^[a-zA-Z\u0370-\u03FF])/g, function(match, char) {
        return isGreekLetter(char) ? toGreekUpper(char) : char.toUpperCase();
      });
      result = result.replace(/([.!?…]\s+)([a-zA-Z\u0370-\u03FF])/g, function(m, sep, char) {
        return sep + (isGreekLetter(char) ? toGreekUpper(char) : char.toUpperCase());
      });
    }
    
    // Preserve word starts if enabled
    if (options.wordPreserve) {
      result = result.replace(/\b([a-zA-Z\u0370-\u03FF])/g, function(m, c) {
        return isGreekLetter(c) ? toGreekUpper(c) : c.toUpperCase();
      });
    }
    
    return result;
  }

  function titleCase(text) {
    var processed = preProcess(text);
    var words = processed.split(/(\s+)/);
    return words.map(function(word) {
      if (/^\s+$/.test(word)) return word;
      if (!word) return word;
      if (options.acronyms && isAcronym(word)) return word;
      if (options.roman && isRomanNumeral(word)) return word;
      var first = word.charAt(0);
      var rest = word.slice(1);
      return (isGreekLetter(first) ? toGreekUpper(first) : first.toUpperCase()) + rest.toLowerCase();
    }).join('');
  }

  function sentenceCase(text) {
    var processed = preProcess(text);
    var lower = processed.toLowerCase();
    return lower.replace(/(^|[.!?…]\s+)([a-zA-Z\u0370-\u03FF])/g,
      function(m, prefix, letter) {
        return prefix + (isGreekLetter(letter) ? toGreekUpper(letter) : letter.toUpperCase());
      }
    );
  }

  function toggleCase(text) {
    var processed = preProcess(text);
    return processed.split('').map(function(c) {
      if (c === c.toUpperCase() && c !== c.toLowerCase()) {
        return c.toLowerCase();
      } else if (c === c.toLowerCase() && c !== c.toUpperCase()) {
        return isGreekLetter(c) ? toGreekUpper(c) : c.toUpperCase();
      }
      return c;
    }).join('');
  }

  // ========== PROGRAMMER CASE FUNCTIONS ==========

  function splitWords(text) {
    return text
      .replace(/[-_\s]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function camelCase(text) {
    var processed = preProcess(text);
    var words = splitWords(processed);
    if (words.length === 0) return '';
    return words.map(function(word, i) {
      var lower = word.toLowerCase();
      var first = lower.charAt(0);
      var rest = lower.slice(1);
      if (i === 0) return first + rest;
      return (isGreekLetter(first) ? toGreekUpper(first) : first.toUpperCase()) + rest;
    }).join('');
  }

  function pascalCase(text) {
    var processed = preProcess(text);
    var words = splitWords(processed);
    return words.map(function(word) {
      var lower = word.toLowerCase();
      var first = lower.charAt(0);
      var rest = lower.slice(1);
      return (isGreekLetter(first) ? toGreekUpper(first) : first.toUpperCase()) + rest;
    }).join('');
  }

  function snakeCase(text) {
    var processed = preProcess(text);
    var words = splitWords(processed);
    return words.join('_').toLowerCase();
  }

  function kebabCase(text) {
    var processed = preProcess(text);
    var words = splitWords(processed);
    return words.join('-').toLowerCase();
  }

  function constantCase(text) {
    var processed = preProcess(text);
    var words = splitWords(processed);
    return words.join('_').split('').map(function(c) {
      return isGreekLetter(c) ? toGreekUpper(c) : c.toUpperCase();
    }).join('');
  }

  // ========== MAIN CONVERSION ==========

  var currentMode = 'uppercase';

  function processConversion(mode) {
    var text = inputArea.value;
    var result = '';

    switch(mode) {
      case 'uppercase': result = uppercase(text); break;
      case 'lowercase': result = lowercase(text); break;
      case 'title': result = titleCase(text); break;
      case 'sentence': result = sentenceCase(text); break;
      case 'toggle': result = toggleCase(text); break;
      case 'camel': result = camelCase(text); break;
      case 'pascal': result = pascalCase(text); break;
      case 'snake': result = snakeCase(text); break;
      case 'kebab': result = kebabCase(text); break;
      case 'constant': result = constantCase(text); break;
      default: result = text;
    }

    result = postProcess(result);
    outputArea.value = result;
    saveState();
  }

  function setCurrentMode(mode) {
    currentMode = mode;
    var modeBtns = document.querySelectorAll('.mode-btn');
    for (var i = 0; i < modeBtns.length; i++) {
      if (modeBtns[i].dataset.mode === mode) {
        modeBtns[i].classList.add('active');
      } else {
        modeBtns[i].classList.remove('active');
      }
    }
    if (inputArea.value) processConversion(mode);
  }

  function setupModeButtons() {
    var modeBtns = document.querySelectorAll('.mode-btn');
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].addEventListener('click', function() {
        setCurrentMode(this.dataset.mode);
      });
    }
    setCurrentMode('uppercase');
  }

  // ========== STATISTICS ==========

  function updateStats() {
    var text = outputArea.value;
    var chars = text.length;
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    var lines = text ? text.split('\n').length : 0;
    var sentences = text.split(/[.!?…]+/).filter(function(s) {
      return s.trim().length > 0;
    }).length;

    var el;
    el = document.getElementById('stat-chars');
    if (el) el.textContent = chars.toLocaleString();
    el = document.getElementById('stat-words');
    if (el) el.textContent = words.toLocaleString();
    el = document.getElementById('stat-lines');
    if (el) el.textContent = lines.toLocaleString();
    el = document.getElementById('stat-sentences');
    if (el) el.textContent = sentences.toLocaleString();
  }

  function toggleStats() {
    if (statsPanel) {
      statsPanel.style.display = statsPanel.style.display === 'none' ? 'flex' : 'none';
    }
  }

  // ========== FILE OPERATIONS ==========

  function openFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      inputArea.value = e.target.result;
      processConversion(currentMode);
      showToast(getTrans('toast_opened'));
    };
    reader.readAsText(file);
  }

  function saveFile() {
    var text = outputArea.value;
    if (!text) return;
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'converted_' + new Date().toISOString().slice(0,19).replace(/[:.]/g,'-') + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(getTrans('toast_downloaded'));
  }

  function copyToClipboard() {
    if (!outputArea.value) return;
    var text = outputArea.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        showToast(getTrans('toast_copied'));
      }).catch(function() {
        outputArea.select();
        document.execCommand('copy');
        window.getSelection().removeAllRanges();
        showToast(getTrans('toast_copied'));
      });
    } else {
      outputArea.select();
      document.execCommand('copy');
      window.getSelection().removeAllRanges();
      showToast(getTrans('toast_copied'));
    }
  }

  function clearAll() {
    var lang = getCurrentLang();
    var msg = lang === 'el'
      ? getTrans('confirm_clear_el') || 'Σίγουρα; Όλο το περιεχόμενο θα χαθεί.'
      : getTrans('confirm_clear') || 'Are you sure? All content will be lost.';
    if (confirm(msg)) {
      inputArea.value = '';
      outputArea.value = '';
      history = [];
      historyIndex = -1;
      localStorage.removeItem(HISTORY_KEY);
      localStorage.removeItem(HISTORY_INDEX_KEY);
      localStorage.removeItem(STORAGE_INPUT);
      localStorage.removeItem(STORAGE_OUTPUT);
      updateStats();
      showToast(getTrans('toast_cleared'));
    }
  }

  // ========== RESTORE ORIGINAL ==========

  function resetOriginal() {
    if (!inputArea.value) return;
    outputArea.value = inputArea.value;
    saveState();
    showToast(getTrans('toast_reset'));
  }

  // ========== KEYBOARD SHORTCUTS ==========

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      var inModal = document.querySelector('.settings-modal.visible');

      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveFile();
      } else if (e.ctrlKey && e.key === 'z') {
        if (inModal) return;
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key === 'y') {
        if (inModal) return;
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        setCurrentMode('uppercase');
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        setCurrentMode('lowercase');
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        setCurrentMode('title');
      }
    });
  }

  // ========== DROPDOWN ==========

  function setupDropdown() {
    var btnOptions = document.getElementById('btn-conv-options');
    var dropdown = document.getElementById('options-dropdown');

    if (btnOptions && dropdown) {
      btnOptions.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.classList.toggle('visible');
      });

      document.addEventListener('click', function() {
        dropdown.classList.remove('visible');
      });

      dropdown.addEventListener('click', function(e) {
        e.stopPropagation();
      });
    }
  }

  // ========== INPUT HANDLER ==========

  function setupInputHandler() {
    if (inputArea) {
      inputArea.addEventListener('input', function() {
        processConversion(currentMode);
      });
    }
  }

  // ========== INIT ==========

  function loadSavedContent() {
    var savedInput = localStorage.getItem(STORAGE_INPUT);
    var savedOutput = localStorage.getItem(STORAGE_OUTPUT);
    if (savedInput) inputArea.value = savedInput;
    if (savedOutput) outputArea.value = savedOutput;
    if (savedInput) processConversion(currentMode);
  }

  function init() {
    loadHistory();
    loadOptions();
    setupOptionListeners();
    setupDropdown();
    setupInputHandler();
    setupKeyboardShortcuts();
    setupModeButtons();
    loadSavedContent();
    updateStats();

    var btnOpen = document.getElementById('btn-conv-open');
    var fileInput = document.getElementById('file-input');
    if (btnOpen && fileInput) {
      btnOpen.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
          openFile(this.files[0]);
          this.value = '';
        }
      });
    }

    var btnCopy = document.getElementById('btn-conv-copy');
    var btnSave = document.getElementById('btn-conv-save');
    var btnClear = document.getElementById('btn-conv-clear');
    var btnUndo = document.getElementById('btn-conv-undo');
    var btnRedo = document.getElementById('btn-conv-redo');
    var btnReset = document.getElementById('btn-conv-reset');
    var btnStats = document.getElementById('btn-conv-stats');

    if (btnCopy) btnCopy.addEventListener('click', copyToClipboard);
    if (btnSave) btnSave.addEventListener('click', saveFile);
    if (btnClear) btnClear.addEventListener('click', clearAll);
    if (btnUndo) btnUndo.addEventListener('click', undo);
    if (btnRedo) btnRedo.addEventListener('click', redo);
    if (btnReset) btnReset.addEventListener('click', resetOriginal);
    if (btnStats) btnStats.addEventListener('click', toggleStats);

    window.addEventListener('oros-language-changed', function() {
      if (inputArea.value) processConversion(currentMode);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();