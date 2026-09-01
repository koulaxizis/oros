// ============================================
// orOS Prompter — Writing Prompts App v2.0
// 100 prompts · 10 techniques · Bilingual
// Features: Daily prompt, custom prompts, completed,
// tags, variations, multi-prompt, sprint timer,
// keyboard nav, export, stats dashboard
// ============================================

(function() {
  'use strict';

  // ===== STORAGE KEYS =====
  var STORAGE_FAVS = 'oros_prompter_favorites';
  var STORAGE_COMPLETED = 'oros_prompter_completed';
  var STORAGE_CUSTOM = 'oros_prompter_custom';
  var STORAGE_SEEN_DAILY = 'oros_prompter_seen_daily';
  var STORAGE_MULTI_SELECTED = 'oros_prompter_multi_selected';
  var STORAGE_SPRINT_TIME = 'oros_prompter_sprint_time';
  var STORAGE_LAST_VISIT = 'oros_prompter_last_visit';

  // ===== DOM REFERENCES =====
  var promptsGrid = document.getElementById('prompts-grid');
  var promptsEmpty = document.getElementById('prompts-empty');
  var categoryChips = document.getElementById('category-chips');
  var tagChips = document.getElementById('tag-chips');
  var searchInput = document.getElementById('prompt-search');
  var dailyBtn = document.getElementById('btn-daily-prompt');
  var randomBtn = document.getElementById('btn-random-prompt');
  var customBtn = document.getElementById('btn-custom-prompts');
  var multiBtn = document.getElementById('btn-multi-prompt');
  var randomDisplay = document.getElementById('random-prompt-display');
  var randomText = document.getElementById('random-prompt-text');
  var randomCategoryBadge = document.getElementById('random-category-badge');
  var promptVariations = document.getElementById('prompt-variations');
  var btnReroll = document.getElementById('btn-reroll');
  var btnRandomCopy = document.getElementById('btn-random-copy');
  var btnRandomComplete = document.getElementById('btn-random-complete');
  var btnRandomClose = document.getElementById('btn-random-close');
  var btnOpenInWriter = document.getElementById('btn-open-in-writer');
  var favToggle = document.getElementById('btn-favorites-toggle');
  var completedToggle = document.getElementById('btn-completed-toggle');
  var exportBtn = document.getElementById('btn-export-prompts');
  var showTagsBtn = document.getElementById('btn-show-tags');
  var completedCountEl = document.getElementById('completed-count');
  var favoritesCountEl = document.getElementById('favorites-count');
  var customCountEl = document.getElementById('custom-count');
  var progressPercentEl = document.getElementById('progress-percent');
  var statsDashboardContent = document.getElementById('stats-dashboard-content');

  // Modals
  var sprintModal = document.getElementById('sprint-modal');
  var customModal = document.getElementById('custom-modal');
  var multiModal = document.getElementById('multi-modal');

  // ===== STATE =====
  var promptsData = null;
  var allPrompts = [];
  var currentFilter = 'all';
  var currentTagFilter = null;
  var currentSearch = '';
  var favoritesOnly = false;
  var completedOnly = false;
  var tagsVisible = false;
  var favorites = loadArray(STORAGE_FAVS);
  var completed = loadArray(STORAGE_COMPLETED);
  var customPrompts = loadArray(STORAGE_CUSTOM);
  var currentRandomPrompt = null;
  var currentVariation = null;
  var multiSelected = [];
  var keyboardFocusIndex = -1;
  var sprintTimerInterval = null;
  var sprintTotalSeconds = 600;
  var sprintRemainingSeconds = 600;
  var sprintRunning = false;

  // ===== HELPERS =====
  function getLang() { return localStorage.getItem('oros-language') || 'en'; }

  function getTrans(key) {
    var lang = getLang();
    var t = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[lang]) || {};
    return t[key] || key;
  }

  function loadArray(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function saveArray(key, arr) {
    localStorage.setItem(key, JSON.stringify(arr));
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

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== FAVORITES =====
  function toggleFavorite(id) {
    var idx = favorites.indexOf(id);
    if (idx === -1) favorites.push(id);
    else favorites.splice(idx, 1);
    saveArray(STORAGE_FAVS, favorites);
    updateStatsBar();
  }

  function isFavorite(id) { return favorites.indexOf(id) !== -1; }

  // ===== COMPLETED =====
  function toggleCompleted(id) {
    var idx = completed.indexOf(id);
    if (idx === -1) completed.push(id);
    else completed.splice(idx, 1);
    saveArray(STORAGE_COMPLETED, completed);
    updateStatsBar();
  }

  function isCompleted(id) { return completed.indexOf(id) !== -1; }

  // ===== CUSTOM PROMPTS =====
  function addCustomPrompt(category, tags, textEn, textEl) {
    var id = 'custom_' + Date.now();
    var tagArr = tags.split(',').map(function(t) { return t.trim().toLowerCase(); }).filter(Boolean);
    customPrompts.push({
      id: id,
      category: category,
      tags: tagArr,
      text: { en: textEn, el: textEl || textEn },
      custom: true,
      variations: []
    });
    saveArray(STORAGE_CUSTOM, customPrompts);
    updateStatsBar();
    renderPrompts();
  }

  function deleteCustomPrompt(id) {
    var idx = -1;
    for (var i = 0; i < customPrompts.length; i++) {
      if (customPrompts[i].id === id) { idx = i; break; }
    }
    if (idx !== -1) {
      customPrompts.splice(idx, 1);
      saveArray(STORAGE_CUSTOM, customPrompts);
      updateStatsBar();
      renderPrompts();
    }
  }

  // ===== DAILY PROMPT =====
  function getDailyPromptIndex() {
    var today = new Date();
    var dateStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    var hash = 0;
    for (var i = 0; i < dateStr.length; i++) {
      hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % allPrompts.length;
  }

  function showDailyPrompt() {
    var idx = getDailyPromptIndex();
    var prompt = allPrompts[idx];
    currentRandomPrompt = prompt;
    currentVariation = null;
    displayRandomPrompt(prompt);
    localStorage.setItem(STORAGE_SEEN_DAILY, new Date().toDateString());
  }

  function hasSeenDaily() {
    var seen = localStorage.getItem(STORAGE_SEEN_DAILY);
    return seen === new Date().toDateString();
  }

  // ===== DATA LOADING =====
  function loadPrompts() {
    fetch('assets/js/prompts.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        promptsData = data;
        allPrompts = data.prompts.concat(customPrompts);
        renderCategoryChips();
        renderTagChips();
        renderPrompts();
        updateStatsBar();
        renderStatsDashboard();
        populateCustomCategorySelect();
      })
      .catch(function(e) {
        console.error('Failed to load prompts:', e);
        if (promptsGrid) {
          promptsGrid.innerHTML = '<div class="prompts-empty"><p>Error loading prompts.</p></div>';
        }
      });
  }

  // ===== CATEGORY CHIPS =====
  function renderCategoryChips() {
    if (!categoryChips || !promptsData) return;
    var lang = getLang();
    var html = '<button class="chip active" data-filter="all">' +
      '<i class="fa fa-list-ul"></i>' +
      (lang === 'el' ? 'Όλα' : 'All') + '</button>';

    for (var i = 0; i < promptsData.categories.length; i++) {
      var cat = promptsData.categories[i];
      html += '<button class="chip" data-filter="' + cat.id + '">' +
        '<i class="fa ' + cat.icon + '"></i>' +
        (cat.name[lang] || cat.name.en) + '</button>';
    }

    categoryChips.innerHTML = html;

    var chips = categoryChips.querySelectorAll('.chip');
    for (var j = 0; j < chips.length; j++) {
      (function(chip) {
        chip.addEventListener('click', function() {
          chips.forEach(function(c) { c.classList.remove('active'); });
          chip.classList.add('active');
          currentFilter = chip.getAttribute('data-filter');
          keyboardFocusIndex = -1;
          renderPrompts();
        });
      })(chips[j]);
    }
  }

  // ===== TAG CHIPS =====
  function renderTagChips() {
    if (!tagChips || !promptsData) return;
    var lang = getLang();
    var tagMap = promptsData.tags[lang] || promptsData.tags.en;
    var allTags = Object.keys(tagMap);

    var html = '';
    for (var i = 0; i < allTags.length; i++) {
      var tagKey = allTags[i];
      html += '<button class="chip" data-tag="' + tagKey + '">' + tagMap[tagKey] + '</button>';
    }

    tagChips.innerHTML = html;

    var chips = tagChips.querySelectorAll('.chip');
    for (var j = 0; j < chips.length; j++) {
      (function(chip) {
        chip.addEventListener('click', function() {
          var tagKey = chip.getAttribute('data-tag');
          if (currentTagFilter === tagKey) {
            currentTagFilter = null;
            chip.classList.remove('active');
          } else {
            chips.forEach(function(c) { c.classList.remove('active'); });
            chip.classList.add('active');
            currentTagFilter = tagKey;
          }
          renderPrompts();
        });
      })(chips[j]);
    }
  }

  // ===== RENDER PROMPTS =====
  function getCategoryById(catId) {
    if (!promptsData) return null;
    for (var i = 0; i < promptsData.categories.length; i++) {
      if (promptsData.categories[i].id === catId) return promptsData.categories[i];
    }
    return null;
  }

  function getFilteredPrompts() {
    var lang = getLang();
    return allPrompts.filter(function(p) {
      if (currentFilter !== 'all' && p.category !== currentFilter) return false;
      if (favoritesOnly && !isFavorite(p.id)) return false;
      if (completedOnly && !isCompleted(p.id)) return false;
      if (currentTagFilter) {
        if (!p.tags || p.tags.indexOf(currentTagFilter) === -1) return false;
      }
      if (currentSearch) {
        var text = (p.text[lang] || p.text.en).toLowerCase();
        if (text.indexOf(currentSearch.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  function renderPrompts() {
    if (!promptsGrid || !promptsData) return;
    var lang = getLang();
    var filtered = getFilteredPrompts();

    if (filtered.length === 0) {
      promptsGrid.style.display = 'none';
      promptsEmpty.style.display = 'block';
      return;
    }

    promptsGrid.style.display = 'grid';
    promptsEmpty.style.display = 'none';

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var p = filtered[i];
      var cat = getCategoryById(p.category);
      var catName = cat ? (cat.name[lang] || cat.name.en) : p.category;
      var catIcon = cat ? cat.icon : 'fa-pencil';
      var text = p.text[lang] || p.text.en;
      var isFav = isFavorite(p.id);
      var isComp = isCompleted(p.id);
      var isCustom = p.custom === true;
      var tagMap = promptsData.tags[lang] || promptsData.tags.en;

      html += '<div class="prompt-card' + (isComp ? ' completed' : '') + '" data-id="' + p.id + '" tabindex="0">' +
        '<div class="prompt-card-header">' +
          '<span class="prompt-card-category"><i class="fa ' + catIcon + '"></i>' + catName + '</span>' +
          '<span class="prompt-card-number">#' + (isCustom ? '★' : p.id) + '</span>' +
        '</div>';

      if (isCustom) {
        html += '<span class="prompt-card-badge custom">Custom</span>';
      }

      html += '<p class="prompt-card-text">' + escapeHtml(text) + '</p>';

      if (p.tags && p.tags.length > 0) {
        html += '<div class="prompt-card-tags">';
        for (var t = 0; t < p.tags.length; t++) {
          var tagName = tagMap[p.tags[t]] || p.tags[t];
          html += '<span class="prompt-tag">' + escapeHtml(tagName) + '</span>';
        }
        html += '</div>';
      }

      if (p.variations && p.variations.length > 0) {
        html += '<div class="prompt-card-tags"><span class="prompt-tag" style="background:var(--accent-gold-dim);color:var(--accent-gold);">' +
          '<i class="fa fa-code-fork"></i> ' + p.variations.length + ' variation' + (p.variations.length > 1 ? 's' : '') +
        '</span></div>';
      }

      html += '<div class="prompt-card-actions">' +
        '<button class="mini-btn fav-btn' + (isFav ? ' active' : '') + '" data-action="fav" data-id="' + p.id + '" title="Favorite"><i class="fa ' + (isFav ? 'fa-star' : 'fa-star-o') + '"></i></button>' +
        '<button class="mini-btn complete-btn' + (isComp ? ' active' : '') + '" data-action="complete" data-id="' + p.id + '" title="Complete"><i class="fa ' + (isComp ? 'fa-check-square' : 'fa-check-square-o') + '"></i></button>' +
        '<button class="mini-btn" data-action="copy" data-id="' + p.id + '" title="Copy"><i class="fa fa-clipboard"></i></button>' +
        '<button class="mini-btn" data-action="writer" data-id="' + p.id + '" title="Open in Writer"><i class="fa fa-pencil"></i></button>' +
        (isCustom ? '<button class="mini-btn" data-action="delete-custom" data-id="' + p.id + '" title="Delete"><i class="fa fa-trash"></i></button>' : '') +
      '</div></div>';
    }

    promptsGrid.innerHTML = html;
    attachCardListeners();
  }

  function attachCardListeners() {
    var cards = promptsGrid.querySelectorAll('.prompt-card');
    for (var j = 0; j < cards.length; j++) {
      (function(card, index) {
        card.addEventListener('focus', function() {
          keyboardFocusIndex = index;
          card.classList.add('keyboard-focused');
        });
        card.addEventListener('blur', function() {
          card.classList.remove('keyboard-focused');
        });
        var btns = card.querySelectorAll('[data-action]');
        for (var k = 0; k < btns.length; k++) {
          (function(btn) {
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              var action = btn.getAttribute('data-action');
              var id = btn.getAttribute('data-id');
              handleCardAction(action, id, btn);
            });
          })(btns[k]);
        }
      })(cards[j], j);
    }
  }

  // ===== CARD ACTIONS =====
  function handleCardAction(action, id, btn) {
    var prompt = findPromptById(id);
    if (!prompt) return;
    var lang = getLang();
    var text = prompt.text[lang] || prompt.text.en;

    if (action === 'fav') {
      toggleFavorite(id);
      var isFav = isFavorite(id);
      btn.classList.toggle('active', isFav);
      var icon = btn.querySelector('i');
      if (icon) icon.className = isFav ? 'fa fa-star' : 'fa fa-star-o';
    } else if (action === 'complete') {
      toggleCompleted(id);
      var isComp = isCompleted(id);
      btn.classList.toggle('active', isComp);
      var cIcon = btn.querySelector('i');
      if (cIcon) cIcon.className = isComp ? 'fa fa-check-square' : 'fa fa-check-square-o';
      var card = btn.closest('.prompt-card');
      if (card) card.classList.toggle('completed', isComp);
    } else if (action === 'copy') {
      copyToClipboard(text);
      showToast(getTrans('toast_copied') || 'Copied!');
    } else if (action === 'writer') {
      openInWriter(text);
    } else if (action === 'delete-custom') {
      deleteCustomPrompt(id);
      showToast(getTrans('toast_deleted') || 'Deleted');
    }
  }

  function findPromptById(id) {
    for (var i = 0; i < allPrompts.length; i++) {
      if (String(allPrompts[i].id) === String(id)) return allPrompts[i];
    }
    return null;
  }

  // ===== RANDOM PROMPT =====
  function showRandomPrompt() {
    var pool = getFilteredPrompts();
    if (pool.length === 0) {
      showToast(getTrans('prompter_no_results') || 'No prompts found');
      return;
    }
    var randomIdx = Math.floor(Math.random() * pool.length);
    currentRandomPrompt = pool[randomIdx];
    currentVariation = null;
    displayRandomPrompt(currentRandomPrompt);
  }

  function displayRandomPrompt(prompt) {
    if (!prompt || !randomDisplay) return;
    var lang = getLang();
    var cat = getCategoryById(prompt.category);
    var catName = cat ? (cat.name[lang] || cat.name.en) : prompt.category;
    var text = prompt.text[lang] || prompt.text.en;

    randomCategoryBadge.textContent = catName;
    randomText.textContent = text;

    // Render variations
    if (prompt.variations && prompt.variations.length > 0) {
      promptVariations.innerHTML = '';
      promptVariations.style.display = 'flex';

      // Base prompt option
      var baseBtn = document.createElement('button');
      baseBtn.className = 'variation-select active';
      baseBtn.textContent = (lang === 'el' ? 'Βασικό' : 'Base prompt');
      baseBtn.addEventListener('click', function() {
        currentVariation = null;
        randomText.textContent = text;
        promptVariations.querySelectorAll('.variation-select').forEach(function(b) { b.classList.remove('active'); });
        baseBtn.classList.add('active');
      });
      promptVariations.appendChild(baseBtn);

      for (var i = 0; i < prompt.variations.length; i++) {
        (function(v, idx) {
          var vBtn = document.createElement('button');
          vBtn.className = 'variation-select';
          var vText = v.text[lang] || v.text.en;
          vBtn.textContent = vText;
          vBtn.addEventListener('click', function() {
            currentVariation = v;
            randomText.textContent = text + ' ' + vText;
            promptVariations.querySelectorAll('.variation-select').forEach(function(b) { b.classList.remove('active'); });
            vBtn.classList.add('active');
          });
          promptVariations.appendChild(vBtn);
        })(prompt.variations[i], i);
      }
    } else {
      promptVariations.style.display = 'none';
      promptVariations.innerHTML = '';
    }

    randomDisplay.style.display = 'block';
    randomDisplay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===== COPY =====
  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(textarea);
  }

  // ===== OPEN IN WRITER =====
  function openInWriter(text) {
    localStorage.setItem('oros_prompter_to_writer', text);
    window.open('editor.html', '_blank');
  }

  // ===== EXPORT =====
  function exportPrompts() {
    var lang = getLang();
    var lines = [];
    lines.push('# orOS Prompter — Export');
    lines.push('# Date: ' + new Date().toISOString());
    lines.push('# Favorites: ' + favorites.length + ' | Completed: ' + completed.length);
    lines.push('');
    var toExport = getFilteredPrompts();
    for (var i = 0; i < toExport.length; i++) {
      var p = toExport[i];
      var cat = getCategoryById(p.category);
      var catName = cat ? (cat.name[lang] || cat.name.en) : p.category;
      var text = p.text[lang] || p.text.en;
      lines.push('## #' + p.id + ' — ' + catName);
      if (p.tags && p.tags.length) lines.push('Tags: ' + p.tags.join(', '));
      lines.push(text);
      if (isFavorite(p.id)) lines.push('[★ Favorite]');
      if (isCompleted(p.id)) lines.push('[✓ Completed]');
      lines.push('');
    }

    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'prompter-export-' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(getTrans('toast_exported') || 'Exported!');
  }

  // ===== STATS BAR =====
  function updateStatsBar() {
    if (completedCountEl) completedCountEl.textContent = completed.length;
    if (favoritesCountEl) favoritesCountEl.textContent = favorites.length;
    if (customCountEl) customCountEl.textContent = customPrompts.length;
    if (progressPercentEl) {
      var total = promptsData ? promptsData.prompts.length : 100;
      var pct = Math.round((completed.length / total) * 100);
      progressPercentEl.textContent = pct + '%';
    }
  }

  // ===== STATS DASHBOARD =====
  function renderStatsDashboard() {
    if (!statsDashboardContent || !promptsData) return;
    var lang = getLang();
    var total = promptsData.prompts.length;
    var catStats = {};
    for (var i = 0; i < promptsData.categories.length; i++) {
      catStats[promptsData.categories[i].id] = { total: 0, completed: 0, name: promptsData.categories[i].name[lang] || promptsData.categories[i].name.en };
    }
    for (var j = 0; j < promptsData.prompts.length; j++) {
      var cat = promptsData.prompts[j].category;
      if (catStats[cat]) {
        catStats[cat].total++;
        if (isCompleted(promptsData.prompts[j].id)) catStats[cat].completed++;
      }
    }

    var html = '';
    html += '<div class="stats-dashboard-card">';
    html += '<h4>' + (lang === 'el' ? 'Σύνοψη' : 'Overview') + '</h4>';
    html += '<div class="stats-dashboard-row"><span>' + (lang === 'el' ? 'Συνολικά' : 'Total') + '</span><span>' + total + '</span></div>';
    html += '<div class="stats-dashboard-row"><span>' + (lang === 'el' ? 'Ολοκληρωμένα' : 'Completed') + '</span><span>' + completed.length + '</span></div>';
    html += '<div class="stats-dashboard-row"><span>' + (lang === 'el' ? 'Αγαπημένα' : 'Favorites') + '</span><span>' + favorites.length + '</span></div>';
    html += '<div class="stats-dashboard-row"><span>' + (lang === 'el' ? 'Προσαρμοσμένα' : 'Custom') + '</span><span>' + customPrompts.length + '</span></div>';
    html += '<div class="progress-bar-container"><div class="progress-bar-fill" style="width:' + Math.round((completed.length / total) * 100) + '%"></div></div>';
    html += '</div>';

    html += '<div class="stats-dashboard-card">';
    html += '<h4>' + (lang === 'el' ? 'Ανά Κατηγορία' : 'By Category') + '</h4>';
    for (var key in catStats) {
      var s = catStats[key];
      var catPct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
      html += '<div class="stats-dashboard-row"><span>' + s.name + '</span><span>' + s.completed + '/' + s.total + ' (' + catPct + '%)</span></div>';
    }
    html += '</div>';

    statsDashboardContent.innerHTML = html;
  }

  // ===== CUSTOM PROMPT MODAL =====
  function populateCustomCategorySelect() {
    var sel = document.getElementById('custom-category');
    if (!sel || !promptsData) return;
    var lang = getLang();
    var html = '';
    for (var i = 0; i < promptsData.categories.length; i++) {
      var cat = promptsData.categories[i];
      html += '<option value="' + cat.id + '">' + (cat.name[lang] || cat.name.en) + '</option>';
    }
    sel.innerHTML = html;
  }

  function openCustomModal() {
    if (customModal) customModal.style.display = 'flex';
  }

  function closeCustomModal() {
    if (customModal) customModal.style.display = 'none';
  }

  // ===== MULTI PROMPT =====
  function openMultiModal() {
    if (!multiModal) return;
    multiModal.style.display = 'flex';
    multiSelected = [];
    renderMultiPromptList();
    updateMultiCount();
  }

  function closeMultiModal() {
    if (multiModal) multiModal.style.display = 'none';
  }

  function renderMultiPromptList() {
    var lang = getLang();
    var container = multiModal.querySelector('.modal-content');
    var existingList = container.querySelector('.multi-prompt-list');
    if (existingList) existingList.remove();

    var listDiv = document.createElement('div');
    listDiv.className = 'multi-prompt-list';

    var pool = getFilteredPrompts().slice(0, 30);
    for (var i = 0; i < pool.length; i++) {
      (function(p) {
        var item = document.createElement('div');
        item.className = 'multi-prompt-item';
        var text = p.text[lang] || p.text.en;
        item.innerHTML = '<input type="checkbox" data-id="' + p.id + '"><span class="multi-prompt-item-text">' + escapeHtml(text.substring(0, 120)) + (text.length > 120 ? '...' : '') + '</span>';
        var cb = item.querySelector('input');
        cb.addEventListener('change', function() {
          if (cb.checked && multiSelected.length < 3) {
            multiSelected.push(p.id);
          } else if (!cb.checked) {
            var idx = multiSelected.indexOf(p.id);
            if (idx !== -1) multiSelected.splice(idx, 1);
          } else {
            cb.checked = false;
          }
          updateMultiCount();
        });
        listDiv.appendChild(item);
      })(pool[i]);
    }

    var startBtn = document.getElementById('btn-start-session');
    if (startBtn) {
      startBtn.parentNode.insertBefore(listDiv, startBtn);
    }
  }

  function updateMultiCount() {
    var countEl = document.getElementById('multi-selected-count');
    var startBtn = document.getElementById('btn-start-session');
    if (countEl) countEl.textContent = multiSelected.length;
    if (startBtn) startBtn.disabled = multiSelected.length < 2;
  }

  function startMultiSession() {
    var lang = getLang();
    var texts = [];
    for (var i = 0; i < multiSelected.length; i++) {
      var p = findPromptById(multiSelected[i]);
      if (p) {
        var text = p.text[lang] || p.text.en;
        texts.push('### ' + (lang === 'el' ? 'Prompt' : 'Prompt') + ' ' + (i + 1) + '\n\n' + text);
      }
    }
    if (texts.length >= 2) {
      openInWriter(texts.join('\n\n---\n\n'));
      closeMultiModal();
    }
  }

  // ===== SPRINT TIMER =====
  function openSprintModal() {
    if (sprintModal) sprintModal.style.display = 'flex';
    sprintRemainingSeconds = sprintTotalSeconds;
    updateTimerDisplay();
  }

  function closeSprintModal() {
    if (sprintModal) sprintModal.style.display = 'none';
    stopSprintTimer();
  }

  function setSprintMinutes(minutes) {
    sprintTotalSeconds = minutes * 60;
    sprintRemainingSeconds = sprintTotalSeconds;
    updateTimerDisplay();
    var presets = sprintModal.querySelectorAll('.preset-btn');
    presets.forEach(function(b) { b.classList.remove('active'); });
    var activeBtn = sprintModal.querySelector('[data-minutes="' + minutes + '"]');
    if (activeBtn) activeBtn.classList.add('active');
  }

  function startSprintTimer() {
    if (sprintRunning) return;
    sprintRunning = true;
    document.getElementById('btn-timer-start').style.display = 'none';
    document.getElementById('btn-timer-stop').style.display = 'flex';
    sprintTimerInterval = setInterval(function() {
      sprintRemainingSeconds--;
      updateTimerDisplay();
      if (sprintRemainingSeconds <= 0) {
        stopSprintTimer();
        showToast(getTrans('sprint_finished') || 'Sprint complete!');
        var display = document.getElementById('sprint-timer-display');
        if (display) display.classList.add('finished');
      }
    }, 1000);
  }

  function stopSprintTimer() {
    sprintRunning = false;
    var startBtn = document.getElementById('btn-timer-start');
    var stopBtn = document.getElementById('btn-timer-stop');
    if (startBtn) startBtn.style.display = 'flex';
    if (stopBtn) stopBtn.style.display = 'none';
    if (sprintTimerInterval) {
      clearInterval(sprintTimerInterval);
      sprintTimerInterval = null;
    }
  }

  function resetSprintTimer() {
    stopSprintTimer();
    sprintRemainingSeconds = sprintTotalSeconds;
    updateTimerDisplay();
    var display = document.getElementById('sprint-timer-display');
    if (display) display.classList.remove('finished');
  }

  function updateTimerDisplay() {
    var minEl = document.getElementById('timer-minutes');
    var secEl = document.getElementById('timer-seconds');
    var m = Math.floor(sprintRemainingSeconds / 60);
    var s = sprintRemainingSeconds % 60;
    if (minEl) minEl.textContent = String(m).padStart(2, '0');
    if (secEl) secEl.textContent = String(s).padStart(2, '0');
  }

  function launchWriterWithTimer() {
    var promptText = '';
    if (currentRandomPrompt) {
      var lang = getLang();
      promptText = currentRandomPrompt.text[lang] || currentRandomPrompt.text.en;
    }
    if (promptText) {
      localStorage.setItem('oros_prompter_to_writer', promptText);
    }
    localStorage.setItem('oros_sprint_remaining', String(sprintRemainingSeconds));
    localStorage.setItem('oros_sprint_running', sprintRunning ? 'true' : 'false');
    window.open('editor.html', '_blank');
    closeSprintModal();
  }

  // ===== KEYBOARD NAVIGATION =====
  function navigateCards(direction) {
    var cards = promptsGrid.querySelectorAll('.prompt-card');
    if (cards.length === 0) return;
    if (keyboardFocusIndex === -1) {
      keyboardFocusIndex = direction > 0 ? 0 : cards.length - 1;
    } else {
      keyboardFocusIndex += direction;
      if (keyboardFocusIndex < 0) keyboardFocusIndex = cards.length - 1;
      if (keyboardFocusIndex >= cards.length) keyboardFocusIndex = 0;
    }
    cards[keyboardFocusIndex].focus();
    cards[keyboardFocusIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function activateFocusedCard() {
    var cards = promptsGrid.querySelectorAll('.prompt-card');
    if (keyboardFocusIndex >= 0 && keyboardFocusIndex < cards.length) {
      var card = cards[keyboardFocusIndex];
      var writerBtn = card.querySelector('[data-action="writer"]');
      if (writerBtn) writerBtn.click();
    }
  }

  // ===== KEYBOARD SHORTCUTS =====
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault(); showRandomPrompt();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      favoritesOnly = !favoritesOnly;
      if (favToggle) favToggle.classList.toggle('active', favoritesOnly);
      renderPrompts();
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      completedOnly = !completedOnly;
      if (completedToggle) completedToggle.classList.toggle('active', completedOnly);
      renderPrompts();
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault(); showDailyPrompt();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault(); openMultiModal();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); navigateCards(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); navigateCards(-1);
    } else if (e.key === 'Enter' && keyboardFocusIndex >= 0) {
      var focused = document.activeElement;
      if (focused && focused.classList.contains('prompt-card')) {
        e.preventDefault(); activateFocusedCard();
      }
    } else if (e.key === 'Escape') {
      if (sprintModal && sprintModal.style.display !== 'none') { closeSprintModal(); return; }
      if (customModal && customModal.style.display !== 'none') { closeCustomModal(); return; }
      if (multiModal && multiModal.style.display !== 'none') { closeMultiModal(); return; }
      if (randomDisplay && randomDisplay.style.display !== 'none') {
        randomDisplay.style.display = 'none';
        currentRandomPrompt = null;
      }
    }
  });

  // ===== EVENT LISTENERS =====
  if (dailyBtn) dailyBtn.addEventListener('click', showDailyPrompt);
  if (randomBtn) randomBtn.addEventListener('click', showRandomPrompt);
  if (btnReroll) btnReroll.addEventListener('click', showRandomPrompt);

  if (btnRandomCopy) btnRandomCopy.addEventListener('click', function() {
    if (!currentRandomPrompt) return;
    var lang = getLang();
    copyToClipboard(randomText.textContent);
    showToast(getTrans('toast_copied') || 'Copied!');
  });

  if (btnRandomComplete) btnRandomComplete.addEventListener('click', function() {
    if (!currentRandomPrompt) return;
    toggleCompleted(currentRandomPrompt.id);
    showToast(getTrans('toast_marked_complete') || 'Marked complete!');
  });

  if (btnRandomClose) btnRandomClose.addEventListener('click', function() {
    randomDisplay.style.display = 'none';
    currentRandomPrompt = null;
  });

  if (btnOpenInWriter) btnOpenInWriter.addEventListener('click', function() {
    if (!currentRandomPrompt) return;
    var lang = getLang();
    openInWriter(randomText.textContent);
  });

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      currentSearch = this.value;
      keyboardFocusIndex = -1;
      renderPrompts();
    });
  }

  if (favToggle) {
    favToggle.addEventListener('click', function() {
      favoritesOnly = !favoritesOnly;
      favToggle.classList.toggle('active', favoritesOnly);
      var icon = favToggle.querySelector('i');
      if (icon) icon.className = favoritesOnly ? 'fa fa-star' : 'fa fa-star-o';
      renderPrompts();
    });
  }

  if (completedToggle) {
    completedToggle.addEventListener('click', function() {
      completedOnly = !completedOnly;
      completedToggle.classList.toggle('active', completedOnly);
      var icon = completedToggle.querySelector('i');
      if (icon) icon.className = completedOnly ? 'fa fa-check-square' : 'fa fa-check-square-o';
      renderPrompts();
    });
  }

  if (showTagsBtn) {
    showTagsBtn.addEventListener('click', function() {
      tagsVisible = !tagsVisible;
      showTagsBtn.classList.toggle('active', tagsVisible);
      tagChips.style.display = tagsVisible ? 'flex' : 'none';
    });
  }

  if (exportBtn) exportBtn.addEventListener('click', exportPrompts);

  if (customBtn) customBtn.addEventListener('click', openCustomModal);
  if (document.getElementById('btn-close-custom')) {
    document.getElementById('btn-close-custom').addEventListener('click', closeCustomModal);
  }

  var customForm = document.getElementById('custom-prompt-form');
  if (customForm) {
    customForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var cat = document.getElementById('custom-category').value;
      var tags = document.getElementById('custom-tags').value;
      var en = document.getElementById('custom-en').value.trim();
      var el = document.getElementById('custom-el').value.trim();
      if (!en) return;
      addCustomPrompt(cat, tags, en, el);
      closeCustomModal();
      customForm.reset();
      showToast(getTrans('toast_custom_added') || 'Custom prompt added!');
    });
  }

  if (multiBtn) multiBtn.addEventListener('click', openMultiModal);
  if (document.getElementById('btn-close-multi')) {
    document.getElementById('btn-close-multi').addEventListener('click', closeMultiModal);
  }
  if (document.getElementById('btn-start-session')) {
    document.getElementById('btn-start-session').addEventListener('click', startMultiSession);
  }

  // Sprint timer events
  var presetBtns = sprintModal ? sprintModal.querySelectorAll('.preset-btn') : [];
  for (var pi = 0; pi < presetBtns.length; pi++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        setSprintMinutes(parseInt(btn.getAttribute('data-minutes')));
      });
    })(presetBtns[pi]);
  }
  if (document.getElementById('btn-timer-start')) {
    document.getElementById('btn-timer-start').addEventListener('click', startSprintTimer);
  }
  if (document.getElementById('btn-timer-stop')) {
    document.getElementById('btn-timer-stop').addEventListener('click', stopSprintTimer);
  }
  if (document.getElementById('btn-timer-reset')) {
    document.getElementById('btn-timer-reset').addEventListener('click', resetSprintTimer);
  }
  if (document.getElementById('btn-close-sprint')) {
    document.getElementById('btn-close-sprint').addEventListener('click', closeSprintModal);
  }
  if (document.getElementById('btn-launch-with-timer')) {
    document.getElementById('btn-launch-with-timer').addEventListener('click', launchWriterWithTimer);
  }

  // Modal overlay clicks
  if (sprintModal) sprintModal.addEventListener('click', function(e) { if (e.target === sprintModal) closeSprintModal(); });
  if (customModal) customModal.addEventListener('click', function(e) { if (e.target === customModal) closeCustomModal(); });
  if (multiModal) multiModal.addEventListener('click', function(e) { if (e.target === multiModal) closeMultiModal(); });

  // ===== LANGUAGE CHANGE =====
  window.addEventListener('oros-language-changed', function() {
    renderCategoryChips();
    renderTagChips();
    renderPrompts();
    if (currentRandomPrompt) displayRandomPrompt(currentRandomPrompt);
    updateStatsBar();
    renderStatsDashboard();
    populateCustomCategorySelect();
  });

    // ===== SETTINGS VISIBILITY =====
  function applySettingsVisibility() {
    var hideRandom = localStorage.getItem('oros_hide_random_btn') === 'true';
    var hideFilter = localStorage.getItem('oros_hide_filter_bar') === 'true';
    var hideFavToggle = localStorage.getItem('oros_hide_fav_toggle') === 'true';
    var hideCompletedToggle = localStorage.getItem('oros_hide_completed_toggle') === 'true';
    var hideDailyBtn = localStorage.getItem('oros_hide_daily_btn') === 'true';
    var hideCustomBtn = localStorage.getItem('oros_hide_custom_btn') === 'true';
    var hideMultiBtn = localStorage.getItem('oros_hide_multi_btn') === 'true';

    if (randomBtn) randomBtn.style.display = hideRandom ? 'none' : '';
    if (dailyBtn) dailyBtn.style.display = hideDailyBtn ? 'none' : '';
    if (customBtn) customBtn.style.display = hideCustomBtn ? 'none' : '';
    if (multiBtn) multiBtn.style.display = hideMultiBtn ? 'none' : '';
    if (favToggle) favToggle.style.display = hideFavToggle ? 'none' : '';
    if (completedToggle) completedToggle.style.display = hideCompletedToggle ? 'none' : '';

    var ctrlBar = document.querySelector('.prompter-controls');
    if (ctrlBar) {
      var allHidden = hideFavToggle && hideCompletedToggle &&
                      localStorage.getItem('oros_hide_filter_bar') === 'true';
      if (hideFilter) {
        var categoryRow = document.getElementById('category-chips');
        var tagRow = document.getElementById('tag-chips');
        var searchWrap = document.querySelector('.search-wrap');
        var showTagsBtnEl = document.getElementById('btn-show-tags');
        var exportBtnEl = document.getElementById('btn-export-prompts');
        if (categoryRow) categoryRow.style.display = 'none';
        if (tagRow) tagRow.style.display = 'none';
        if (searchWrap) searchWrap.style.display = 'none';
        if (showTagsBtnEl) showTagsBtnEl.style.display = 'none';
        if (exportBtnEl) exportBtnEl.style.display = 'none';
      }
    }
  }

  function setupSettingsToggles() {
    var toggles = [
      { id: 'toggle-hide-random-btn', key: 'oros_hide_random_btn' },
      { id: 'toggle-hide-filter-bar', key: 'oros_hide_filter_bar' },
      { id: 'toggle-hide-fav-toggle', key: 'oros_hide_fav_toggle' },
      { id: 'toggle-hide-completed-toggle', key: 'oros_hide_completed_toggle' },
      { id: 'toggle-hide-daily-btn', key: 'oros_hide_daily_btn' },
      { id: 'toggle-hide-custom-btn', key: 'oros_hide_custom_btn' },
      { id: 'toggle-hide-multi-btn', key: 'oros_hide_multi_btn' }
    ];

    for (var i = 0; i < toggles.length; i++) {
      (function(t) {
        var el = document.getElementById(t.id);
        if (!el) return;
        el.checked = localStorage.getItem(t.key) === 'true';
        el.addEventListener('change', function() {
          localStorage.setItem(t.key, el.checked ? 'true' : 'false');
          applySettingsVisibility();
        });
      })(toggles[i]);
    }
  }

  // ===== CLOSE WARNING =====
  window.addEventListener('beforeunload', function(e) {
    if (sprintRunning) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ===== INIT =====
  function init() {
    loadPrompts();
    applySettingsVisibility();
    setupSettingsToggles();

    // Auto-show daily prompt hint if not seen today
    if (!hasSeenDaily() && dailyBtn) {
      dailyBtn.classList.add('pulse-hint');
      setTimeout(function() {
        dailyBtn.classList.remove('pulse-hint');
      }, 4000);
    }

    // Listen for external language changes from main.js
    document.addEventListener('languageChanged', function() {
      window.dispatchEvent(new CustomEvent('oros-language-changed'));
    });
  }

  // ===== BOOTSTRAP =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();