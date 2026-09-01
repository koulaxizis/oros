/* ============================================
   orOS Kanban — Main Application Logic (v2.3)
   Full implementation matching editor/converter pattern
   ============================================ */

(function() {
  'use strict';

  // ===== GLOBAL STATE =====
  let boards = {};
  let currentBoardId = null;
  let columns = [];
  let cards = [];
  let labels = [];
  let assignments = [];
  let columnOrder = [];
  let archivedCards = [];
  let showArchived = false;
  let searchQuery = '';
  let activeFilters = [];
  let draggedCard = null;
  let draggedColumn = null;
  let editedCard = null;
  let cardModalOpen = false;
  let autoSaveEnabled = true;
  let saveTimeout = null;
  let isBeta = typeof OROS_CONFIG !== 'undefined' && OROS_CONFIG.isBeta;
  let autoSaveInterval = null;

  // ===== INITIALIZATION =====
  document.addEventListener('DOMContentLoaded', function() {
    console.log('orOS Kanban initializing (v2.3)...');

    // Wait for translations to load
    waitForTranslations().then(() => {
      initApp();
    }).catch(err => {
      console.error('Translation load failed:', err);
      initApp();
    });
  });

  function waitForTranslations(maxWait = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = setInterval(() => {
        if (window.OROS_TRANSLATIONS || document.querySelector('body[data-translations-loaded]')) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - startTime > maxWait) {
          clearInterval(check);
          resolve(); // Continue anyway with fallbacks
        }
      }, 50);
    });
  }

  function initApp() {
    try {
      loadFromStorage();
      setupEventListeners();
      setupThemeToggle();
      renderBoards();
      setupPWA();
      setupKeyboardShortcuts();

      // Auto-save every 30 seconds if enabled
      if (autoSaveEnabled) {
        startAutoSave();
      }

      console.log('orOS Kanban initialized (v2.3)');
    } catch (err) {
      console.error('Initialization error:', err);
      showErrorToast('Failed to initialize. Try clearing localStorage.');
    }
  }

  // ===== TRANSLATIONS HELPER =====
  function getTrans(key, fallback = '') {
    if (!window.OROS_TRANSLATIONS) return fallback;
    const val = window.OROS_TRANSLATIONS[key];
    return val === undefined || val === null ? fallback : val;
  }

  // ===== STORAGE =====
  function getStorageKey() {
    return 'oros-kanban-' + (isBeta ? 'beta-' : '');
  }

  function saveToStorage() {
    if (!currentBoardId) return;

    const data = {
      boards,
      currentBoardId,
      labels,
      assignments,
      autoSaveEnabled,
      settings: {
        hideAddColumnBtn: document.getElementById('toggle-hide-add-column-btn')?.checked || false,
        hideImportBtn: document.getElementById('toggle-hide-import-btn')?.checked || false,
        hideExportBtn: document.getElementById('toggle-hide-export-btn')?.checked || false
      }
    };

    try {
      localStorage.setItem(getStorageKey() + 'data', JSON.stringify(data));
      scheduleAutoSave();
    } catch (err) {
      console.error('Storage save failed:', err);
      showErrorToast('Save failed - storage full?');
    }
  }

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(getStorageKey() + 'data');
      if (stored) {
        const data = JSON.parse(stored);
        boards = data.boards || {};
        currentBoardId = data.currentBoardId || null;
        labels = data.labels || [];
        assignments = data.assignments || [];
        autoSaveEnabled = data.autoSaveEnabled !== false;
        
        if (data.settings) {
          updateSettingsUI(data.settings);
        }
      }

      // Initialize default board if none exist
      if (Object.keys(boards).length === 0) {
        createDefaultBoard();
      }

      // Load current board
      if (currentBoardId && boards[currentBoardId]) {
        loadBoard(currentBoardId);
      } else if (Object.keys(boards).length > 0) {
        currentBoardId = Object.keys(boards)[0];
        loadBoard(currentBoardId);
      }

      // Update UI
      updateCurrentBoardName();
      toggleSettingsVisibility();
    } catch (err) {
      console.error('Load failed:', err);
      createDefaultBoard();
    }
  }

  function createDefaultBoard() {
    const defaultBoardId = 'default-' + Date.now();
    boards[defaultBoardId] = {
      id: defaultBoardId,
      name: 'My First Board',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    columns = [
      { id: 'col-1', title: 'To Do', cardIds: [], order: [] },
      { id: 'col-2', title: 'In Progress', cardIds: [], order: [] },
      { id: 'col-3', title: 'Done', cardIds: [], order: [] }
    ];

    columnOrder = ['col-1', 'col-2', 'col-3'];
    cards = [];
    archivedCards = [];
    currentBoardId = defaultBoardId;

    saveToStorage();
    renderColumns();
    showNotification('Welcome! Create your first board.');
  }

  function loadBoard(boardId) {
    const board = boards[boardId];
    if (!board) {
      console.error('Board not found:', boardId);
      return;
    }

    currentBoardId = boardId;

    // Load board-specific data
    const boardData = localStorage.getItem(getStorageKey() + 'board-' + boardId);
    if (boardData) {
      try {
        const data = JSON.parse(boardData);
        columns = data.columns || [];
        cards = data.cards || [];
        columnOrder = data.columnOrder || [];
        archivedCards = data.archivedCards || [];
      } catch (err) {
        console.error('Board parse error:', err);
        resetBoardToDefaults();
      }
    } else {
      resetBoardToDefaults();
    }

        updateCurrentBoardName();
    renderColumns();
    updateFilterDropdown();
  }

  function resetBoardToDefaults() {
    columns = [
      { id: 'col-' + Date.now(), title: 'To Do', cardIds: [], order: [] },
      { id: 'col-' + (Date.now()+1), title: 'Doing', cardIds: [], order: [] },
      { id: 'col-' + (Date.now()+2), title: 'Done', cardIds: [], order: [] }
    ];
    columnOrder = columns.map(c => c.id);
    cards = [];
    archivedCards = [];
    saveBoardToStorage();
  }

  function saveBoardToStorage() {
    if (!currentBoardId) return;

    const boardData = {
      columns,
      cards,
      columnOrder,
      archivedCards,
      updatedAt: Date.now()
    };

    try {
      localStorage.setItem(getStorageKey() + 'board-' + currentBoardId, JSON.stringify(boardData));
      boards[currentBoardId].updatedAt = Date.now();
      saveToStorage();
    } catch (err) {
      console.error('Board save failed:', err);
    }
  }

  // ===== RENDERING =====
  function updateCurrentBoardName() {
    const el = document.getElementById('current-board-name');
    if (el && currentBoardId && boards[currentBoardId]) {
      el.textContent = boards[currentBoardId].name || getTrans('BOARD_UNNAMED', 'Unnamed Board');
    }
  }

  function renderBoards() {
    const listEl = document.querySelector('.board-list-items');
    if (!listEl) return;

    listEl.innerHTML = '';

    const boardIds = Object.keys(boards).sort((a, b) => 
      (boards[b]?.updatedAt || 0) - (boards[a]?.updatedAt || 0)
    );

    if (boardIds.length === 0) {
      listEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px;">No boards yet</div>';
      return;
    }

    boardIds.forEach(id => {
      const board = boards[id];
      const item = document.createElement('div');
      item.className = 'board-list-item' + (id === currentBoardId ? ' active' : '');
      item.dataset.boardId = id;

      const cardCount = getBoardCardCount(id);

      item.innerHTML = `
        <i class="fa fa-folder-open" style="color:var(--accent-gold);font-size:14px;"></i>
        <span class="board-list-item-name">${escapeHtml(board.name)}</span>
        <span class="board-list-item-count">${cardCount}</span>
        <div class="board-list-item-controls">
          <button class="board-reorder-btn" data-action="reorder" title="${getTrans('REORDER', 'Reorder')}">
            <i class="fa fa-arrows"></i>
          </button>
          <button class="board-rename-btn" data-action="rename" title="${getTrans('RENAME', 'Rename')}">
            <i class="fa fa-pencil"></i>
          </button>
          <button class="board-list-item-delete" data-action="delete" title="${getTrans('DELETE', 'Delete')}">
            <i class="fa fa-trash"></i>
          </button>
        </div>
      `;

      // Click to switch board
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.board-list-item-controls')) {
          switchBoard(id);
        }
      });

      // Control buttons
      item.querySelectorAll('.board-reorder-btn, .board-rename-btn, .board-list-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'rename') renameBoard(id);
          if (action === 'delete') deleteBoard(id);
          if (action === 'reorder') reorderBoards();
        });
      });

      listEl.appendChild(item);
    });
  }

  function getBoardCardCount(boardId) {
    const boardData = localStorage.getItem(getStorageKey() + 'board-' + boardId);
    if (!boardData) return 0;
    try {
      const data = JSON.parse(boardData);
      return (data.cards || []).length;
    } catch {
      return 0;
    }
  }

  function renderColumns() {
    const container = document.getElementById('kanban-columns');
    const emptyState = document.getElementById('kanban-empty-state');
    
    if (!container) return;

    // Show/hide empty state
    if (columns.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      container.innerHTML = '';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = '';

    columnOrder.forEach(colId => {
      const col = columns.find(c => c.id === colId);
      if (!col) return;

      const colEl = createColumnElement(col);
      container.appendChild(colEl);
    });

    // Add column placeholder
    const addPlaceholder = document.createElement('div');
    addPlaceholder.className = 'add-column-placeholder';
    addPlaceholder.innerHTML = '<i class="fa fa-plus"></i> ' + getTrans('ADD_COLUMN', 'Add Column');
    addPlaceholder.addEventListener('click', addNewColumn);
    container.appendChild(addPlaceholder);

    updateCardCounts();
  }

  function createColumnElement(column) {
    const el = document.createElement('div');
    el.className = 'kanban-column';
    el.dataset.columnId = column.id;

    // Get filtered cards for this column
    const visibleCardIds = column.cardIds.filter(cardId => {
      const card = cards.find(c => c.id === cardId);
      if (!card) return false;
      if (card.archived && !showArchived) return false;
      if (searchQuery && !matchesSearch(card)) return false;
      if (activeFilters.length > 0 && !matchesFilters(card)) return false;
      return true;
    });

    el.innerHTML = `
      <div class="column-header" draggable="true">
        <span class="column-title" data-col-id="${column.id}">${escapeHtml(column.title)}</span>
        <span class="column-card-count">${visibleCardIds.length}</span>
        <div class="column-actions">
          <button class="column-action-btn edit" title="${getTrans('EDIT', 'Edit')}">
            <i class="fa fa-pencil"></i>
          </button>
          <button class="column-action-btn delete" title="${getTrans('DELETE', 'Delete')}">
            <i class="fa fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="column-cards"></div>
      <div class="column-add-card">
        <button class="btn-add-card">
          <i class="fa fa-plus"></i> ${getTrans('ADD_CARD', 'Add Card')}
        </button>
      </div>
    `;

    // Column header drag
    const header = el.querySelector('.column-header');
    header.addEventListener('dragstart', handleColumnDragStart);
    header.addEventListener('dragend', handleColumnDragEnd);
    header.addEventListener('dragover', handleColumnDragOver);
    header.addEventListener('drop', handleColumnDrop);

    // Column title edit (double-click)
    const titleEl = el.querySelector('.column-title');
    titleEl.addEventListener('dblclick', () => editColumnTitle(column.id));

    // Column action buttons
    el.querySelector('.column-action-btn.edit').addEventListener('click', () => editColumnTitle(column.id));
    el.querySelector('.column-action-btn.delete').addEventListener('click', () => deleteColumn(column.id));

    // Cards container
    const cardsContainer = el.querySelector('.column-cards');
    cardsContainer.dataset.columnId = column.id;
    cardsContainer.addEventListener('dragover', handleCardDragOver);
    cardsContainer.addEventListener('drop', handleCardDrop);
    cardsContainer.addEventListener('dragenter', (e) => {
      e.preventDefault();
      cardsContainer.classList.add('drop-target');
    });
    cardsContainer.addEventListener('dragleave', (e) => {
      if (!cardsContainer.contains(e.relatedTarget)) {
        cardsContainer.classList.remove('drop-target');
      }
    });

    // Render cards
    visibleCardIds.forEach(cardId => {
      const card = cards.find(c => c.id === cardId);
      if (card) {
        const cardEl = createCardElement(card);
        cardsContainer.appendChild(cardEl);
      }
    });

    // Add card button
    el.querySelector('.btn-add-card').addEventListener('click', () => openAddCardForm(column.id));

    return el;
  }

  function createCardElement(card) {
    const el = document.createElement('div');
    el.className = 'kanban-card';
    el.dataset.cardId = card.id;

    if (card.color) {
      el.classList.add('has-color');
      el.style.setProperty('--card-color', card.color);
    }
    if (card.archived) {
      el.classList.add('archived');
    }

    // Priority badge
    let priorityBadge = '';
    if (card.priority && card.priority > 0) {
      const priorityClass = card.priority === 1 ? 'p1' : card.priority === 2 ? 'p2' : 'p3';
      const priorityText = card.priority === 1 ? getTrans('LOW', 'Low') : card.priority === 2 ? getTrans('MEDIUM', 'Medium') : getTrans('HIGH', 'High');
      priorityBadge = `<span class="card-priority-badge ${priorityClass}" title="${getTrans('PRIORITY_' + card.priority, priorityText)}">${card.priority}</span>`;
    }

    // Due date
    let dueDateDisplay = '';
    if (card.dueDate) {
      const due = new Date(card.dueDate);
      const today = new Date();
      today.setHours(0,0,0,0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const classes = ['card-due-date'];
      let icon = 'fa-calendar-o';
      let text = formatDate(due);
      
      if (due < today) {
        classes.push('overdue');
        icon = 'fa-exclamation-triangle';
        text = getTrans('OVERDUE', 'Overdue');
      } else if (due.toDateString() === today.toDateString()) {
        classes.push('today');
        icon = 'fa-bell';
        text = getTrans('TODAY', 'Today');
      }
      
      dueDateDisplay = `<div class="${classes.join(' ')}"><i class="fa ${icon}"></i> ${text}</div>`;
    }

    // Subtasks
    let subtaskIndicator = '';
    if (card.subtasks && card.subtasks.length > 0) {
      const completed = card.subtasks.filter(s => s.completed).length;
      const total = card.subtasks.length;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      subtaskIndicator = `
        <div class="card-subtask-indicator">
          <i class="fa fa-check-square-o"></i> ${completed}/${total}
          <div class="subtask-progress-bar"><div class="subtask-progress-fill" style="width:${percent}%"></div></div>
        </div>
      `;
    }

    // Labels
    let labelsHTML = '';
    if (card.labels && card.labels.length > 0) {
      const labelObjs = card.labels.map(lid => labels.find(l => l.id === lid)).filter(Boolean);
      labelsHTML = '<div class="card-labels">' + labelObjs.map(l => 
        `<span class="card-label" style="background:${l.color||'#6d4aff'}">${escapeHtml(l.name)}</span>`
      ).join('') + '</div>';
    }

    // Assignments preview
    let assignmentsHTML = '';
    if (card.assignments && card.assignments.length > 0) {
      const assignmentObjs = card.assignments.slice(0, 2).map(a => {
        const assg = assignments.find(x => x.id === a);
        return assg ? `${assg.type}: ${assg.value}` : '';
      }).filter(Boolean);
      if (assignmentObjs.length > 0) {
        assignmentsHTML = `<div class="card-assignments"><div class="card-assignment"><span class="assignment-type">Info:</span><span class="assignment-value">${assignmentObjs.join(', ')}</span></div></div>`;
      }
    }

    el.innerHTML = `
      <div class="card-body-content">
        ${priorityBadge}
        <div class="card-title">${escapeHtml(card.title)}</div>
        ${card.description ? `<div class="card-description-indicator"><i class="fa fa-align-left"></i> ${getTrans('HAS_DESC', 'Has description')}</div>` : ''}
        ${dueDateDisplay}
        ${subtaskIndicator}
        ${labelsHTML}
        ${assignmentsHTML}
      </div>
    `;

    // Click to edit
    el.addEventListener('click', () => openCardModal(card.id));

    // Drag
    el.addEventListener('dragstart', (e) => handleCardDragStart(e, card.id));
    el.addEventListener('dragend', handleCardDragEnd);

    return el;
  }

  function updateCardCounts() {
    document.querySelectorAll('.column-card-count').forEach(el => {
      const colEl = el.closest('.kanban-column');
      if (colEl) {
        const colId = colEl.dataset.columnId;
        const col = columns.find(c => c.id === colId);
        if (col) {
          const count = col.cardIds.filter(id => {
            const card = cards.find(c => c.id === id);
            return card && !card.archived && (!searchQuery || matchesSearch(card)) && (!activeFilters.length || matchesFilters(card));
          }).length;
          el.textContent = count;
        }
      }
    });
  }

  // ===== CARD OPERATIONS =====
  function openCardModal(cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    editedCard = { ...card };
    cardModalOpen = true;

    // Populate modal
    document.getElementById('card-edit-title').value = card.title || '';
    document.getElementById('card-edit-description').value = card.description || '';
    document.getElementById('card-edit-due-date').value = card.dueDate || '';
    
    // Priority buttons
    document.querySelectorAll('.priority-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.priority) === (card.priority || 0));
    });

    // Color picker
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.color === (card.color || ''));
    });

    // Labels
    renderCardLabelsEditor(card.labels || []);

    // Subtasks
    renderSubtasks(card.subtasks || []);

    // Assignments
    renderAssignments(card.assignments || []);

    // Meta info
    document.getElementById('card-meta-created').textContent = card.createdAt ? formatDateFull(card.createdAt) : '';
    document.getElementById('card-meta-modified').textContent = card.updatedAt ? formatDateFull(card.updatedAt) : '';

    // Show modal
    document.getElementById('card-modal-overlay').classList.add('visible');
    document.getElementById('card-modal').classList.add('visible');

    // Focus title
    setTimeout(() => document.getElementById('card-edit-title').focus(), 100);

    // Bind events
    bindCardModalEvents();
  }

  function renderCardLabelsEditor(selectedLabelIds) {
    const container = document.getElementById('card-edit-labels');
    container.innerHTML = '';

    (selectedLabelIds || []).forEach(labelId => {
      const label = labels.find(l => l.id === labelId);
      if (label) {
        const span = document.createElement('span');
        span.className = 'card-label';
        span.style.background = label.color || '#6d4aff';
        span.textContent = label.name;
        span.dataset.labelId = labelId;
        span.style.cursor = 'pointer';
        span.title = 'Click to remove';
        span.addEventListener('click', () => {
          editedCard.labels = (editedCard.labels || []).filter(id => id !== labelId);
          renderCardLabelsEditor(editedCard.labels);
          saveCardDraft();
        });
        container.appendChild(span);
      }
    });
  }

  function renderSubtasks(subtasks) {
    const container = document.getElementById('subtask-list');
    container.innerHTML = '';

    (subtasks || []).forEach((sub, idx) => {
      const item = document.createElement('div');
      item.className = 'subtask-item';
      item.innerHTML = `
        <input type="checkbox" class="subtask-checkbox" ${sub.completed ? 'checked' : ''}>
        <input type="text" class="subtask-text ${sub.completed ? 'completed' : ''}" value="${escapeHtml(sub.text)}">
        <button class="subtask-delete"><i class="fa fa-times"></i></button>
      `;

      item.querySelector('.subtask-checkbox').addEventListener('change', (e) => {
        sub.completed = e.target.checked;
        item.querySelector('.subtask-text').classList.toggle('completed', sub.completed);
        saveCardDraft();
      });

      item.querySelector('.subtask-text').addEventListener('input', (e) => {
        sub.text = e.target.value;
        saveCardDraft();
      });

      item.querySelector('.subtask-delete').addEventListener('click', () => {
        editedCard.subtasks = (editedCard.subtasks || []).filter((_, i) => i !== idx);
        renderSubtasks(editedCard.subtasks);
        saveCardDraft();
      });

      container.appendChild(item);
    });
  }

  function renderAssignments(currentAssignments) {
    const container = document.getElementById('card-edit-assignments');
    container.innerHTML = '';

    (currentAssignments || []).forEach(assgId => {
      const row = createAssignmentRow(assgId);
      container.appendChild(row);
    });
  }

  function createAssignmentRow(assgId = null) {
    const row = document.createElement('div');
    row.className = 'assignment-row';

    const select = document.createElement('select');
    select.className = 'assignment-select';
    select.innerHTML = `
      <option value="due">${getTrans('TYPE_DUE', 'Due Date')}</option>
      <option value="assignee">${getTrans('TYPE_ASSIGNEE', 'Assignee')}</option>
      <option value="custom">${getTrans('TYPE_CUSTOM', 'Custom')}</option>
    `;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'assignment-input';
    input.placeholder = getTrans('ASSIGNMENT_VAL', 'Value...');

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-assignment';
    removeBtn.innerHTML = '<i class="fa fa-times"></i>';
    removeBtn.title = getTrans('REMOVE', 'Remove');

    row.appendChild(select);
    row.appendChild(input);
    row.appendChild(removeBtn);

    if (assgId) {
      const existing = assignments.find(a => a.id === assgId);
      if (existing) {
        select.value = existing.type;
        input.value = existing.value;
      }
    }

    select.addEventListener('change', () => {
      if (assgId) {
        const existing = assignments.find(a => a.id === assgId);
        if (existing) existing.type = select.value;
        saveCardDraft();
      }
    });

    input.addEventListener('input', () => {
      if (assgId) {
        const existing = assignments.find(a => a.id === assgId);
        if (existing) existing.value = input.value;
        saveCardDraft();
      }
    });

    removeBtn.addEventListener('click', () => {
      if (assgId) {
        editedCard.assignments = (editedCard.assignments || []).filter(id => id !== assgId);
        assignments = assignments.filter(a => a.id !== assgId);
        renderAssignments(editedCard.assignments);
        saveToStorage();
        saveCardDraft();
      } else {
        row.remove();
      }
    });

    return row;
  }

  function bindCardModalEvents() {
    const saveBtn = document.getElementById('btn-save-card');
    const deleteBtn = document.getElementById('card-delete-btn');
    const archiveBtn = document.getElementById('btn-archive-card');
    const duplicateBtn = document.getElementById('btn-duplicate-card');

    saveBtn.onclick = saveCardFromModal;
    deleteBtn.onclick = () => deleteCard(editedCard.id);
    archiveBtn.onclick = () => archiveCard(editedCard.id);
    duplicateBtn.onclick = () => duplicateCard(editedCard.id);

    // Markdown toggle
    const mdToggle = document.getElementById('md-toggle-btn');
    const descInput = document.getElementById('card-edit-description');
    const mdPreview = document.getElementById('md-preview');

    mdToggle.onclick = () => {
      mdToggle.classList.toggle('active');
      if (mdToggle.classList.contains('active')) {
        mdPreview.style.display = 'block';
        mdPreview.innerHTML = parseMarkdown(descInput.value);
      } else {
        mdPreview.style.display = 'none';
      }
    };

    descInput.oninput = () => {
      if (mdToggle.classList.contains('active')) {
        mdPreview.innerHTML = parseMarkdown(descInput.value);
      }
      editedCard.description = descInput.value;
    };

    // Priority buttons
    document.querySelectorAll('.priority-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        editedCard.priority = parseInt(btn.dataset.priority);
      };
    });

    // Color swatches
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.onclick = () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        editedCard.color = swatch.dataset.color || null;
      };
    });

    // Clear due date
    document.getElementById('btn-clear-due').onclick = () => {
      document.getElementById('card-edit-due-date').value = '';
      editedCard.dueDate = null;
    };

    // Show labels picker
    document.getElementById('btn-show-labels').onclick = toggleLabelsPicker;

    // Add assignment
    document.getElementById('btn-add-assignment').onclick = () => {
      const row = createAssignmentRow();
      document.getElementById('card-edit-assignments').appendChild(row);
    };

    // Add subtask
    document.getElementById('btn-add-subtask').onclick = addSubtask;
    document.getElementById('subtask-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSubtask();
      }
    });

    // Close modal
    document.getElementById('card-modal-close').onclick = closeCardModal;
    document.getElementById('card-modal-overlay').onclick = closeCardModal;
  }

  function addSubtask() {
    const input = document.getElementById('subtask-input');
    const text = input.value.trim();
    if (!text) return;

    editedCard.subtasks = editedCard.subtasks || [];
    editedCard.subtasks.push({ id: 'sub-' + Date.now(), text, completed: false });
    input.value = '';

    renderSubtasks(editedCard.subtasks);
    saveCardDraft();
  }

  function saveCardDraft() {
    editedCard.title = document.getElementById('card-edit-title').value || getTrans('UNTITLED', 'Untitled');
    editedCard.updatedAt = Date.now();
  }

  function saveCardFromModal() {
    if (!editedCard) return;

    saveCardDraft();

    const idx = cards.findIndex(c => c.id === editedCard.id);
    if (idx >= 0) {
      cards[idx] = { ...editedCard };
    }

    closeCardModal();
    saveBoardToStorage();
    renderColumns();
    showNotification(getTrans('CARD_SAVED', 'Card saved!'));
  }

  function closeCardModal() {
    document.getElementById('card-modal-overlay').classList.remove('visible');
    document.getElementById('card-modal').classList.remove('visible');
    cardModalOpen = false;
    editedCard = null;
  }
  
    // ===== DRAG AND DROP =====
  function handleCardDragStart(e, cardId) {
    draggedCard = cardId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardId);
  }

  function handleCardDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    draggedCard = null;
  }

  function handleCardDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleCardDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drop-target');

    const cardId = e.dataTransfer.getData('text/plain');
    const targetColId = e.currentTarget.dataset.columnId;

    if (!cardId || !targetColId || draggedCard === cardId) return;

    // Find source column
    const sourceCol = columns.find(c => c.cardIds.includes(cardId));
    const targetCol = columns.find(c => c.id === targetColId);

    if (!sourceCol || !targetCol) return;

    // Remove from source
    sourceCol.cardIds = sourceCol.cardIds.filter(id => id !== cardId);

    // Add to target
    const dropIndex = getDropIndex(e, targetCol);
    targetCol.cardIds.splice(dropIndex, 0, cardId);

    saveBoardToStorage();
    renderColumns();
  }

  function getDropIndex(e, column) {
    const cardsContainer = document.querySelector(`.column-cards[data-column-id="${column.id}"]`);
    if (!cardsContainer) return column.cardIds.length;

    const cardElements = Array.from(cardsContainer.querySelectorAll('.kanban-card:not(.dragging)'));
    const dropY = e.clientY;

    for (let i = 0; i < cardElements.length; i++) {
      const rect = cardElements[i].getBoundingClientRect();
      if (dropY < rect.top + rect.height / 2) {
        return i;
      }
    }

    return column.cardIds.length;
  }

  // ===== COLUMN DRAG =====
  function handleColumnDragStart(e) {
    draggedColumn = e.target.closest('.kanban-column').dataset.columnId;
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleColumnDragEnd(e) {
    draggedColumn = null;
    document.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('dragging'));
  }

  function handleColumnDragOver(e) {
    e.preventDefault();
  }

  function handleColumnDrop(e) {
    e.preventDefault();
    const targetCol = e.target.closest('.kanban-column');
    if (!targetCol || draggedColumn === targetCol.dataset.columnId) return;

    const oldIndex = columnOrder.indexOf(draggedColumn);
    const newIndex = columnOrder.indexOf(targetCol.dataset.columnId);

    columnOrder.splice(oldIndex, 1);
    columnOrder.splice(newIndex, 0, draggedColumn);

    saveBoardToStorage();
    renderColumns();
  }

  // ===== SEARCH =====
  function setupSearch() {
    const searchBox = document.getElementById('kanban-search-box');
    const clearBtn = document.getElementById('kanban-search-clear');

    if (searchBox) {
      searchBox.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        debouncedRender();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchBox.value = '';
        searchQuery = '';
        debouncedRender();
      });
    }
  }

  function matchesSearch(card) {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      card.title.toLowerCase().includes(query) ||
      (card.description && card.description.toLowerCase().includes(query)) ||
      (card.labels && card.labels.some(lid => {
        const label = labels.find(l => l.id === lid);
        return label && label.name.toLowerCase().includes(query);
      }))
    );
  }

  // ===== FILTERS =====
  function setupFilterDropdown() {
    const filterBtn = document.getElementById('filter-btn');
    const filterContent = document.getElementById('filter-dropdown-content');

    if (!filterBtn || !filterContent) return;

    // Build filter UI
    updateFilterDropdown();

    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      filterContent.classList.toggle('visible');
    });

    document.addEventListener('click', () => {
      filterContent.classList.remove('visible');
    });

    // Listen for label changes
    document.addEventListener('labels-updated', () => {
      updateFilterDropdown();
    });
  }

  function updateFilterDropdown() {
    const filterContent = document.getElementById('filter-dropdown-content');
    if (!filterContent) return;

    let html = '<div class="filter-item"><strong>' + getTrans('FILTER_BY_LABEL', 'Filter by label') + '</strong></div>';

    labels.forEach(label => {
      const isActive = activeFilters.includes(label.id);
      html += `
        <div class="filter-item" data-label-id="${label.id}">
          <input type="checkbox" class="filter-item-checkbox" ${isActive ? 'checked' : ''}>
          <span class="filter-color-dot" style="background:${label.color||'#6d4aff'}"></span>
          <span class="filter-item-text">${escapeHtml(label.name)}</span>
        </div>
      `;
    });

    if (labels.length === 0) {
      html += '<div class="filter-item" style="color:var(--text-muted);font-style:italic;">' + getTrans('NO_LABELS', 'No labels yet') + '</div>';
    }

    filterContent.innerHTML = html;

    // Bind checkboxes
    filterContent.querySelectorAll('.filter-item').forEach(item => {
      if (item.dataset.labelId) {
        const checkbox = item.querySelector('.filter-item-checkbox');
        checkbox.addEventListener('change', () => {
          const labelId = item.dataset.labelId;
          if (checkbox.checked) {
            if (!activeFilters.includes(labelId)) activeFilters.push(labelId);
          } else {
            activeFilters = activeFilters.filter(id => id !== labelId);
          }
          updateFilterToggle();
          debouncedRender();
        });
      }
    });
  }

  function updateFilterToggle() {
    const toggle = document.querySelector('.filter-toggle');
    if (toggle) {
      toggle.classList.toggle('active', activeFilters.length > 0);
      toggle.innerHTML = '<i class="fa fa-filter"></i> ' + getTrans('FILTER', 'Filter') + (activeFilters.length ? ` (${activeFilters.length})` : '');
    }
  }

  function matchesFilters(card) {
    if (activeFilters.length === 0) return true;
    if (!card.labels || card.labels.length === 0) return false;
    return activeFilters.some(filterId => card.labels.includes(filterId));
  }

  // ===== COLUMN OPERATIONS =====
  function addNewColumn() {
    const title = prompt(getTrans('COL_TITLE', 'Column title:') || 'Column title');
    if (!title) return;

    const newCol = {
      id: 'col-' + Date.now(),
      title: escapeHtml(title),
      cardIds: [],
      order: []
    };

    columns.push(newCol);
    columnOrder.push(newCol.id);
    saveBoardToStorage();
    renderColumns();
  }

  function editColumnTitle(colId) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'column-title-edit';
    input.value = col.title;
    input.style.left = '50%';
    input.style.top = '50%';
    input.style.transform = 'translate(-50%, -50%)';

    document.body.appendChild(input);
    input.focus();
    input.select();

    const save = () => {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== col.title) {
        col.title = escapeHtml(newTitle);
        saveBoardToStorage();
        renderColumns();
      }
      input.remove();
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.remove();
      }
    });
  }

  function deleteColumn(colId) {
    if (!confirm(getTrans('DEL_COL_CONFIRM', 'Delete this column and all its cards?'))) return;

    // Remove cards from this column
    const col = columns.find(c => c.id === colId);
    if (col) {
      cards = cards.filter(c => !col.cardIds.includes(c.id));
    }

    columns = columns.filter(c => c.id !== colId);
    columnOrder = columnOrder.filter(id => id !== colId);

    saveBoardToStorage();
    renderColumns();
    showNotification(getTrans('COL_DELETED', 'Column deleted'));
  }

  // ===== ADD CARD =====
  function openAddCardForm(colId) {
    const title = prompt(getTrans('CARD_TITLE', 'Card title:'));
    if (!title) return;

    const newCard = {
      id: 'card-' + Date.now(),
      title: escapeHtml(title),
      description: '',
      priority: 0,
      color: null,
      labels: [],
      subtasks: [],
      assignments: [],
      dueDate: null,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    cards.push(newCard);

    const col = columns.find(c => c.id === colId);
    if (col) {
      col.cardIds.push(newCard.id);
    }

    saveBoardToStorage();
    renderColumns();
    showNotification(getTrans('CARD_CREATED', 'Card created'));
  }

  function deleteCard(cardId) {
    if (!confirm(getTrans('DEL_CARD_CONFIRM', 'Delete this card?'))) return;

    // Remove from all columns
    columns.forEach(col => {
      col.cardIds = col.cardIds.filter(id => id !== cardId);
    });

    cards = cards.filter(c => c.id !== cardId);

    if (editedCard && editedCard.id === cardId) {
      closeCardModal();
    }

    saveBoardToStorage();
    renderColumns();
    showNotification(getTrans('CARD_DELETED', 'Card deleted'));
  }

  function archiveCard(cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    card.archived = true;
    card.updatedAt = Date.now();

    // Remove from visible columns
    columns.forEach(col => {
      col.cardIds = col.cardIds.filter(id => id !== cardId);
    });

    if (!archivedCards.find(a => a.id === cardId)) {
      archivedCards.push(cardId);
    }

    if (editedCard && editedCard.id === cardId) {
      closeCardModal();
    }

    saveBoardToStorage();
    renderColumns();
    showNotification(getTrans('CARD_ARCHIVED', 'Card archived'));
  }

  function duplicateCard(cardId) {
    const original = cards.find(c => c.id === cardId);
    if (!original) return;

    const newCard = {
      ...original,
      id: 'card-' + Date.now(),
      title: original.title + ' (copy)',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    cards.push(newCard);

    // Find source column and add to same column
    const sourceCol = columns.find(c => c.cardIds.includes(cardId));
    if (sourceCol) {
      const idx = sourceCol.cardIds.indexOf(cardId);
      sourceCol.cardIds.splice(idx + 1, 0, newCard.id);
    }

    saveBoardToStorage();
    renderColumns();
    showNotification(getTrans('CARD_DUPLICATED', 'Card duplicated'));
  }

  // ===== KEYBOARD SHORTCUTS =====
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input/textarea
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        // Except Ctrl+Enter to save card
        if (e.ctrlKey && e.key === 'Enter' && cardModalOpen) {
          e.preventDefault();
          saveCardFromModal();
          return;
        }
        // Ctrl+Delete to delete card
        if (e.ctrlKey && e.key === 'Delete' && cardModalOpen) {
          e.preventDefault();
          deleteCard(editedCard?.id);
          return;
        }
        return;
      }

      // Global shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            saveBoardToStorage();
            showNotification(getTrans('BOARDS_SAVED', 'Board saved!'));
            break;
          case 'b':
            e.preventDefault();
            toggleExportMenu();
            break;
        }
      }

      // Escape to close modals
      if (e.key === 'Escape') {
        if (cardModalOpen) closeCardModal();
        document.querySelectorAll('.modal-overlay.visible').forEach(el => el.classList.remove('visible'));
        document.querySelectorAll('.modal.visible').forEach(el => el.classList.remove('visible'));
        document.querySelectorAll('.board-selector-dropdown.visible').forEach(el => el.classList.remove('visible'));
        document.querySelectorAll('.filter-content.visible').forEach(el => el.classList.remove('visible'));
        document.querySelectorAll('.kanban-export-menu.open').forEach(el => el.classList.remove('open'));
      }
    });
  }

  // ===== THEMING =====
  function setupThemeToggle() {
    // From Settings modal
    const settingsToggle = document.getElementById('btn-theme-toggle');
    if (settingsToggle) {
      settingsToggle.addEventListener('click', toggleTheme);
    }

    // Also check for header-based toggle (added by header.js)
    const headerToggle = document.querySelector('#oros-header .btn-theme-toggle');
    if (headerToggle) {
      headerToggle.addEventListener('click', toggleTheme);
    }
  }

  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('oros-theme', next);
    showNotification(next === 'dark' ? 'Dark mode' : 'Light mode');
  }

  function initTheme() {
    const saved = localStorage.getItem('oros-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }

  // ===== PWA INSTALL =====
  function setupPWA() {
    let deferredPrompt = null;
    const installBtn = document.getElementById('btn-install');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) installBtn.disabled = false;
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          showNotification(getTrans('INSTALLED', 'App installed!'));
        }
        deferredPrompt = null;
        installBtn.disabled = true;
      });
    }
  }

  // ===== UTILITIES =====
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatDateFull(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
  }

  function parseMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^- (.+)$/gm, '<ul><li>$1</li></ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    return html;
  }

  function showNotification(msg) {
    // Remove existing
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function showErrorToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.style.background = 'var(--danger)';
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function scheduleAutoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveBoardToStorage, 30000);
  }

  function startAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(saveBoardToStorage, 60000);
  }

  function debouncedRender() {
    setTimeout(() => {
      renderColumns();
      updateCardCounts();
    }, 150);
  }

  function toggleSettingsUI(settings) {
    document.getElementById('toggle-hide-add-column-btn').checked = settings.hideAddColumnBtn || false;
    document.getElementById('toggle-hide-import-btn').checked = settings.hideImportBtn || false;
    document.getElementById('toggle-hide-export-btn').checked = settings.hideExportBtn || false;
  }

  // ===== EVENT LISTENERS SETUP =====
  function setupEventListeners() {
    // Board selector
    document.getElementById('board-selector-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('board-list').classList.toggle('visible');
    });

    document.addEventListener('click', () => {
      document.getElementById('board-list').classList.remove('visible');
    });

    // New board
    document.getElementById('btn-new-board').addEventListener('click', createNewBoard);
    document.getElementById('kanban-create-first-board').addEventListener('click', createNewBoard);

    // Add column
    document.getElementById('btn-add-column').addEventListener('click', addNewColumn);

    // Import
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', importBoard);

    // Export
    document.getElementById('btn-export').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExportMenu();
    });

    document.getElementById('export-full').addEventListener('click', exportFullBackup);
    document.getElementById('export-csv').addEventListener('click', exportCSV);

    document.addEventListener('click', () => {
      document.getElementById('export-options').classList.remove('open');
    });

    // Archive toggle
    document.getElementById('btn-archive-toggle').addEventListener('click', () => {
      showArchived = !showArchived;
      document.getElementById('btn-archive-toggle').classList.toggle('archive-active', showArchived);
      renderColumns();
    });

    // Labels management
    document.getElementById('btn-labels').addEventListener('click', openLabelModal);

    // Stats
    document.getElementById('btn-stats').addEventListener('click', openStatsModal);

    // Help
    document.getElementById('btn-help').addEventListener('click', showKeyboardHelp);

    // Settings modal
    document.querySelector('.settings-modal .settings-close').addEventListener('click', closeSettingsModal);
    document.querySelector('.settings-modal-overlay').addEventListener('click', closeSettingsModal);
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', switchTab);
    });

    // Settings toggles
    document.getElementById('kanban-auto-save-toggle').addEventListener('change', (e) => {
      autoSaveEnabled = e.target.checked;
      if (autoSaveEnabled) startAutoSave();
      else if (autoSaveInterval) clearInterval(autoSaveInterval);
      saveToStorage();
    });

    document.getElementById('toggle-hide-add-column-btn').addEventListener('change', (e) => {
      document.getElementById('btn-add-column').style.display = e.target.checked ? 'none' : 'flex';
      saveToStorage();
    });

    document.getElementById('toggle-hide-import-btn').addEventListener('change', (e) => {
      document.getElementById('btn-import').style.display = e.target.checked ? 'none' : 'flex';
      saveToStorage();
    });

    document.getElementById('toggle-hide-export-btn').addEventListener('change', (e) => {
      document.getElementById('btn-export').style.display = e.target.checked ? 'none' : 'flex';
      saveToStorage();
    });

    // Label modal
    document.getElementById('label-modal-close').addEventListener('click', closeLabelModal);
    document.getElementById('label-modal-overlay').addEventListener('click', closeLabelModal);
    document.getElementById('btn-add-label-modal').addEventListener('click', addNewLabel);

    // Stats modal
    document.getElementById('btn-close-stats').addEventListener('click', closeStatsModal);
    document.getElementById('stats-modal-overlay').addEventListener('click', closeStatsModal);

    // Setup search and filters
    setupSearch();
    setupFilterDropdown();

    // Init theme
    initTheme();
  }

  // ===== BOARD MANAGEMENT FUNCTIONS =====
  function createNewBoard() {
    const name = prompt(getTrans('NEW_BOARD_NAME', 'Board name:'));
    if (!name) return;

    const boardId = 'board-' + Date.now();
    boards[boardId] = {
      id: boardId,
      name: escapeHtml(name),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    currentBoardId = boardId;
    resetBoardToDefaults();
    renderBoards();
    updateCurrentBoardName();
    showNotification(getTrans('BOARD_CREATED', 'Board created'));
  }

  function switchBoard(boardId) {
    currentBoardId = boardId;
    loadBoard(boardId);
    renderBoards();
    document.getElementById('board-list').classList.remove('visible');
    showNotification(getTrans('BOARD_SWITCHED', 'Board switched'));
  }

  function renameBoard(boardId) {
    const board = boards[boardId];
    if (!board) return;

    const newName = prompt(getTrans('RENAME_BOARD', 'New name:'), board.name);
    if (!newName) return;

    board.name = escapeHtml(newName);
    board.updatedAt = Date.now();
    saveToStorage();
    renderBoards();
    updateCurrentBoardName();
    showNotification(getTrans('BOARD_RENAMED', 'Board renamed'));
  }

  function deleteBoard(boardId) {
    if (!confirm(getTrans('DEL_BOARD_CONFIRM', 'Delete this board permanently?'))) return;

    delete boards[boardId];
    localStorage.removeItem(getStorageKey() + 'board-' + boardId);

    if (currentBoardId === boardId) {
      const remaining = Object.keys(boards);
      if (remaining.length > 0) {
        currentBoardId = remaining[0];
        loadBoard(currentBoardId);
      } else {
        createDefaultBoard();
      }
    }

    renderBoards();
    showNotification(getTrans('BOARD_DELETED', 'Board deleted'));
  }

  function reorderBoards() {
    // Simplified - could be enhanced with drag/reorder UI
    showNotification(getTrans('REORDER_HINT', 'Boards are sorted by last modified'));
  }

  // ===== IMPORT/EXPORT =====
  function importBoard(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.boards && data.currentBoardId) {
          boards = data.boards;
          currentBoardId = data.currentBoardId;
          labels = data.labels || [];
          loadBoard(currentBoardId);
          renderBoards();
          showNotification(getTrans('IMPORT_SUCCESS', 'Board imported!'));
        }
      } catch (err) {
        showErrorToast(getTrans('IMPORT_FAIL', 'Import failed: invalid file'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function toggleExportMenu() {
    document.getElementById('export-options').classList.toggle('open');
  }

  function exportFullBackup() {
    const data = {
      boards,
      currentBoardId,
      labels,
      assignments,
      exportedAt: Date.now()
    };

    // Add board-specific data
    Object.keys(boards).forEach(id => {
      const boardData = localStorage.getItem(getStorageKey() + 'board-' + id);
      if (boardData) {
        data.boardData = data.boardData || {};
        data.boardData[id] = JSON.parse(boardData);
      }
    });

    downloadJSON(data, 'oros-kanban-backup-' + new Date().toISOString().slice(0,10) + '.json');
    showNotification(getTrans('EXPORT_SUCCESS', 'Backup downloaded'));
  }

  function exportCSV() {
    const csvRows = [['Card Title', 'Column', 'Priority', 'Labels', 'Due Date']];

    columns.forEach(col => {
      col.cardIds.forEach(cardId => {
        const card = cards.find(c => c.id === cardId);
        if (card && !card.archived) {
          const labelNames = (card.labels || []).map(lid => {
            const label = labels.find(l => l.id === lid);
            return label ? label.name : '';
          }).join('; ');

          csvRows.push([
            card.title,
            col.title,
            card.priority || 0,
            labelNames,
            card.dueDate || ''
          ]);
        }
      });
    });

    downloadCSV(csvRows, 'oros-kanban-export-' + new Date().toISOString().slice(0,10) + '.csv');
    showNotification(getTrans('CSV_EXPORTED', 'CSV exported'));
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCSV(rows, filename) {
    const csv = rows.map(row => row.map(cell => `"${(cell||'').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ===== LABELS MANAGEMENT =====
  function openLabelModal() {
    document.getElementById('label-modal-overlay').classList.add('visible');
    document.getElementById('label-modal').classList.add('visible');
    renderLabelManagement();
  }

  function closeLabelModal() {
    document.getElementById('label-modal-overlay').classList.remove('visible');
    document.getElementById('label-modal').classList.remove('visible');
  }

  function renderLabelManagement() {
    const container = document.getElementById('label-modal-body');
    container.innerHTML = '';

    if (labels.length === 0) {
      container.innerHTML = '<div style="padding:12px;color:var(--text-muted);">' + getTrans('NO_LABELS', 'No labels yet') + '</div>';
      return;
    }

    labels.forEach(label => {
      const item = document.createElement('div');
      item.className = 'label-manage-item';
      item.innerHTML = `
        <input type="color" class="label-manage-color" value="${label.color||'#6d4aff'}">
        <input type="text" class="label-manage-text" value="${escapeHtml(label.name)}">
        <button class="label-manage-delete"><i class="fa fa-trash"></i></button>
      `;

      item.querySelector('.label-manage-color').addEventListener('input', (e) => {
        label.color = e.target.value;
        saveBoardToStorage();
      });

      item.querySelector('.label-manage-text').addEventListener('input', (e) => {
        label.name = e.target.value;
        saveBoardToStorage();
        renderColumns();
      });

      item.querySelector('.label-manage-delete').addEventListener('click', () => {
        if (!confirm('Delete this label?')) return;
        labels = labels.filter(l => l.id !== label.id);
        // Remove from all cards
        cards.forEach(c => {
          c.labels = (c.labels || []).filter(id => id !== label.id);
        });
        saveBoardToStorage();
        renderLabelManagement();
        renderColumns();
        document.dispatchEvent(new CustomEvent('labels-updated'));
      });

      container.appendChild(item);
    });
  }

  function addNewLabel() {
    const name = prompt(getTrans('LABEL_NAME', 'Label name:'));
    if (!name) return;

    const color = prompt(getTrans('LABEL_COLOR', 'Color (hex):'), '#6d4aff');

    const newLabel = {
      id: 'label-' + Date.now(),
      name: escapeHtml(name),
      color: color || '#6d4aff'
    };

    labels.push(newLabel);
    saveBoardToStorage();
    renderLabelManagement();
    document.dispatchEvent(new CustomEvent('labels-updated'));
    showNotification(getTrans('LABEL_ADDED', 'Label added'));
  }

  function toggleLabelsPicker() {
    const picker = document.getElementById('label-picker');
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';

    const list = document.getElementById('label-picker-list');
    list.innerHTML = '';

    labels.forEach(label => {
      const item = document.createElement('div');
      item.className = 'picker-label-item';
      item.style.background = label.color || '#6d4aff';
      item.textContent = label.name;
      item.dataset.labelId = label.id;
      item.style.margin = '2px';
      item.style.padding = '4px 8px';
      item.style.borderRadius = '3px';
      item.style.fontSize = '11px';
      item.style.fontWeight = '600';
      item.style.color = '#fff';
      item.style.cursor = 'pointer';

      const isSelected = (editedCard.labels || []).includes(label.id);
      if (isSelected) item.classList.add('selected');

      item.addEventListener('click', () => {
        if (isSelected) {
          editedCard.labels = (editedCard.labels || []).filter(id => id !== label.id);
        } else {
          editedCard.labels = [...(editedCard.labels || []), label.id];
        }
        renderCardLabelsEditor(editedCard.labels);
        saveCardDraft();
      });

      list.appendChild(item);
    });
  }

  // ===== STATS MODAL =====
  function openStatsModal() {
    document.getElementById('stats-modal-overlay').classList.add('visible');
    document.getElementById('stats-modal').classList.add('visible');
    renderStats();
  }

  function closeStatsModal() {
    document.getElementById('stats-modal-overlay').classList.remove('visible');
    document.getElementById('stats-modal').classList.remove('visible');
  }

  function renderStats() {
    const container = document.getElementById('stats-modal-body');
    const totalCards = cards.filter(c => !c.archived).length;
    const archivedCount = archivedCards.length;
    const completedCount = columns.find(c => c.title === 'Done')?.cardIds.length || 0;

    let html = `
      <div class="stat-category">
        <div class="stat-category-title">${getTrans('OVERVIEW', 'Overview')}</div>
        <div class="stat-item"><span>Total cards</span><span class="stat-value">${totalCards}</span></div>
        <div class="stat-item"><span>Archived</span><span class="stat-value">${archivedCount}</span></div>
        <div class="stat-item"><span>Completed</span><span class="stat-value">${completedCount}</span></div>
      </div>
      <div class="stat-category">
        <div class="stat-category-title">${getTrans('BY_COLUMN', 'By column')}</div>
    `;

    columns.forEach(col => {
      const count = col.cardIds.filter(id => {
        const card = cards.find(c => c.id === id);
        return card && !card.archived;
      }).length;
      html += `<div class="stat-item"><span>${escapeHtml(col.title)}</span><span class="stat-value">${count}</span></div>`;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // ===== HELP / SHORTCUTS =====
  function showKeyboardHelp() {
    alert(
      getTrans('SHORTCUTS_HELP', 'Keyboard Shortcuts:\n\n' +
        'Ctrl+S - Save board\n' +
        'Ctrl+B - Export menu\n' +
        'Ctrl+Enter - Save card (in modal)\n' +
        'Ctrl+Delete - Delete card (in modal)\n' +
        'Esc - Close modal/dropdown\n\n' +
        'Click card - Edit\n' +
        'Double-click column title - Rename\n' +
        'Drag card/column - Move')
    );
  }

  // ===== SETTINGS MODAL =====
  function closeSettingsModal() {
    document.querySelector('.settings-modal').classList.remove('visible');
  }

  function switchTab(e) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const tabId = e.target.dataset.tab;
    document.getElementById(tabId).classList.add('active');
  }

  function toggleSettingsVisibility() {
    // Called when board changes
  }

})();