// ============================================================
// orOS To-Do — App logic (v0.4)
// New in v0.4 (cross-device MERGE):
//   - Every entity (list / task / label) carries mtime (content
//     version) + pos/om (ordering version). Every mutation stamps.
//   - Soft deletes: state.deleted = { [id]: ts } tombstones,
//     pruned after 30 days. Deletion wins over older edits;
//     an edit NEWER than its tombstone resurrects the entity.
//   - mergeTodoStates(local, remote): deterministic, symmetric —
//     both devices compute the SAME converged result.
//       · scalars (activeList/hideCompleted): larger sm wins
//       · entities: union by id, content by larger mtime
//         (tie → lexicographic JSON — identical both ways)
//       · ordering (pos/om): side with larger om wins positions
//       · tombstones: union with max ts; deletion beats older
//         edits, loses to newer ones
//   - Undo asserts the WHOLE snapshot as newest (stampAll) —
//     undo wins over remote, propagates.
//   - DATA_VER 2 → 3 additive migration (mtime/om/pos/deleted/sm).
// Carried over from v0.3 (Kanban-pattern port):
//   - Labels, filter by label, global search (all lists),
//     extra info key-value fields, tab drag reorder, rename pencil.
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model, storage, migration, IDs
//   2b. Cross-device merge engine (v0.4)
//   3. Recurrence date math + list-cycle engine
//   4. Render: tabs (+ rename pencil + drag reorder)
//   5. Render: items (+ search/filter view)
//   6. Quick-add (natural date parsing)
//   7. Item detail dialog (+ labels / extra info editors)
//   8. List settings dialog
//   9. Item drag & drop reorder
//  10. Label helpers (shared by items + filter)
//  11. Undo / toast
//  12. Sync slice (Dropbox, merge-registered) + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-todo-data";
  var DATA_VER = 3;
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

  // ---------- 1. Constants, i18n, helpers ----------
  // Language comes from the shell (same-origin, shared localStorage).
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "quick.add":     "Add a task… (try “tomorrow”, “friday”)",
      "hide.completed":"Hide completed",
      "clear.completed":"Clear completed",
      "empty.title":   "Nothing here yet",
      "empty.hint":    "Add your first task above.",
      "item.title":    "Task",
      "item.text":     "Text",
      "item.due":      "Due date",
      "item.notes":    "Notes",
      "item.labels":   "Labels",
      "labels.manage": "Add / manage labels",
      "labels.chipRemove": "Click to remove",
      "labels.newph":  "New label…",
      "labels.add":    "Add",
      "labels.none":   "No labels yet — create one below.",
      "item.info":     "Extra info",
      "item.info.add": "Add field",
      "item.info.label": "Field",
      "item.info.value": "Value",
      "recur.title":   "Repeat",
      "recur.none":    "Never",
      "recur.every":   "Every",
      "unit.day":      "days",
      "unit.week":     "weeks",
      "unit.month":    "months",
      "item.delete":   "Delete",
      "save":          "Save",
      "list.settings": "List settings",
      "list.name":     "Name",
      "list.delete":   "Delete list",
      "recur.list.title": "List cycle",
      "recur.list.hint":  "When a cycle ends, all checks are cleared automatically.",
      "due.today":     "Today",
      "due.tomorrow":  "Tomorrow",
      "due.overdue":   "Overdue",
      "search.ph":     "Search…",
      "search.clear":  "Clear search",
      "search.none":   "No matches",
      "search.none.hint": "Try another term or clear the label filter.",
      "filter.title":  "Filter by label",
      "filter.empty":  "No labels yet — add one from a task.",
      "filter.del":   "Delete label",
      "tab.rename":    "Rename list",
      "toast.deleted": "Deleted",
      "toast.undone":  "Restored",
      "toast.cleared": "Completed items cleared",
      "toast.listdel": "List deleted",
      "toast.labeladd": "Label created",
      "toast.labeldel": "Label deleted",
      "toast.merged":  "Synced changes from another device",
      "undo":          "Undo",
      "confirm.listdel": "Delete this list and all its tasks?",
      "confirm.itemdel": "Delete this task?",
      "confirm.lbldel":  "Delete this label? It will be removed from all tasks.",
      "new.list":      "New list",
      "recur.list.next": "Next reset:",
      "drag.reorder":   "Reorder"
    },
    el: {
      "quick.add":     "Προσθήκη εργασίας… (δοκίμασε «αύριο», «παρασκευή»)",
      "hide.completed":"Απόκρυψη ολοκληρωμένων",
      "clear.completed":"Καθαρισμός ολοκληρωμένων",
      "empty.title":   "Δεν υπάρχει τίποτα εδώ ακόμα",
      "empty.hint":    "Πρόσθεσε την πρώτη σου εργασία παραπάνω.",
      "item.title":    "Εργασία",
      "item.text":     "Κείμενο",
      "item.due":      "Προθεσμία",
      "item.notes":    "Σημειώσεις",
      "item.labels":   "Ετικέτες",
      "labels.manage": "Προσθήκη / διαχείριση ετικετών",
      "labels.chipRemove": "Κλικ για αφαίρεση",
      "labels.newph":  "Νέα ετικέτα…",
      "labels.add":    "Προσθήκη",
      "labels.none":   "Δεν υπάρχουν ετικέτες — δημιούργησε από κάτω.",
      "item.info":     "Επιπλέον στοιχεία",
      "item.info.add": "Προσθήκη πεδίου",
      "item.info.label": "Πεδίο",
      "item.info.value": "Τιμή",
      "recur.title":   "Επανάληψη",
      "recur.none":    "Ποτέ",
      "recur.every":   "Κάθε",
      "unit.day":      "ημέρες",
      "unit.week":     "εβδομάδες",
      "unit.month":    "μήνες",
      "item.delete":   "Διαγραφή",
      "save":          "Αποθήκευση",
      "list.settings": "Ρυθμίσεις λίστας",
      "list.name":     "Όνομα",
      "list.delete":   "Διαγραφή λίστας",
      "recur.list.title": "Κύκλος λίστας",
      "recur.list.hint":  "Όταν λήξει ο κύκλος, όλα τα τσεκαρίσματα μηδενίζονται αυτόματα.",
      "due.today":     "Σήμερα",
      "due.tomorrow":  "Αύριο",
      "due.overdue":   "Σε καθυστέρηση",
      "search.ph":     "Αναζήτηση…",
      "search.clear":  "Καθαρισμός αναζήτησης",
      "search.none":   "Καμία αντιστοιχία",
      "search.none.hint": "Δοκίμασε άλλον όρο ή καθάρισε το φίλτρο ετικετών.",
      "filter.title":  "Φιλτράρισμα ανά ετικέτα",
      "filter.empty":  "Δεν υπάρχουν ετικέτες — πρόσθεσε από κάποια εργασία.",
      "filter.del":    "Διαγραφή ετικέτας",
      "tab.rename":    "Μετονομασία λίστας",
      "toast.deleted": "Διαγράφηκε",
      "toast.undone":  "Επαναφέρθηκε",
      "toast.cleared": "Καθαρίστηκαν οι ολοκληρωμένες εργασίες",
      "toast.listdel": "Η λίστα διαγράφηκε",
      "toast.labeladd": "Η ετικέτα δημιουργήθηκε",
      "toast.labeldel": "Η ετικέτα διαγράφηκε",
      "toast.merged":  "Συγχρονίστηκαν αλλαγές από άλλη συσκευή",
      "undo":          "Αναίρεση",
      "confirm.listdel": "Διαγραφή λίστας και όλων των εργασιών της;",
      "confirm.itemdel": "Διαγραφή αυτής της εργασίας;",
      "confirm.lbldel":  "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις εργασίες.",
      "new.list":      "Νέα λίστα",
      "recur.list.next": "Επόμενο reset:",
      "drag.reorder":   "Αναδιάταξη"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  var WEEKDAY_KEYS = {
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"]
  };
  // Lookup words for the quick-add parser (lowercased, accents stripped)
  var WEEKDAY_WORDS = {};
  ["en", "el"].forEach(function (l) {
    WEEKDAY_KEYS[l].forEach(function (name, idx) {
      WEEKDAY_WORDS[normalize(name)] = idx;
      WEEKDAY_WORDS[normalize(name.slice(0, 3))] = idx;   // "fri", "παρ"
    });
  });
  var WORD_TOMORROW = {};
  WORD_TOMORROW["tomorrow"] = WORD_TOMORROW["αύριο"] = WORD_TOMORROW["αυριο"] = true;
  var WORD_TODAY = {};
  WORD_TODAY["today"] = WORD_TODAY["σήμερα"] = WORD_TODAY["σημερα"] = true;

  function normalize(s) {
    return s.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip accents
      .replace(/[^\p{L}\p{N}]+/gu, "");                  // letters+digits only
  }

  // ISO date (YYYY-MM-DD) helpers — everything human-readable is
  // derived locally, so EL gets GR format for free via toLocaleDateString.
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoToDate(iso) {
    var p = String(iso).split("-");
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  function dateToISO(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function daysDiff(isoA, isoB) {          // a - b, in days
    return Math.round((isoToDate(isoA) - isoToDate(isoB)) / 86400000);
  }
  function fmtDue(iso) {
    var diff = daysDiff(iso, todayISO());
    if (diff === 0)  return t("due.today");
    if (diff === 1)  return t("due.tomorrow");
    var d = isoToDate(iso);
    var loc = LANG === "el" ? "el-GR" : "en-GB";
    return d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }

  var SWATCH_COLORS = ["#d4af37", "#4caf50", "#f44336", "#2196f3",
                       "#ff9800", "#9c27b0", "#e91e63", "#03a9f4"];
  var FALLBACK_COLOR = "#d4af37";

  // ---------- 2. Data model, storage, migration ----------
  // state = {
  //   ver: 3,
  //   sm: <root settings mtime — activeList/hideCompleted LWW>,
  //   activeList: <listId>,
  //   hideCompleted: bool,
  //   deleted: { <entityId>: <tombstone ts> },   // pruned after 30 days
  //   labels: [{ id, name, color, mtime, om, pos }],
  //   lists: [{
  //     id, name, mtime, om, pos,
  //     recurrence: null | {every, unit, weekday},
  //     lastReset: iso, nextReset: iso,
  //     items: [{ id, text, done, due, notes,
  //               labels: [<label id>], info: [{ id, label, value }],
  //               recurrence: null | {every, unit, weekday},
  //               mtime, om, pos }]
  //   }]
  // }
  //   mtime — content version: larger wins merge conflicts
  //   om/pos — ordering version: reorders stamp om + rewrite pos;
  //           content edits never disturb order
  var state = null;
  var renderQueued = false;

  // Search / filter are session-only view state (never persisted):
  // sync pulls from another device must not resurrect a stale view.
  var searchQuery = "";
  var activeFilters = [];

  // --- version stamps ---
  function touch(ent)     { ent.mtime = Date.now(); }
  function tombstone(id) {
    if (!state.deleted) state.deleted = {};
    state.deleted[id] = Date.now();
  }
  // Undo policy: the restored snapshot is asserted as the NEWEST
  // state everywhere → it wins the next merge and propagates.
  function stampAll() {
    var nowMs = Date.now();
    state.sm = nowMs;
    (state.labels || []).forEach(function (lb) { lb.mtime = nowMs; });
    (state.lists || []).forEach(function (l) {
      l.mtime = nowMs;
      (l.items || []).forEach(function (it) { it.mtime = nowMs; });
    });
  }

  function defaultState() {
    var first = newListObj(LANG === "el" ? "Γενικά" : "General");
    var work   = newListObj(LANG === "el" ? "Ψώνια" : "Groceries");
    first.pos = 0;
    work.pos = 1;
    return {
      ver: DATA_VER,
      sm: Date.now(),
      activeList: first.id,
      hideCompleted: false,
      deleted: {},
      labels: [],
      lists:       [first, work]
    };
  }

  function newListObj(name) {
    return {
      id: uid(),
      name: name,
      mtime: Date.now(),
      om: 0,                         // ordering version (items' order)
      pos: 0,                        // position within state.lists
      recurrence: null,
      lastReset: null,
      nextReset: null,
      items: []
    };
  }

  function newItemObj(text, due) {
    return {
      id: uid(),
      text: text,
      done: false,
      due: due || null,
      notes: "",
      labels: [],
      info: [],
      recurrence: null,
      mtime: Date.now(),
      om: 0,                         // (reserved, per-item; ordering is list-level)
      pos: 0
    };
  }

  // Additive migration: bring ANY older shape up to DATA_VER.
  // v1 → labels/info; v2 → merge stamps (sm/om/mtime/pos/deleted).
  // Unknown stamps default to 0 = "oldest possible": real remote
  // timestamps (if any) win over migrated data — never the reverse.
  function migrate(data) {
    if (!data || !Array.isArray(data.lists)) return null;
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
    if (!Array.isArray(data.labels)) data.labels = [];
    data.labels.forEach(function (lb) {
      if (typeof lb.mtime !== "number") lb.mtime = 0;
      if (typeof lb.pos !== "number") lb.pos = 0;
    });
    data.lists.forEach(function (list) {
      if (typeof list.mtime !== "number") list.mtime = 0;
      if (typeof list.om !== "number") list.om = 0;
      if (typeof list.pos !== "number") list.pos = 0;
      if (!Array.isArray(list.items)) list.items = [];
      list.items.forEach(function (it) {
        if (!Array.isArray(it.labels)) it.labels = [];
        if (!Array.isArray(it.info)) it.info = [];
        if (typeof it.mtime !== "number") it.mtime = 0;
        if (typeof it.pos !== "number") it.pos = 0;
      });
    });
    data.ver = DATA_VER;
    return data;
  }

  function pruneTombstones(st) {
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(st.deleted || {}).forEach(function (id) {
      if (st.deleted[id] < cutoff) delete st.deleted[id];
    });
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data && Array.isArray(data.lists) && data.lists.length > 0) {
          state = data;
          pruneTombstones(state);
          applyListCycles();      // section 3 — may reset lists
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    state = defaultState();
    save();
  }

  // Auto-save: every mutation ends with save() + scheduleRender().
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota — nothing sensible to do offline */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderAll();
    });
  }

  function activeList() {
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id === state.activeList) return state.lists[i];
    }
    return state.lists[0];      // fallback (guarded in sliceSet)
  }

  function listById(id) {
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id === id) return state.lists[i];
    }
    return null;
  }

  function itemById(list, itemId) {
    if (!list) return null;
    for (var i = 0; i < list.items.length; i++) {
      if (list.items[i].id === itemId) return list.items[i];
    }
    return null;
  }

  // ---------- 2b. Cross-device merge engine (v0.4) ----------
  // Contract (consumed by sync.js via registerSlice's 5th arg):
  //   mergeTodoStates(local, remote) → merged state.
  // Deterministic + symmetric: merge(A,B) === merge(B,A). Convergence
  // on both devices stops the push/pull ping-pong.
  //
  //   · scalars (activeList/hideCompleted) — larger root sm wins
  //   · content (list headers, tasks, labels) — larger mtime wins;
  //     equal mtimes → lexicographically larger JSON (identical
  //     decision on both sides, no coin flips)
  //   · ordering — the side with the larger ordering version (om)
  //     donates the positions; unknown entities append at the end
  //     (older mtime first)
  //   · tombstones — union, max ts. An entity survives only if its
  //     content mtime is NEWER than its tombstone (edit-after-delete
  //     resurrects); otherwise deletion wins.
  //
  // Timestamps come from different device clocks — clock skew simply
  // biases winners, the determinism guarantees no oscillation.

  function mergeEntityMaps(aDel, bDel) {
    var out = {};
    var a = aDel || {}, b = bDel || {};
    Object.keys(a).forEach(function (id) { out[id] = a[id]; });
    Object.keys(b).forEach(function (id) {
      out[id] = Math.max(out[id] || 0, b[id]);
    });
    return out;
  }

  function entAlive(ent, tomb) {
    var ts = tomb[ent.id];
    return ts === undefined || (ent.mtime || 0) > ts;
  }

  // Whole-entity LWW for leaves (tasks, labels, list HEADERS):
  // bigger mtime wins; tie → larger serialized JSON (deterministic).
  function newerEntity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  // Union two entity arrays by id (LWW content). Tombstoned
  // entities are dropped right here — a merge never resurrects a
  // deletion unless the surviving content is genuinely newer.
  function unionEntities(aArr, bArr, tomb) {
    var map = {};
    (aArr || []).forEach(function (e) { map[e.id] = e; });
    (bArr || []).forEach(function (e) {
      map[e.id] = map[e.id] ? newerEntity(map[e.id], e) : e;
    });
    var out = [];
    Object.keys(map).forEach(function (id) {
      if (entAlive(map[id], tomb)) out.push(map[id]);
    });
    return out;
  }

  // Position merged entities by the reference side's order (the side
  // with the larger om). Entities unknown to the reference side go to
  // the end, oldest first. Assigns fresh sequential pos.
  function orderEntities(entities, refArr) {
    var idx = {};
    (refArr || []).forEach(function (e, i) { idx[e.id] = i; });
    entities.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.mtime || 0) !== (y.mtime || 0)) return (x.mtime || 0) - (y.mtime || 0);
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    entities.forEach(function (e, i) { e.pos = i; });
    return entities;
  }

  // Lists merge STRUCTURALLY: headers LWW by mtime, but each list's
  // items merge independently — a header edit on one device must
  // never clobber item changes on the other.
  function mergeListEntity(la, lb, tomb) {
    var strip = function (l) {
      var c = JSON.parse(JSON.stringify(l));
      delete c.items;
      return c;
    };
    var head = newerEntity(strip(la), strip(lb));
    head.om = Math.max(la.om || 0, lb.om || 0);
    head.items = unionEntities(la.items || [], lb.items || [], tomb);
    head.items = orderEntities(head.items, (la.om || 0) >= (lb.om || 0) ? la.items : lb.items);
    return head;
  }

  function mergeTodoStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = mergeEntityMaps(a.deleted, b.deleted);
    // Prune expired tombstones INSIDE the merge — both sides shrink
    // identically, so pruning is itself convergence-safe.
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(tomb).forEach(function (id) {
      if (tomb[id] < cutoff) delete tomb[id];
    });

    // scalars: LWW by root settings mtime
    var settings = (a.sm || 0) >= (b.sm || 0) ? a : b;

    var out = {
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      om: Math.max(a.om || 0, b.om || 0),
      activeList: settings.activeList,
      hideCompleted: settings.hideCompleted,
      deleted: tomb,
      labels: [],
      lists: []
    };

    // labels: content LWW, order by larger om side
    var labels = unionEntities(a.labels || [], b.labels || [], tomb);
    out.labels = orderEntities(labels, (a.om || 0) >= (b.om || 0) ? (a.labels || []) : (b.labels || []));

    // lists: pair by id, structural merge (headers + independent items)
    var listMap = {};
    var forEachList = function (arr) {
      (arr || []).forEach(function (l) {
        if (listMap[l.id]) listMap[l.id].push(l);
        else listMap[l.id] = [l];
      });
    };
    forEachList(a.lists); forEachList(b.lists);

    var mergedLists = [];
    Object.keys(listMap).forEach(function (id) {
      var pair = listMap[id];
      var merged;
      if (pair.length === 2) merged = mergeListEntity(pair[0], pair[1], tomb);
      else merged = pair[0];                       // one-sided (new or removed elsewhere)
      if (entAlive(merged, tomb)) mergedLists.push(merged);
    });
    out.lists = orderEntities(mergedLists, (a.om || 0) >= (b.om || 0) ? (a.lists || []) : (b.lists || []));

    // post-conditions: never ship an empty state (fresh-install
    // fallback), never point activeList at a ghost
    if (out.lists.length === 0) return null;
    var found = out.lists.some(function (l) { return l.id === out.activeList; });
    if (!found) out.activeList = out.lists[0].id;

    return out;
  }

  // ---------- 3. Recurrence date math + list cycles ----------
  function advance(date, rec) {
    var d = new Date(date.getTime());
    if (rec.unit === "day")   d.setDate(d.getDate() + rec.every);
    else if (rec.unit === "month") d.setMonth(d.getMonth() + rec.every);
    else                       d.setDate(d.getDate() + 7 * rec.every);   // weeks
    return d;
  }

  // Next occurrence honoring a weekday constraint (weekly only).
  function nextWithWeekday(from, rec) {
    var d = new Date(from.getTime());
    d.setDate(d.getDate() + 7 * rec.every);
    var wd = d.getDay();
    if (wd !== rec.weekday) {
      var delta = (rec.weekday - wd + 7) % 7;
      d.setDate(d.getDate() + delta);
    }
    return d;
  }

  // Advance until strictly after "from". An item completed while
  // already overdue jumps to the FIRST future occurrence, not N-ahead.
  function nextOccurrence(from, rec) {
    var d = new Date(from.getTime());
    if (rec.unit === "week" && typeof rec.weekday === "number") {
      while (d <= from || d.getDay() !== rec.weekday) d = nextWithWeekday(d, rec);
      return d;
    }
    d = advance(d, rec);
    while (d <= from) d = advance(d, rec);
    return d;
  }

  // Checked a recurring item → it re-opens with the next due date
  // instead of staying done. Returns true if the item recycled.
  function recycleItem(item) {
    if (!item.recurrence) return false;
    var anchor = new Date();                                // now
    var next = nextOccurrence(anchor, item.recurrence);
    item.due = dateToISO(next);
    item.done = false;
    return true;
  }

  // List-level cycle: when the deadline passes, every item resets.
  // Rolled-over items get fresh mtimes: the cycle event is a REAL
  // content change and must win the next merge (both devices must
  // agree the cycle happened, not re-fight it forever).
  function applyListCycles() {
    var today = todayISO();
    var changed = false;
    state.lists.forEach(function (list) {
      if (!list.recurrence) { list.nextReset = null; return; }
      if (!list.nextReset) {
        list.lastReset = today;
        list.nextReset = dateToISO(
          nextOccurrence(isoToDate(today), list.recurrence));
        changed = true;
      }
      while (list.nextReset <= today) {
        list.lastReset = list.nextReset;
        list.items.forEach(function (it) {
          if (it.done) { it.done = false; touch(it); }
        });
        list.nextReset = dateToISO(
          nextOccurrence(isoToDate(list.nextReset), list.recurrence));
        changed = true;
      }
    });
    if (changed) save();
  }

  // ---------- 4. Render: tabs ----------
  function overdueCount(list) {
    var today = todayISO();
    var n = 0;
    list.items.forEach(function (it) {
      if (!it.done && it.due && it.due < today) n++;
    });
    return n;
  }

  function renderTabs() {
    var tabs = $("tabs");
    tabs.innerHTML = "";
    state.lists.forEach(function (list) {
      var b = document.createElement("button");
      b.className = "tab" + (list.id === state.activeList ? " active" : "");
      b.setAttribute("role", "tab");
      b.dataset.listId = list.id;
      b.type = "button";

      var name = document.createElement("span");
      name.textContent = list.name;
      b.appendChild(name);

      var od = overdueCount(list);
      if (od > 0) {
        var chip = document.createElement("span");
        chip.className = "chip overdue";
        chip.textContent = String(od);
        b.appendChild(chip);
      }

      // Rename pencil — same dialog as dblclick (Kanban #22 parity)
      var pen = document.createElement("span");
      pen.className = "t-rename";
      pen.setAttribute("role", "button");
      pen.setAttribute("aria-label", t("tab.rename"));
      pen.title = t("tab.rename");
      pen.innerHTML =
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
      pen.addEventListener("click", function (e) {
        e.stopPropagation();
        openListDialog(list.id);
      });
      b.appendChild(pen);

      b.addEventListener("dblclick", function () { openListDialog(list.id); });
      b.addEventListener("click", function () {
        if (state.activeList === list.id) return;
        state.activeList = list.id;
        state.sm = Date.now();      // settings LWW follows the freshest tap
        save(); scheduleRender();
      });

      // Tab drag reorder (pointer-based, horizontal bias)
      attachTabDrag(b, list);

      tabs.appendChild(b);
    });
  }

  // ---------- 5. Render: items ----------
  // View modes:
  //   - browsing: the active list's items (drag handles enabled)
  //   - searching/filtering: flattened results from ALL lists,
  //     source chip per item, no drag handles (cross-list reorder
  //     is meaningless)
  function isSearching() {
    return !!(searchQuery || activeFilters.length > 0);
  }

  function itemMatchesView(item) {
    if (state.hideCompleted && item.done) return false;
    if (searchQuery && !matchesSearch(item)) return false;
    if (activeFilters.length > 0 && !matchesFilters(item)) return false;
    return true;
  }

  function matchesSearch(item) {
    if ((item.text || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    if ((item.notes || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    for (var i = 0; i < (item.info || []).length; i++) {
      var f = item.info[i];
      if ((f.label || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
      if ((f.value || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    for (var j = 0; j < (item.labels || []).length; j++) {
      var label = labelById(item.labels[j]);
      if (label && label.name.toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    return false;
  }

  // OR over selected labels — item shows if it carries ANY active label.
  function matchesFilters(item) {
    if (!item.labels || item.labels.length === 0) return false;
    for (var i = 0; i < activeFilters.length; i++) {
      if (item.labels.indexOf(activeFilters[i]) !== -1) return true;
    }
    return false;
  }

  function renderItems() {
    var ul = $("items");
    ul.innerHTML = "";

    if (isSearching()) {
      var results = [];
      state.lists.forEach(function (list) {
        list.items.forEach(function (item) {
          if (itemMatchesView(item)) results.push({ list: list, item: item });
        });
      });

      results.forEach(function (r) {
        ul.appendChild(makeItemRow(r.list, r.item, { source: true }));
      });

      var anyItems = state.lists.some(function (l) { return l.items.length > 0; });
      $("empty").hidden = true;
      $("no-match").hidden = !(results.length === 0 && anyItems);
      return;
    }

    // Browsing mode — the active list, drag handles on
    var list = activeList();
    $("no-match").hidden = true;
    $("empty").hidden = !(list.items.length === 0);

    list.items.forEach(function (item) {
      if (state.hideCompleted && item.done) return;
      ul.appendChild(makeItemRow(list, item, { handle: true }));
    });
  }

  // Shared row builder (both view modes render identical rows —
  // the ONLY difference is the drag handle vs the source chip).
  function makeItemRow(list, item, opts) {
    var li = document.createElement("li");
    li.className = "item" + (item.done ? " done" : "");
    li.dataset.id = item.id;

    // checkbox
    var check = document.createElement("input");
    check.type = "checkbox";
    check.className = "check";
    check.checked = item.done;
    check.addEventListener("change", function () {
      item.done = check.checked;
      if (item.done) recycleItem(item);       // recurring → reopens
      touch(item);                            // content version bump
      save(); scheduleRender();
    });
    li.appendChild(check);

    // body (text + extras) — click opens detail dialog
    var body = document.createElement("div");
    body.className = "body";
    var label = document.createElement("div");
    label.className = "label";
    label.textContent = item.text;
    body.appendChild(label);

    if (item.notes) {
      var prev = document.createElement("div");
      prev.className = "notes-preview";
      prev.textContent = item.notes;
      body.appendChild(prev);
    }

    // label chips (Kanban parity)
    if (item.labels && item.labels.length > 0) {
      var chipHost = document.createElement("div");
      chipHost.className = "chips";
      item.labels.forEach(function (lid) {
        var lb = labelById(lid);
        if (!lb) return;
        var chip = document.createElement("span");
        chip.className = "chip";
        chip.style.background = lb.color || FALLBACK_COLOR;
        chip.textContent = lb.name;
        chip.title = lb.name;
        chipHost.appendChild(chip);
      });
      if (chipHost.childNodes.length > 0) body.appendChild(chipHost);
    }

    // extra info preview: one dim, truncated line (Kanban parity)
    var infoParts = [];
    (item.info || []).forEach(function (f) {
      var l = (f.label || "").trim();
      var v = (f.value || "").trim();
      if (l && v) infoParts.push(l + ": " + v);
    });
    if (infoParts.length > 0) {
      var ip = document.createElement("div");
      ip.className = "info-preview";
      ip.textContent = infoParts.join("  ·  ");
      body.appendChild(ip);
    }

    // meta row: due chip + repeat indicator + source list chip
    var hasMeta = item.due || item.recurrence || opts.source;
    if (hasMeta) {
      var meta = document.createElement("div");
      meta.className = "meta";
      if (item.due) {
        var chip = document.createElement("span");
        chip.className = "chip-due" + dueClass(item.due);
        chip.textContent = fmtDue(item.due);
        meta.appendChild(chip);
      }
      if (item.recurrence) {
        var rec = document.createElement("span");
        rec.className = "chip-recur-ico";
        rec.innerHTML = RECUR_SVG;
        rec.appendChild(document.createTextNode(recurShort(item.recurrence)));
        meta.appendChild(rec);
      }
      if (opts.source) {
        var src = document.createElement("span");
        src.className = "chip-src";
        src.textContent = list.name;
        src.title = list.name;
        meta.appendChild(src);
      }
      body.appendChild(meta);
    }

    body.addEventListener("click", function () { openItemDialog(list.id, item.id); });
    li.appendChild(body);

    // drag handle (browsing mode only)
    if (opts.handle) li.appendChild(makeDragHandle(list, item));

    return li;
  }

  function dueClass(iso) {
    var diff = daysDiff(iso, todayISO());
    if (diff < 0) return " overdue";
    if (diff === 0) return " today";
    return "";
  }

  function recurShort(rec) {
    var s = t("recur.every") + " " + rec.every + " " + t("unit." + rec.unit);
    if (rec.unit === "week" && typeof rec.weekday === "number") {
      s += " · " + WEEKDAY_KEYS[LANG][rec.weekday];
    }
    return s;
  }

  // ---------- 6. Quick-add with natural date parsing ----------
  function parseQuickAdd(raw) {
    var tokens = raw.trim().split(/\s+/);
    var due = null;
    var weekdayHit = null;

    var kept = tokens.filter(function (tok) {
      var n = normalize(tok);
      if (WORD_TODAY[n]) { due = todayISO(); return false; }
      if (WORD_TOMORROW[n]) {
        var d = isoToDate(todayISO());
        d.setDate(d.getDate() + 1);
        due = dateToISO(d);
        return false;
      }
      if (WEEKDAY_WORDS[n] !== undefined) {
        weekdayHit = WEEKDAY_WORDS[n];
        return false;
      }
      return true;
    });

    if (weekdayHit !== null) {
      var d2 = isoToDate(todayISO());
      var delta = (weekdayHit - d2.getDay() + 7) % 7;
      if (delta === 0) delta = 7;                 // "friday" on a Friday = next one
      d2.setDate(d2.getDate() + delta);
      due = dateToISO(d2);
    }

    return { text: kept.join(" ").trim(), due: due };
  }

  function quickAdd() {
    var input = $("quick-add");
    var raw = input.value;
    if (!raw.trim()) return;

    var parsed = parseQuickAdd(raw);
    if (!parsed.text) return;                    // only date words typed

    var list = activeList();
    var item = newItemObj(parsed.text, parsed.due);
    list.items.unshift(item);
    list.items.forEach(function (it, i) { it.pos = i; });   // keep pos honest

    input.value = "";
    save(); scheduleRender();
  }

  function renderAll() {
    renderTabs();
    renderItems();
  }

  // ---------- 7. Item detail dialog ----------
  var editingListId = null;
  var editingItemId = null;
  var pickedSwatch = FALLBACK_COLOR;

  function editingItem() {
    return itemById(listById(editingListId), editingItemId);
  }

  function populateWeekdaySelects() {
    [$("f-weekday"), $("l-weekday")].forEach(function (sel) {
      sel.innerHTML = "";
      WEEKDAY_KEYS[LANG].forEach(function (name, idx) {
        var o = document.createElement("option");
        o.value = String(idx);
        o.textContent = name;
        sel.appendChild(o);
      });
      sel.value = "1";   // Monday default
    });
  }

  function openItemDialog(listId, itemId) {
    var list = listById(listId);
    var item = itemById(list, itemId);
    if (!list || !item) return;

    editingListId = listId;
    editingItemId = itemId;

    $("f-text").value  = item.text;
    $("f-due").value   = item.due || "";
    $("f-notes").value = item.notes || "";

    renderItemLabels(item);
    renderInfoRows(item);
    $("f-lbl-picker").hidden = true;

    var hasRec = !!item.recurrence;
    setRadio("f-rec", hasRec ? "on" : "none");
    $("rec-editor").style.display = hasRec ? "flex" : "none";
    if (hasRec) fillRecFields("f-", item.recurrence);

    $("dlg-item").showModal();
    setTimeout(function () { $("f-text").focus(); }, 50);
  }

  function fillRecFields(prefix, rec) {
    $(prefix + "every").value = rec.every || 1;
    $(prefix + "unit").value  = rec.unit || "week";
    if (rec.unit === "week" && typeof rec.weekday === "number") {
      $(prefix + "weekday").value = String(rec.weekday);
    }
    $(prefix + "weekday").disabled = ($(prefix + "unit").value !== "week");
  }

  function setRadio(name, val) {
    var radios = document.getElementsByName(name);
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = radios[i].value === val;
    }
  }

  function getRadio(name) {
    var radios = document.getElementsByName(name);
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) return radios[i].value;
    }
    return null;
  }

  function readRecFromFields(prefix) {
    if (getRadio(prefix + "rec") !== "on") return null;
    var unit = $(prefix + "unit").value;
    return {
      every:   Math.max(1, parseInt($(prefix + "every").value, 10) || 1),
      unit:    unit,
      weekday: unit === "week" ? parseInt($(prefix + "weekday").value, 10) : null
    };
  }

  // --- Labels inside the item dialog (Kanban-parity contract) ---
  function renderItemLabels(item) {
    var host = $("f-lbl-chips");
    host.innerHTML = "";
    (item.labels || []).forEach(function (lid) {
      var lb = labelById(lid);
      if (!lb) return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lbl-chip";
      chip.style.background = lb.color || FALLBACK_COLOR;
      chip.title = t("labels.chipRemove");
      var name = document.createElement("span");
      name.textContent = lb.name;
      chip.appendChild(name);
      chip.addEventListener("click", function () {
        item.labels = item.labels.filter(function (id) { return id !== lid; });
        touch(item);
        save(); scheduleRender();
        renderItemLabels(item);
      });
      host.appendChild(chip);
    });
  }

  function renderLblPicker() {
    var list = $("f-lbl-list");
    list.innerHTML = "";

    if (state.labels.length === 0) {
      var none = document.createElement("div");
      none.className = "lbl-none";
      none.textContent = t("labels.none");
      list.appendChild(none);
      return;
    }

    var item = editingItem();
    state.labels.forEach(function (label) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "lbl-item";
      if (item && item.labels.indexOf(label.id) !== -1) {
        row.classList.add("attached");
      }

      var dot = document.createElement("span");
      dot.className = "fl-dot";
      dot.style.background = label.color || FALLBACK_COLOR;
      row.appendChild(dot);

      var name = document.createElement("span");
      name.className = "fl-name";
      name.textContent = label.name;
      row.appendChild(name);

      row.addEventListener("click", function () {
        var it = editingItem();
        if (!it) return;
        var pos = it.labels.indexOf(label.id);
        if (pos === -1) it.labels.push(label.id);
        else            it.labels.splice(pos, 1);
        touch(it);
        save(); scheduleRender();
        renderItemLabels(it);
        renderLblPicker();
      });

      list.appendChild(row);
    });
  }

  function renderLblSwatches() {
    var host = $("f-lbl-swatches");
    host.innerHTML = "";
    SWATCH_COLORS.forEach(function (c) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "lbl-swatch" + (pickedSwatch === c ? " sel" : "");
      sw.style.background = c;
      sw.addEventListener("click", function () {
        pickedSwatch = c;
        renderLblSwatches();
      });
      host.appendChild(sw);
    });
  }

  function createNewLabel() {
    var input = $("f-lbl-name");
    var name = input.value.trim();
    if (!name) return;

    var label = {
      id: uid(), name: name, color: pickedSwatch,
      mtime: Date.now(), om: 0, pos: state.labels.length
    };
    state.labels.push(label);

    var item = editingItem();
    if (item) { item.labels.push(label.id); touch(item); }

    pickedSwatch = FALLBACK_COLOR;
    input.value = "";

    save(); scheduleRender();
    if (item) renderItemLabels(item);
    renderLblPicker();
    input.focus();
    showToast(t("toast.labeladd"), false);
  }

  // --- Extra info rows inside the item dialog (free key-value) ---
  function renderInfoRows(item) {
    var host = $("f-info-list");
    host.innerHTML = "";
    item.info.forEach(function (f) {
      host.appendChild(makeInfoRow(item, f));
    });
  }

  function makeInfoRow(item, f) {
    var row = document.createElement("div");
    row.className = "info-row";

    var lbl = document.createElement("input");
    lbl.type = "text";
    lbl.setAttribute("placeholder", t("item.info.label"));
    lbl.value = f.label;
    lbl.autocomplete = "off";
    lbl.addEventListener("input", function () { f.label = lbl.value; });
    row.appendChild(lbl);

    var val = document.createElement("input");
    val.type = "text";
    val.setAttribute("placeholder", t("item.info.value"));
    val.value = f.value;
    val.autocomplete = "off";
    val.addEventListener("input", function () { f.value = val.value; });
    row.appendChild(val);

    var x = document.createElement("button");
    x.type = "button";
    x.className = "row-x";
    x.setAttribute("aria-label", t("item.info.add"));
    x.title = t("item.info.add");
    x.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", function () {
      item.info = item.info.filter(function (r) { return r !== f; });
      touch(item);
      save(); scheduleRender();
      renderInfoRows(item);
    });
    row.appendChild(x);

    return row;
  }

  function addInfoRow() {
    var item = editingItem();
    if (!item) return;
    item.info.push({ id: uid(), label: "", value: "" });
    touch(item);
    save();
    renderInfoRows(item);
    var rows = $("f-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector("input");
      if (l) l.focus();
    }
  }

  // Flush typed-but-unsaved text when the item dialog closes by ANY
  // path (Save button, Esc) — nothing is ever lost. Structural label/
  // info changes are saved at the moment of the click, Kanban-style.
  // Every flush stamps the item: dialog edits are real mutations.
  $("dlg-item").addEventListener("close", function () {
    if (editingListId === null) return;
    var item = editingItem();
    editingListId = null;
    editingItemId = null;
    if (!item) return;
    item.info = (item.info || []).filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    });
    item.text  = $("f-text").value.trim() || item.text;
    item.due   = $("f-due").value || null;
    item.notes = $("f-notes").value;
    item.recurrence = readRecFromFields("f-");
    touch(item);
    save(); scheduleRender();
  });

  // ---------- 8. List settings dialog ----------
  function openListDialog(listId) {
    var list = listById(listId);
    if (!list) return;

    editingListId = listId;
    editingItemId = null;

    $("l-name").value = list.name;
    var hasRec = !!list.recurrence;
    setRadio("l-rec", hasRec ? "on" : "none");
    $("rec-editor-list").style.display = hasRec ? "flex" : "none";
    if (hasRec) fillRecFields("l-", list.recurrence);

    updateNextResetLabel(list);

    $("dlg-list").showModal();
    setTimeout(function () { $("l-name").focus(); }, 50);
  }

  function updateNextResetLabel(list) {
    var el = $("l-next-reset");
    if (list.recurrence && list.nextReset) {
      var d = isoToDate(list.nextReset);
      el.textContent = t("recur.list.next") + " " +
        d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
                             { day: "numeric", month: "short", year: "numeric" });
    } else {
      el.textContent = "";
    }
  }

  function createList() {
    var list = newListObj(t("new.list"));
    list.pos = state.lists.length;
    state.lists.push(list);
    state.activeList = list.id;
    state.om = Date.now();          // new order version
    state.sm = Date.now();
    save(); scheduleRender();
    openListDialog(list.id);      // straight into settings to name it
  }

  // ---------- 9. Item drag & drop reorder ----------
  var DRAG_SVG =
    '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">' +
    '<circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>' +
    '<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>' +
    '<circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';

  var RECUR_SVG =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

  function makeDragHandle(list, item) {
    var h = document.createElement("span");
    h.className = "drag-handle";
    h.setAttribute("title", t("drag.reorder"));
    h.setAttribute("aria-label", t("drag.reorder"));
    h.innerHTML = DRAG_SVG;

    h.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      startDrag(h.closest(".item"), list, item, e);
    });
    return h;
  }

  // Pointer-based (mouse + touch unified). While dragging we only
  // decorate the DOM; the array is touched once, on drop. A drop
  // stamps the LIST's ordering version (om) — positions are the
  // ordering concern, item content mtimes stay untouched.
  function startDrag(li, list, item, e) {
    var rows = [].slice.call(document.querySelectorAll("#items .item"));
    li.classList.add("dragging");
    document.body.classList.add("is-dragging");

    function clearMarks() {
      rows.forEach(function (el) {
        el.classList.remove("drag-over-above", "drag-over-below");
      });
    }

    function hitTest(y) {
      var inside = null, nearest = null, bestDist = Infinity;
      rows.forEach(function (el) {
        if (el === li) return;
        var r = el.getBoundingClientRect();
        var cy = r.top + r.height / 2;
        if (y >= r.top && y <= r.bottom) inside = el;
        var dist = Math.abs(y - cy);
        if (dist < bestDist) { bestDist = dist; nearest = el; }
      });
      return inside || nearest;
    }

    function onMove(ev) {
      clearMarks();
      var target = hitTest(ev.clientY);
      if (!target || target === li) return;
      var r = target.getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) target.classList.add("drag-over-above");
      else                                  target.classList.add("drag-over-below");
    }

    function onUp(ev) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);

      var target = hitTest(ev.clientY);
      li.classList.remove("dragging");
      document.body.classList.remove("is-dragging");
      clearMarks();

      if (!target || target === li) return;      // dropped nowhere useful

      var before = ev.clientY < target.getBoundingClientRect().top +
                           target.getBoundingClientRect().height / 2;

      // Build the visible order, splice the dragged item in, then
      // append any items the filter hid (keeps them, at the end).
      var ids = rows.map(function (el) { return el.dataset.id; })
                    .filter(function (id) { return id !== item.id; });
      var ti = ids.indexOf(target.dataset.id);
      if (ti === -1) return;
      ids.splice(before ? ti : ti + 1, 0, item.id);

      var byId = {};
      list.items.forEach(function (it) { byId[it.id] = it; });
      var reordered = [];
      ids.forEach(function (id) {
        if (byId[id]) { reordered.push(byId[id]); delete byId[id]; }
      });
      Object.keys(byId).forEach(function (k) { reordered.push(byId[k]); });
      list.items = reordered;
      list.items.forEach(function (it, i) { it.pos = i; });
      list.om = Date.now();          // this side owns the item order now

      save(); scheduleRender();
    }

    function onCancel() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      li.classList.remove("dragging");
      document.body.classList.remove("is-dragging");
      clearMarks();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  // ---------- 9b. Tab drag reorder ----------
  var TAB_DRAG_THRESHOLD = 8;

  function attachTabDrag(tabEl, list) {
    tabEl.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest(".t-rename")) return;
      if ($("dlg-item").open || $("dlg-list").open) return;
      if (state.lists.length < 2) return;        // nothing to reorder

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        tabEl.classList.add("drag-src");
        document.body.classList.add("is-dragging-tab");
      }

      function clearMarks() {
        var marked = document.querySelectorAll(
          ".tab.drag-over-left, .tab.drag-over-right");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-left", "drag-over-right");
        }
      }

      function findTarget(x) {
        var tabs = [].slice.call(document.querySelectorAll("#tabs .tab"));
        var target = null, bestDist = Infinity;
        tabs.forEach(function (tb) {
          if (tb === tabEl) return;
          var r = tb.getBoundingClientRect();
          var cx = r.left + r.width / 2;
          var dist = Math.abs(x - cx);
          if (dist < bestDist) { bestDist = dist; target = tb; }
        });
        return target;
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          // horizontal bias: vertical drags stay with the browser
          if (Math.abs(dx) < TAB_DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
          beginDrag();
        }
        ev.preventDefault();
        clearMarks();

        var target = findTarget(ev.clientX);
        if (!target) return;
        var r = target.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) target.classList.add("drag-over-left");
        else                                   target.classList.add("drag-over-right");
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        var target = findTarget(ev.clientX);

        tabEl.classList.remove("drag-src");
        document.body.classList.remove("is-dragging-tab");
        clearMarks();

        if (started && target && target.dataset.listId) {
          var r = target.getBoundingClientRect();
          var before = ev.clientX < r.left + r.width / 2;
          moveListById(list, target.dataset.listId, before);
        }
        if (started) { save(); scheduleRender(); }
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (started) {
          tabEl.classList.remove("drag-src");
          document.body.classList.remove("is-dragging-tab");
          clearMarks();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  function moveListById(srcList, targetListId, before) {
    var targetList = listById(targetListId);
    if (!targetList || targetList === srcList) return;

    var from = state.lists.indexOf(srcList);
    if (from === -1) return;
    state.lists.splice(from, 1);

    var to = state.lists.indexOf(targetList);
    if (to === -1) {                     // paranoia — restore source
      state.lists.splice(from, 0, srcList);
      return;
    }
    state.lists.splice(before ? to : to + 1, 0, srcList);

    // This side owns the LIST order now — fresh ordering version
    state.om = Date.now();
    state.lists.forEach(function (l, i) { l.pos = i; });
  }

  // ---------- 10. Label helpers ----------
  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }

  function updateFilterBtn() {
    var btn = $("filter-btn");
    var badge = $("filter-count");
    if (!btn || !badge) return;
    if (activeFilters.length > 0) {
      btn.classList.add("has-filters");
      badge.textContent = String(activeFilters.length);
      badge.hidden = false;
    } else {
      btn.classList.remove("has-filters");
      badge.hidden = true;
    }
  }

  function renderFilterPop() {
    var pop = $("filter-pop");
    pop.innerHTML = "";

    if (state.labels.length === 0) {
      var e = document.createElement("div");
      e.className = "fl-empty";
      e.textContent = t("filter.empty");
      pop.appendChild(e);
      return;
    }

    state.labels.forEach(function (label) {
      var item = document.createElement("div");
      item.className = "fl-item";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = activeFilters.indexOf(label.id) !== -1;
      cb.addEventListener("change", function () {
        var at = activeFilters.indexOf(label.id);
        if (cb.checked && at === -1) activeFilters.push(label.id);
        if (!cb.checked && at !== -1) activeFilters.splice(at, 1);
        updateFilterBtn();
        scheduleRender();
      });
      item.appendChild(cb);

      var dot = document.createElement("span");
      dot.className = "fl-dot";
      dot.style.background = label.color || FALLBACK_COLOR;
      item.appendChild(dot);

      var name = document.createElement("span");
      name.className = "fl-name";
      name.textContent = label.name;
      item.appendChild(name);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "fl-del";
      del.setAttribute("aria-label", t("filter.del"));
      del.title = t("filter.del");
      del.innerHTML =
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (!confirm(t("confirm.lbldel"))) return;
        deleteLabel(label.id);
      });
      item.appendChild(del);

      pop.appendChild(item);
    });
  }

  // Deleting a label detaches it everywhere and clears it from active
  // filters → no orphan ids, no ghost filter entries. Soft-deleted via
  // tombstone: the OTHER device merges the deletion instead of
  // resurrecting the label from its stale local copy.
  function deleteLabel(labelId) {
    state.labels = state.labels.filter(function (l) { return l.id !== labelId; });
    state.lists.forEach(function (list) {
      list.items.forEach(function (item) {
        item.labels = (item.labels || []).filter(function (id) { return id !== labelId; });
      });
    });
    tombstone(labelId);      // merge-safe deletion
    activeFilters = activeFilters.filter(function (id) { return id !== labelId; });

    updateFilterBtn();
    save(); scheduleRender();
    if (!$("filter-pop").hidden) renderFilterPop();
    var item = editingItem();
    if (item) renderItemLabels(item);
    showToast(t("toast.labeldel"), false);
  }

  // ---------- 11. Undo / toast ----------
  var undoSnapshot = null;
  var toastTimer = null;

  function pushUndo(key) {
    undoSnapshot = JSON.stringify(state);
    showToast(t(key), true);
  }

  function doUndo() {
    if (!undoSnapshot) return;
    state = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    stampAll();              // the restored snapshot is the NEWEST truth
    save(); renderAll();
    showToast(t("toast.undone"), false);
  }

  function showToast(text, withUndo) {
    var el = $("toast");
    el.innerHTML = "";
    el.classList.remove("show");

    var span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);

    if (withUndo) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = t("undo");
      b.addEventListener("click", doUndo);
      el.appendChild(b);
    }

    void el.offsetWidth;               // restart transition
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  // ---------- 12. Sync slice (merge-registered) + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone (direct) open — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;

    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    // v0.4: 5th argument — the merge function. With it, a pull never
    // wholesale-overwrites local state; local and remote converge.
    api.registerSlice("todo", sliceGet, sliceSet, "oros-todo-data", mergeTodoStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  // data  — merged result (or plain remote on legacy LWW paths)
  // info  — { merged: true } when the value came through mergeTodoStates
  //         (sync.js contract); anything else = wholesale apply.
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.lists) || data.lists.length === 0) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      pruneTombstones(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      applyListCycles();               // may fast-forward missed cycles
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // activeList must point at something that exists
    var ok = state.lists.some(function (l) { return l.id === state.activeList; });
    if (!ok) state.activeList = state.lists[0].id;

    scheduleRender();

    if (info && info.merged) {
      showToast(t("toast.merged"), false);   // visible convergence
    }
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < ti.length; j++) {
      ti[j].setAttribute("title", t(ti[j].getAttribute("data-i18n-title")));
      ti[j].setAttribute("aria-label", ti[j].getAttribute("title"));
    }
    var p = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < p.length; k++) {
      p[k].setAttribute("placeholder", t(p[k].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // Quick-add
    $("quick-add").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); quickAdd(); }
    });
    $("quick-add-btn").addEventListener("click", function () {
      quickAdd();
      $("quick-add").focus();
    });

    // Controls
    $("hide-completed").addEventListener("change", function () {
      state.hideCompleted = this.checked;
      state.sm = Date.now();      // settings change — LWW participant
      save(); scheduleRender();
    });
    $("clear-completed").addEventListener("click", function () {
      var list = activeList();
      var doomed = list.items.filter(function (it) { return it.done; });
      if (doomed.length === 0) return;
      pushUndo("toast.cleared");
      doomed.forEach(function (it) { tombstone(it.id); });   // merge-safe
      list.items = list.items.filter(function (it) { return !it.done; });
      save(); scheduleRender();
    });
    $("list-settings").addEventListener("click", function () {
      openListDialog(activeList().id);
    });

    // New list
    $("tab-add").addEventListener("click", createList);

    // --- Global search ---
    $("search").addEventListener("input", function () {
      searchQuery = this.value.trim().toLowerCase();
      $("search-clear").hidden = !searchQuery;
      scheduleRender();
    });
    $("search-clear").addEventListener("click", function () {
      $("search").value = "";
      searchQuery = "";
      $("search-clear").hidden = true;
      scheduleRender();
      $("search").focus();
    });

    // --- Label filter popover ---
    $("filter-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = $("filter-pop");
      pop.hidden = !pop.hidden;
      if (!pop.hidden) renderFilterPop();
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#filter-slot")) {
        $("filter-pop").hidden = true;
      }
    });

    // --- Item dialog: labels ---
    $("f-lbl-toggle").addEventListener("click", function () {
      var picker = $("f-lbl-picker");
      if (picker.hidden) {
        renderLblPicker();
        renderLblSwatches();
        picker.hidden = false;
      } else {
        picker.hidden = true;
      }
    });
    $("f-lbl-new-add").addEventListener("click", createNewLabel);
    $("f-lbl-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); createNewLabel(); }
    });

    // --- Item dialog: extra info ---
    $("f-info-add").addEventListener("click", addInfoRow);

    // --- Item dialog submit (form-validation path) ---
    var itemForm = $("item-form");
    itemForm.addEventListener("submit", function (e) {
      e.preventDefault();
      $("dlg-item").close();   // persistence commits in the close handler
    });
        // Delete: tombstone (merge-safe) + local removal. Null-ing the
    // editing ids BEFORE close() makes the close-commit handler skip —
    // the item is already deleted, there is nothing to flush.
    $("f-delete").addEventListener("click", function () {
      if (!confirm(t("confirm.itemdel"))) return;
      var list = listById(editingListId);
      if (list) {
        pushUndo("toast.deleted");
        tombstone(editingItemId);          // merge-safe deletion
        list.items = list.items.filter(function (it) { return it.id !== editingItemId; });
      }
      editingListId = null;
      editingItemId = null;
      $("dlg-item").close();
      save(); scheduleRender();
    });

    // --- List dialog ---
    var listForm = $("list-form");
    listForm.addEventListener("submit", function (e) {
      e.preventDefault();
      saveListDialog();
      $("dlg-list").close();
    });
    $("l-delete").addEventListener("click", function () {
      var list = listById(editingListId);
      if (!list) return;
      if (!confirm(t("confirm.listdel"))) return;

      pushUndo("toast.listdel");
      tombstone(list.id);
      list.items.forEach(function (it) { tombstone(it.id); });   // cascade
      state.lists = state.lists.filter(function (l) { return l.id !== list.id; });

      if (state.lists.length === 0) {
        var fresh = newListObj(t("new.list"));
        fresh.pos = 0;
        state.lists.push(fresh);
      }
      if (!state.lists.some(function (l) { return l.id === state.activeList; })) {
        state.activeList = state.lists[0].id;
      }
      state.om = Date.now();
      state.sm = Date.now();
      editingListId = null;

      $("dlg-list").close();
      save(); renderAll();
    });

    // Recurrence toggles (item + list editors)
    [["f", "rec-editor"], ["l", "rec-editor-list"]].forEach(function (pair) {
      var prefix = pair[0], editorId = pair[1];
      var radios = document.getElementsByName(prefix + "-rec");
      for (var i = 0; i < radios.length; i++) {
        radios[i].addEventListener("change", function () {
          $(editorId).style.display = (this.value === "on") ? "flex" : "none";
        });
      }
      $(prefix + "-unit").addEventListener("change", function () {
        $(prefix + "-weekday").disabled = (this.value !== "week");
      });
    });
  }

  // Commits the list dialog: header edits stamp the HEADER's mtime —
  // never other lists' data (structural merge keeps them independent).
  function saveListDialog() {
    var list = listById(editingListId);
    if (!list) return;

    var newName = $("l-name").value.trim();
    if (newName && newName !== list.name) {
      list.name = newName;
      touch(list);
    }

    var rec = readRecFromFields("l-");
    if (JSON.stringify(rec) !== JSON.stringify(list.recurrence)) {
      list.recurrence = rec;
      if (rec) {
        // Cycle restarts from today under the new rule
        list.lastReset = todayISO();
        list.nextReset = dateToISO(nextOccurrence(isoToDate(todayISO()), rec));
      } else {
        list.lastReset = null;
        list.nextReset = null;
      }
      touch(list);
    }

    editingListId = null;
    save(); scheduleRender();
  }

  // ---------- Boot ----------
  load();
  applyI18n();
  populateWeekdaySelects();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  renderAll();
})();