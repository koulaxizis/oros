// ============================================
// orOS Characters — Character Designer
// COMPLETE VERSION v2.0: All features integrated
// - CRUD, Relationships, Grid View
// - Templates, Random Generator
// - Radar Chart, Comparison View
// - Drag-to-Reorder
// - Cross-app exports (Writer, Notes, Kanban)
// ============================================

(function() {
  'use strict';

  // ========== CONSTANTS ==========
  var STORAGE_KEY = 'oros_characters_data';
  var STORAGE_SETTINGS_PREFIX = 'oros_';
  var SHARED_WORKSPACE_KEY = 'oros_workspace';

  var AVATAR_COLORS = [
    '#c8a96e', '#e57373', '#81c784', '#64b5f6',
    '#ba68c8', '#ffb74d', '#4dd0e1', '#a1887f',
    '#90a4ae', '#f06292', '#4fc3f7', '#aed581'
  ];

  var DEFAULT_TRAITS = [
    { key: 'courage',      labelKey: 'trait_courage',      maxValue: 100 },
    { key: 'honesty',      labelKey: 'trait_honesty',      maxValue: 100 },
    { key: 'intelligence', labelKey: 'trait_intelligence', maxValue: 100 },
    { key: 'compassion',   labelKey: 'trait_compassion',   maxValue: 100 },
    { key: 'loyalty',      labelKey: 'trait_loyalty',      maxValue: 100 }
  ];

  var INVERSE_RELATIONSHIPS = {
    'friend': 'friend',
    'enemy': 'enemy',
    'father': 'child',
    'mother': 'child',
    'sibling': 'sibling',
    'lover': 'lover',
    'spouse': 'spouse',
    'mentor': 'mentor',
    'rival': 'rival',
    'ally': 'ally',
    'child': 'parent',
    'custom': 'custom'
  };

  var REL_COLORS = {
    friend:  '#66bb6a',
    enemy:   '#ef5350',
    father:  '#42a5f5',
    mother:  '#42a5f5',
    sibling: '#5c6bc0',
    lover:   '#ec407a',
    spouse:  '#ab47bc',
    mentor:  '#7e57c2',
    rival:   '#ff7043',
    ally:    '#26a69a',
    child:   '#5c6bc0',
    custom:  '#78909c'
  };

  var REL_ABBR = {
    friend:  'FR',
    enemy:   'EN',
    father:  'FA',
    mother:  'MO',
    sibling: 'SI',
    lover:   'LO',
    spouse:  'SP',
    mentor:  'ME',
    rival:   'RI',
    ally:    'AL',
    child:   'CH',
    custom:  'CU'
  };

  var REL_TYPES_ORDER = [
    'friend', 'enemy', 'father', 'mother', 'sibling',
    'lover', 'spouse', 'mentor', 'rival', 'ally', 'child', 'custom'
  ];

  // CHARACTER TEMPLATES
  var TEMPLATES = {
    hero: {
      role: 'protagonist',
      traits: { courage: 85, honesty: 75, intelligence: 65, compassion: 80, loyalty: 90 },
      tags: ['brave', 'selfless', 'honorable', 'determined'],
      arc: 'from insecurity/conflict to confidence/mastery',
      backstoryPlaceholder: 'Ordinary person called to adventure, faces trials, grows through challenges.',
      motivationPlaceholder: 'Protect others, fulfill destiny, achieve justice.'
    },
    villain: {
      role: 'antagonist',
      traits: { courage: 70, honesty: 10, intelligence: 90, compassion: 5, loyalty: 30 },
      tags: ['ruthless', 'ambitious', 'manipulative', 'charismatic'],
      arc: 'from wounded pride to tyranny/self-destruction',
      backstoryPlaceholder: 'Past trauma led to desire for power/control over others.',
      motivationPlaceholder: 'Gain ultimate power, prove superiority, destroy enemies.'
    },
    mentor: {
      role: 'supporting',
      traits: { courage: 60, honesty: 85, intelligence: 95, compassion: 80, loyalty: 85 },
      tags: ['wise', 'patient', 'enigmatic', 'experienced'],
      arc: 'helps protagonist while confronting own past regrets',
      backstoryPlaceholder: 'Former warrior/wizard who retired after great loss or failure.',
      motivationPlaceholder: 'Guide next generation, redeem past mistakes.'
    },
    trickster: {
      role: 'supporting',
      traits: { courage: 50, honesty: 15, intelligence: 85, compassion: 40, loyalty: 25 },
      tags: ['clever', 'unpredictable', 'humorous', 'mischievous'],
      arc: 'from selfish games to meaningful contribution',
      backstoryPlaceholder: 'Enjoys chaos and pranks, challenges conventions through mischief.',
      motivationPlaceholder: 'Have fun, outsmart others, expose hypocrisy.'
    },
    herald: {
      role: 'supporting',
      traits: { courage: 65, honesty: 90, intelligence: 60, compassion: 70, loyalty: 75 },
      tags: ['messenger', 'truth-teller', 'persistent', 'concerned'],
      arc: 'brings challenge, may sacrifice themselves for the cause',
      backstoryPlaceholder: 'Delivers crucial message that sets story in motion.',
      motivationPlaceholder: 'Ensure hero hears call, warn of danger.'
    },
    shadow: {
      role: 'antagonist',
      traits: { courage: 80, honesty: 50, intelligence: 75, compassion: 10, loyalty: 20 },
      tags: ['dark', 'vengeful', 'obsessed', 'powerful'],
      arc: 'mirror to hero representing path not taken',
      backstoryPlaceholder: 'Dark reflection of hero, represents what hero could become.',
      motivationPlaceholder: 'Destroy hero, claim what was lost.'
    }
  };

  // NAME POOLS FOR RANDOM GENERATOR
  var NAMES = {
    male: ['Ares', 'Apollo', 'Orion', 'Atlas', 'Hector', 'Achilles', 'Odysseus', 'Perseus', 'Theseus', 'Prometheus',
           'Liam', 'Noah', 'Oliver', 'Elijah', 'William', 'James', 'Benjamin', 'Lucas', 'Henry', 'Alexander'],
    female: ['Athena', 'Artemis', 'Hera', 'Aphrodite', 'Medusa', 'Helen', 'Penelope', 'Andromeda', ' Electra', 'Cassiopeia',
             'Emma', 'Olivia', 'Ava', 'Isabella', 'Sophia', 'Charlotte', 'Amelia', 'Mia', 'Harper', 'Evelyn'],
    unisex: ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Sam', 'Jamie', 'Charlie', 'Quinn'],
    fantasy: ['Zephyr', 'Lyra', 'Kael', 'Nyxx', 'Thorne', 'Elara', 'Draven', 'Seraphina', 'Aldric', 'Isla']
  };

  var OCCUPATIONS = ['warrior', 'mage', 'king', 'queen', 'blacksmith', 'merchant', 'bard', 'scholar',
                     'farmer', 'hunter', 'pirate', 'assassin', 'priestess', 'guardian', 'spy', 'healer'];

  var TAGS_POOL = ['brave', 'cowardly', 'wise', 'foolish', 'kind', 'cruel', 'generous', 'greedy',
                   'honest', 'dishonest', 'loyal', 'betraying', 'calm', 'temperamental',
                   'introverted', 'outgoing', 'stubborn', 'flexible', 'optimistic', 'pessimistic',
                   'honorable', 'dishonorable', 'righteous', 'corrupt', 'pure', 'tainted'];

  // ========== STATE ==========
  var state = {
    characters: [],
    relationships: [],
    activeCharId: null,
    searchQuery: '',
    currentView: 'detail',
    compareSelection: []
  };

  var gridTooltipEl = null;
  var dragSrcIndex = null;
  var radarChartCtx = null;

  // ========== HELPERS ==========
  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }

  function getTrans(key) {
    var lang = getCurrentLang();
    var t = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[lang]) || {};
    return t[key] || key;
  }

  function generateUUID() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  function generateRelUUID() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  }

  function getAvatarColor(name) {
    if (!name) return AVATAR_COLORS[0];
    var hash = 0;
    for (var i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function getInitial(name) {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  }

  function getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getCharById(id) {
    for (var i = 0; i < state.characters.length; i++) {
      if (state.characters[i].id === id) return state.characters[i];
    }
    return null;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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

  // ========== SHARED WORKSPACE ==========
  function getSharedWorkspace() {
    try {
      var raw = localStorage.getItem(SHARED_WORKSPACE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch(e) {}
    return { characterRefs: [], noteRefs: [], kanbanRefs: [] };
  }

  function setSharedWorkspace(data) {
    localStorage.setItem(SHARED_WORKSPACE_KEY, JSON.stringify(data));
  }

  function registerCharacterRef(charId) {
    var ws = getSharedWorkspace();
    if (ws.characterRefs.indexOf(charId) === -1) {
      ws.characterRefs.push(charId);
      setSharedWorkspace(ws);
    }
  }

  // ========== PERSISTENCE ==========
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state.characters = parsed.characters || [];
        state.relationships = parsed.relationships || [];
      }
    } catch(e) {
      state.characters = [];
      state.relationships = [];
    }

    // Load compare selection if persisted
    try {
      var saved = localStorage.getItem(STORAGE_SETTINGS_PREFIX + 'compare_selection');
      if (saved) {
        state.compareSelection = JSON.parse(saved);
      }
    } catch(e) {}
  }

  function saveData() {
    var data = {
      characters: state.characters,
      relationships: state.relationships
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function saveCompareSelection() {
    localStorage.setItem(STORAGE_SETTINGS_PREFIX + 'compare_selection', JSON.stringify(state.compareSelection));
  }

    // ========== CHARACTER CRUD ==========
  function createCharacter() {
    var char = {
      id: generateUUID(),
      name: '',
      role: 'supporting',
      age: '',
      gender: '',
      occupation: '',
      appearance: '',
      personalityTags: [],
      traits: {},
      backstory: '',
      motivations: '',
      goals: [],
      flaws: '',
      arc: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    for (var i = 0; i < DEFAULT_TRAITS.length; i++) {
      char.traits[DEFAULT_TRAITS[i].key] = 50;
    }
    state.characters.push(char);
    saveData();
    state.activeCharId = char.id;
    state.currentView = 'detail';
    registerCharacterRef(char.id);
    renderSidebar();
    renderDetail();
    var nameInput = document.getElementById('char-name-input');
    if (nameInput) setTimeout(function() { nameInput.focus(); }, 50);
  }

  function cloneCharacter(id) {
    var original = getCharById(id);
    if (!original) return;

    var cloned = JSON.parse(JSON.stringify(original));
    cloned.id = generateUUID();
    cloned.name = (original.name || 'Unnamed') + ' (copy)';
    cloned.created = new Date().toISOString();
    cloned.modified = new Date().toISOString();

    state.characters.push(cloned);
    saveData();
    registerCharacterRef(cloned.id);
    state.activeCharId = cloned.id;
    renderSidebar();
    renderDetail();
    showToast(getTrans('char_cloned') || 'Character cloned');
  }

  function deleteCharacter(id) {
    var char = getCharById(id);
    if (!char) return;

    var lang = getCurrentLang();
    var msg = lang === 'el'
      ? 'Σίγουρα ότι ο χαρακτήρας "' + (char.name || '?') + '" θα διαγραφεί;'
      : 'Are you sure character "' + (char.name || '?') + '" will be deleted?';

    if (!confirm(msg)) return;

    for (var i = state.characters.length - 1; i >= 0; i--) {
      if (state.characters[i].id === id) {
        state.characters.splice(i, 1);
        break;
      }
    }

    state.relationships = state.relationships.filter(function(r) {
      return r.from !== id && r.to !== id;
    });

    // Remove from compare selection
    state.compareSelection = state.compareSelection.filter(function(cid) {
      return cid !== id;
    });
    saveCompareSelection();

    saveData();

    if (state.characters.length > 0) {
      state.activeCharId = state.characters[0].id;
    } else {
      state.activeCharId = null;
    }

    renderSidebar();
    renderDetail();
    showToast(getTrans('char_deleted'));
  }

  function updateActiveCharacter(field, value) {
    var char = getCharById(state.activeCharId);
    if (!char) return;
    char[field] = value;
    char.modified = new Date().toISOString();
    saveData();
  }

  // ========== TEMPLATES ==========
  function applyTemplate(templateName) {
    var char = getCharById(state.activeCharId);
    if (!char) return;
    var tpl = TEMPLATES[templateName];
    if (!tpl) return;

    char.role = tpl.role;
    char.traits = {};
    for (var k in tpl.traits) {
      if (tpl.traits.hasOwnProperty(k)) {
        char.traits[k] = tpl.traits[k];
      }
    }
    char.personalityTags = tpl.tags.slice();
    char.arc = tpl.arc;
    if (!char.backstory) char.backstory = '';
    if (!char.motivations) char.motivations = '';
    char.modified = new Date().toISOString();
    saveData();

    renderDetail();
    renderRadarChart();
    renderSidebar();
    showToast(getTrans('char_template_applied') || 'Template applied');
  }

  // ========== RANDOM GENERATOR ==========
  function generateRandomCharacter() {
    var genderPool = Math.random() < 0.4 ? 'male' : (Math.random() < 0.67 ? 'female' : (Math.random() < 0.5 ? 'unisex' : 'fantasy'));
    var namePool = NAMES[genderPool];
    var name = getRandomElement(namePool);
    var roles = ['protagonist', 'antagonist', 'supporting', 'supporting', 'supporting', 'extra'];
    var role = getRandomElement(roles);
    var age = String(getRandomInt(17, 70));
    var occupation = getRandomElement(OCCUPATIONS);

    var char = {
      id: generateUUID(),
      name: name,
      role: role,
      age: age,
      gender: genderPool === 'male' ? 'Male' : (genderPool === 'female' ? 'Female' : 'Non-binary'),
      occupation: occupation,
      appearance: '',
      personalityTags: [],
      traits: {},
      backstory: '',
      motivations: '',
      goals: [],
      flaws: '',
      arc: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };

    // Randomized traits (±20 around 50)
    for (var i = 0; i < DEFAULT_TRAITS.length; i++) {
      var key = DEFAULT_TRAITS[i].key;
      char.traits[key] = getRandomInt(30, 80);
    }

    // 2-3 random tags
    var numTags = getRandomInt(2, 3);
    var tempTags = TAGS_POOL.slice();
    for (var t = 0; t < numTags; t++) {
      var idx = Math.floor(Math.random() * tempTags.length);
      char.personalityTags.push(tempTags[idx]);
      tempTags.splice(idx, 1);
    }

    state.characters.push(char);
    saveData();
    registerCharacterRef(char.id);
    state.activeCharId = char.id;
    state.currentView = 'detail';
    renderSidebar();
    renderDetail();
    showToast(getTrans('char_generated') || 'Random character created');
  }

  // ========== RENDERING — SIDEBAR ==========
  function renderSidebar() {
    var listEl = document.getElementById('char-list');
    if (!listEl) return;

    var query = state.searchQuery.toLowerCase();
    var filtered = state.characters.filter(function(c) {
      if (!query) return true;
      var name = (c.name || '').toLowerCase();
      var role = (c.role || '').toLowerCase();
      var occ = (c.occupation || '').toLowerCase();
      return name.indexOf(query) !== -1 ||
             role.indexOf(query) !== -1 ||
             occ.indexOf(query) !== -1;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">' +
        getTrans('char_empty_list') + '</div>';
      return;
    }

    listEl.innerHTML = '';
    var dragEnabled = isDragReorderEnabled();

    for (var i = 0; i < filtered.length; i++) {
      (function(char, index) {
        var item = document.createElement('div');
        item.className = 'char-item' + (char.id === state.activeCharId ? ' active' : '');
        if (dragEnabled) item.className += ' draggable';
        item.setAttribute('draggable', dragEnabled ? 'true' : 'false');
        item.setAttribute('data-char-id', char.id);
        item.setAttribute('data-index', index);

        var avatar = document.createElement('div');
        avatar.className = 'char-item-avatar';
        avatar.style.background = getAvatarColor(char.name);
        avatar.textContent = getInitial(char.name);

        var name = document.createElement('div');
        name.className = 'char-item-name';
        name.textContent = char.name || getTrans('char_unnamed');

        var roleBadge = document.createElement('span');
        roleBadge.className = 'char-item-role role-' + (char.role || 'supporting');
        roleBadge.textContent = getTrans('role_' + (char.role || 'supporting'));

        item.appendChild(avatar);
        item.appendChild(name);
        item.appendChild(roleBadge);

        item.addEventListener('click', function() {
          state.activeCharId = char.id;
          renderSidebar();
          renderDetail();
        });

        // Drag events
        if (dragEnabled) {
          item.addEventListener('dragstart', handleDragStart);
          item.addEventListener('dragover', handleDragOver);
          item.addEventListener('drop', handleDrop);
          item.addEventListener('dragend', handleDragEnd);
          item.addEventListener('dragleave', handleDragLeave);
        }

        listEl.appendChild(item);
      })(filtered[i], i);
    }
  }

  // ========== DRAG-TO-REORDER ==========
  function isDragReorderEnabled() {
    return localStorage.getItem('oros_drag_reorder') === 'true';
  }

  function handleDragStart(e) {
    dragSrcIndex = parseInt(e.currentTarget.getAttribute('data-index'), 10);
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.getAttribute('data-char-id'));
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drop-over');
  }

  function handleDragLeave(e) {
    e.currentTarget.classList.remove('drop-over');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drop-over');

    var srcId = e.dataTransfer.getData('text/plain');
    var destId = e.currentTarget.getAttribute('data-char-id');

    if (srcId === destId) return;

    var srcIdx = -1;
    var destIdx = -1;
    for (var i = 0; i < state.characters.length; i++) {
      if (state.characters[i].id === srcId) srcIdx = i;
      if (state.characters[i].id === destId) destIdx = i;
    }

    if (srcIdx === -1 || destIdx === -1 || srcIdx === destIdx) return;

    // Reorder
    var moved = state.characters[srcIdx];
    state.characters.splice(srcIdx, 1);
    state.characters.splice(destIdx, 0, moved);

    saveData();
    renderSidebar();
  }

  function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    var items = document.querySelectorAll('.char-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('drop-over');
    }
    dragSrcIndex = null;
  }

  // ========== RENDERING — DETAIL ==========
  function renderDetail() {
    var emptyState = document.getElementById('char-empty-state');
    var detailEl = document.getElementById('char-detail');
    var gridEl = document.getElementById('char-grid-view');
    var compareEl = document.getElementById('char-compare-view');
    var toggleBar = document.getElementById('view-toggle-bar');

    // No characters — empty state
    if (!state.activeCharId || state.characters.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      if (detailEl) detailEl.style.display = 'none';
      if (gridEl) gridEl.style.display = 'none';
      if (compareEl) compareEl.style.display = 'none';
      if (toggleBar) toggleBar.style.display = 'none';
      return;
    }

    var char = getCharById(state.activeCharId);
    if (!char) {
      state.activeCharId = null;
      renderDetail();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (toggleBar) toggleBar.style.display = 'flex';

    var btnDetail = document.getElementById('btn-view-detail');
    var btnGrid = document.getElementById('btn-view-grid');
    var btnCompare = toggleBar ? toggleBar.querySelector('#btn-view-compare') : null;

    // Hide all views first
    if (detailEl) detailEl.style.display = 'none';
    if (gridEl) gridEl.style.display = 'none';
    if (compareEl) compareEl.style.display = 'none';

    // Reset active states
    if (btnDetail) btnDetail.classList.remove('active');
    if (btnGrid) btnGrid.classList.remove('active');
    if (btnCompare) btnCompare.classList.remove('active');

    if (state.currentView === 'grid') {
      if (gridEl) gridEl.style.display = '';
      if (btnGrid) btnGrid.classList.add('active');
      renderRelationshipGrid();
    } else if (state.currentView === 'compare') {
      if (compareEl) compareEl.style.display = '';
      if (btnCompare) btnCompare.classList.add('active');
      renderComparisonView();
    } else {
      if (detailEl) detailEl.style.display = '';
      if (btnDetail) btnDetail.classList.add('active');
    }

    // Always populate detail fields (even if hidden)
    var avatarEl = document.getElementById('char-avatar');
    if (avatarEl) {
      avatarEl.style.background = getAvatarColor(char.name);
      avatarEl.textContent = getInitial(char.name);
    }

    setInputValue('char-name-input', char.name);
    setSelectValue('char-role', char.role);
    setInputValue('char-age', char.age);
    setInputValue('char-gender', char.gender);
    setInputValue('char-occupation', char.occupation);

    setTextareaValue('char-appearance', char.appearance);
    setTextareaValue('char-backstory', char.backstory);
    setTextareaValue('char-motivations', char.motivations);
    setTextareaValue('char-flaws', char.flaws);
    setTextareaValue('char-arc', char.arc);

    renderTags(char.personalityTags);
    renderTraits(char.traits);
    renderGoals(char.goals);
    renderRelationships();
    populateRelTargetSelect();

    // Radar chart
    renderRadarChart();
  }

  function setInputValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  function setSelectValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  function setTextareaValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  // ========== RADAR CHART ==========
  function renderRadarChart() {
    var canvas = document.getElementById('trait-radar-chart');
    if (!canvas) return;

    var showRadar = localStorage.getItem('oros_show_radar') !== 'false';
    if (!showRadar) {
      canvas.style.display = 'none';
      var section = canvas.closest('.char-section');
      if (section && !canvas.previousElementSibling) section.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';

    var char = getCharById(state.activeCharId);
    if (!char) return;

    var ctx = canvas.getContext('2d');
    var cx = canvas.width / 2;
    var cy = canvas.height / 2;
    var radius = Math.max(10, Math.min(cx, cy) - 30);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var numAxes = DEFAULT_TRAITS.length;
    var angleStep = (Math.PI * 2) / numAxes;

    // Draw grid rings
    ctx.strokeStyle = 'rgba(200,169,110,0.15)';
    ctx.lineWidth = 1;
    for (var ring = 1; ring <= 4; ring++) {
      var r = (radius / 4) * ring;
      ctx.beginPath();
      for (var a = 0; a <= numAxes; a++) {
        var angle = a * angleStep - Math.PI / 2;
        var x = cx + r * Math.cos(angle);
        var y = cy + r * Math.sin(angle);
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = 'rgba(200,169,110,0.2)';
    for (var ax = 0; ax < numAxes; ax++) {
      var ang = ax * angleStep - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + radius * Math.cos(ang), cy + radius * Math.sin(ang));
      ctx.stroke();
    }

    // Draw filled polygon
    ctx.fillStyle = 'rgba(200,169,110,0.2)';
    ctx.strokeStyle = '#c8a96e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var p = 0; p < numAxes; p++) {
      var traitKey = DEFAULT_TRAITS[p].key;
      var val = char.traits[traitKey] !== undefined ? char.traits[traitKey] : 50;
      var pct = val / 100;
      var pa = p * angleStep - Math.PI / 2;
      var px = cx + radius * pct * Math.cos(pa);
      var py = cy + radius * pct * Math.sin(pa);
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw vertices
    ctx.fillStyle = '#c8a96e';
    for (var v = 0; v < numAxes; v++) {
      var traitKey2 = DEFAULT_TRAITS[v].key;
      var val2 = char.traits[traitKey2] !== undefined ? char.traits[traitKey2] : 50;
      var pct2 = val2 / 100;
      var va = v * angleStep - Math.PI / 2;
      var vx = cx + radius * pct2 * Math.cos(va);
      var vy = cy + radius * pct2 * Math.sin(va);
      ctx.beginPath();
      ctx.arc(vx, vy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw labels
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '500 11px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var lb = 0; lb < numAxes; lb++) {
      var la = lb * angleStep - Math.PI / 2;
      var lx = cx + (radius + 15) * Math.cos(la);
      var ly = cy + (radius + 15) * Math.sin(la);
      ctx.fillText(getTrans(DEFAULT_TRAITS[lb].labelKey), lx, ly);
    }
  }

  // ========== RENDERING — TAGS ==========
  function renderTags(tags) {
    var container = document.getElementById('char-personality-tags');
    if (!container) return;
    container.innerHTML = '';

    if (!tags || tags.length === 0) return;

    for (var i = 0; i < tags.length; i++) {
      (function(tag, index) {
        var el = document.createElement('span');
        el.className = 'tag';
        el.innerHTML = escapeHtml(tag) +
          ' <span class="tag-remove" data-index="' + index + '">&times;</span>';

        el.querySelector('.tag-remove').addEventListener('click', function() {
          var char = getCharById(state.activeCharId);
          if (!char) return;
          char.personalityTags.splice(index, 1);
          char.modified = new Date().toISOString();
          saveData();
          renderTags(char.personalityTags);
        });

        container.appendChild(el);
      })(tags[i], i);
    }
  }

  function addTag() {
    var input = document.getElementById('char-tag-input');
    if (!input || !input.value.trim()) return;
    var char = getCharById(state.activeCharId);
    if (!char) return;
    if (!char.personalityTags) char.personalityTags = [];
    var tag = input.value.trim();
    if (char.personalityTags.indexOf(tag) !== -1) {
      showToast(getTrans('char_tag_exists'));
      return;
    }
    char.personalityTags.push(tag);
    char.modified = new Date().toISOString();
    saveData();
    input.value = '';
    renderTags(char.personalityTags);
  }

  // ========== RENDERING — TRAITS ==========
  function renderTraits(traits) {
    var container = document.getElementById('char-traits');
    if (!container) return;
    container.innerHTML = '';

    for (var i = 0; i < DEFAULT_TRAITS.length; i++) {
      (function(traitDef) {
        var value = traits[traitDef.key] !== undefined ? traits[traitDef.key] : 50;

        var row = document.createElement('div');
        row.className = 'trait-row';

        var labelRow = document.createElement('div');
        labelRow.style.display = 'flex';
        labelRow.style.justifyContent = 'space-between';
        labelRow.style.alignItems = 'center';

        var label = document.createElement('span');
        label.className = 'trait-label';
        label.textContent = getTrans(traitDef.labelKey);

        var valSpan = document.createElement('span');
        valSpan.className = 'trait-value';
        valSpan.textContent = value + '%';

        labelRow.appendChild(label);
        labelRow.appendChild(valSpan);

        var slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'trait-slider';
        slider.min = 0;
        slider.max = 100;
        slider.value = value;

        slider.addEventListener('input', function() {
          valSpan.textContent = slider.value + '%';
          var char = getCharById(state.activeCharId);
          if (char) {
            char.traits[traitDef.key] = parseInt(slider.value, 10);
            char.modified = new Date().toISOString();
            saveData();
            renderRadarChart();
          }
        });

        slider.addEventListener('dblclick', function() {
          slider.value = 50;
          valSpan.textContent = '50%';
          var char = getCharById(state.activeCharId);
          if (char) {
            char.traits[traitDef.key] = 50;
            char.modified = new Date().toISOString();
            saveData();
            renderRadarChart();
          }
        });

        row.appendChild(labelRow);
        row.appendChild(slider);
        container.appendChild(row);
      })(DEFAULT_TRAITS[i]);
    }
  }

  // ========== RENDERING — GOALS ==========
  function renderGoals(goals) {
    var container = document.getElementById('char-goals');
    if (!container) return;
    container.innerHTML = '';

    if (!goals || goals.length ===  0) return;

    for (var i = 0; i < goals.length; i++) {
      (function(goal, index) {
        var item = document.createElement('div');
        item.className = 'goal-item';

        var text = document.createElement('span');
        text.className = 'goal-item-text';
        text.textContent = goal;

        var removeBtn = document.createElement('button');
        removeBtn.className = 'goal-remove';
        removeBtn.innerHTML = '<i class="fa fa-times"></i>';
        removeBtn.addEventListener('click', function() {
          var char = getCharById(state.activeCharId);
          if (!char) return;
          char.goals.splice(index, 1);
          char.modified = new    Date().toISOString();
          saveData();
          renderGoals(char.goals);
        });

        item.appendChild(text);
        item.appendChild(removeBtn);
        container.appendChild(item);
      })(goals[i], i);
    }
  }

  function addGoal() {
    var input = document.getElementById('char-goal-input');
    if (!input || !input.value.trim()) return;
    var char = getCharById(state.activeCharId);
    if (!char) return;
    if (!char.goals) char.goals = [];
    char.goals.push(input.value.trim());
    char.modified = new Date().toISOString();
    saveData();
    input.value = '';
    renderGoals(char.goals);
  }

  // ========== RELATIONSHIPS ==========
  function populateRelTargetSelect() {
    var select = document.getElementById('rel-target-select');
    if (!select) return;
    select.innerHTML = '';

    for (var i = 0; i < state.characters.length; i++) {
      var char = state.characters[i];
      if (char.id === state.activeCharId) continue;
      var opt = document.createElement('option');
      opt.value = char.id;
      opt.textContent = char.name || getTrans('char_unnamed');
      select.appendChild(opt);
    }

    if (select.options.length === 0) {
      var emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = getTrans('char_no_others');
      emptyOpt.disabled = true;
      select.appendChild(emptyOpt);
    }
  }

  function renderRelationships() {
    var container = document.getElementById('char-relationships');
    if (!container) return;
    container.innerHTML = '';

    var rels = state.relationships.filter(function(r) {
      return r.from === state.activeCharId;
    });

    if (rels.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:8px;">' +
        getTrans('char_no_relationships') + '</div>';
      return;
    }

    for (var i = 0; i < rels.length; i++) {
      (function(rel) {
        var targetChar = getCharById(rel.to);
        var targetName = targetChar ? (targetChar.name || getTrans('char_unnamed')) : getTrans('char_deleted_char');

        var item = document.createElement('div');
        item.className = 'rel-item';

        var typeSpan = document.createElement('span');
        typeSpan.className = 'rel-type';
        typeSpan.textContent = getTrans('rel_' + rel.type);

        var nameSpan = document.createElement('span');
        nameSpan    .className = 'rel-char-name';
        nameSpan.textContent = targetName;
        nameSpan.style.cursor = 'pointer';
        nameSpan.addEventListener('click', function() {
          if (targetChar) {
            state.activeCharId = targetChar.id;
            renderSidebar();
            renderDetail();
          }
        });

        var notesSpan = document.createElement('span');
        notesSpan.className = 'rel-notes';
        notesSpan.textContent = rel.notes ? '\u00b7 ' + rel.notes : '';

        var removeBtn = document.createElement('button');
        removeBtn.className = 'rel-remove';
        removeBtn.innerHTML = '<i class="fa fa-times"></i>';
        removeBtn.addEventListener('click', function() {
          removeRelationship(rel.id);
        });

        item.appendChild(typeSpan);
        item.appendChild(document.createTextNode(': '));
        item.appendChild(nameSpan);
        if (rel.notes) item.appendChild(notesSpan);
        item.appendChild(removeBtn);
        container.appendChild(item);
      })(rels[i]);
    }
  }

  function addRelationship() {
    var targetSelect = document.getElementById('rel-target-select');
    var typeSelect = document.getElementById('rel-type-select');
    var notesInput = document.getElementById('rel-notes-input');

    if (!targetSelect || !targetSelect.value) {
      showToast(getTrans('char_select_target'));
      return;
    }

    var rel = {
      id: generateRelUUID(),
      from: state.activeCharId,
      to: targetSelect.value,
      type: typeSelect.value,
      notes: notesInput ? notesInput.value.trim() : ''
    };

    state.relationships.push(rel);

    // Bidirectional auto-link
    var inverseType = INVERSE_RELATIONSHIPS[rel.type] || 'custom';
    if (inverseType !== rel.type || rel.from !== rel.to) {
      var inverseRel = {
        id: generateRelUUID(),
        from: rel.to,
        to: rel.from,
        type: inverseType,
        notes: rel.notes
      };
      state.relationships.push(inverseRel);
    }

    saveData();

    if (targetSelect) targetSelect.value = '';
    if (notesInput) notesInput.value = '';
    if (typeSelect) typeSelect.selectedIndex = 0;

    renderRelationships();
    showToast(getTrans('char_rel_added'));
  }

  function removeRelationship(relId) {
    var rel = null;
    var relIndex = -1;
    for (var i = 0; i < state.relationships.length; i++) {
      if (state.relationships[i].id === relId) {
        rel = state.relationships[i];
        relIndex = i;
        break;
      }
    }
    if (!rel) return;

    state.relationships.splice(relIndex, 1);

    // Also remove the inverse relationship
    for (var j = state.relationships.length - 1; j >= 0; j--) {
      var r = state.relationships[j];
      if (r.from === rel.to && r.to === rel.from) {
        state.relationships.splice(j, 1);
        break;
      }
    }

    saveData();
    renderRelationships();
  }

  // ========== VIEW TOGGLE ==========
  function setView(view) {
    state.currentView = view;
    renderDetail();
  }

  // ========== RELATIONSHIP GRID ==========
  function renderRelationshipGrid() {
    var container = document.getElementById('char-grid-container');
    var legendEl = document.getElementById('char-grid-legend');
    var emptyEl = document.getElementById('char-grid-empty');
    if (!container) return;

    if (state.characters.length < 2) {
      container.innerHTML = '';
      if (legendEl) legendEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (legendEl) {
      legendEl.style.display = 'flex';
      renderLegend(legendEl);
    }

    var chars = state.characters;

    var relMap = {};
    for (var r = 0; r < state.relationships.length; r++) {
      var rel = state.relationships[r];
      if (!relMap[rel.from]) relMap[rel.from] = {};
      if (!relMap[rel.from][rel.to]) relMap[rel.from][rel.to] = [];
      relMap[rel.from][rel.to].push(rel);
    }

    var html = '<table class="rel-matrix"><thead><tr>';
    html += '<th class="corner-cell"></th>';
    for (var c = 0; c < chars.length; c++) {
      var ch = chars[c];
      var color = getAvatarColor(ch.name);
      var initial = getInitial(ch.name);
      var name = escapeHtml(ch.name || getTrans('char_unnamed'));
      html += '<th>' +
        '<div class="char-chip" data-char-id="' + ch.id + '">' +
        '<div class="char-chip-avatar" style="background:' + color + '">' + initial + '</div>' +
        '<span class="char-chip-name">' + name + '</span>' +
        '</div></th>';
    }
    html += '</tr></thead><tbody>';

    for (var row = 0; row < chars.length; row++) {
      var rowChar = chars[row];
      var rowColor = getAvatarColor(rowChar.name);
      var rowInitial = getInitial(rowChar.name);
      var rowName = escapeHtml(rowChar.name || getTrans('char_unnamed'));
      html += '<tr>';
      html += '<th><div class="row-char-name" data-char-id="' + rowChar.id + '">' +
        '<span class="row-avatar" style="background:' + rowColor + '">' + rowInitial + '</span>' +
        '<span>' + rowName + '</span></div></th>';

      for (var col = 0; col < chars.length; col++) {
        var colChar = chars[col];

        if (row === col) {
          html += '<td class="diag-cell"><span class="diag-mark">\u2014</span></td>';
          continue;
        }

        var rels = relMap[rowChar.id] && relMap[rowChar.id][colChar.id];
        if (!rels || rels.length === 0) {
          html += '<td class="empty-cell"></td>';
          continue;
        }

        var cellHtml = '<td class="rel-cell" data-from="' + rowChar.id + '" data-to="' + colChar.id + '">';
        for (var ri = 0; ri < rels.length; ri++) {
          var relType = rels[ri].type;
          var abbr = REL_ABBR[relType] || '??';
          var colorClass = 'rel-color-' + relType;
          cellHtml += '<span class="rel-badge ' + colorClass + '">' + abbr + '</span>';
          if (ri < rels.length - 1) cellHtml += ' ';
        }
        cellHtml += '</td>';
        html += cellHtml;
      }

      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;

    // Attach click handlers for character chips and row names
    var chips = container.querySelectorAll('.char-chip, .row-char-name');
    for (var ci = 0; ci < chips.length; ci++) {
      (function(chip) {
        chip.addEventListener('click', function() {
          var charId = chip.getAttribute('data-char-id');
          if (charId) {
            state.activeCharId = charId;
            state.currentView = 'detail';
            renderSidebar();
            renderDetail();
          }
        });
      })(chips[ci]);
    }

    // Attach tooltip + click for rel cells
    var relCells = container.querySelectorAll('.rel-cell');
    for (var rc = 0; rc < relCells.length; rc++) {
      (function(cell) {
        cell.addEventListener('mouseenter', showCellTooltip);
        cell.addEventListener('mouseleave', hideCellTooltip);
        cell.addEventListener('mousemove', moveCellTooltip);
        cell.addEventListener('click', function() {
          var fromId = cell.getAttribute('data-from');
          if (fromId) {
            state.activeCharId = fromId;
            state.currentView = 'detail';
            renderSidebar();
            renderDetail();
          }
        });
      })(relCells[rc]);
    }
  }

  function renderLegend(legendEl) {
    var html = '';
    for (var i = 0; i < REL_TYPES_ORDER.length; i++) {
      var t = REL_TYPES_ORDER[i];
      var color = REL_COLORS[t] || '#78909c';
      var label = getTrans('rel_' + t);
      var abbr = REL_ABBR[t] || '??';
      html += '<div class="legend-item">' +
        '<span class="legend-dot" style="background:' + color + '"></span>' +
        '<span>' + escapeHtml(label) + ' (' + abbr + ')</span>' +
        '</div>';
    }
    legendEl.innerHTML = html;
  }

  // ========== GRID TOOLTIP ==========
  function getOrCreateTooltip() {
    if (gridTooltipEl) return gridTooltipEl;
    gridTooltipEl = document.createElement('div');
    gridTooltipEl.className = 'grid-tooltip';
    document.body.appendChild(gridTooltipEl);
    return gridTooltipEl;
  }

  function showCellTooltip(e) {
    var cell = e.currentTarget;
    var fromId = cell.getAttribute('data-from');
    var toId = cell.getAttribute('data-to');
    if (!fromId || !toId) return;

    var fromChar = getCharById(fromId);
    var toChar = getCharById(toId);
    if (!fromChar || !toChar) return;

    var rels = state.relationships.filter(function(r) {
      return r.from === fromId && r.to === toId;
    });
    if (rels.length === 0) return;

    var tt = getOrCreateTooltip();
    var html = '<span class="tt-from">' + escapeHtml(fromChar.name || getTrans('char_unnamed')) + '</span>' +
               '<span class="tt-arrow">\u2192</span>' +
               '<span class="tt-to">' + escapeHtml(toChar.name || getTrans('char_unnamed')) + '</span>';

    for (var i = 0; i < rels.length; i++) {
      var relType = rels[i].type;
      var color = REL_COLORS[relType] || '#78909c';
      html += '<br><span class="tt-type" style="background:' + color + '">' +
              escapeHtml(getTrans('rel_' + relType)) + '</span>';
      if (rels[i].notes) {
        html += '<span class="tt-notes">' + escapeHtml(rels[i].notes) + '</span>';
      }
    }

    tt.innerHTML = html;
    tt.classList.add('visible');
    moveCellTooltip(e);
  }

  function moveCellTooltip(e) {
    if (!gridTooltipEl || !gridTooltipEl.classList.contains('visible')) return;
    var x = e.clientX + 12;
    var y = e.clientY + 12;
    var ttRect = gridTooltipEl.getBoundingClientRect();
    if (x + ttRect.width > window.innerWidth) x = e.clientX - ttRect.width - 12;
    if (y + ttRect.height > window.innerHeight) y = e.clientY - ttRect.height - 12;
    gridTooltipEl.style.left = x + 'px';
    gridTooltipEl.style.top = y + 'px';
  }

  function hideCellTooltip() {
    if (gridTooltipEl) gridTooltipEl.classList.remove('visible');
  }

  // ========== COMPARISON VIEW ==========
  function renderComparisonView() {
    var chipsContainer = document.getElementById('compare-chips');
    var emptyEl = document.getElementById('compare-empty');
    var contentEl = document.getElementById('compare-content');

    if (!chipsContainer) return;

    // Render selected chips
    chipsContainer.innerHTML = '';
    for (var i = 0; i < state.compareSelection.length; i++) {
      (function(charId) {
        var char = getCharById(charId);
        if (!char) return;

        var chip = document.createElement('span');
        chip.className = 'compare-chip';
        chip.innerHTML = escapeHtml(char.name || getTrans('char_unnamed')) +
          ' <span class="compare-chip-remove" data-id="' + charId + '">&times;</span>';

        chip.querySelector('.compare-chip-remove').addEventListener('click', function() {
          state.compareSelection = state.compareSelection.filter(function(id) {
            return id !== charId;
          });
          saveCompareSelection();
          renderComparisonView();
        });

        chipsContainer.appendChild(chip);
      })(state.compareSelection[i]);
    }

    // Add a "+" button to open the selector modal
    if (state.compareSelection.length < 4) {
      var addBtn = document.createElement('button');
      addBtn.className = 'btn-secondary';
      addBtn.style.padding = '6px 12px';
      addBtn.style.fontSize = '13px';
      addBtn.innerHTML = '<i class="fa fa-plus"></i> ' + getTrans('compare_add');
      addBtn.addEventListener('click', openCompareModal);
      chipsContainer.appendChild(addBtn);
    }

    if (state.compareSelection.length < 2) {
      if (emptyEl) emptyEl.style.display = 'flex';
      if (contentEl) contentEl.style.display = 'none';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (contentEl) contentEl.style.display = '';

    renderCompareTraitsTable();
    renderCompareBasicTable();
    renderCompareGoalsTable();
  }

  function renderCompareTraitsTable() {
    var container = document.getElementById('compare-traits-table');
    if (!container) return;

    var html = '<table class="compare-table"><thead><tr><th>Trait</th>';
    for (var i = 0; i < state.compareSelection.length; i++) {
      var ch = getCharById(state.compareSelection[i]);
      if (!ch) continue;
      html += '<th>' + escapeHtml(ch.name || getTrans('char_unnamed')) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var t = 0; t < DEFAULT_TRAITS.length; t++) {
      html += '<tr><td>' + getTrans(DEFAULT_TRAITS[t].labelKey) + '</td>';
      for (var c = 0; c < state.compareSelection.length; c++) {
        var char = getCharById(state.compareSelection[c]);
        if (!char) { html += '<td class="trait-val">—</td>'; continue; }
        var val = char.traits[DEFAULT_TRAITS[t].key] !== undefined ? char.traits[DEFAULT_TRAITS[t].key] : 50;
        var fillWidth = val;
        html += '<td class="trait-val">' +
          '<span class="compare-trait-barchart"><span class="compare-trait-fill" style="width:' + fillWidth + '%"></span></span>' +
          val + '%</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderCompareBasicTable() {
    var container = document.getElementById('compare-basic-table');
    if (!container) return;

    var fields = [
      { label: getTrans('char_role'), key: 'role', isRole: true },
      { label: getTrans('char_age'), key: 'age' },
      { label: getTrans('char_gender'), key: 'gender' },
      { label: getTrans('char_occupation'), key: 'occupation' }
    ];

    var html = '<table class="compare-table"><thead><tr><th>Field</th>';
    for (var i = 0; i < state.compareSelection.length; i++) {
      var ch = getCharById(state.compareSelection[i]);
      if (!ch) continue;
      html += '<th>' + escapeHtml(ch.name || getTrans('char_unnamed')) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var f = 0; f < fields.length; f++) {
      html += '<tr><td>' + fields[f].label + '</td>';
      for (var c = 0; c < state.compareSelection.length; c++) {
        var char = getCharById(state.compareSelection[c]);
        if (!char) { html += '<td>—</td>'; continue; }
        var val = char[fields[f].key] || '';
        if (fields[f].isRole) val = getTrans('role_' + (val || 'supporting'));
        html += '<td>' + escapeHtml(String(val)) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderCompareGoalsTable() {
    var container = document.getElementById('compare-goals-table');
    if (!container) return;

    var html = '<table class="compare-table"><thead><tr><th>Goals</th>';
    for (var i = 0; i < state.compareSelection.length; i++) {
      var ch = getCharById(state.compareSelection[i]);
      if (!ch) continue;
      html += '<th>' + escapeHtml(ch.name || getTrans('char_unnamed')) + '</th>';
    }
    html += '</tr></thead><tbody><tr><td style="vertical-align:top;">&nbsp;</td>';

    for (var c = 0; c < state.compareSelection.length; c++) {
      var char = getCharById(state.compareSelection[c]);
      if (!char) { html += '<td>—</td>'; continue; }
      var goals = char.goals || [];
      var goalsHtml = goals.length > 0
        ? '<ul style="margin:0;padding-left:18px;">' + goals.map(function(g) { return '<li>' + escapeHtml(g) + '</li>'; }).join('') + '</ul>'
        : '<span style="color:var(--text-muted);">—</span>';
      html += '<td>' + goalsHtml + '</td>';
    }
    html += '</tr></tbody></table>';
    container.innerHTML = html;
  }

  // ========== COMPARE MODAL ==========
  function openCompareModal() {
    var modal = document.getElementById('compare-modal');
    var listEl = document.getElementById('compare-char-list');
    if (!modal || !listEl) return;

    listEl.innerHTML = '';

    for (var i = 0; i < state.characters.length; i++) {
      (function(char) {
        var isSelected = state.compareSelection.indexOf(char.id) !== -1;

        var item = document.createElement('div');
        item.className = 'compare-char-item' + (isSelected ? ' selected' : '');

        var avatar = document.createElement('div');
        avatar.className = 'char-item-avatar';
        avatar.style.background = getAvatarColor(char.name);
        avatar.textContent = getInitial(char.name);
        avatar.style.marginRight = '0';

        var name = document.createElement('div');
        name.className = 'char-item-name';
        name.style.flex = '1';
        name.textContent = char.name || getTrans('char_unnamed');

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'compare-char-checkbox';
        checkbox.checked = isSelected;
        checkbox.setAttribute('data-char-id', char.id);

        checkbox.addEventListener('change', function() {
          if (this.checked) {
            if (state.compareSelection.length >= 4) {
              this.checked = false;
              showToast(getTrans('compare_max_hint'));
              return;
            }
            if (state.compareSelection.indexOf(char.id) === -1) {
              state.compareSelection.push(char.id);
            }
          } else {
            state.compareSelection = state.compareSelection.filter(function(id) {
              return id !== char.id;
            });
          }
          saveCompareSelection();
        });

        item.appendChild(checkbox);
        item.appendChild(avatar);
        item.appendChild(name);

        item.addEventListener('click', function(e) {
          if (e.target !== checkbox) {
            checkbox.checked = !checkbox.checked;
            var evt = new Event('change');
            checkbox.dispatchEvent(evt);
          }
          if (checkbox.checked) {
            item.classList.add('selected');
          } else {
            item.classList.remove('selected');
          }
        });

        listEl.appendChild(item);
      })(state.characters[i]);
    }

    modal.style.display = 'flex';
  }

  function closeCompareModal() {
    var modal = document.getElementById('compare-modal');
    if (modal) modal.style.display = 'none';
  }

  function clearComparison() {
    state.compareSelection = [];
    saveCompareSelection();
    renderComparisonView();
    closeCompareModal();
  }

  // ========== CROSS-APP EXPORTS ==========
  function sendToWriter() {
    var char = getCharById(state.activeCharId);
    if (!char) return;

    var content = buildCharacterRichText(char);
    localStorage.setItem('oros_writer_incoming', content);
    localStorage.setItem('oros_writer_incoming_title', (char.name || 'Character') + ' — Character Sheet');

    var lang = getCurrentLang();
    var msg = lang === 'el'
      ? 'Το προφίλ στάλθηκε στον Writer. Άνοιξε το Writer για να το δεις.'
      : 'Profile sent to Writer. Open Writer to view it.';
    showToast(msg);
  }

  function buildCharacterRichText(char) {
    var lines = [];
    lines.push('# ' + (char.name || 'Unnamed Character'));
    lines.push('');
    lines.push('**Role:** ' + getTrans('role_' + char.role));
    if (char.age) lines.push('**Age:** ' + char.age);
    if (char.gender) lines.push('**Gender:** ' + char.gender);
    if (char.occupation) lines.push('**Occupation:** ' + char.occupation);
    lines.push('');

    if (char.appearance) {
      lines.push('## Appearance');
      lines.push(char.appearance);
      lines.push('');
    }
    if (char.personalityTags && char.personalityTags.length > 0) {
      lines.push('## Personality Tags');
      lines.push(char.personalityTags.join(', '));
      lines.push('');
    }
    if (char.traits) {
      lines.push('## Traits');
      for (var i = 0; i < DEFAULT_TRAITS.length; i++) {
        var td = DEFAULT_TRAITS[i];
        var val = char.traits[td.key] !== undefined ? char.traits[td.key] : 50;
        lines.push('- ' + getTrans(td.labelKey) + ': ' + val + '%');
      }
      lines.push('');
    }
    if (char.backstory) {
      lines.push('## Backstory');
      lines.push(char.backstory);
      lines.push('');
    }
    if (char.motivations) {
      lines.push('## Motivations');
      lines.push(char.motivations);
      lines.push('');
    }
    if (char.goals && char.goals.length > 0) {
      lines.push('## Goals');
      for (var g = 0; g < char.goals.length; g++) {
        lines.push('- ' + char.goals[g]);
      }
      lines.push('');
    }
    if (char.flaws) {
      lines.push('## Flaws');
      lines.push(char.flaws);
      lines.push('');
    }
    if (char.arc) {
      lines.push('## Character Arc');
      lines.push(char.arc);
      lines.push('');
    }

    var rels = state.relationships.filter(function(r) { return r.from === char.id; });
    if (rels.length > 0) {
      lines.push('## Relationships');
      for (var r = 0; r < rels.length; r++) {
        var target = getCharById(rels[r].to);
        var targetName = target ? (target.name || 'Unnamed') : 'Unknown';
        lines.push('- **' + getTrans('rel_' + rels[r].type) + ':** ' + targetName +
          (rels[r].notes ? ' — ' + rels[r].notes : ''));
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  function sendToNotes() {
    var char = getCharById(state.activeCharId);
    if (!char) return;

    // Build note content with wikilinks to related characters
    var content = buildCharacterMarkdown(char);

    // Convert related character names to wikilinks
    var rels = state.relationships.filter(function(r) { return r.from === char.id; });
    for (var i = 0; i < rels.length; i++) {
      var target = getCharById(rels[i].to);
      if (target && target.name) {
        var regex = new RegExp('\\b' + target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
        content = content.replace(regex, '[[' + target.name + ']]');
      }
    }

    var noteData = {
      title: (char.name || 'Unnamed') + ' — Character Profile',
      content: content,
      tags: ['character', char.role || 'supporting'],
      folder: 'Characters',
      source: 'characters-app',
      timestamp: new Date().toISOString()
    };

    var existingNotes = [];
    try {
      var raw = localStorage.getItem('oros_notes_incoming');
      if (raw) existingNotes = JSON.parse(raw);
    } catch(e) {}

    existingNotes.push(noteData);
    localStorage.setItem('oros_notes_incoming', JSON.stringify(existingNotes));

    var lang = getCurrentLang();
    var msg = lang === 'el'
      ? 'Το προφίλ εξήχθη στο Notes. Άνοιξε το Notes για να το δεις.'
      : 'Profile exported to Notes. Open Notes to view it.';
    showToast(msg);
  }

  function sendToKanban() {
    if (state.characters.length === 0) {
      showToast(getTrans('char_no_export'));
      return;
    }

    var columns = [
      { id: 'col_intro', title: 'To Introduce', cards: [] },
      { id: 'col_active', title: 'Active', cards: [] },
      { id: 'col_develop', title: 'Development', cards: [] },
      { id: 'col_climax', title: 'Climax', cards: [] },
      { id: 'col_resolve', title: 'Resolution', cards: [] }
    ];

    for (var i = 0; i < state.characters.length; i++) {
      var char = state.characters[i];
      var card = {
        id: 'card_' + char.id,
        title: char.name || 'Unnamed',
        description: getTrans('role_' + (char.role || 'supporting')),
        labels: [],
        meta: {
          source: 'characters-app',
          characterId: char.id,
          arc: char.arc || '',
          goals: char.goals || []
        }
      };

      // Distribute based on role
      if (char.role === 'protagonist') {
        columns[1].cards.push(card); // Active
      } else if (char.role === 'antagonist') {
        columns[2].cards.push(card); // Development
      } else {
        columns[0].cards.push(card); // To Introduce
      }
    }

    var boardData = {
      title: 'Story Board — Characters',
      columns: columns,
      source: 'characters-app',
      timestamp: new Date().toISOString()
    };

    localStorage.setItem('oros_kanban_incoming', JSON.stringify(boardData));

    var lang = getCurrentLang();
    var msg = lang === 'el'
      ? 'Το Story Board δημιουργήθηκε. Άνοιξε το Kanban για να το δεις.'
      : 'Story Board created. Open Kanban to view it.';
    showToast(msg);
  }

  // ========== EXPORT ==========
  function exportCharacter(format) {
    var char = getCharById(state.activeCharId);
    if (!char) return;

    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var safeName = (char.name || 'character').replace(/[^a-z0-9]/gi, '_').toLowerCase();

    if (format === 'json') {
      var data = {
        character: char,
        relationships: state.relationships.filter(function(r) {
          return r.from === char.id || r.to === char.id;
        }),
        relatedCharacters: {}
      };

      var rels = data.relationships;
      for (var i = 0; i < rels.length; i++) {
        var otherId = rels[i].from === char.id ? rels[i].to : rels[i].from;
        if (!data.relatedCharacters[otherId]) {
          var other = getCharById(otherId);
          data.relatedCharacters[otherId] = other ? other.name : 'Unknown';
        }
      }

      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      triggerDownload(blob, safeName + '_' + timestamp + '.json');
      showToast(getTrans('toast_downloaded') || 'File downloaded');
    } else if (format === 'md') {
      var md = buildCharacterMarkdown(char);
      var blob2 = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      triggerDownload(blob2, safeName + '_' + timestamp + '.md');
      showToast(getTrans('toast_downloaded') || 'File downloaded');
    }
  }

  function buildCharacterMarkdown(char) {
    var md = '# ' + (char.name || 'Unnamed Character') + '\n\n';

    md += '**' + getTrans('char_role') + ':** ' + getTrans('role_' + char.role) + '\n';
    if (char.age) md += '**' + getTrans('char_age') + ':** ' + char.age + '\n';
    if (char.gender) md += '**' + getTrans('char_gender') + ':** ' + char.gender + '\n';
    if (char.occupation) md += '**' + getTrans('char_occupation') + ':** ' + char.occupation + '\n';
    md += '\n';

    if (char.appearance) {
      md += '## ' + getTrans('char_appearance') + '\n\n' + char.appearance + '\n\n';
    }
    if (char.personalityTags && char.personalityTags.length > 0) {
      md += '## ' + getTrans('char_personality_tags') + '\n\n';
      md += char.personalityTags.map(function(t) { return '`' + t + '`'; }).join(' ');
      md += '\n\n';
    }
    if (char.traits) {
      md += '## ' + getTrans('char_traits') + '\n\n';
      for (var i = 0; i < DEFAULT_TRAITS.length; i++) {
        var td = DEFAULT_TRAITS[i];
        var val = char.traits[td.key] !== undefined ? char.traits[td.key] : 50;
        md += '- **' + getTrans(td.labelKey) + ':** ' + val + '%\n';
      }
      md += '\n';
    }
    if (char.backstory) {
      md += '## ' + getTrans('char_backstory') + '\n\n' + char.backstory + '\n\n';
    }
    if (char.motivations) {
      md += '## ' + getTrans('char_motivations') + '\n\n' + char.motivations + '\n\n';
    }
    if (char.goals && char.goals.length > 4) {
      md += '## ' + getTrans('char_goals') + '\n\n';
      for (var g = 0; g < char.goals.length; g++) {
        md += '- ' + char.goals[g] + '\n';
      }
      md += '\n';
    }
    if (char.flaws) {
      md += '## ' + getTrans('char_flaws') + '\n\n' + char.flaws + '\n\n';
    }
    if (char.arc) {
      md += '## ' + getTrans('char_arc') + '\n\n' + char.arc + '\n\n';
    }

    var rels = state.relationships.filter(function(r) { return r.from === char.id; });
    if (rels.length > 0) {
      md += '## ' + getTrans('char_relationships') + '\n\n';
      for (var r = 0; r < rels.length; r++) {
        var target = getCharById(rels[r].to);
        var targetName = target ? (target.name || 'Unnamed') : 'Unknown';
        md += '- **' + getTrans('rel_' + rels[r].type) + ':** ' + targetName;
        if (rels[r].notes) md += ' \u2014 ' + rels[r].notes;
        md += '\n';
      }
      md += '\n';
    }

    return md;
  }

  function exportAll() {
    if (state.characters.length === 0) {
      showToast(getTrans('char_no_export'));
      return;
    }

    var data = {
      characters: state.characters,
      relationships: state.relationships,
      exportedAt: new Date().toISOString()
    };

    var json = JSON.stringify(data, null, 2);
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var blob = new Blob([json], { type: ' 'application/json;charset=utf-8' });
    triggerDownload(blob, 'oros_characters_' + timestamp + '.json');
    showToast(getTrans('toast_downloaded') || 'File downloaded');
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ========== IMPORT ==========
  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);

        if (Array.isArray(data.characters)) {
          var existingIds = {};
          for (var i = 0; i < state.characters.length; i++) {
            existingIds[state.characters[i].id] = true;
          }

          for (var c = 0; c < data.characters.length; c++) {
            if (!existingIds[data.characters[c].id]) {
              state.characters.push(data.characters[c]);
            }
          }

          if (Array.isArray(data.relationships)) {
            var existingRelIds = {};
            for (var r = 0; r < state.relationships.length; r++) {
              existingRelIds[state.relationships[r].id] = true;
            }
            for (var rr = 0; rr < data.relationships.length; rr++) {
              if (!existingRelIds[data.relationships[rr].id]) {
                state.relationships.push(data.relationships[rr]);
              }
            }
          }

          saveData();
          renderSidebar();
          if (state.characters.length > 0 && !state.activeCharId) {
            state.activeCharId = state.characters[0].id;
          }
          renderDetail();
          showToast(getTrans('char_imported'));
        } else if (data.character) {
          var newChar = data.character;
          newChar.id = generateUUID();
          newChar.created = new Date().toISOString();
          newChar.modified = new Date().toISOString();
          state.characters.push(newChar);
          saveData();
          renderSidebar();
          state.activeCharId = newChar.id;
          renderDetail();
          showToast(getTrans('char_imported'));
        } else {
          showToast(getTrans('char_invalid_file'));
        }
      } catch(err) {
        showToast(getTrans('char_invalid_file'));
      }
    };
    reader.onerror = function() {
      showToast(getTrans('char_invalid_file'));
    };
    reader.readAsText(file);
  }

  // ========== EVENT LISTENERS ==========

  // New character buttons
  var btnNewChar = document.getElementById('btn-new-char');
  if (btnNewChar) btnNewChar.addEventListener('click', createCharacter);

  var btnCreateFirst = document.getElementById('btn-create-first-char');
  if (btnCreateFirst) btnCreateFirst.addEventListener('click', createCharacter);

  // Random character button
  var btnRandom = document.getElementById('btn-generate-random');
  if (btnRandom) btnRandom.addEventListener('click', generateRandomCharacter);

  // Clone character
  var btnClone = document.getElementById('btn-clone-char');
  if (btnClone) btnClone.addEventListener('click', function() {
    if (state.activeCharId) cloneCharacter(state.activeCharId);
  });

  // Delete character
  var btnDeleteChar = document.getElementById('btn-delete-char');
  if (btnDeleteChar) btnDeleteChar.addEventListener('click', function() {
    if (state.activeCharId) deleteCharacter(state.activeCharId);
  });

  // Search
  var searchInput = document.getElementById('char-search');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      state.searchQuery = this.value;
      renderSidebar();
    });
  }

  // Name input — live update avatar + sidebar
  var nameInput = document.getElementById('char-name-input');
  if (nameInput) {
    var nameDebounce = null;
    nameInput.addEventListener('input', function() {
      var value = this.value;
      var char = getCharById(state.activeCharId);
      if (!char) return;
      char.name = value;
      char.modified = new Date().toISOString();
      saveData();

      var avatarEl = document.getElementById('char-avatar');
      if (avatarEl) {
        avatarEl.style.background = getAvatarColor(value);
        avatarEl.textContent = getInitial(value);
      }

      clearTimeout(nameDebounce);
      nameDebounce = setTimeout(renderSidebar, 300);
    });
  }

  // Role select
  var roleSelect = document.getElementById('char-role');
  if (roleSelect) {
    roleSelect.addEventListener('change', function() {
      updateActiveCharacter('role', this.value);
      renderSidebar();
    });
  }

  // Basic text inputs
  var basicFields = ['char-age', 'char-gender', 'char-occupation'];
  for (var bi = 0; bi < basicFields.length; bi++) {
    (function(fieldId, dataField) {
      var el = document.getElementById(fieldId);
      if (el) {
        var debounce = null;
        el.addEventListener('input', function() {
          var self = this;
          clearTimeout(debounce);
          debounce = setTimeout(function() {
            updateActiveCharacter(dataField, self.value);
          }, 400);
        });
      }
    })(basicFields[bi], basicFields[bi].replace('char-', ''));
  }

  // Textareas
  var textareaFields = [
    { id: 'char-appearance',   field: 'appearance' },
    { id: 'char-backstory',    field: 'backstory' },
    { id: 'char-motivations',  field: 'motivations' },
    { id: 'char-flaws',        field: 'flaws' },
    { id: 'char-arc',          field: 'arc' }
  ];
  for (var ti = 0; ti < textareaFields.length; ti++) {
    (function(item) {
      var el = document.getElementById(item.id);
      if (el) {
        var debounce = null;
        el.addEventListener('input', function() {
          var self = this;
          clearTimeout(debounce);
          debounce = setTimeout(function() {
            updateActiveCharacter(item.field, self.value);
          }, 500);
        });
      }
    })(textareaFields[ti]);
  }

  // Tag input
  var tagInput = document.getElementById('char-tag-input');
  if (tagInput) {
    tagInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
    });
  }
  var btnAddTag = document.getElementById('btn-add-tag');
  if (btnAddTag) btnAddTag.addEventListener('click', addTag);

  // Goal input
  var goalInput = document.getElementById('char-goal-input');
  if (goalInput) {
    goalInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addGoal();
      }
    });
  }
  var btnAddGoal = document.getElementById('btn-add-goal');
  if (btnAddGoal) btnAddGoal.addEventListener('click', addGoal);

  // Relationship add
  var btnAddRel = document.getElementById('btn-add-relationship');
  if (btnAddRel) btnAddRel.addEventListener('click', addRelationship);

  var relNotesInput = document.getElementById('rel-notes-input');
  if (relNotesInput) {
    relNotesInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addRelationship();
      }
    });
  }

  // Template dropdown
  var btnApplyTemplate = document.getElementById('btn-apply-template');
  var templateDropdown = document.getElementById('template-dropdown');
  if (btnApplyTemplate && templateDropdown) {
    btnApplyTemplate.addEventListener('click', function(e) {
      e.stopPropagation();
      templateDropdown.classList.toggle('visible');
    });
    document.addEventListener('click', function() {
      templateDropdown.classList.remove('visible');
    });
    var tplBtns = templateDropdown.querySelectorAll('button');
    for (var tpI = 0; tpI < tplBtns.length; tpI++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var tplName = btn.getAttribute('data-template');
          applyTemplate(tplName);
          templateDropdown.classList.remove('visible');
        });
      })(tplBtns[tpI]);
    }
  }

  // Export dropdown (including cross-app actions)
  var btnExportChar = document.getElementById('btn-export-char');
  var charExportDropdown = document.getElementById('char-export-dropdown');
  if (btnExportChar && charExportDropdown) {
    btnExportChar.addEventListener('click', function(e) {
      e.stopPropagation();
      charExportDropdown.classList.toggle('visible');
    });
    document.addEventListener('click', function() {
      charExportDropdown.classList.remove('visible');
    });
    var expBtns = charExportDropdown.querySelectorAll('button');
    for (var ei = 0; ei < expBtns.length; ei++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var fmt = btn.getAttribute('data-format');
          var action = btn.getAttribute('data-action');
          if (fmt) {
            exportCharacter(fmt);
          } else if (action === 'send-writer') {
            sendToWriter();
          } else if (action === 'send-notes') {
            sendToNotes();
          } else if (action === 'send-kanban') {
            sendToKanban();
          }
          charExportDropdown.classList.remove('visible');
        });
      })(expBtns[ei]);
    }
  }

  // Export all
  var btnExportAll = document.getElementById('btn-export-all');
  if (btnExportAll) btnExportAll.addEventListener('click', exportAll);

  // Import
  var btnImportChar = document.getElementById('btn-import-char');
  var charFileInput = document.getElementById('char-file-input');
  if (btnImportChar && charFileInput) {
    btnImportChar.addEventListener('click', function() {
      charFileInput.click();
    });
    charFileInput.addEventListener('change', function() {
      if (this.files && this.files[0]) {
        importJSON(this.files[0]);
        this.value = '';
      }
    });
  }

  // View toggle
  var btnViewDetail = document.getElementById('btn-view-detail');
  if (btnViewDetail) btnViewDetail.addEventListener('click', function() { setView('detail'); });

  var btnViewGrid = document.getElementById('btn-view-grid');
  if (btnViewGrid) btnViewGrid.addEventListener('click', function() { setView('grid'); });

  var btnViewCompare = document.getElementById('btn-view-compare');
  if (btnViewCompare) btnViewCompare.addEventListener('click', function() { setView('compare'); });

  // Compare modal
  var btnClearCompare = document.getElementById('btn-clear-compare');
  if (btnClearCompare) btnClearCompare.addEventListener('click', clearComparison);

  var btnStartCompare = document.getElementById('btn-start-compare');
  if (btnStartCompare) btnStartCompare.addEventListener('click', function() {
    closeCompareModal();
    renderComparisonView();
  });

  var compareModalClose = document.querySelector('#compare-modal .modal-close');
  if (compareModalClose) compareModalClose.addEventListener('click', closeCompareModal);

  var compareModalOverlay = document.getElementById('compare-modal');
  if (compareModalOverlay) {
    compareModalOverlay.addEventListener('click', function(e) {
      if (e.target === compareModalOverlay) closeCompareModal();
    });
  }

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', function(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = (tag === 'input' || tag === 'textarea' || tag === 'select');

    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      createCharacter();
    }
    else if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      exportAll();
    }
    else if (e.key === 'Escape') {
      if (charExportDropdown) charExportDropdown.classList.remove('visible');
      if (templateDropdown) templateDropdown.classList.remove('visible');
      hideCellTooltip();
      var modal = document.getElementById('compare-modal');
      if (modal && modal.style.display !== 'none') closeCompareModal();
    }
  });

  // ========== LANGUAGE CHANGE ==========
  window.addEventListener('oros-language-changed', function() {
    renderSidebar();
    renderDetail();
  });

  // ========== SETTINGS TOGGLES ==========
  var charToggles = [
    { id: 'toggle-hide-new-char-btn',   key: 'oros_hide_new_char_btn',   element: 'btn-new-char' },
    { id: 'toggle-hide-char-export-btn', key: 'oros_hide_char_export_btn', element: 'btn-export-all' },
    { id: 'toggle-hide-char-import-btn', key: 'oros_hide_char_import_btn', element: 'btn-import-char' },
    { id: 'toggle-hide-char-search',    key: 'oros_hide_char_search',    element: 'char-search' },
    { id: 'toggle-show-radar',          key: 'oros_show_radar',          element: null, isFlag: true },
    { id: 'toggle-drag-reorder',        key: 'oros_drag_reorder',        element: null, isFlag: true }
  ];

  charToggles.forEach(function(toggle) {
    var el = document.getElementById(toggle.id);
    if (el) {
      // For flag toggles, default to enabled
      if (toggle.isFlag && toggle.id === 'toggle-show-radar') {
        el.checked = localStorage.getItem(toggle.key) !== 'false';
      } else if (toggle.isFlag) {
        el.checked = localStorage.getItem(toggle.key) === 'true';
      } else {
        el.checked = localStorage.getItem(toggle.key) === 'true';
      }

      el.addEventListener('change', function() {
        var checked = this.checked;
        localStorage.setItem(toggle.key, checked ? 'true' : 'false');

        if (toggle.element) {
          var target = document.getElementById(toggle.element);
          if (target) target.style.display = checked ? '' : 'none';
        } else if (toggle.id === 'toggle-show-radar') {
          renderDetail();
        } else if (toggle.id === 'toggle-drag-reorder') {
          renderSidebar();
        }
      });
    }
  });

  // ========== VISIBILITY INIT ==========
  charToggles.forEach(function(toggle) {
    var el = document.getElementById(toggle.id);
    if (el) {
      if (!toggle.isFlag && el.checked) {
        var target = document.getElementById(toggle.element);
        if (target) target.style.display = 'none';
      }
    }
  });

  // ========== INITIALIZE ==========
  loadData();
  if (state.characters.length > 0) {
    state.activeCharId = state.characters[0].id;
  }
  renderSidebar();
  renderDetail();

})();