// ============================================
// orOS Notes — Full Implementation v4.4
// Changes from v4.3:
//   - Sidebar collapse expands editor (CSS-driven)
//   - View icons moved to editor footer
//   - Editor tabs bar (Write/Preview) removed
//   - Backlinks default state setting (open/closed on load)
//   - Sidebar sort order setting
//   - More UI element hide/show toggles
//   - Default view mode properly persisted
//   - Settings included in JSON backup/restore
//   - All focus mode remnants removed
// ============================================

(function() {
  'use strict';

  // ========== STORAGE KEYS ==========
  var STORAGE_KEY = 'oros_notes_data_v4';
  var ACTIVE_NOTE_ID = 'oros_notes_active_id';
  var VIEW_MODE = 'oros_notes_view_mode';
  var DEFAULT_VIEW_MODE = 'oros_notes_default_view';
  var SIDEBAR_COLLAPSED = 'oros_notes_sidebar_collapsed';
  var BACKLINKS_DEFAULT_STATE = 'oros_notes_backlinks_default';
  var BACKLINKS_USER_STATE = 'oros_notes_backlinks_user_state';
  var SIDEBAR_SORT_ORDER = 'oros_notes_sidebar_sort';

  // ========== SETTING KEYS (for JSON backup/restore) ==========
  var SETTING_KEYS = [
    'oros_notes_view_mode',
    'oros_notes_default_view',
    'oros_notes_sidebar_collapsed',
    'oros_notes_backlinks_default',
    'oros_notes_backlinks_user_state',
    'oros_notes_sidebar_sort',
    'oros_hide_new_note_btn',
    'oros_hide_new_folder_btn',
    'oros_hide_sidebar_toggle',
    'oros_hide_outline_panel',
    'oros_hide_tags_panel',
    'oros_hide_root_dropzone',
    'oros_hide_meta_info',
    'oros_hide_graph_btn',
    'oros_hide_export_btn',
    'oros_hide_daily_btn',
    'oros_hide_backlinks_panel',
    'oros-language',
    'oros-zen-mode'
  ];

  // ========== STATE ==========
  var state = {
    nodes: [],
    activeNodeId: null,
    searchQuery: '',
    expandedFolders: {},
    contextTargetId: null,
    pendingLinkId: null,
    draggedNodeId: null,
    clipboard: null,
    graphNodes: [],
    graphEdges: [],
    commandPaletteIndex: 0,
    commandPaletteResults: [],
    autocompleteResults: [],
    autocompleteIndex: 0
  };

  // ========== ID GENERATOR ==========
  function genId(type) {
    return (type || 'node') + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }

  // ========== HELPER: i18n ==========
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
    }, 2500);
  }

  // ========== DATA: LOAD / SAVE ==========
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state.nodes = JSON.parse(raw);
      }
    } catch(e) {
      state.nodes = [];
    }

    var savedActive = localStorage.getItem(ACTIVE_NOTE_ID);
    if (savedActive) state.activeNodeId = savedActive;

    var savedMode = localStorage.getItem(VIEW_MODE);
    if (savedMode) applyViewMode(savedMode);

    var sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED) === 'true';
    if (sidebarCollapsed) {
      var sidebar = document.getElementById('notes-sidebar');
      if (sidebar) sidebar.classList.add('collapsed');
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.nodes));
      localStorage.setItem(ACTIVE_NOTE_ID, state.activeNodeId || '');
      var sidebar = document.getElementById('notes-sidebar');
      localStorage.setItem(SIDEBAR_COLLAPSED, sidebar ? (sidebar.classList.contains('collapsed') ? 'true' : 'false') : 'false');
    } catch(e) {
      showToast('Storage limit reached. Export and delete old notes.');
    }
  }

  function saveBacklinksState() {
    var panel = document.getElementById('backlinks-panel');
    if (panel) {
      localStorage.setItem(BACKLINKS_USER_STATE, panel.classList.contains('collapsed') ? 'collapsed' : 'open');
    }
  }

  // ========== NODE OPERATIONS ==========
  function getNode(id) {
    return findNodeById(id, state.nodes);
  }

  function findNodeById(id, nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes[i];
      if (nodes[i].children) {
        var found = findNodeById(id, nodes[i].children);
        if (found) return found;
      }
    }
    return null;
  }

  function getParentNode(id) {
    return findParent(id, state.nodes, null);
  }

  function findParent(id, nodes, parent) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return parent;
      if (nodes[i].children) {
        var found = findParent(id, nodes[i].children, nodes[i]);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  function getAllNodes() {
    var result = [];
    flattenNodes(state.nodes, result);
    return result;
  }

  function flattenNodes(nodes, result) {
    for (var i = 0; i < nodes.length; i++) {
      result.push(nodes[i]);
      if (nodes[i].children) flattenNodes(nodes[i].children, result);
    }
  }

  function getNotes() {
    return getAllNodes().filter(function(n) { return n.type === 'note'; });
  }

  function getPinnedNotes() {
    return getNotes().filter(function(n) { return n.pinned === true; });
  }

  function createFolder(parentId, title) {
    var folder = {
      id: genId('folder'),
      type: 'folder',
      parentId: parentId || null,
      title: title || 'Untitled Folder',
      children: [],
      expanded: false,
      pinned: false,
      created: Date.now(),
      modified: Date.now()
    };

    if (parentId) {
      var parent = getNode(parentId);
      if (parent && parent.children) {
        parent.children.push(folder);
        parent.expanded = true;
        parent.modified = Date.now();
      }
    } else {
      state.nodes.push(folder);
    }

    saveData();
    renderTree();
    renderTagsPanel();
    return folder;
  }

  function createNote(parentId, title, tags) {
    var note = {
      id: genId('note'),
      type: 'note',
      parentId: parentId || null,
      title: title || 'Untitled Note',
      content: '',
      tags: tags || [],
      pinned: false,
      created: Date.now(),
      modified: Date.now()
    };

    if (parentId) {
      var parent = getNode(parentId);
      if (parent && parent.children) {
        parent.children.push(note);
        parent.modified = Date.now();
      } else {
        state.nodes.push(note);
      }
    } else {
      state.nodes.push(note);
    }

    state.activeNodeId = note.id;
    saveData();
    renderAll();
    return note;
  }

  function renameNode(id, newTitle) {
    var node = getNode(id);
    if (node) {
      node.title = newTitle;
      node.modified = Date.now();
      saveData();
      renderAll();
    }
  }

  function deleteNode(id) {
    var node = getNode(id);
    if (!node) return;

    var msg = node.type === 'folder'
      ? getTrans('notes_confirm_delete_folder') || 'Delete folder and all contents?'
      : getTrans('notes_confirm_delete_note') || 'Delete this note?';
    if (!confirm(msg)) return;

    deleteNodeRecursive(id);

    if (state.activeNodeId === id) {
      state.activeNodeId = null;
      renderEditorPanel();
    }

    saveData();
    renderAll();
    showToast(node.type === 'folder' ? getTrans('notes_deleted_folder') || 'Folder deleted' : getTrans('notes_deleted_note') || 'Note deleted');
  }

  function deleteNodeRecursive(id) {
    var parent = getParentNode(id);
    if (parent && parent.children) {
      var idx = parent.children.findIndex(function(c) { return c.id === id; });
      if (idx !== -1) parent.children.splice(idx, 1);
    } else {
      var idx2 = state.nodes.findIndex(function(n) { return n.id === id; });
      if (idx2 !== -1) state.nodes.splice(idx2, 1);
    }
  }

  function updateNoteContent(content) {
    var note = getNode(state.activeNodeId);
    if (note) {
      note.content = content;
      note.modified = Date.now();
      saveData();
      updateMetaInfo();
      updateLinkCount();
      renderOutline();
      renderBacklinks();
    }
  }

  function togglePin(id) {
    var node = getNode(id);
    if (node) {
      node.pinned = !node.pinned;
      node.modified = Date.now();
      saveData();
      renderTree();
      var ctxLabel = document.getElementById('ctx-pin-label');
      if (ctxLabel) ctxLabel.textContent = node.pinned ? 'Unpin' : 'Pin';
      showToast(node.pinned ? 'Pinned' : 'Unpinned');
    }
  }

  // ========== TAGS ==========
  function updateTags(tags) {
    var note = getNode(state.activeNodeId);
    if (note) {
      note.tags = tags;
      note.modified = Date.now();
      saveData();
      updateTagDisplay();
      renderTagsPanel();
      renderRelatedNotes();
    }
  }

  function parseTagsInput(input) {
    return input.split(',').map(function(t) {
      return t.trim().toLowerCase().replace(/^#/, '');
    }).filter(function(t) { return t && t.length > 0; });
  }

  function getAllTags() {
    var tags = {};
    getNotes().forEach(function(note) {
      (note.tags || []).forEach(function(tag) {
        if (!tags[tag]) tags[tag] = 0;
        tags[tag]++;
      });
    });
    return tags;
  }

  function updateTagDisplay() {
    var note = getNode(state.activeNodeId);
    var container = document.getElementById('note-tags-display');
    if (!container || !note) return;

    container.innerHTML = '';
    (note.tags || []).forEach(function(tag) {
      var badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.innerHTML = '#' + escapeHtml(tag) + '<i class="fa fa-times tag-remove"></i>';
      badge.querySelector('.tag-remove').addEventListener('click', function() {
        var newTags = (note.tags || []).filter(function(t) { return t !== tag; });
        updateTags(newTags);
      });
      container.appendChild(badge);
    });
  }

  function renderTagsPanel() {
    var container = document.getElementById('tags-panel-list');
    if (!container) return;
    container.innerHTML = '';

    var allTags = getAllTags();
    var tagNames = Object.keys(allTags).sort();

    if (tagNames.length === 0) {
      container.innerHTML = '<span class="tags-panel-empty">No tags yet</span>';
      return;
    }

    tagNames.forEach(function(tag) {
      var badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.textContent = '#' + tag + ' (' + allTags[tag] + ')';
      badge.addEventListener('click', function() {
        var search = document.getElementById('notes-search');
        if (search) {
          search.value = '#' + tag;
          state.searchQuery = '#' + tag;
          var clearBtn = document.getElementById('notes-search-clear');
          if (clearBtn) clearBtn.style.display = 'block';
          applySearchFilter();
        }
      });
      container.appendChild(badge);
    });
  }

  // ========== MOVE NODE ==========
  function moveNode(nodeId, targetParentId) {
    var node = getNode(nodeId);
    if (!node) return false;

    if (node.type === 'folder') {
      var currentParentId = targetParentId;
      while (currentParentId) {
        if (currentParentId === nodeId) {
          showToast('Cannot move folder into itself');
          return false;
        }
        var parent = getNode(currentParentId);
        currentParentId = parent ? parent.parentId : null;
      }
    }

    if (node.parentId === targetParentId) {
      showToast('Already in this location');
      return false;
    }

    var oldParent = getParentNode(nodeId);

    if (oldParent && oldParent.children) {
      var idx = oldParent.children.findIndex(function(c) { return c.id === nodeId; });
      if (idx !== -1) oldParent.children.splice(idx, 1);
      oldParent.modified = Date.now();
    } else {
      var idx2 = state.nodes.findIndex(function(n) { return n.id === nodeId; });
      if (idx2 !== -1) state.nodes.splice(idx2, 1);
    }

    if (targetParentId) {
      var newParent = getNode(targetParentId);
      if (newParent && newParent.children) {
        newParent.children.push(node);
        newParent.expanded = true;
        newParent.modified = Date.now();
      }
    } else {
      state.nodes.push(node);
    }

    node.parentId = targetParentId;
    node.modified = Date.now();
    saveData();
    renderTree();
    renderTagsPanel();
    showToast(node.type === 'folder' ? 'Folder moved' : 'Note moved');
    return true;
  }

  // ========== DAILY NOTE ==========
  function createOrOpenDailyNote() {
    var today = new Date();
    var dateStr = today.toISOString().split('T')[0];
    var dailyTitle = dateStr;

    var existing = getNotes().find(function(n) {
      return n.title === dailyTitle;
    });

    if (existing) {
      state.activeNodeId = existing.id;
      renderAll();
    } else {
      var note = createNote(null, dailyTitle);
      var template = '# ' + dateStr + '\n\n## Tasks\n- [ ] \n\n## Notes\n\n## Meetings\n';
      note.content = template;
      note.modified = Date.now();
      saveData();
      renderAll();
    }
    showToast('Daily note opened/created');
  }

  // ========== SORT NODES ==========
  function sortNodes(nodes) {
    var sortOrder = localStorage.getItem(SIDEBAR_SORT_ORDER) || 'recent-modified';
    var sorted = nodes.slice();

    switch(sortOrder) {
      case 'recent-modified':
        sorted.sort(function(a, b) { return (b.modified || 0) - (a.modified || 0); });
        break;
      case 'recent-created':
        sorted.sort(function(a, b) { return (b.created || 0) - (a.created || 0); });
        break;
      case 'alpha-asc':
        sorted.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
        break;
      case 'alpha-desc':
        sorted.sort(function(a, b) { return (b.title || '').localeCompare(a.title || ''); });
        break;
      case 'folders-first':
        sorted.sort(function(a, b) {
          if (a.type === 'folder' && b.type !== 'folder') return -1;
          if (a.type !== 'folder' && b.type === 'folder') return 1;
          return (b.modified || 0) - (a.modified || 0);
        });
        break;
      case 'notes-first':
        sorted.sort(function(a, b) {
          if (a.type === 'note' && b.type !== 'note') return -1;
          if (a.type !== 'note' && b.type === 'note') return 1;
          return (b.modified || 0) - (a.modified || 0);
        });
        break;
      default:
        sorted.sort(function(a, b) { return (b.modified || 0) - (a.modified || 0); });
    }

    sorted.forEach(function(node) {
      if (node.children && node.children.length > 0) {
        node.children = sortNodes(node.children);
      }
    });

    return sorted;
  }

  // ========== RENDERING ==========
  function renderAll() {
    renderTree();
    renderEditorPanel();
    renderTagsPanel();
    renderOutline();
    renderBacklinks();
    toggleEmptyState();
  }

  function renderTree() {
    var container = document.getElementById('sidebar-tree');
    if (!container) return;

    container.innerHTML = '';

    var pinnedNotes = getPinnedNotes();
    pinnedNotes.forEach(function(note) {
      container.appendChild(renderTreeNode(note, 0));
    });

    if (pinnedNotes.length > 0) {
      var divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:var(--border-color,#3a3528);margin:4px 0;';
      container.appendChild(divider);
    }

    var sortedNodes = sortNodes(state.nodes);
    sortedNodes.forEach(function(node) {
      container.appendChild(renderTreeNode(node, 0));
    });

    applySearchFilter();
    renderRootDropzone();
  }

  function renderTreeNode(node, depth) {
    var itemEl = document.createElement('div');
    itemEl.className = 'tree-node';

    var el = document.createElement('div');
    el.className = 'tree-item ' + node.type;
    if (node.pinned) el.classList.add('pinned');
    el.setAttribute('data-id', node.id);
    el.setAttribute('draggable', 'true');
    if (node.id === state.activeNodeId) el.classList.add('active');

    el.addEventListener('dragstart', function(e) {
      state.draggedNodeId = node.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    });

    el.addEventListener('dragend', function(e) {
      el.classList.remove('dragging');
      state.draggedNodeId = null;
      document.querySelectorAll('.tree-item.drag-over').forEach(function(item) {
        item.classList.remove('drag-over');
      });
      e.stopPropagation();
    });

    var expand = document.createElement('span');
    expand.className = 'tree-expand';
    expand.innerHTML = '<i class="fa fa-chevron-right"></i>';

    var icon = document.createElement('i');
    icon.className = 'tree-icon fa ' + (node.type === 'folder' ? 'fa-folder-o' : 'fa-file-text-o');
    if (node.type === 'folder' && node.expanded) {
      icon.className = 'tree-icon fa fa-folder-open-o';
    }

    var title = document.createElement('span');
    title.className = 'tree-title';
    title.textContent = node.title;
    title.title = node.title;

    el.appendChild(expand);
    el.appendChild(icon);
    el.appendChild(title);

    if (node.type === 'note' && node.tags && node.tags.length > 0) {
      var tagDot = document.createElement('span');
      tagDot.className = 'tree-tag-dot';
      tagDot.title = 'Has tags: ' + node.tags.join(', ');
      el.appendChild(tagDot);
    }

    var childrenEl = document.createElement('div');
    childrenEl.className = 'tree-children';
    if (node.expanded) el.classList.add('tree-expanded');

    if (node.type === 'folder' && node.children) {
      var sortedChildren = sortNodes(node.children);
      sortedChildren.forEach(function(child) {
        childrenEl.appendChild(renderTreeNode(child, depth + 1));
      });
    }

    itemEl.appendChild(el);
    itemEl.appendChild(childrenEl);

    if (node.type === 'folder') {
      el.addEventListener('dragover', function(e) {
        if (state.draggedNodeId && state.draggedNodeId !== node.id) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          el.classList.add('drag-over');
        }
        e.stopPropagation();
      });

      el.addEventListener('dragleave', function(e) {
        el.classList.remove('drag-over');
        e.stopPropagation();
      });

      el.addEventListener('drop', function(e) {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (state.draggedNodeId && state.draggedNodeId !== node.id) {
          moveNode(state.draggedNodeId, node.id);
        }
        e.stopPropagation();
      });
    }

    if (node.type === 'folder') {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.tree-expand') || e.target === el || e.target.closest('.tree-icon') || e.target.closest('.tree-title')) {
          node.expanded = !node.expanded;
          el.classList.toggle('tree-expanded');
          icon.className = 'tree-icon fa ' + (node.expanded ? 'fa-folder-open-o' : 'fa-folder-o');
          saveData();
        }
      });
    } else {
      el.addEventListener('click', function() {
        selectNote(node.id);
      });
    }

    el.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.pageX, e.pageY, node.id);
    });

    el.addEventListener('dblclick', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openRenameModal(node.id);
    });

    return itemEl;
  }

  function renderRootDropzone() {
    var dropzone = document.getElementById('sidebar-root-dropzone');
    if (!dropzone) return;

    var newDropzone = dropzone.cloneNode(true);
    dropzone.parentNode.replaceChild(newDropzone, dropzone);

    newDropzone.addEventListener('dragover', function(e) {
      if (state.draggedNodeId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        newDropzone.classList.add('drag-over');
      }
    });

    newDropzone.addEventListener('dragleave', function(e) {
      newDropzone.classList.remove('drag-over');
    });

    newDropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      newDropzone.classList.remove('drag-over');
      if (state.draggedNodeId) moveNode(state.draggedNodeId, null);
    });
  }

  function renderEditorPanel() {
    var emptyState = document.getElementById('notes-empty-state');
    var editorPanel = document.getElementById('notes-editor-panel');
    var editorTitle = document.getElementById('note-title-input');
    var editorContent = document.getElementById('note-editor');

    var note = getNode(state.activeNodeId);

    if (!note || note.type !== 'note') {
      if (emptyState) emptyState.style.display = 'flex';
      if (editorPanel) editorPanel.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (editorPanel) editorPanel.style.display = 'flex';

    editorTitle.value = note.title;
    editorContent.value = note.content || '';

    syncPreview(editorContent.value);
    updateMetaInfo();
    updateLinkCount();
    updateTagDisplay();
    renderOutline();
    renderBacklinks();

    localStorage.setItem(ACTIVE_NOTE_ID, note.id);
  }

  function selectNote(id) {
    var currentNote = getNode(state.activeNodeId);
    if (currentNote && currentNote.content) {
      var editor = document.getElementById('note-editor');
      if (editor) updateNoteContent(editor.value);
    }

    state.activeNodeId = id;

    document.querySelectorAll('.tree-item.active').forEach(function(el) {
      el.classList.remove('active');
    });
    var activeEl = document.querySelector('.tree-item[data-id="' + id + '"]');
    if (activeEl) activeEl.classList.add('active');

    renderEditorPanel();
  }
  
    // ============================================
  // MARKDOWN PARSER
  // ============================================
  function parseMarkdown(text) {
    var html = escapeHtml(text);

    // Extract code blocks first
    var codeBlocks = [];
    html = html.replace(/```([\s\S]*?)```/g, function(m, code) {
      codeBlocks.push(code);
      return '\x00CODEBLOCK' + (codeBlocks.length - 1) + '\x00';
    });

    // Extract task-list items BEFORE regular list parsing
    var taskListItems = [];
    html = html.replace(/^- \[([ x])\] (.+)$/gim, function(m, checked, content) {
      var idx = taskListItems.length;
      var isChecked = checked.toLowerCase() === 'x';
      taskListItems.push({
        content: content,
        checked: isChecked
      });
      return '\x00TASKITEM' + idx + '\x00';
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // GFM Tables
    html = parseGfmTables(html);

    // Headers
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Regular unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, function(m) {
      return '<ul>' + m + '</ul>';
    });

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<ol_item><li>$1</li>');
    html = html.replace(/(<ol_item>(?:<li>.*<\/li>\n?)+)/g, function(m) {
      return '<ol>' + m.replace(/<ol_item>/g, '') + '</ol>';
    });

    // Restore task-list items as proper HTML
    html = html.replace(/\x00TASKITEM(\d+)\x00/g, function(m, idxStr) {
      var idx = parseInt(idxStr, 10);
      var item = taskListItems[idx];
      if (!item) return m;
      var checkedAttr = item.checked ? ' checked' : '';
      var cls = item.checked ? 'checked' : 'unchecked';
      return '<ul class="task-list"><li class="' + cls + '"><input type="checkbox"' + checkedAttr + '>' + item.content + '</li></ul>';
    });

    // Merge consecutive task-list uls
    html = html.replace(/(<\/ul>\n?<ul class="task-list">)/g, '');

    // Restore code blocks
    html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, function(m, idxStr) {
      var idx = parseInt(idxStr, 10);
      return '<pre><code>' + codeBlocks[idx] + '</code></pre>';
    });

    // Paragraphs
    html = html.replace(/^(?!<[hopu]|<blockquote|<hr|<pre|<li|<\/)[^\n]+$/gm, function(m) {
      if (m.trim()) return '<p>' + m + '</p>';
      return m;
    });

    // Merge consecutive paragraphs
    html = html.replace(/(<p>.*?<\/p>\s*)+/g, function(m) {
      return m.replace(/\s*<\/p>\s*<p>\s*/g, '</p><p>');
    });

    return html;
  }

  function parseGfmTables(html) {
    var tableRegex = /((?:\|[^\n]+\n))(?:\|[-:\s|]+\n)((?:\|[^\n]+\n?)+)/gm;
    return html.replace(tableRegex, function(match, headerRow, bodyRows) {
      var headers = headerRow.trim().split('|').map(function(h) { return h.trim(); }).filter(function(h) { return h.length > 0; });
      var headerHtml = '<thead><tr>' + headers.map(function(h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>';

      var rows = bodyRows.trim().split('\n');
      var bodyHtml = '<tbody>';
      rows.forEach(function(row) {
        var cells = row.split('|').map(function(c) { return c.trim(); }).filter(function(c, i, arr) {
          return c.length > 0 || (i > 0 && i < arr.length - 1);
        });
        bodyHtml += '<tr>' + cells.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      });
      bodyHtml += '</tbody>';

      return '<table>' + headerHtml + bodyHtml + '</table>';
    });
  }

  // ========== WIKILINKS ==========
  function processWikilinks(html) {
    return html.replace(/\[\[(.+?)\]\]/g, function(match, noteName) {
      var trimmed = noteName.trim();
      var matchingNote = findNoteByTitle(trimmed);
      if (matchingNote) {
        return '<span class="wikilink" data-note-id="' + matchingNote.id + '">' + escapeHtml(trimmed) + '</span>';
      } else {
        return '<span class="wikilink broken" data-note-name="' + escapeHtml(trimmed) + '">' + escapeHtml(trimmed) + '</span>';
      }
    });
  }

  function findNoteByTitle(title) {
    var notes = getNotes();
    return notes.find(function(n) {
      return n.title.toLowerCase() === title.toLowerCase();
    }) || null;
  }

  function syncPreview(content) {
    var preview = document.getElementById('note-preview');
    if (!preview) return;

    var html = parseMarkdown(content);
    html = processWikilinks(html);
    preview.innerHTML = html;

    preview.querySelectorAll('.wikilink').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        var noteId = link.dataset.noteId;
        var noteName = link.dataset.noteName;
        if (noteId) {
          selectNote(noteId);
        } else if (noteName) {
          openLinkPickerModal(noteName);
        }
      });
    });

    preview.querySelectorAll('.task-list input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function(e) {
        handleCheckboxToggle(e.target);
      });
    });
  }

  // ========== CHECKBOX TOGGLE ==========
  function handleCheckboxToggle(checkboxEl) {
    var note = getNode(state.activeNodeId);
    if (!note) return;

    var editor = document.getElementById('note-editor');
    if (!editor) return;

    var allCheckboxes = document.querySelectorAll('.note-preview .task-list input[type="checkbox"]');
    var clickedIndex = Array.prototype.indexOf.call(allCheckboxes, checkboxEl);

    var lines = editor.value.split('\n');
    var checkboxLineIndex = 0;
    for (var i = 0; i < lines.length; i++) {
      var uncheckedMatch = lines[i].match(/^- \[ \] (.+)$/);
      var checkedMatch = lines[i].match(/^- \[x\] (.+)$/i);

      if (uncheckedMatch || checkedMatch) {
        if (checkboxLineIndex === clickedIndex) {
          if (checkboxEl.checked) {
            lines[i] = lines[i].replace(/^- \[ \] /, '- [x] ');
          } else {
            lines[i] = lines[i].replace(/^- \[x\] /i, '- [ ] ');
          }
          break;
        }
        checkboxLineIndex++;
      }
    }

    editor.value = lines.join('\n');
    updateNoteContent(editor.value);
    syncPreview(editor.value);
  }

  // ========== META INFO ==========
  function updateMetaInfo() {
    var modifiedEl = document.getElementById('note-modified');
    var wordsEl = document.getElementById('note-words');
    var linksEl = document.getElementById('note-links');
    var note = getNode(state.activeNodeId);
    if (!note) return;

    if (modifiedEl && note.modified) {
      var date = new Date(note.modified);
      modifiedEl.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (wordsEl) {
      var words = note.content ? note.content.trim().split(/\s+/).filter(function(w) { return w.length > 0; }).length : 0;
      wordsEl.textContent = words + ' ' + (getTrans('text_words') || 'words');
    }

    if (linksEl) {
      var linkCount = note.content ? (note.content.match(/\[\[.+?\]\]/g) || []).length : 0;
      linksEl.textContent = linkCount + ' ' + (getTrans('notes_links') || 'links');
    }
  }

  function updateLinkCount() {
    var note = getNode(state.activeNodeId);
    var el = document.getElementById('note-links');
    if (!el) return;
    var linkCount = (note && note.content) ? (note.content.match(/\[\[.+?\]\]/g) || []).length : 0;
    el.textContent = linkCount + ' ' + (getTrans('notes_links') || 'links');
  }

  // ========== OUTLINE ==========
  function renderOutline() {
    var container = document.getElementById('outline-list');
    if (!container) return;

    var note = getNode(state.activeNodeId);
    if (!note || !note.content) {
      container.innerHTML = '<span class="outline-empty">No headers</span>';
      return;
    }

    var lines = note.content.split('\n');
    var headers = [];

    lines.forEach(function(line, idx) {
      var match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        headers.push({
          level: match[1].length,
          text: match[2],
          lineIndex: idx
        });
      }
    });

    if (headers.length === 0) {
      container.innerHTML = '<span class="outline-empty">No headers</span>';
      return;
    }

    container.innerHTML = '';
    headers.forEach(function(header) {
      var item = document.createElement('div');
      item.className = 'outline-item h' + header.level;
      item.textContent = header.text;
      item.title = 'Jump to: ' + header.text;
      item.addEventListener('click', function() {
        jumpToHeader(header.lineIndex);
      });
      container.appendChild(item);
    });
  }

  function jumpToHeader(lineIndex) {
    var editor = document.getElementById('note-editor');
    if (!editor) return;

    var lines = editor.value.split('\n');
    var charPos = 0;
    for (var i = 0; i < lineIndex && i < lines.length; i++) {
      charPos += lines[i].length + 1;
    }

    editor.focus();
    editor.setSelectionRange(charPos, charPos);
    editor.scrollTop = editor.scrollHeight * (charPos / editor.value.length);
  }

  // ========== BACKLINKS & RELATED ==========
  function renderBacklinks() {
    var note = getNode(state.activeNodeId);
    var listEl = document.getElementById('backlinks-list');
    var countEl = document.getElementById('backlinks-count');
    if (!listEl || !note) return;

    listEl.innerHTML = '';
    var backlinks = [];

    getNotes().forEach(function(otherNote) {
      if (otherNote.id === note.id) return;
      if (!otherNote.content) return;

      var regex = new RegExp('\\[\\[(' + escapeRegex(note.title) + ')\\]\\]', 'i');
      if (regex.test(otherNote.content)) {
        backlinks.push(otherNote);
      }
    });

    if (countEl) countEl.textContent = backlinks.length;

    if (backlinks.length === 0) {
      listEl.innerHTML = '<div class="backlinks-empty">No backlinks</div>';
    } else {
      backlinks.forEach(function(bl) {
        var item = document.createElement('div');
        item.className = 'backlink-item';
        item.innerHTML = '<i class="fa fa-file-text-o"></i>' + escapeHtml(bl.title);
        item.addEventListener('click', function() { selectNote(bl.id); });
        listEl.appendChild(item);
      });
    }

    renderRelatedNotes();
  }

  function renderRelatedNotes() {
    var note = getNode(state.activeNodeId);
    var listEl = document.getElementById('related-list');
    if (!listEl || !note) return;

    listEl.innerHTML = '';
    var noteTags = note.tags || [];

    if (noteTags.length === 0) {
      listEl.innerHTML = '<div class="backlinks-empty">No related notes</div>';
      return;
    }

    var scored = [];
    getNotes().forEach(function(other) {
      if (other.id === note.id) return;
      var otherTags = other.tags || [];
      var shared = 0;
      noteTags.forEach(function(t) {
        if (otherTags.indexOf(t) !== -1) shared++;
      });
      if (shared > 0) {
        scored.push({ note: other, score: shared });
      }
    });

    scored.sort(function(a, b) { return b.score - a.score; });

    if (scored.length === 0) {
      listEl.innerHTML = '<div class="backlinks-empty">No related notes</div>';
      return;
    }

    scored.forEach(function(entry) {
      var item = document.createElement('div');
      item.className = 'related-item';
      item.innerHTML = '<i class="fa fa-tag"></i>' + escapeHtml(entry.note.title) +
        '<span class="related-score">' + entry.score + '</span>';
      item.addEventListener('click', function() { selectNote(entry.note.id); });
      listEl.appendChild(item);
    });
  }

  // ========== SEARCH ==========
  function applySearchFilter() {
    var query = state.searchQuery.toLowerCase().trim();
    var items = document.querySelectorAll('.tree-item');
    var isTagSearch = query.startsWith('#');
    var tagQuery = isTagSearch ? query.slice(1) : null;

    items.forEach(function(item) {
      var titleEl = item.querySelector('.tree-title');
      if (!titleEl) return;

      var title = titleEl.textContent.toLowerCase();
      var visible = false;

      if (query === '') {
        visible = true;
      } else if (isTagSearch) {
        var nodeId = item.getAttribute('data-id');
        var node = getNode(nodeId);
        if (node && node.tags && node.tags.some(function(t) {
          return t.toLowerCase().includes(tagQuery);
        })) {
          visible = true;
        }
        if (node && node.type === 'folder') visible = true;
      } else {
        visible = title.includes(query);
      }

      item.parentElement.style.display = visible ? '' : 'none';
    });
  }

  // ============================================
  // MULTI-FORMAT EXPORT (UPDATED WITH SETTINGS)
  // ============================================
  function exportData(scope, format) {
    if (scope === 'note') {
      exportSingleNote(format);
    } else {
      exportAllNotes(format);
    }
  }

  function exportAllNotes(format) {
    var notes = getNotes();

    switch(format) {
      case 'json':
        exportJsonBackup();
        break;
      case 'md':
        var mdContent = notes.map(function(n) {
          return '# ' + n.title + '\n\n' + (n.content || '') + '\n\n---\n';
        }).join('\n');
        downloadBlob(mdContent, 'notes_all.md', 'text/markdown');
        showToast('Exported all notes as Markdown');
        break;
      case 'txt':
        var txtContent = notes.map(function(n) {
          return '=== ' + n.title + ' ===\n\n' + (n.content || '') + '\n\n';
        }).join('\n');
        downloadBlob(txtContent, 'notes_all.txt', 'text/plain');
        showToast('Exported all notes as text');
        break;
      case 'doc':
        var docContent = generateDocHtml(notes, true);
        downloadBlob(docContent, 'notes_all.doc', 'application/msword');
        showToast('Exported all notes as Word document');
        break;
      case 'pdf':
        var pdfContent = generatePrintHtml(notes, true);
        printContent(pdfContent);
        break;
    }
  }

  function exportSingleNote(format) {
    var note = getNode(state.activeNodeId);
    if (!note) return;

    switch(format) {
      case 'md':
        var mdContent = '# ' + note.title + '\n\n' + (note.content || '');
        downloadBlob(mdContent, sanitizeFilename(note.title) + '.md', 'text/markdown');
        showToast('Exported as Markdown');
        break;
      case 'txt':
        var txtContent = note.content || '';
        downloadBlob(txtContent, sanitizeFilename(note.title) + '.txt', 'text/plain');
        showToast('Exported as text');
        break;
      case 'doc':
        var docHtml = generateDocHtml([note], false);
        downloadBlob(docHtml, sanitizeFilename(note.title) + '.doc', 'application/msword');
        showToast('Exported as Word document');
        break;
      case 'pdf':
        var printHtml = generatePrintHtml([note], false);
        printContent(printHtml);
        break;
    }
  }

  function exportJsonBackup() {
    var settings = {};
    SETTING_KEYS.forEach(function(key) {
      var val = localStorage.getItem(key);
      if (val !== null) settings[key] = val;
    });

    var data = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      nodes: state.nodes,
      settings: settings
    };

    var jsonStr = JSON.stringify(data, null, 2);

    if (window.showSaveFilePicker) {
      window.showSaveFilePicker({
        suggestedName: 'notes_backup_' + new Date().toISOString().slice(0,10) + '.json',
        types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
      }).then(function(handle) {
        return handle.createWritable();
      }).then(function(writable) {
        return writable.write(jsonStr).then(function() { return writable.close(); });
      }).then(function() {
        showToast('Backup exported successfully');
      }).catch(function(e) {
        if (e.name !== 'AbortError') {
          downloadBlob(jsonStr, 'notes_backup.json', 'application/json');
          showToast('Backup exported');
        }
      });
    } else {
      downloadBlob(jsonStr, 'notes_backup.json', 'application/json');
      showToast('Backup exported');
    }
  }

  function generateDocHtml(notes, isAll) {
    var body = notes.map(function(n) {
      var parsedHtml = parseMarkdown(n.content || '');
      parsedHtml = processWikilinks(parsedHtml);
      return '<h1>' + escapeHtml(n.title) + '</h1>' + parsedHtml;
    }).join('<hr>');

    return '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>orOS Notes Export</title>' +
      '<style>body{font-family:Nunito,sans-serif;font-size:14px;line-height:1.6;color:#333;}' +
      'h1{color:#c8a96e;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px;}' +
      'h2,h3{color:#555;}code{background:#f4f4f4;padding:2px 6px;border-radius:3px;}' +
      'pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto;}' +
      'blockquote{border-left:3px solid #c8a96e;margin:8px 0;padding:4px 16px;color:#666;}' +
      'table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:8px;}' +
      'th{background:#f0f0f0;font-weight:bold;}</style></head><body>' + body + '</body></html>';
  }

  function generatePrintHtml(notes, isAll) {
    var body = notes.map(function(n) {
      var parsedHtml = parseMarkdown(n.content || '');
      parsedHtml = processWikilinks(parsedHtml);
      return '<h1>' + escapeHtml(n.title) + '</h1>' + parsedHtml;
    }).join('<div style="page-break-after:always;"></div>');

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>orOS Notes</title>' +
      '<style>@page{margin:2cm;}' +
      'body{font-family:Georgia,serif;font-size:13px;line-height:1.7;color:#222;}' +
      'h1{color:#c8a96e;border-bottom:1px solid #ddd;padding-bottom:4px;page-break-after:avoid;}' +
      'h2{color:#444;page-break-after:avoid;}h3{color:#666;page-break-after:avoid;}' +
      'code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-family:monospace;}' +
      'pre{background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;page-break-inside:avoid;}' +
      'blockquote{border-left:3px solid #c8a96e;margin:8px 0;padding:4px 16px;color:#666;}' +
      'table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:8px;}' +
      'th{background:#f0f0f0;}' +
      'a{color:#c8a96e;text-decoration:none;}' +
      '.wikilink{color:#c8a96e;}' +
      'input[type="checkbox"]{margin-right:6px;}</style></head><body>' + body + '</body></html>';
  }

  function printContent(html) {
    var frame = document.getElementById('print-frame');
    if (!frame) return;

    frame.srcdoc = html;
    frame.onload = function() {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch(e) {
        showToast('Print failed. Try opening in new tab.');
      }
    };

    setTimeout(function() {
      try {
        if (frame.contentDocument && frame.contentDocument.body) {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        }
      } catch(e) {}
    }, 500);
  }

  function downloadBlob(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(title) {
    return title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'untitled';
  }

  // ========== IMPORT (UPDATED WITH SETTINGS RESTORE) ==========
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'json') {
          var data = JSON.parse(e.target.result);
          if (!data.nodes || !Array.isArray(data.nodes)) {
            showToast(getTrans('notes_invalid_file') || 'Invalid notes file');
            return;
          }

          // Restore settings if present
          if (data.settings) {
            Object.keys(data.settings).forEach(function(key) {
              localStorage.setItem(key, data.settings[key]);
            });
            showToast('Settings restored');
          }

          var existingTitles = getAllNodes().map(function(n) { return n.title.toLowerCase(); });
          var importedCount = 0;

          function mergeNodes(nodes, parent) {
            nodes.forEach(function(node) {
              if (!existingTitles.includes(node.title.toLowerCase())) {
                var newNode = JSON.parse(JSON.stringify(node));
                newNode.id = genId(node.type);
                newNode.pinned = false;
                if (parent) {
                  if (!parent.children) parent.children = [];
                  parent.children.push(newNode);
                } else {
                  state.nodes.push(newNode);
                }
                importedCount++;
                if (newNode.children && newNode.children.length > 0) {
                  mergeNodes(newNode.children, newNode);
                }
              }
            });
          }

          mergeNodes(data.nodes, null);
          saveData();
          renderAll();
          
          // Re-apply settings
          loadAndApplySettings();
          
          showToast((getTrans('notes_imported') || 'Imported') + ': ' + importedCount + ' items');
        } else if (ext === 'md' || ext === 'txt') {
          var content = e.target.result;
          var title = file.name.replace(/\.(md|txt)$/i, '');
          var note = createNote(null, title);
          note.content = content;
          note.modified = Date.now();
          saveData();
          renderAll();
          showToast('Imported: ' + title);
        }
      } catch(err) {
        showToast(getTrans('notes_import_failed') || 'Failed to import');
      }
    };
    reader.readAsText(file);
  }

  function loadAndApplySettings() {
    // Apply default view mode
    var defaultMode = localStorage.getItem(DEFAULT_VIEW_MODE) || 'split';
    applyViewMode(defaultMode);
    
    // Set view buttons state
    document.querySelectorAll('.view-btn').forEach(function(btn) {
      btn.classList.remove('active');
      if ((defaultMode === 'split' && btn.id === 'btn-view-split') ||
          (defaultMode === 'editor' && btn.id === 'btn-view-editor') ||
          (defaultMode === 'preview' && btn.id === 'btn-view-preview')) {
        btn.classList.add('active');
      }
    });
    
    // Set backlinks default state
    var backlinksDefault = localStorage.getItem(BACKLINKS_DEFAULT_STATE) || 'open';
    var panel = document.getElementById('backlinks-panel');
    if (panel) {
      if (backlinksDefault === 'closed') {
        panel.classList.add('collapsed');
      } else {
        panel.classList.remove('collapsed');
      }
    }
    
    // Apply sidebar sort order
    var sortOrder = localStorage.getItem(SIDEBAR_SORT_ORDER) || 'recent-modified';
    var sortSelect = document.getElementById('setting-sidebar-sort');
    if (sortSelect) sortSelect.value = sortOrder;
  }

  // ========== TOGGLE / VIEW ==========
  function toggleSidebar() {
    var sidebar = document.getElementById('notes-sidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
    localStorage.setItem(SIDEBAR_COLLAPSED, sidebar ? (sidebar.classList.contains('collapsed') ? 'true' : 'false') : 'false');
  }

  function applyViewMode(mode) {
    var container = document.getElementById('notes-main');
    var editorBody = document.querySelector('.editor-body');
    var editorTextarea = document.getElementById('note-editor');
    var previewDiv = document.getElementById('note-preview');
    var tabWrite = document.getElementById('tab-write');
    var tabPreview = document.getElementById('tab-preview');

    if (!container || !editorBody) return;

    container.classList.remove('view-editor-only', 'view-preview-only');
    editorBody.classList.remove('full-width');

    switch(mode) {
      case 'editor':
        container.classList.add('view-editor-only');
        if (editorTextarea) editorTextarea.style.display = '';
        if (previewDiv) previewDiv.style.display = 'none';
        if (tabWrite) tabWrite.classList.add('active');
        if (tabPreview) tabPreview.classList.remove('active');
        break;
      case 'preview':
        container.classList.add('view-preview-only');
        editorBody.classList.add('full-width');
        if (editorTextarea) editorTextarea.style.display = 'none';
        if (previewDiv) { previewDiv.style.display = 'block'; previewDiv.classList.add('visible'); }
        if (tabWrite) tabWrite.classList.remove('active');
        if (tabPreview) tabPreview.classList.add('active');
        break;
      default:
        if (editorTextarea) editorTextarea.style.display = '';
        if (previewDiv) { previewDiv.style.display = 'block'; previewDiv.classList.add('visible'); }
        if (tabWrite) tabWrite.classList.add('active');
        if (tabPreview) tabPreview.classList.remove('active');
    }

    localStorage.setItem(VIEW_MODE, mode);
  }

  function toggleMarkdownPreview() {
    var editorBody = document.querySelector('.editor-body');
    if (!editorBody) return;
    if (editorBody.classList.contains('full-width')) {
      applyViewMode('split');
    } else {
      applyViewMode('preview');
    }
  }

  function switchTab(tabName) {
    var tabWrite = document.getElementById('tab-write');
    var tabPreview = document.getElementById('tab-preview');
    if (tabWrite) tabWrite.classList.remove('active');
    if (tabPreview) tabPreview.classList.remove('active');

    if (tabName === 'write') {
      if (tabWrite) tabWrite.classList.add('active');
      applyViewMode('editor');
      var editor = document.getElementById('note-editor');
      if (editor) editor.focus();
    } else if (tabName === 'preview') {
      if (tabPreview) tabPreview.classList.add('active');
      applyViewMode('preview');
      var ed = document.getElementById('note-editor');
      if (ed) syncPreview(ed.value);
    }
  }

  // ========== GRAPH VIEW ==========
  function buildGraphData() {
    var notes = getNotes();
    var nodes = notes.map(function(n) {
      return { id: n.id, title: n.title, tags: n.tags || [] };
    });

    var edges = [];
    notes.forEach(function(note) {
      if (note.content) {
        var matches = note.content.match(/\[\[(.+?)\]\]/g) || [];
        matches.forEach(function(match) {
          var name = match.replace(/\[\[|\]\]/g, '').trim();
          var target = findNoteByTitle(name);
          if (target) {
            edges.push({ source: note.id, target: target.id });
          }
        });
      }
    });

    state.graphNodes = nodes;
    state.graphEdges = edges;
  }

  function renderGraph() {
    buildGraphData();
    var canvas = document.getElementById('graph-canvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    var cx = canvas.width / 2;
    var cy = canvas.height / 2;
    var radius = Math.min(cx, cy) * 0.7;

    var nodes = state.graphNodes;
    var edges = state.graphEdges;
    var angleStep = (Math.PI * 2) / Math.max(nodes.length, 1);

    var positions = {};
    nodes.forEach(function(node, i) {
      var angle = i * angleStep;
      positions[node.id] = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });

    ctx.strokeStyle = 'rgba(200, 169, 110, 0.3)';
    ctx.lineWidth = 1;
    edges.forEach(function(edge) {
      var s = positions[edge.source];
      var t = positions[edge.target];
      if (s && t) {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
    });

    nodes.forEach(function(node) {
      var pos = positions[node.id];
      if (!pos) return;

      var isActive = node.id === state.activeNodeId;
      var hasLinks = edges.some(function(e) { return e.source === node.id || e.target === node.id; });

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isActive ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#c8a96e' : (hasLinks ? '#8a7a5a' : '#5a5345');
      ctx.fill();

      if (isActive) {
        ctx.strokeStyle = '#c8a96e';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = '#8a8474';
      ctx.font = '10px Nunito, sans-serif';
      ctx.textAlign = 'center';
      var label = node.title.length > 15 ? node.title.substring(0, 12) + '...' : node.title;
      ctx.fillText(label, pos.x, pos.y + 18);
    });
  }

  function openGraphModal() {
    var modal = document.getElementById('graph-modal');
    if (!modal) return;
    modal.classList.add('visible');
    setTimeout(renderGraph, 50);
  }

  function closeGraphModal() {
    var modal = document.getElementById('graph-modal');
    if (modal) modal.classList.remove('visible');
  }

  // ========== RESIZE HANDLER FOR GRAPH ==========
  var graphResizeTimeout = null;
  function handleGraphResize() {
    if (graphResizeTimeout) clearTimeout(graphResizeTimeout);
    graphResizeTimeout = setTimeout(function() {
      var graphModal = document.getElementById('graph-modal');
      if (graphModal && graphModal.classList.contains('visible')) {
        renderGraph();
      }
    }, 150);
  }
  
  // ========== COMMAND PALETTE ==========
  function openCommandPalette() {
    var modal = document.getElementById('command-palette-modal');
    var input = document.getElementById('command-palette-input');
    if (!modal || !input) return;

    modal.classList.add('visible');
    input.value = '';
    state.commandPaletteIndex = 0;

    renderCommandPaletteResults('');
    setTimeout(function() { input.focus(); }, 50);
  }

  function closeCommandPalette() {
    var modal = document.getElementById('command-palette-modal');
    if (modal) modal.classList.remove('visible');
  }

  function getCommands() {
    return [
      { label: 'New Note', icon: 'fa-plus', type: 'command', action: function() {
        var activeNode = getNode(state.activeNodeId);
        var parentId = (activeNode && activeNode.type === 'folder') ? activeNode.id : null;
        createNote(parentId);
      }},
      { label: 'New Folder', icon: 'fa-folder-o', type: 'command', action: function() {
        var name = prompt('Folder name:', 'New Folder');
        if (name && name.trim()) {
          var activeNode = getNode(state.activeNodeId);
          var parentId = (activeNode && activeNode.type === 'folder') ? activeNode.id : null;
          createFolder(parentId, name.trim());
        }
      }},
      { label: 'Daily Note', icon: 'fa-calendar', type: 'command', action: createOrOpenDailyNote },
      { label: 'Graph View', icon: 'fa-share-square-o', type: 'command', action: openGraphModal },
      { label: 'Toggle Sidebar', icon: 'fa-bars', type: 'command', action: toggleSidebar },
      { label: 'Backup Database (JSON)', icon: 'fa-database', type: 'command', action: function() { exportJsonBackup(); }},
      { label: 'Import Notes', icon: 'fa-folder-open', type: 'command', action: function() {
        var input = document.getElementById('import-file-input');
        if (input) input.click();
      }},
      { label: 'Export All (Markdown)', icon: 'fa-file-text-o', type: 'command', action: function() { exportAllNotes('md'); }},
      { label: 'Export All (Text)', icon: 'fa-file-o', type: 'command', action: function() { exportAllNotes('txt'); }},
      { label: 'Export All (Word)', icon: 'fa-file-word-o', type: 'command', action: function() { exportAllNotes('doc'); }},
      { label: 'Export All (PDF)', icon: 'fa-file-pdf-o', type: 'command', action: function() { exportAllNotes('pdf'); }},
      { label: 'Export Current Note (MD)', icon: 'fa-file-text-o', type: 'command', action: function() { exportSingleNote('md'); }},
      { label: 'Export Current Note (Word)', icon: 'fa-file-word-o', type: 'command', action: function() { exportSingleNote('doc'); }},
      { label: 'Export Current Note (PDF)', icon: 'fa-file-pdf-o', type: 'command', action: function() { exportSingleNote('pdf'); }}
    ];
  }

  function renderCommandPaletteResults(query) {
    var container = document.getElementById('command-palette-results');
    if (!container) return;
    container.innerHTML = '';

    var commands = getCommands();
    var notes = getNotes();
    var results = [];
    var lowerQuery = query.toLowerCase().trim();

    if (query === '' || query.startsWith('>')) {
      var cmdQuery = query.startsWith('>') ? query.slice(1).trim() : '';
      var lowerCmdQuery = cmdQuery.toLowerCase();
      commands.forEach(function(cmd) {
        if (cmdQuery === '' || cmd.label.toLowerCase().includes(lowerCmdQuery)) {
          results.push({
            label: cmd.label,
            icon: cmd.icon,
            type: 'Command',
            action: cmd.action
          });
        }
      });
    }

    if (query !== '' && !query.startsWith('>')) {
      notes.forEach(function(note) {
        if (note.title.toLowerCase().includes(lowerQuery) ||
            (note.content && note.content.toLowerCase().includes(lowerQuery))) {
          results.push({
            label: note.title,
            icon: 'fa-file-text-o',
            type: 'Note',
            action: function() { selectNote(note.id); }
          });
        }
      });

      if (lowerQuery.startsWith('#')) {
        var tagQ = lowerQuery.slice(1);
        notes.forEach(function(note) {
          if (note.tags && note.tags.some(function(t) { return t.includes(tagQ); })) {
            results.push({
              label: note.title + ' #' + note.tags.join(' #'),
              icon: 'fa-tag',
              type: 'Tag',
              action: function() { selectNote(note.id); }
            });
          }
        });
      }
    }

    state.commandPaletteResults = results;
    state.commandPaletteIndex = 0;

    if (results.length === 0) {
      container.innerHTML = '<div class="cmd-item" style="opacity:0.5;cursor:default;">No results found</div>';
      return;
    }

    results.forEach(function(result, i) {
      var item = document.createElement('div');
      item.className = 'cmd-item' + (i === 0 ? ' selected' : '');
      item.innerHTML = '<i class="fa ' + result.icon + '"></i>' + escapeHtml(result.label) +
        '<span class="cmd-item-type">' + result.type + '</span>';
      item.addEventListener('click', function() {
        if (result.action) result.action();
        closeCommandPalette();
      });
      item.addEventListener('mouseenter', function() {
        state.commandPaletteIndex = i;
        updateCommandPaletteSelection();
      });
      container.appendChild(item);
    });
  }

  function updateCommandPaletteSelection() {
    var items = document.querySelectorAll('#command-palette-results .cmd-item');
    items.forEach(function(item, i) {
      item.classList.toggle('selected', i === state.commandPaletteIndex);
    });
  }

  function navigateCommandPalette(direction) {
    var results = state.commandPaletteResults;
    if (results.length === 0) return;

    if (direction === 'down') {
      state.commandPaletteIndex = (state.commandPaletteIndex + 1) % results.length;
    } else if (direction === 'up') {
      state.commandPaletteIndex = (state.commandPaletteIndex - 1 + results.length) % results.length;
    }
    updateCommandPaletteSelection();

    var selected = document.querySelector('.cmd-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function executeCommandPalette() {
    var result = state.commandPaletteResults[state.commandPaletteIndex];
    if (result && result.action) {
      result.action();
    }
    closeCommandPalette();
  }

  // ========== AUTOCOMPLETE ==========
  function handleAutocomplete() {
    var editor = document.getElementById('note-editor');
    var dropdown = document.getElementById('autocomplete-dropdown');
    if (!editor || !dropdown) return;

    var cursorPos = editor.selectionStart;
    var textBefore = editor.value.substring(0, cursorPos);

    var lastOpen = textBefore.lastIndexOf('[[');
    if (lastOpen === -1) {
      hideAutocomplete();
      return;
    }

    var textAfterOpen = textBefore.substring(lastOpen + 2);
    if (textAfterOpen.includes(']]')) {
      hideAutocomplete();
      return;
    }

    var query = textAfterOpen.trim();

    if (query.includes('\n')) {
      hideAutocomplete();
      return;
    }

    var notes = getNotes();
    var matching = notes.filter(function(n) {
      return n.title.toLowerCase().includes(query.toLowerCase());
    }).slice(0, 8);

    if (matching.length === 0) {
      hideAutocomplete();
      return;
    }

    state.autocompleteResults = matching;
    state.autocompleteIndex = 0;

    var listEl = document.getElementById('autocomplete-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    matching.forEach(function(note, i) {
      var item = document.createElement('div');
      item.className = 'autocomplete-item' + (i === 0 ? ' selected' : '');
      var tagHtml = '';
      if (note.tags && note.tags.length > 0) {
        tagHtml = '<span class="ac-tag-list">';
        note.tags.slice(0, 2).forEach(function(t) {
          tagHtml += '<span class="ac-tag">#' + escapeHtml(t) + '</span>';
        });
        tagHtml += '</span>';
      }
      item.innerHTML = '<i class="fa fa-file-text-o"></i>' + escapeHtml(note.title) + tagHtml;

      item.addEventListener('mousedown', function(e) {
        e.preventDefault();
        insertAutocomplete(note.title, lastOpen, cursorPos);
      });
      item.addEventListener('mouseenter', function() {
        state.autocompleteIndex = i;
        updateAutocompleteSelection();
      });
      listEl.appendChild(item);
    });

    var rect = editor.getBoundingClientRect();
    var lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 21;
    var fontSize = parseFloat(getComputedStyle(editor).fontSize) || 14;

    var linesBefore = textBefore.split('\n').length - 1;
    var charsInLastLine = textBefore.length - textBefore.lastIndexOf('\n') - 1;
    var charWidthEstimate = fontSize * 0.57;

    var xPos = rect.left + (charsInLastLine * charWidthEstimate) + rect.width;
    var yPos = rect.top + ((linesBefore + 1) * lineHeight);

    xPos = Math.min(xPos, window.innerWidth - 280);
    yPos = Math.min(yPos, window.innerHeight - 220);

    dropdown.style.display = 'block';
    dropdown.style.left = xPos + 'px';
    dropdown.style.top = yPos + 'px';
  }

  function updateAutocompleteSelection() {
    var items = document.querySelectorAll('.autocomplete-item');
    items.forEach(function(item, i) {
      item.classList.toggle('selected', i === state.autocompleteIndex);
    });
  }

  function hideAutocomplete() {
    var dropdown = document.getElementById('autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    state.autocompleteResults = [];
  }

  function insertAutocomplete(noteTitle, openPos, cursorPos) {
    var editor = document.getElementById('note-editor');
    if (!editor) return;

    var before = editor.value.substring(0, openPos);
    var after = editor.value.substring(cursorPos);
    var insertion = '[[' + noteTitle + ']]';

    editor.value = before + insertion + after;

    var newPos = openPos + insertion.length;
    editor.selectionStart = newPos;
    editor.selectionEnd = newPos;
    editor.focus();

    hideAutocomplete();
    updateNoteContent(editor.value);

    var preview = document.getElementById('note-preview');
    if (preview && preview.style.display !== 'none') {
      syncPreview(editor.value);
    }
  }

  function navigateAutocomplete(direction) {
    var results = state.autocompleteResults;
    if (results.length === 0) return;

    if (direction === 'down') {
      state.autocompleteIndex = (state.autocompleteIndex + 1) % results.length;
    } else if (direction === 'up') {
      state.autocompleteIndex = (state.autocompleteIndex - 1 + results.length) % results.length;
    }
    updateAutocompleteSelection();
  }

  function selectAutocomplete() {
    var note = state.autocompleteResults[state.autocompleteIndex];
    if (!note) return false;

    var editor = document.getElementById('note-editor');
    var cursorPos = editor.selectionStart;
    var textBefore = editor.value.substring(0, cursorPos);
    var lastOpen = textBefore.lastIndexOf('[[');

    if (lastOpen !== -1) {
      insertAutocomplete(note.title, lastOpen, cursorPos);
      return true;
    }
    return false;
  }

  // ========== CONTEXT MENUS ==========
  function showContextMenu(x, y, nodeId) {
    state.contextTargetId = nodeId;
    var menu = document.getElementById('context-menu');
    if (!menu) return;

    var node = getNode(nodeId);
    var ctxLabel = document.getElementById('ctx-pin-label');
    if (ctxLabel && node) {
      ctxLabel.textContent = node.pinned ? 'Unpin' : 'Pin';
    }

    var pasteItem = menu.querySelector('[data-action="paste"]');
    if (pasteItem) {
      pasteItem.classList.toggle('disabled', !state.clipboard);
    }

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('visible');

    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
  }

  function hideContextMenu() {
    var menu = document.getElementById('context-menu');
    if (menu) menu.classList.remove('visible');
    state.contextTargetId = null;
  }

  function showEditorContextMenu(x, y) {
    var menu = document.getElementById('editor-context-menu');
    if (!menu) return;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('visible');
  }

  function hideEditorContextMenu() {
    var menu = document.getElementById('editor-context-menu');
    if (menu) menu.classList.remove('visible');
  }

  // ========== RENAME MODAL ==========
  var renameCallback = null;

  function openRenameModal(nodeId) {
    var node = getNode(nodeId);
    if (!node) return;
    var modal = document.getElementById('rename-modal');
    var input = document.getElementById('rename-input');
    if (!modal || !input) return;

    input.value = node.title;
    modal.classList.add('visible');

    setTimeout(function() { input.focus(); input.select(); }, 50);

    renameCallback = function(newTitle) {
      if (newTitle && newTitle.trim() && newTitle.trim() !== node.title) {
        renameNode(nodeId, newTitle.trim());
      }
    };
  }

  function closeRenameModal() {
    var modal = document.getElementById('rename-modal');
    if (modal) modal.classList.remove('visible');
    renameCallback = null;
  }

  function confirmRename() {
    var input = document.getElementById('rename-input');
    if (!input) return;
    if (renameCallback) renameCallback(input.value);
    closeRenameModal();
  }

  // ========== LINK PICKER MODAL ==========
  function openLinkPickerModal(noteName) {
    var modal = document.getElementById('link-picker-modal');
    var input = document.getElementById('link-picker-target');
    if (!modal || !input) return;

    input.value = noteName;
    state.pendingLinkId = noteName;
    modal.classList.add('visible');
    renderNoteResults(noteName);

    setTimeout(function() { input.focus(); input.select(); }, 50);
  }

  function closeLinkPickerModal() {
    var modal = document.getElementById('link-picker-modal');
    if (modal) modal.classList.remove('visible');
    state.pendingLinkId = null;
  }

  function renderNoteResults(query) {
    var container = document.getElementById('note-list-results');
    if (!container) return;
    container.innerHTML = '';

    var lowerQuery = (query || '').toLowerCase();
    var matching = getNotes().filter(function(n) {
      return n.title.toLowerCase().includes(lowerQuery);
    });

    if (matching.length === 0) {
      container.innerHTML = '<div class="note-result-item" style="cursor:default;color:var(--text-muted,#8a8474);font-style:italic;">No matching notes found</div>';
      return;
    }

    matching.forEach(function(note) {
      var item = document.createElement('div');
      item.className = 'note-result-item';
      item.textContent = note.title;
      item.addEventListener('click', function() {
        selectNote(note.id);
        closeLinkPickerModal();
      });
      container.appendChild(item);
    });
  }

  function confirmLinkPickerCreate() {
    var input = document.getElementById('link-picker-target');
    var noteName = input ? input.value.trim() : '';
    if (!noteName) { closeLinkPickerModal(); return; }

    var existing = findNoteByTitle(noteName);
    if (existing) {
      selectNote(existing.id);
    } else {
      createNote(null, noteName);
    }
    closeLinkPickerModal();
  }

  // ========== EMPTY STATE ==========
  function toggleEmptyState() {
    var emptyState = document.getElementById('notes-empty-state');
    var editorPanel = document.getElementById('notes-editor-panel');
    var toolbar = document.getElementById('notes-toolbar');
    var container = document.getElementById('notes-container');
    var sidebar = document.getElementById('notes-sidebar');

    var hasNotes = getNotes().length > 0;

    if (!hasNotes) {
      if (emptyState) emptyState.style.display = 'flex';
      if (editorPanel) editorPanel.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
      if (sidebar) sidebar.style.display = 'none';
      if (container) container.style.display = 'flex';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      if (toolbar) toolbar.style.display = '';
      if (sidebar) sidebar.style.display = '';
      if (container) container.style.display = '';
      var note = getNode(state.activeNodeId);
      if (!note || note.type !== 'note') {
        if (editorPanel) editorPanel.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
      } else {
        if (editorPanel) editorPanel.style.display = 'flex';
        if (emptyState) emptyState.style.display = 'none';
      }
    }
  }

  // ========== FORMAT SELECTION ==========
  function applyFormatToSelection(format) {
    var editor = document.getElementById('note-editor');
    if (!editor) return;

    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    var selectedText = editor.value.substring(start, end);
    var newText = selectedText;

    switch(format) {
      case 'bold': newText = '**' + selectedText + '**'; break;
      case 'italic': newText = '*' + selectedText + '*'; break;
      case 'strike': newText = '~~' + selectedText + '~~'; break;
      case 'code': newText = '`' + selectedText + '`'; break;
      case 'wikilink': newText = '[[' + selectedText + ']]'; break;
      case 'checkbox': newText = '- [ ] ' + selectedText; break;
      case 'h1': newText = '# ' + selectedText; break;
      case 'h2': newText = '## ' + selectedText; break;
      case 'h3': newText = '### ' + selectedText; break;
    }

    editor.value = editor.value.substring(0, start) + newText + editor.value.substring(end);
    var newCursorPos = start + newText.length;
    editor.selectionStart = newCursorPos;
    editor.selectionEnd = newCursorPos;
    editor.focus();
    updateNoteContent(editor.value);

    var preview = document.getElementById('note-preview');
    if (preview && preview.style.display !== 'none') syncPreview(editor.value);
  }

  // ========== EXPORT DROPDOWN ==========
  function toggleExportDropdown() {
    var dropdown = document.getElementById('export-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('visible');
  }

  function hideExportDropdown() {
    var dropdown = document.getElementById('export-dropdown');
    if (dropdown) dropdown.classList.remove('visible');
  }

  // ========== SETTINGS MODAL ==========
  function openSettingsModal() {
    var modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.add('visible');

    var viewSelect = document.getElementById('setting-default-view');
    if (viewSelect) {
      viewSelect.value = localStorage.getItem(DEFAULT_VIEW_MODE) || 'split';
    }

    var backlinksDefaultSelect = document.getElementById('setting-backlinks-default');
    if (backlinksDefaultSelect) {
      backlinksDefaultSelect.value = localStorage.getItem(BACKLINKS_DEFAULT_STATE) || 'open';
    }

    var sortSelect = document.getElementById('setting-sidebar-sort');
    if (sortSelect) {
      sortSelect.value = localStorage.getItem(SIDEBAR_SORT_ORDER) || 'recent-modified';
    }
  }

  function closeSettingsModal() {
    var modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('visible');
  }

  function setupSettingsModal() {
    var modal = document.getElementById('settings-modal');
    if (!modal) return;

    // View mode selector
    var viewSelect = document.getElementById('setting-default-view');
    if (viewSelect) {
      viewSelect.value = localStorage.getItem(DEFAULT_VIEW_MODE) || 'split';
      viewSelect.addEventListener('change', function() {
        var mode = this.value;
        localStorage.setItem(DEFAULT_VIEW_MODE, mode);
        applyViewMode(mode);
        showToast('Default view saved');
      });
    }

    // Backlinks default state
    var backlinksSelect = document.getElementById('setting-backlinks-default');
    if (backlinksSelect) {
      backlinksSelect.value = localStorage.getItem(BACKLINKS_DEFAULT_STATE) || 'open';
      backlinksSelect.addEventListener('change', function() {
        var state = this.value;
        localStorage.setItem(BACKLINKS_DEFAULT_STATE, state);
        var panel = document.getElementById('backlinks-panel');
        if (panel) {
          if (state === 'closed') {
            panel.classList.add('collapsed');
          } else {
            panel.classList.remove('collapsed');
          }
        }
        showToast('Backlinks default saved');
      });
    }

    // Sidebar sort order
    var sortSelect = document.getElementById('setting-sidebar-sort');
    if (sortSelect) {
      sortSelect.value = localStorage.getItem(SIDEBAR_SORT_ORDER) || 'recent-modified';
      sortSelect.addEventListener('change', function() {
        var order = this.value;
        localStorage.setItem(SIDEBAR_SORT_ORDER, order);
        renderTree();
        showToast('Sort order saved');
      });
    }
  }

  // ========== UTILITY ==========
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function setActiveViewButton(btn) {
    document.querySelectorAll('.view-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }

  function setActiveViewButtonSmall(btn) {
    document.querySelectorAll('.view-btn-small').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }

  // ========== TOOLBAR VISIBILITY ==========
  function applyToolbarVisibility() {
    var hideNewNote = localStorage.getItem('oros_hide_new_note_btn') === 'true';
    var hideNewFolder = localStorage.getItem('oros_hide_new_folder_btn') === 'true';
    var hideSidebarToggle = localStorage.getItem('oros_hide_sidebar_toggle') === 'true';

    var btnNewNote = document.getElementById('btn-new-note');
    if (btnNewNote) btnNewNote.style.display = hideNewNote ? 'none' : '';

    var btnNewFolder = document.getElementById('btn-new-folder');
    if (btnNewFolder) btnNewFolder.style.display = hideNewFolder ? 'none' : '';

    var btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) btnToggleSidebar.style.display = hideSidebarToggle ? 'none' : '';

    var btnGraph = document.getElementById('btn-graph');
    if (btnGraph) btnGraph.style.display = localStorage.getItem('oros_hide_graph_btn') === 'true' ? 'none' : '';

    var btnDailyNote = document.getElementById('btn-daily-note');
    if (btnDailyNote) btnDailyNote.style.display = localStorage.getItem('oros_hide_daily_btn') === 'true' ? 'none' : '';
  }

  // ========== ZEN MODE ==========
  function toggleZenMode() {
    var zenEnabled = localStorage.getItem('oros-zen-mode') === 'true';
    document.body.setAttribute('data-zen', zenEnabled);
    
    var btn = document.getElementById('toggle-zen-mode');
    if (btn) btn.checked = zenEnabled;
  }

  function setupZenMode() {
    var btn = document.getElementById('toggle-zen-mode');
    if (!btn) return;
    
    btn.checked = localStorage.getItem('oros-zen-mode') === 'true';
    btn.addEventListener('change', function() {
      var enabled = this.checked;
      localStorage.setItem('oros-zen-mode', enabled);
      document.body.setAttribute('data-zen', enabled);
      showToast(enabled ? 'Zen Mode On' : 'Zen Mode Off');
    });
  }

  // ========== SETUP ==========
  function setup() {
    // ===== Toolbar Buttons =====
    var btnNewNote = document.getElementById('btn-new-note');
    var btnNewFolder = document.getElementById('btn-new-folder');
    var btnDailyNote = document.getElementById('btn-daily-note');
    var btnGraph = document.getElementById('btn-graph');
    var btnCmdPalette = document.getElementById('btn-command-palette');

    if (btnNewNote) btnNewNote.addEventListener('click', function() {
      var activeNode = getNode(state.activeNodeId);
      var parentId = (activeNode && activeNode.type === 'folder') ? activeNode.id : null;
      createNote(parentId);
    });

    if (btnNewFolder) btnNewFolder.addEventListener('click', function() {
      var name = prompt(getTrans('notes_folder_name') || 'Folder name:', 'New Folder');
      if (name && name.trim()) {
        var activeNode = getNode(state.activeNodeId);
        var parentId = (activeNode && activeNode.type === 'folder') ? activeNode.id : null;
        createFolder(parentId, name.trim());
      }
    });

    if (btnDailyNote) btnDailyNote.addEventListener('click', createOrOpenDailyNote);
    if (btnGraph) btnGraph.addEventListener('click', openGraphModal);
    if (btnCmdPalette) btnCmdPalette.addEventListener('click', openCommandPalette);

    // ===== Graph Modal Close =====
    var graphModal = document.getElementById('graph-modal');
    var graphOverlay = document.getElementById('graph-modal-overlay');
    var graphClose = document.getElementById('graph-modal-close');
    if (graphOverlay) graphOverlay.addEventListener('click', closeGraphModal);
    if (graphClose) graphClose.addEventListener('click', closeGraphModal);

    // ===== Create First Note =====
    var btnCreateFirst = document.getElementById('btn-create-first-note');
    if (btnCreateFirst) btnCreateFirst.addEventListener('click', function() {
      createNote(null, 'Welcome Note');
    });

    // ===== Toggle Sidebar =====
    var btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);

    // ===== Search =====
    var searchInput = document.getElementById('notes-search');
    var searchClear = document.getElementById('notes-search-clear');

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        state.searchQuery = this.value;
        if (searchClear) searchClear.style.display = this.value ? 'block' : 'none';
        applySearchFilter();
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', function() {
        if (searchInput) {
          searchInput.value = '';
          state.searchQuery = '';
          searchClear.style.display = 'none';
          applySearchFilter();
          searchInput.focus();
        }
      });
    }

    // ===== View Toggles (in footer now) =====
    var btnViewSplit = document.getElementById('btn-view-split');
    var btnViewEditor = document.getElementById('btn-view-editor');
    var btnViewPreview = document.getElementById('btn-view-preview');

    if (btnViewSplit) {
      btnViewSplit.addEventListener('click', function() { 
        setActiveViewButtonSmall(this); 
        applyViewMode('split'); 
      });
    }
    if (btnViewEditor) {
      btnViewEditor.addEventListener('click', function() { 
        setActiveViewButtonSmall(this); 
        applyViewMode('editor'); 
      });
    }
    if (btnViewPreview) {
      btnViewPreview.addEventListener('click', function() { 
        setActiveViewButtonSmall(this); 
        applyViewMode('preview'); 
      });
    }

    // ===== Editor Tabs =====
    var tabWrite = document.getElementById('tab-write');
    var tabPreview = document.getElementById('tab-preview');
    if (tabWrite) tabWrite.addEventListener('click', function() { switchTab('write'); });
    if (tabPreview) tabPreview.addEventListener('click', function() { switchTab('preview'); });

    // ===== Import =====
    var importInput = document.getElementById('import-file-input');
    if (importInput) {
      importInput.addEventListener('change', function() {
        if (this.files && this.files[0]) { importData(this.files[0]); this.value = ''; }
      });
    }

    var btnImport = document.getElementById('btn-import');
    if (btnImport && importInput) {
      btnImport.addEventListener('click', function() { importInput.click(); });
    }

    // ===== Export Dropdown =====
    var btnExport = document.getElementById('btn-export');
    if (btnExport) {
      btnExport.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleExportDropdown();
      });
    }

    var exportDropdown = document.getElementById('export-dropdown');
    if (exportDropdown) {
      exportDropdown.querySelectorAll('.export-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
          e.stopPropagation();
          var scope = this.getAttribute('data-scope');
          var format = this.getAttribute('data-format');
          if (scope && format) {
            exportData(scope, format);
          }
          hideExportDropdown();
        });
      });
    }

    // ===== Export Current Note =====
    var btnExportNote = document.getElementById('btn-export-note');
    if (btnExportNote) btnExportNote.addEventListener('click', function() { exportSingleNote('md'); });

    // ===== Delete Note =====
    var btnDeleteNote = document.getElementById('btn-delete-note');
    if (btnDeleteNote) btnDeleteNote.addEventListener('click', function() {
      if (state.activeNodeId) deleteNode(state.activeNodeId);
    });

    // ===== Editor Inputs =====
    var noteTitleInput = document.getElementById('note-title-input');
    var noteEditor = document.getElementById('note-editor');

    if (noteTitleInput) {
      noteTitleInput.addEventListener('input', function() {
        var note = getNode(state.activeNodeId);
        if (note) {
          note.title = this.value;
          note.modified = Date.now();
          saveData();
          var treeTitle = document.querySelector('.tree-item.active .tree-title');
          if (treeTitle) treeTitle.textContent = this.value;
          renderBacklinks();
        }
      });
    }

    if (noteEditor) {
      var debounceTimer = null;
      noteEditor.addEventListener('input', function() {
        var content = this.value;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() { updateNoteContent(content); }, 500);

        var preview = document.getElementById('note-preview');
        if (preview && preview.style.display !== 'none') syncPreview(content);

        var wordsEl = document.getElementById('note-words');
        if (wordsEl) {
          var words = content.trim().split(/\s+/).filter(function(w) { return w.length > 0; }).length;
          wordsEl.textContent = words + ' ' + (getTrans('text_words') || 'words');
        }

        handleAutocomplete();
      });

      noteEditor.addEventListener('contextmenu', function(e) {
        if (noteEditor.selectionStart !== noteEditor.selectionEnd) {
          e.preventDefault();
          showEditorContextMenu(e.pageX, e.pageY);
        }
      });

      noteEditor.addEventListener('keydown', function(e) {
        var dropdown = document.getElementById('autocomplete-dropdown');
        var acVisible = dropdown && dropdown.style.display === 'block';

        if (acVisible) {
          if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            selectAutocomplete();
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateAutocomplete('down');
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateAutocomplete('up');
            return;
          }
          if (e.key === 'Escape') {
            hideAutocomplete();
            return;
          }
        }
      });
    }

    // ===== Tags Input =====
    var tagsInput = document.getElementById('note-tags-input');
    if (tagsInput) {
      tagsInput.addEventListener('keydown', function(e) {
        var note = getNode(state.activeNodeId);
        if (!note) return;

        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          var newTags = parseTagsInput(this.value);
          if (newTags.length > 0) {
            var currentTags = note.tags || [];
            var merged = currentTags.concat(newTags.filter(function(t) {
                            return currentTags.indexOf(t) === -1;
            }));
            updateTags(merged);
          }
          this.value = '';
        } else if (e.key === 'Backspace' && this.value === '') {
          if (note.tags && note.tags.length > 0) {
            updateTags(note.tags.slice(0, -1));
          }
        }
      });
    }

    // ===== Backlinks Panel Toggle =====
    var backlinksHeader = document.getElementById('backlinks-header');
    var backlinksPanel = document.getElementById('backlinks-panel');
    if (backlinksHeader && backlinksPanel) {
      backlinksHeader.addEventListener('click', function() {
        backlinksPanel.classList.toggle('collapsed');
        saveBacklinksState();
      });
    }

    // ===== Context Menus: global close =====
    var contextMenu = document.getElementById('context-menu');
    var editorCtxMenu = document.getElementById('editor-context-menu');

    document.addEventListener('click', function(e) {
      if (contextMenu && contextMenu.classList.contains('visible')) {
        if (!contextMenu.contains(e.target)) hideContextMenu();
      }
      if (editorCtxMenu && editorCtxMenu.classList.contains('visible')) {
        if (!editorCtxMenu.contains(e.target)) hideEditorContextMenu();
      }
      var exportDD = document.getElementById('export-dropdown');
      if (exportDD && exportDD.classList.contains('visible')) {
        if (!e.target.closest('.export-dropdown-wrapper')) hideExportDropdown();
      }
      var ac = document.getElementById('autocomplete-dropdown');
      if (ac && ac.style.display === 'block' && !ac.contains(e.target)) {
        if (!e.target.closest('#note-editor')) hideAutocomplete();
      }
    });

    document.addEventListener('contextmenu', function(e) {
      if (!e.target.closest('.tree-item') && !e.target.closest('.note-editor')) {
        hideContextMenu();
      }
    });

    // ===== Tree context menu actions =====
    if (contextMenu) {
      contextMenu.querySelectorAll('.context-item').forEach(function(item) {
        item.addEventListener('click', function() {
          if (this.classList.contains('disabled')) return;

          var action = this.dataset.action;
          var nodeId = state.contextTargetId;
          if (!nodeId) { hideContextMenu(); return; }

          switch(action) {
            case 'rename': openRenameModal(nodeId); break;
            case 'delete': deleteNode(nodeId); break;
            case 'pin': togglePin(nodeId); break;
            case 'cut': state.clipboard = nodeId; showToast('Cut — right-click destination and Paste'); break;
            case 'paste':
              if (state.clipboard) {
                var targetNode = getNode(nodeId);
                var targetId = (targetNode && targetNode.type === 'folder') ? nodeId : null;
                moveNode(state.clipboard, targetId);
                state.clipboard = null;
              }
              break;
          }
          hideContextMenu();
        });
      });
    }

    // ===== Editor context menu actions =====
    if (editorCtxMenu) {
      editorCtxMenu.querySelectorAll('.context-item[data-format]').forEach(function(item) {
        item.addEventListener('click', function() {
          applyFormatToSelection(this.dataset.format);
          hideEditorContextMenu();
        });
      });
    }

    // ===== Rename Modal =====
    var renameOverlay = document.getElementById('rename-modal-overlay');
    var renameClose = document.getElementById('rename-modal-close');
    var renameCancel = document.getElementById('rename-cancel');
    var renameConfirm = document.getElementById('rename-confirm');
    var renameInputEl = document.getElementById('rename-input');

    if (renameOverlay) renameOverlay.addEventListener('click', closeRenameModal);
    if (renameClose) renameClose.addEventListener('click', closeRenameModal);
    if (renameCancel) renameCancel.addEventListener('click', closeRenameModal);
    if (renameConfirm) renameConfirm.addEventListener('click', confirmRename);
    if (renameInputEl) {
      renameInputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
        else if (e.key === 'Escape') closeRenameModal();
      });
    }

    // ===== Link Picker Modal =====
    var lpOverlay = document.getElementById('link-picker-modal-overlay');
    var lpClose = document.getElementById('link-picker-modal-close');
    var lpCancel = document.getElementById('link-picker-cancel');
    var lpCreate = document.getElementById('link-picker-create');
    var lpInput = document.getElementById('link-picker-target');

    if (lpOverlay) lpOverlay.addEventListener('click', closeLinkPickerModal);
    if (lpClose) lpClose.addEventListener('click', closeLinkPickerModal);
    if (lpCancel) lpCancel.addEventListener('click', closeLinkPickerModal);
    if (lpCreate) lpCreate.addEventListener('click', confirmLinkPickerCreate);
    if (lpInput) {
      lpInput.addEventListener('input', function() { renderNoteResults(this.value); });
      lpInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmLinkPickerCreate(); }
        else if (e.key === 'Escape') closeLinkPickerModal();
      });
    }

    // ===== Command Palette =====
    var cpOverlay = document.getElementById('command-palette-overlay');
    var cpInput = document.getElementById('command-palette-input');

    if (cpOverlay) cpOverlay.addEventListener('click', closeCommandPalette);
    if (cpInput) {
      cpInput.addEventListener('input', function() {
        renderCommandPaletteResults(this.value);
      });
      cpInput.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); navigateCommandPalette('down'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); navigateCommandPalette('up'); }
        else if (e.key === 'Enter') { e.preventDefault(); executeCommandPalette(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
      });
    }

    // ===== Settings Modal =====
    setupSettingsModal();

    // ===== Toolbar visibility toggles =====
    var toggleHideNewNote = document.getElementById('toggle-hide-new-note-btn');
    if (toggleHideNewNote) {
      toggleHideNewNote.checked = localStorage.getItem('oros_hide_new_note_btn') === 'true';
      toggleHideNewNote.addEventListener('change', function() {
        var hidden = this.checked;
        localStorage.setItem('oros_hide_new_note_btn', hidden ? 'true' : 'false');
        var btn = document.getElementById('btn-new-note');
        if (btn) btn.style.display = hidden ? 'none' : '';
      });
    }

    var toggleHideNewFolder = document.getElementById('toggle-hide-new-folder-btn');
    if (toggleHideNewFolder) {
      toggleHideNewFolder.checked = localStorage.getItem('oros_hide_new_folder_btn') === 'true';
      toggleHideNewFolder.addEventListener('change', function() {
        var hidden = this.checked;
        localStorage.setItem('oros_hide_new_folder_btn', hidden ? 'true' : 'false');
        var btn = document.getElementById('btn-new-folder');
        if (btn) btn.style.display = hidden ? 'none' : '';
      });
    }

    var toggleHideSidebar = document.getElementById('toggle-hide-sidebar-toggle');
    if (toggleHideSidebar) {
      toggleHideSidebar.checked = localStorage.getItem('oros_hide_sidebar_toggle') === 'true';
      toggleHideSidebar.addEventListener('change', function() {
        var hidden = this.checked;
        localStorage.setItem('oros_hide_sidebar_toggle', hidden ? 'true' : 'false');
        var btn = document.getElementById('btn-toggle-sidebar');
        if (btn) btn.style.display = hidden ? 'none' : '';
      });
    }

    // ===== Zen Mode Setup =====
    setupZenMode();

    // ===== Keyboard Shortcuts =====
    document.addEventListener('keydown', function(e) {
      var cpModal = document.getElementById('command-palette-modal');
      var inCommandPalette = cpModal && cpModal.classList.contains('visible');

      if (e.key === 'Escape') {
        hideContextMenu();
        hideEditorContextMenu();
        closeGraphModal();
        closeCommandPalette();
        closeSettingsModal();
        closeRenameModal();
        closeLinkPickerModal();
        hideAutocomplete();
        hideExportDropdown();
        return;
      }

      if (inCommandPalette) return;

      var inModal = document.querySelector('.modal.visible') ||
                   (document.getElementById('link-picker-modal') && document.getElementById('link-picker-modal').classList.contains('visible')) ||
                   (document.getElementById('graph-modal') && document.getElementById('graph-modal').classList.contains('visible')) ||
                   (document.getElementById('settings-modal') && document.getElementById('settings-modal').classList.contains('visible'));
      if (inModal) return;

      var ed = document.getElementById('note-editor');
      var inEditor = (document.activeElement === ed);

      // Ctrl+P — command palette
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      // Ctrl+S — JSON backup
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportJsonBackup();
        return;
      }

      // Ctrl+N — new note
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        var activeNode = getNode(state.activeNodeId);
        var parentId = (activeNode && activeNode.type === 'folder') ? activeNode.id : null;
        createNote(parentId);
        return;
      }

      // Ctrl+D — daily note
      if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        createOrOpenDailyNote();
        return;
      }

      // Ctrl+E — export current note as MD
      if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        exportSingleNote('md');
        return;
      }

      // Ctrl+Shift+F — focus search
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        var search = document.getElementById('notes-search');
        if (search) search.focus();
        return;
      }

      // F9 — Zen Mode
      if (e.key === 'F9' && !inEditor) {
        e.preventDefault();
        var zenBtn = document.getElementById('toggle-zen-mode');
        if (zenBtn) zenBtn.checked = !zenBtn.checked;
        zenBtn.dispatchEvent(new Event('change'));
        return;
      }

      // Ctrl+B — bold
      if (e.ctrlKey && e.key.toLowerCase() === 'b' && inEditor && ed.selectionStart !== ed.selectionEnd) {
        e.preventDefault();
        applyFormatToSelection('bold');
        return;
      }

      // Ctrl+I — italic
      if (e.ctrlKey && e.key.toLowerCase() === 'i' && inEditor && ed.selectionStart !== ed.selectionEnd) {
        e.preventDefault();
        applyFormatToSelection('italic');
        return;
      }
    });

    // ===== Language Change =====
    window.addEventListener('oros-language-changed', function() { renderAll(); });

    // ===== Resize =====
    window.addEventListener('resize', function() {
      hideContextMenu();
      hideEditorContextMenu();
      hideAutocomplete();
      handleGraphResize();
    });
  }

  // ========== INIT ==========
  function init() {
    loadData();
    setup();
    renderAll();
    applyToolbarVisibility();

    // Apply default view mode on load
    loadAndApplySettings();

    // Set active state for view buttons
    var savedMode = localStorage.getItem(VIEW_MODE) || localStorage.getItem(DEFAULT_VIEW_MODE) || 'split';
    document.querySelectorAll('.view-btn').forEach(function(btn) {
      btn.classList.remove('active');
      if ((savedMode === 'split' && btn.id === 'btn-view-split') ||
          (savedMode === 'editor' && btn.id === 'btn-view-editor') ||
          (savedMode === 'preview' && btn.id === 'btn-view-preview')) {
        btn.classList.add('active');
      }
    });

    document.querySelectorAll('.view-btn-small').forEach(function(btn) {
      btn.classList.remove('active');
      if ((savedMode === 'split' && btn.id === 'btn-view-split') ||
          (savedMode === 'editor' && btn.id === 'btn-view-editor') ||
          (savedMode === 'preview' && btn.id === 'btn-view-preview')) {
        btn.classList.add('active');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();