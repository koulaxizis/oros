// ============================================================
// orOS To-Do — App logic
// New in v0.4 (cross-device MERGE):
//   - Every entity (list / task / label) carries mtime (content
//     version) + pos/om (ordering version). Every mutation stamps.
//   - Soft deletes: state.deleted = { [id]: ts } tombstones,
//     pruned after 30 days. Deletion wins over older edits;
//     an edit NEWER than its tombstone resurrects the entity.
//   - mergeTodoStates(local, remote): deterministic, symmetric —
//     both devices compute the SAME converged result.
//       · scalars (activeList/hideCompleted): larger sm wins — kept
//         for devices on the previous version only; this version
//         keeps the view per device ("oros-todo-prefs", TD-8)
//       · entities: union by id, content by larger mtime
//         (tie → lexicographic JSON — identical both ways)
//       · ordering (pos/om): side with larger om wins positions
//       · tombstones: union with max ts; deletion beats older
//         edits, loses to newer ones
//   - Undo puts back ONLY what the action removed, stamped newest
//     (TD-1); nothing else is re-stamped.
//   - Tasks merge FIELD BY FIELD (it.fm, TD-3); the slice and the
//     merge share one canonical form (TD-4).
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
      "item.info.remove": "Remove field",
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
      "toast.saveFail": "Could not save — the storage of this browser is full",
      "undo":          "Undo",
      "confirm.listdel": "Delete this list and all its tasks?",
      "confirm.itemdel": "Delete this task?",
      "confirm.lbldel":  "Delete this label? It will be removed from all tasks.",
      "confirm.no":      "Cancel",
      "new.list":      "New list",
      "recur.list.next": "Next reset:",
      "drag.reorder":   "Reorder",
      "tab.add":        "Add list",
      "add.task":       "Add task",
      "interval.aria":  "Interval",
      "filtered.title": "All tasks are completed",
      "filtered.hint":  "Turn off “Hide completed” to see them."
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
      "item.info.remove": "Αφαίρεση πεδίου",
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
      "toast.saveFail": "Η αποθήκευση απέτυχε — ο χώρος αποθήκευσης του browser γέμισε",
      "undo":          "Αναίρεση",
      "confirm.listdel": "Διαγραφή λίστας και όλων των εργασιών της;",
      "confirm.itemdel": "Διαγραφή αυτής της εργασίας;",
      "confirm.lbldel":  "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις εργασίες.",
      "confirm.no":     "Άκυρο",
      "new.list":      "Νέα λίστα",
      "recur.list.next": "Επόμενο reset:",
      "drag.reorder":   "Αναδιάταξη",
      "tab.add":        "Προσθήκη λίστας",
      "add.task":       "Προσθήκη εργασίας",
      "interval.aria":  "Διάστημα",
      "filtered.title": "Όλες οι εργασίες έχουν ολοκληρωθεί",
      "filtered.hint":  "Απενεργοποίησε την «Απόκρυψη ολοκληρωμένων» για να τις δεις."
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

  // BOOT MARKER (Part VII §16 + Checklist F): stale-bundle
  // detection (R3/R11) + lang attr at boot (F: i18N).
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("todo.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // §14 LABEL_COLORS — shared 8-color vocabulary (Notes/To-Do/
  // Mood/Habits). Audit #23: todo shipped a private palette;
  // unified. Stored label colors are data — untouched; only the
  // picker options change.
  var SWATCH_COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf",
                       "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var FALLBACK_COLOR = "#ecc75f";

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

  // TD-3 — ONE STAMP PER FIELD OF A TASK. A task used to carry a
  // single mtime and the merge took the whole newer object: ticking
  // a task on the phone erased notes written on the laptop (or the
  // other way round), and the nightly list cycle — which only
  // un-ticks — overwrote every edit made elsewhere to those tasks.
  //   it.fm = { text, done, due, notes, labels, info, recurrence }
  // (always complete once present); it.mtime = the newest of them
  // and still decides life against a tombstone.
  // A task whose mtime is NEWER than all of its field stamps was
  // last changed by a device on the previous todo.js (it bumps mtime
  // only): for that version mtime speaks for every field.
  var ITEM_FIELDS = ["text", "done", "due", "notes", "labels", "info", "recurrence"];
  function touchedByOldCode(it) {
    if (!it.fm || typeof it.fm !== "object") return false;
    var mx = 0;
    for (var i = 0; i < ITEM_FIELDS.length; i++) {
      var v = it.fm[ITEM_FIELDS[i]];
      if (typeof v === "number" && v > mx) mx = v;
    }
    return (it.mtime || 0) > mx;
  }
  function fieldStamp(it, f) {
    if (!it.fm || typeof it.fm !== "object" || touchedByOldCode(it)) return it.mtime || 0;
    return (typeof it.fm[f] === "number") ? it.fm[f] : 0;
  }
  function ensureFm(it) {
    var fm = {};
    for (var i = 0; i < ITEM_FIELDS.length; i++) fm[ITEM_FIELDS[i]] = fieldStamp(it, ITEM_FIELDS[i]);
    it.fm = fm;
  }
  function touchField(it, f) {
    ensureFm(it);
    var now = Date.now();
    it.fm[f] = now;
    it.mtime = now;
  }
  function stampItemNewest(it, now) {
    it.fm = {};
    for (var i = 0; i < ITEM_FIELDS.length; i++) it.fm[ITEM_FIELDS[i]] = now;
    it.mtime = now;
  }

  // TD-9 — the same for a LIST header, in two groups: "name", and
  // "cycle" (recurrence + lastReset + nextReset travel together).
  // Renaming a list on one device no longer reverts a cycle set on
  // another, and the other way round.
  var LIST_FIELDS = ["name", "cycle"];
  function listTouchedByOldCode(l) {
    if (!l.fm || typeof l.fm !== "object") return false;
    var mx = Math.max(typeof l.fm.name === "number" ? l.fm.name : 0,
                      typeof l.fm.cycle === "number" ? l.fm.cycle : 0);
    return (l.mtime || 0) > mx;
  }
  function listStamp(l, f) {
    if (!l.fm || typeof l.fm !== "object" || listTouchedByOldCode(l)) return l.mtime || 0;
    return (typeof l.fm[f] === "number") ? l.fm[f] : 0;
  }
  function touchListField(l, f) {
    var fm = { name: listStamp(l, "name"), cycle: listStamp(l, "cycle") };
    var now = Date.now();
    fm[f] = now;
    l.fm = fm;
    l.mtime = now;
  }
  function stampListNewest(l, now) {
    l.fm = { name: now, cycle: now };
    l.mtime = now;
  }

  function tombstone(id) {
    if (!state.deleted) state.deleted = {};
    state.deleted[id] = Date.now();
  }

  function defaultState() {
    // SEEDS MUST BE DETERMINISTIC (v0.36.00 fix — "parallel lists on
    // fresh device" root cause). Fixed IDs + mtime/sm/om = 0 mean:
    //   · every device computes byte-identical seeds → the merge
    //     union-by-id COLLAPSES them into ONE instance (no twins)
    //   · mtime 0 = "oldest possible content" → any real user edit
    //     or remote copy wins LWW, seeds never override real data
    //   · sm 0   = seeded settings can NEVER beat the remote's
    //     activeList/hideCompleted (the "opens the new empty list
    //     by default" symptom)
    //   · tombstones (user deleted defaults elsewhere) always beat
    //     mtime-0 seeds → deleted defaults stay deleted
    // DO NOT use newListObj()/uid()/Date.now() here. The names are
    // language-dependent by design (localized per device); LWW picks
    // one deterministically — never duplicates.
    var mkSeed = function (id, name, pos) {
      return {
        id: id, name: name, mtime: 0, om: 0, pos: pos,
        recurrence: null, lastReset: null, nextReset: null, items: [],
        fm: { name: 0, cycle: 0 }
      };
    };
    return {
      ver: DATA_VER,
      sm: 0,
      om: 0,
      activeList: "tdl-general",
      hideCompleted: false,
      deleted: {},
      labels: [],
      lists: [
        mkSeed("tdl-general", LANG === "el" ? "Γενικά" : "General", 0),
        mkSeed("tdl-groceries", LANG === "el" ? "Ψώνια" : "Groceries", 1)
      ]
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
  function freshList(name) {
    var l = newListObj(name);
    stampListNewest(l, l.mtime);
    return l;
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
  function freshItem(text, due) {
    var it = newItemObj(text, due);
    stampItemNewest(it, it.mtime);
    return it;
  }

  // Additive migration: bring ANY older shape up to DATA_VER.
  // v1 → labels/info; v2 → merge stamps (sm/om/mtime/pos/deleted).
  // Unknown stamps default to 0 = "oldest possible": real remote
  // timestamps (if any) win over migrated data — never the reverse.
  function migrate(data) {
    if (!data || !Array.isArray(data.lists)) return null;
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    if (typeof data.hideCompleted !== "boolean") data.hideCompleted = false;
    if (typeof data.activeList !== "string") data.activeList = (data.lists[0] || {}).id || null;
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

  // TD-4 — tombstones in ONE canonical form: keys sorted, and the
  // 30-day prune measured against the NEWEST stamp found in the data,
  // never against this device's clock. Two devices used to hold the
  // same tombstones in different key order (each deletes something
  // before syncing) — the serialized states never matched, and both
  // uploaded on every sync cycle, for as long as the tombs lived.
  function newestStamp(st) {
    var mx = Math.max(st.sm || 0, st.om || 0);
    (st.labels || []).forEach(function (lb) { if ((lb.mtime || 0) > mx) mx = lb.mtime; });
    (st.lists || []).forEach(function (l) {
      if ((l.mtime || 0) > mx) mx = l.mtime;
      if ((l.om || 0) > mx) mx = l.om;
      (l.items || []).forEach(function (it) { if ((it.mtime || 0) > mx) mx = it.mtime; });
    });
    var del = st.deleted || {};
    Object.keys(del).forEach(function (id) { if ((del[id] || 0) > mx) mx = del[id]; });
    return mx;
  }
  // TD-10: the tombstone of a DEFAULT list never expires. Every new
  // device creates the two default lists again (same ids, stamp 0);
  // once the 30 days were over, a default list the user had deleted
  // came back, empty, on all devices.
  var SEED_LIST_IDS = { "tdl-general": true, "tdl-groceries": true };
  function canonDeleted(st) {
    var src = st.deleted || {}, out = {};
    var cutoff = newestStamp(st) - TOMB_LIFETIME_MS;
    Object.keys(src).sort().forEach(function (id) {
      if (SEED_LIST_IDS[id] || (src[id] || 0) >= cutoff) out[id] = src[id];
    });
    return out;
  }
  function pruneTombstones(st) {
    st.deleted = canonDeleted(st);
  }

  // Canonical task: fixed key order, field stamps always spelled out.
  var ITEM_KEYS = ["id", "text", "done", "due", "notes", "labels", "info", "recurrence",
                   "mtime", "om", "pos", "fm"];
  function canonItem(src) {
    var it = {}, i;
    for (i = 0; i < ITEM_KEYS.length; i++) if (src[ITEM_KEYS[i]] !== undefined) it[ITEM_KEYS[i]] = src[ITEM_KEYS[i]];
    Object.keys(src).sort().forEach(function (k) {
      if (it[k] === undefined && src[k] !== undefined) it[k] = src[k];
    });
    var fm = {};
    for (i = 0; i < ITEM_FIELDS.length; i++) fm[ITEM_FIELDS[i]] = fieldStamp(src, ITEM_FIELDS[i]);
    delete it.fm;
    it.fm = fm;
    return it;
  }
  // What the sync engine sees (getter) and what the merge returns.
  var LIST_KEYS = ["id", "name", "mtime", "om", "pos", "recurrence", "lastReset", "nextReset", "items", "fm"];
  function canonList(src) {
    var l = {}, i;
    for (i = 0; i < LIST_KEYS.length; i++) if (src[LIST_KEYS[i]] !== undefined) l[LIST_KEYS[i]] = src[LIST_KEYS[i]];
    Object.keys(src).sort().forEach(function (k) {
      if (l[k] === undefined && src[k] !== undefined) l[k] = src[k];
    });
    l.items = (src.items || []).map(canonItem);
    delete l.fm;
    l.fm = { name: listStamp(src, "name"), cycle: listStamp(src, "cycle") };
    return l;
  }
  function canonState(st) {
    var out = JSON.parse(JSON.stringify(st));
    out.lists = (out.lists || []).map(canonList);
    out.deleted = canonDeleted(out);
    return out;
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
    } catch (e) {
      // TD-13: corrupted → fresh start, but the unreadable text is
      // copied aside first (rescue copy, never synced) instead of
      // being overwritten by the save() below.
      try {
        var bad = localStorage.getItem(STORAGE_KEY);
        if (bad && !localStorage.getItem(STORAGE_KEY + "-broken")) localStorage.setItem(STORAGE_KEY + "-broken", bad);
      } catch (e1) {}
    }
    state = defaultState();
    save();
  }

  // Auto-save: every mutation ends with save() + scheduleRender().
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) {
      // TD-6: a full disk used to be swallowed here — the task looked
      // saved and was gone at the next start. One inbox line per hour.
      try {
        var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
        if (N && typeof N.emit === "function") {
          N.emit({ ns: "todo", key: "save-fail:" + new Date().toISOString().slice(0, 13),
                   type: "err", title: "To-Do", body: t("toast.saveFail") });
        } else { showToast(t("toast.saveFail"), false); }
      } catch (e2) {}
    }
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

  // TD-8 — THE VIEW BELONGS TO THE DEVICE. Which tab is open and
  // whether completed tasks are hidden used to be SYNCED settings
  // (state.activeList / state.hideCompleted, ordered by state.sm):
  // every tab switch marked the engine dirty and uploaded, and the
  // other device's screen jumped to that tab at its next pull — a
  // task typed into the quick-add at that moment landed in a list the
  // user was not looking at a second earlier.
  // They now live in "oros-todo-prefs" (device-local, swept by the
  // factory reset). The three old fields stay in the data untouched,
  // for devices still running the previous todo.js.
  var PREFS_KEY = "oros-todo-prefs";
  var view = { activeList: null, hideCompleted: false };
  function loadView() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY)); } catch (e) {}
    if (p && typeof p === "object") {
      view.activeList = (typeof p.activeList === "string") ? p.activeList : null;
      view.hideCompleted = !!p.hideCompleted;
    } else {
      // first run of this version: start from what this device showed last
      view.activeList = (typeof state.activeList === "string") ? state.activeList : null;
      view.hideCompleted = !!state.hideCompleted;
      saveView();
    }
  }
  function saveView() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(view)); } catch (e) {}
  }
  function setActiveList(id) {
    view.activeList = id;
    saveView();
  }
  function activeList() {
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id === view.activeList) return state.lists[i];
    }
    // The list on screen is gone (deleted here or elsewhere): first one.
    view.activeList = state.lists[0].id;
    saveView();
    return state.lists[0];
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
    return entities.map(function (e, i) {
      if (e.pos === i) return e;
      var c = {};
      Object.keys(e).forEach(function (k) { c[k] = e[k]; });
      c.pos = i;                                 // on a copy: inputs stay untouched
      return c;
    });
  }
  
    // Symmetric ordering-reference pick: larger om wins; TIES broken
  // by lexicographic id sequence (identical decision on both devices
  // — never "local wins", that flip-flops forever).
  // TD-12: on a tie the two id sequences are compared as SEQUENCES
  // (element by element; a prefix is smaller than its extension),
  // restricted to the entities that survive the merge. The merged
  // order is the chosen sequence plus appended newcomers — an
  // extension of it — so merging the result with either input again
  // picks the result's own order. (The old comparison of serialized
  // strings let an EMPTY list beat a full one, and the order could
  // flip when the same data met again.)
  function pickRef(aArr, bArr, aOm, bOm, survivors) {
    if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
    var alive = {};
    (survivors || []).forEach(function (e) { alive[e.id] = true; });
    var seq = function (arr) {
      return (arr || []).map(function (e) { return e.id; })
        .filter(function (id) { return !survivors || alive[id]; });
    };
    var ka = seq(aArr), kb = seq(bArr), n = Math.min(ka.length, kb.length);
    for (var i = 0; i < n; i++) {
      if (ka[i] !== kb[i]) return ka[i] > kb[i] ? aArr : bArr;
    }
    return ka.length >= kb.length ? aArr : bArr;
  }

  // Lists merge STRUCTURALLY: headers LWW by mtime, but each list's
  // items merge independently — a header edit on one device must
  // never clobber item changes on the other.
  // Two versions of ONE task → one task, field by field (TD-3).
  function mergeItem(x, y) {
    if (JSON.stringify(x) === JSON.stringify(y)) return x;
    var base = newerEntity(x, y), out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    var fm = {};
    ITEM_FIELDS.forEach(function (f) {
      var sx = fieldStamp(x, f), sy = fieldStamp(y, f), w;
      if (sx !== sy) w = (sx > sy) ? x : y;
      else {
        var jx = JSON.stringify(x[f] === undefined ? null : x[f]);
        var jy = JSON.stringify(y[f] === undefined ? null : y[f]);
        w = (jx >= jy) ? x : y;                 // tie → same pick on both devices
      }
      if (w[f] === undefined) delete out[f];
      else out[f] = JSON.parse(JSON.stringify(w[f]));
      fm[f] = Math.max(sx, sy);
    });
    out.fm = fm;
    out.mtime = Math.max(x.mtime || 0, y.mtime || 0);
    return out;
  }
  function unionItems(aArr, bArr, tomb) {
    var map = {};
    (aArr || []).forEach(function (e) { map[e.id] = e; });
    (bArr || []).forEach(function (e) {
      map[e.id] = map[e.id] ? mergeItem(map[e.id], e) : e;
    });
    var out = [];
    Object.keys(map).forEach(function (id) {
      if (entAlive(map[id], tomb)) out.push(map[id]);
    });
    return out;
  }
  function mergeListEntity(la, lb, tomb) {
    var strip = function (l) {
      var c = JSON.parse(JSON.stringify(l));
      delete c.items;
      return c;
    };
    var base = newerEntity(strip(la), strip(lb)), head = {};
    Object.keys(base).forEach(function (k) { head[k] = base[k]; });
    // TD-9: name and cycle each from the side that changed them last
    var nA = listStamp(la, "name"), nB = listStamp(lb, "name");
    var nameFrom = (nA !== nB) ? (nA > nB ? la : lb)
                 : (JSON.stringify(la.name) >= JSON.stringify(lb.name) ? la : lb);
    head.name = nameFrom.name;
    var cyc = function (l) { return JSON.stringify([l.recurrence || null, l.lastReset || null, l.nextReset || null]); };
    var cA = listStamp(la, "cycle"), cB = listStamp(lb, "cycle");
    var cycFrom = (cA !== cB) ? (cA > cB ? la : lb) : (cyc(la) >= cyc(lb) ? la : lb);
    head.recurrence = cycFrom.recurrence ? JSON.parse(JSON.stringify(cycFrom.recurrence)) : null;
    head.lastReset = cycFrom.lastReset || null;
    head.nextReset = cycFrom.nextReset || null;
    head.fm = { name: Math.max(nA, nB), cycle: Math.max(cA, cB) };
    head.mtime = Math.max(la.mtime || 0, lb.mtime || 0);
    head.om = Math.max(la.om || 0, lb.om || 0);
    head.items = unionItems(la.items || [], lb.items || [], tomb);
    head.items = orderEntities(head.items, pickRef(la.items, lb.items, la.om, lb.om, head.items));
    return head;
  }

  function mergeTodoStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = mergeEntityMaps(a.deleted, b.deleted);
    // Pruning and key order happen once, at the end (canonState →
    // canonDeleted), by a rule that does not read this device's clock.

    // scalars: LWW by root settings mtime. TIES must NOT favor the
    // local side — merge(A,B) and merge(B,A) must pick the SAME side
    // or equal-sm devices ping-pong forever. Symmetric tie-break:
    // lexicographic compare of the scalars themselves.
    var sa = JSON.stringify([a.activeList || null, !!a.hideCompleted]);
    var sb = JSON.stringify([b.activeList || null, !!b.hideCompleted]);
    var settings = (a.sm || 0) !== (b.sm || 0)
      ? ((a.sm || 0) > (b.sm || 0) ? a : b)
      : (sa >= sb ? a : b);

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
    out.labels = orderEntities(labels, pickRef(a.labels, b.labels, a.om, b.om, labels));

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
      else {
        // one-sided (new or removed elsewhere): its tasks still obey
        // the tombstones (a task deleted on the other device stays so)
        merged = {};
        Object.keys(pair[0]).forEach(function (k) { merged[k] = pair[0][k]; });
        merged.items = orderEntities(
          (pair[0].items || []).filter(function (it) { return entAlive(it, tomb); }),
          pair[0].items);                          // keep the order, renumber pos
      }
      if (entAlive(merged, tomb)) mergedLists.push(merged);
    });
    out.lists = orderEntities(mergedLists, pickRef(a.lists, b.lists, a.om, b.om, mergedLists));

    // post-conditions: never ship an empty state (fresh-install
    // fallback), never point activeList at a ghost
    if (out.lists.length === 0) return null;
    var found = out.lists.some(function (l) { return l.id === out.activeList; });
    if (!found) out.activeList = out.lists[0].id;
    return canonState(out);
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
    // TD2: anchor on the CURRENT due date when it is still ahead —
    // finishing early must skip to the NEXT cycle instead of
    // re-issuing the period that was just completed. Past/absent
    // due dates anchor on now (overdue catch-up unchanged). This
    // also keeps the weekly-weekday math exact for biweekly rules,
    // since the anchor now lands on the due weekday.
    var now = new Date();
    var anchor = now;
    if (item.due) {
      var dIso = isoToDate(item.due);
      if (!isNaN(dIso.getTime()) && dIso >= now) anchor = dIso;
    }
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
          if (it.done) { it.done = false; touchField(it, "done"); }   // TD-3: only the tick
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
      b.className = "tab" + (list.id === activeList().id ? " active" : "");
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
        if (Date.now() - tabDragEndTs < 300) return;   // post-drag click
        if (view.activeList === list.id) return;
        setActiveList(list.id);     // TD-8: a view change — nothing to save or sync
        scheduleRender();
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
    if (view.hideCompleted && item.done) return false;
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
      $("empty").hidden = !(results.length === 0 && !anyItems);
      $("no-match").hidden = !(results.length === 0 && anyItems);
      $("filtered").hidden = true;
      return;
    }

    // Browsing mode — the active list, drag handles on
    var list = activeList();
    $("no-match").hidden = true;
    $("filtered").hidden = true;
    var visible = list.items.filter(function (item) {
      return !(view.hideCompleted && item.done);
    });
    if (visible.length === 0 && list.items.length > 0) {
      // Everything completed + Hide completed on → say so, never blank
      $("empty").hidden = true;
      $("filtered").hidden = false;
    } else {
      $("empty").hidden = !(list.items.length === 0);
    }

    list.items.forEach(function (item) {
      if (view.hideCompleted && item.done) return;
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
      touchField(item, "done");               // TD-3: the tick only
      if (item.done && recycleItem(item)) touchField(item, "due");   // recurring → reopens, new date
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
    var item = freshItem(parsed.text, parsed.due);
    list.items.unshift(item);
    list.items.forEach(function (it, i) { it.pos = i; });   // keep pos honest
    list.om = Date.now();          // top-insert is an ORDERING decision:
                                   // stamp it so this layout is the merge
                                   // reference (v0.4 — same contract as drag)

    input.value = "";
    // TD4: adding while a search/filter was active used to HIDE the
    // new task (it didn't match the view) — felt like a silent
    // failure. Adding is an explicit "show me this" action: clear
    // the session-only view state (never synced) so the task is
    // immediately visible.
    searchQuery = "";
    activeFilters = [];
    var si = $("search");
    if (si) si.value = "";
    var sc = $("search-clear");
    if (sc) sc.hidden = true;
    updateFilterBtn();
    save(); scheduleRender();
  }

  function renderAll() {
    renderTabs();
    renderItems();
    // Settings → UI: the checkbox must mirror state on EVERY render
    // (sync pull, undo), not only on user clicks. Fixes the "toggle
    // desync" where the checkbox showed stale state after a merge.
    var hc = $("hide-completed");
    if (hc && hc.checked !== !!view.hideCompleted) hc.checked = !!view.hideCompleted;
  }

  // ---------- 7. Item detail dialog ----------
  var editingListId = null;
  var editingItemId = null;
  var pickedSwatch = FALLBACK_COLOR;
  // TD-2: what the dialog showed when it opened, field by field. On
  // close only the fields the USER changed are written back.
  var openValues = null;
  // Extra-info rows are edited on a dialog-local copy and committed
  // at close: the rows used to write straight into the task object,
  // which a sync pull may replace while the dialog is open.
  var dlgInfo = [];

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
    dlgInfo = (item.info || []).map(function (f) {
      return { id: f.id || uid(), label: f.label || "", value: f.value || "" };
    });
    renderInfoRows();
    $("f-lbl-picker").hidden = true;

    var hasRec = !!item.recurrence;
    setRadio("f-rec", hasRec ? "on" : "none");
    $("rec-editor").style.display = hasRec ? "flex" : "none";
    if (hasRec) fillRecFields("f-", item.recurrence);

    openValues = readItemDialog();
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
        var cur = editingItem() || item;       // the state may have been replaced by a pull
        cur.labels = (cur.labels || []).filter(function (id) { return id !== lid; });
        touchField(cur, "labels");
        save(); scheduleRender();
        renderItemLabels(cur);
        if (!$("f-lbl-picker").hidden) renderLblPicker();
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
        touchField(it, "labels");
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
    if (item) { item.labels.push(label.id); touchField(item, "labels"); }

    pickedSwatch = FALLBACK_COLOR;
    input.value = "";

    save(); scheduleRender();
    if (item) renderItemLabels(item);
    renderLblPicker();
    input.focus();
    showToast(t("toast.labeladd"), false);
  }

  // --- Extra info rows inside the item dialog (free key-value) ---
  function renderInfoRows() {
    var host = $("f-info-list");
    host.innerHTML = "";
    dlgInfo.forEach(function (f) {
      host.appendChild(makeInfoRow(f));
    });
  }

  function makeInfoRow(f) {
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
    x.setAttribute("aria-label", t("item.info.remove"));
    x.title = t("item.info.remove");
    x.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", function () {
      // Committed with the rest of the dialog when it closes.
      dlgInfo = dlgInfo.filter(function (r) { return r !== f; });
      renderInfoRows();
    });
    row.appendChild(x);
    return row;
  }

  function addInfoRow() {
    if (!editingItem()) return;
    dlgInfo.push({ id: uid(), label: "", value: "" });
    // A blank row is not a change yet: the close-flush commits filled
    // rows and silently drops blank ones.
    renderInfoRows();
    var rows = $("f-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector("input");
      if (l) l.focus();
    }
  }

  // What the dialog holds right now, in comparable form.
  function readItemDialog() {
    var info = dlgInfo.filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    }).map(function (f) { return { id: f.id, label: f.label || "", value: f.value || "" }; });
    return {
      text:  $("f-text").value.trim(),
      due:   $("f-due").value || null,
      notes: $("f-notes").value,
      rec:   readRecFromFields("f-"),
      info:  info,
      infoKey: JSON.stringify(info.map(function (f) { return [f.label, f.value]; }))
    };
  }

  // TD-2 — commit the dialog: ONLY what the user changed since it
  // opened. The old close handler copied every field of the dialog
  // back into the task before it even checked for changes — when the
  // task had been updated by a sync in the meantime, an untouched
  // dialog (Esc) put the old text, date and notes back in memory, and
  // the next save of anything wrote them out.
  function commitItemDialog() {
    if (editingListId === null || editingItemId === null) return;
    var item = editingItem();
    var was = openValues;
    editingListId = null;
    editingItemId = null;
    openValues = null;
    if (!item || !was) return;
    var now = readItemDialog(), changed = false;
    if (now.text && now.text !== was.text) { item.text = now.text; touchField(item, "text"); changed = true; }
    if (now.due !== was.due) { item.due = now.due; touchField(item, "due"); changed = true; }
    if (now.notes !== was.notes) { item.notes = now.notes; touchField(item, "notes"); changed = true; }
    if (JSON.stringify(now.rec) !== JSON.stringify(was.rec)) {
      item.recurrence = now.rec; touchField(item, "recurrence"); changed = true;
    }
    if (now.infoKey !== was.infoKey) { item.info = now.info; touchField(item, "info"); changed = true; }
    if (!changed) return;                 // pristine close: no stamp, no save, no push
    save(); scheduleRender();
  }

  // Flush typed-but-unsaved text when the item dialog closes by ANY
  // path (Save button, Esc) — nothing is ever lost. Structural label/
  // info changes are saved at the moment of the click, Kanban-style.
  // Every flush stamps the item: dialog edits are real mutations.
  $("dlg-item").addEventListener("close", commitItemDialog);

  // TD-5: the "close" event never fires when the APP is closed with
  // the dialog still open (the shell replaces the frame) — notes
  // typed in it were simply gone. Commit on the way out too.
  function commitOpenDialogs() {
    try {
      if ($("dlg-item").open) commitItemDialog();
      if ($("dlg-list").open && editingListId !== null) saveListDialog();
    } catch (e) {}
  }
  window.addEventListener("pagehide", commitOpenDialogs);
  window.addEventListener("beforeunload", commitOpenDialogs);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") commitOpenDialogs();
  });

// v0.4b — the list dialog commits on ANY close path (Save, Esc,
  // backdrop), same contract as the item dialog. Nothing typed is
  // ever silently dropped. The submit handler nulls editingListId
  // first, so this handler is a no-op on the Save path (no double
  // commit), and the delete path nulls it before close() as well.
  $("dlg-list").addEventListener("close", function () {
    if (editingListId === null) return;
    saveListDialog();
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
    var list = freshList(t("new.list"));
    list.pos = state.lists.length;
    state.lists.push(list);
    setActiveList(list.id);
    state.om = Date.now();          // new order version
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
  var tabDragEndTs = 0;   // suppresses the trailing click after a drop

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
        if (started) {
          tabDragEndTs = Date.now();   // swallow the synthetic click
          save(); scheduleRender();
        }
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
        confirmDialog("confirm.lbldel", function () {
          deleteLabel(label.id);
        });
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
    pushUndo("toast.labeldel");   // audit #18: the ONLY destructive op without undo — now consistent
    state.labels = state.labels.filter(function (l) { return l.id !== labelId; });
    state.lists.forEach(function (list) {
      list.items.forEach(function (item) {
        var next = (item.labels || []).filter(function (id) { return id !== labelId; });
        // audit #18: detach MUST stamp the item's content version —
        // otherwise remote copies (older mtime, stale label id) can
        // win the JSON tie-break lottery and resurrect dead refs.
        if (next.length !== (item.labels || []).length) {
          item.labels = next;
          touchField(item, "labels");
        }
      });
    });
    tombstone(labelId);      // merge-safe deletion
    activeFilters = activeFilters.filter(function (id) { return id !== labelId; });

    updateFilterBtn();
    save(); scheduleRender();
    if (!$("filter-pop").hidden) renderFilterPop();
    var item = editingItem();
    if (item) renderItemLabels(item);
    // toast now comes from pushUndo() — with Undo button
  }

  // ---------- 11. Undo / toast ----------
  var undoSnapshot = null;
  var toastTimer = null;

  var undoFreshListId = null;   // the empty list created when the LAST list was deleted
  var undoViewList = null;      // the tab that was open when the action happened
  function pushUndo(key) {
    undoSnapshot = JSON.stringify(state);
    undoFreshListId = null;
    undoViewList = view.activeList;
    showToast(t(key), true);
  }

  // TD-1 — UNDO PUTS BACK WHAT THE ACTION REMOVED, NOTHING ELSE.
  // It used to restore the whole database as it was before the
  // action and stamp EVERY list, task and label "newest" (stampAll):
  // undoing one deletion then overrode every edit made on another
  // device that had not synced yet — and anything a pull had brought
  // in during the five seconds of the toast.
  function doUndo() {
    if (!undoSnapshot) return;
    var snap = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    var now = Date.now(), listBack = false;

    // labels that are gone → back, and back onto the tasks that had them
    var labelsBack = {};
    (snap.labels || []).forEach(function (lb, i) {
      if (labelById(lb.id)) return;
      lb.mtime = now;
      state.labels.splice(Math.min(i, state.labels.length), 0, lb);
      delete state.deleted[lb.id];
      labelsBack[lb.id] = true;
    });
    if (Object.keys(labelsBack).length) state.labels.forEach(function (lb, i) { lb.pos = i; });

    (snap.lists || []).forEach(function (sl, li) {
      var cur = listById(sl.id);
      if (!cur) {                                  // a deleted list → back, with its tasks
        stampListNewest(sl, now);
        sl.om = now;
        (sl.items || []).forEach(function (it) { stampItemNewest(it, now); delete state.deleted[it.id]; });
        state.lists.splice(Math.min(li, state.lists.length), 0, sl);
        delete state.deleted[sl.id];
        listBack = true;
        return;
      }
      var itemsBack = false;
      (sl.items || []).forEach(function (si, ii) {
        var ci = itemById(cur, si.id);
        if (!ci) {                                 // a deleted task → back, at its place
          stampItemNewest(si, now);
          cur.items.splice(Math.min(ii, cur.items.length), 0, si);
          delete state.deleted[si.id];
          itemsBack = true;
          return;
        }
        var add = (si.labels || []).filter(function (id) {
          return labelsBack[id] && (ci.labels || []).indexOf(id) === -1;
        });
        if (add.length) { ci.labels = (ci.labels || []).concat(add); touchField(ci, "labels"); }
      });
      if (itemsBack) {
        cur.items.forEach(function (it, i) { it.pos = i; });
        cur.om = now;                              // this layout is the ordering reference
      }
    });

    if (listBack) {
      if (undoFreshListId) {                       // the stand-in list is no longer needed
        var fl = listById(undoFreshListId);
        if (fl && fl.items.length === 0) {
          state.lists = state.lists.filter(function (l) { return l.id !== undoFreshListId; });
          tombstone(undoFreshListId);
        }
      }
      state.lists.forEach(function (l, i) { l.pos = i; });
      state.om = now;
      if (undoViewList && listById(undoViewList)) setActiveList(undoViewList);
    }
    undoFreshListId = null;
    save(); renderAll();
    showToast(t("toast.undone"), false);
  }

  // R12: only a toast that carries Undo stays in the app. Every plain
  // message goes to the shell's unified notifications; the local
  // toast is the fallback when the app runs standalone.
  function showToast(text, withUndo) {
    if (!withUndo) {
      try {
        var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
        if (N && typeof N.transient === "function") {
          N.transient({ ns: "todo", title: text, body: "" });
          return;
        }
      } catch (e) { /* cross-origin guard */ }
    }
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
    // R12: an Undo offer stays at least 8 seconds; plain notes 4.
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, withUndo ? 8000 : 4000);
  }
  
    // ---------- 11b. Themed confirm (R14) ----------
  // Native confirm() is RETIRED (Bible R14): a themed <dialog> built
  // from the app palette. Esc/backdrop/click-outside = cancel;
  // focus starts on CANCEL so Enter never fires the destructive act.
  function confirmDialog(msgKey, onYes) {
    var stale = document.getElementById("todo-confirm");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "todo-confirm";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:18px;" +
      "width:min(340px,calc(100vw - 32px));";

    var form = document.createElement("form");
    form.method = "dialog";

    var msg = document.createElement("div");
    msg.style.cssText = "font-size:13px;line-height:1.5;margin-bottom:16px;";
    msg.textContent = t(msgKey);
    form.appendChild(msg);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    var no = document.createElement("button");
    no.type = "button";
    no.style.cssText =
      "border:1px solid var(--border);border-radius:7px;background:transparent;" +
      "color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    no.textContent = t("confirm.no");
    no.addEventListener("click", function () { dlg.close(); });
    row.appendChild(no);

    var yes = document.createElement("button");
    yes.type = "submit";
    yes.style.cssText =
      "border:1px solid var(--danger);border-radius:7px;background:transparent;" +
      "color:var(--danger);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    yes.textContent = t("item.delete");
    row.appendChild(yes);

    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      dlg.close();
      onYes();
    });
    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { no.focus(); }, 50);
  }

  // ---------- 12. Sync slice (merge-registered) + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

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

  // Debug / test handle (read-only use).
  window.__todoDebug = {
    merge: mergeTodoStates,
    canon: canonState,
    state: function () { return state; }
  };

  function sliceGet() {
    // Canonical copy (TD-4): what the merge would return for this state.
    return canonState(state);
  }

  // data  — merged result (or plain remote on legacy LWW paths)
  // info  — { merged: true } when the value came through mergeTodoStates
  //         (sync.js contract); anything else = wholesale apply.
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.lists) || data.lists.length === 0) return;
    // Echo: nothing new → no rewrite, no re-render.
    if (JSON.stringify(canonState(data)) === JSON.stringify(canonState(state))) return;
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
    // (No toast per merge: it fired on every sync cycle that brought
    // anything, on top of whatever the user was doing.)
  }

    // Contract Β: shell-owned combos (Ctrl+Alt+Shift+*) forward FIRST.
  // Standalone listener — does not touch existing keydown handling.
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (window.parent.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);   // capture phase: runs BEFORE the app's own bubble listeners

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

  // R9 parity with the shell: static buttons ship EMPTY in the HTML,
  // JS paints localized aria-labels/titles at boot.
  function paintStaticAria() {
    var pairs = [
      ["tab-add",       "tab.add"],
      ["quick-add-btn", "add.task"],
      ["f-every",       "interval.aria"],
      ["l-every",       "interval.aria"]
    ];
    pairs.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.setAttribute("aria-label", t(pair[1]));
      el.setAttribute("title", t(pair[1]));
    });
    var ta = $("tab-add");
    if (ta && !ta.innerHTML.trim()) {
      ta.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
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
      view.hideCompleted = this.checked;   // TD-8: device-local
      saveView();
      scheduleRender();
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
    // TD6: keyboard parity — Esc dismisses the open label filter
    // popover (same gesture as outside-click). Bubble phase: the
    // Contract B capture listener only intercepts Ctrl+Alt+Shift
    // combos and is unaffected.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if ($("filter-pop").hidden) return;
      $("filter-pop").hidden = true;
      e.stopPropagation();
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
      confirmDialog("confirm.itemdel", function () {
        var list = listById(editingListId);
        if (list) {
          pushUndo("toast.deleted");
          tombstone(editingItemId);        // merge-safe deletion
          list.items = list.items.filter(function (it) { return it.id !== editingItemId; });
        }
        editingListId = null;
        editingItemId = null;
        $("dlg-item").close();
        save(); scheduleRender();
      });
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

      confirmDialog("confirm.listdel", function () {
        pushUndo("toast.listdel");
        tombstone(list.id);
        list.items.forEach(function (it) { tombstone(it.id); });   // cascade
        state.lists = state.lists.filter(function (l) { return l.id !== list.id; });

        if (state.lists.length === 0) {
          var fresh = freshList(t("new.list"));
          fresh.pos = 0;
          state.lists.push(fresh);
          undoFreshListId = fresh.id;
        }
        state.om = Date.now();
        editingListId = null;

        $("dlg-list").close();
        save(); renderAll();
      });
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
      touchListField(list, "name");
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
      touchListField(list, "cycle");
    }

    editingListId = null;
    save(); scheduleRender();
  }

  // ---------- Boot ----------
  load();
  loadView();
  applyI18n();
  paintStaticAria();
  populateWeekdaySelects();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();

  // Midnight rollover (audit #20): cycles + overdue chips must catch
  // up when the app stays open across the date change. applyListCycles
  // self-saves ONLY when it actually resets something — no pointless
  // dirty/sync push on a no-op wake. scheduleRender refreshes the
  // overdue chips either way.
  var cycleDay = todayISO();
  window.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (todayISO() === cycleDay) return;
    cycleDay = todayISO();
    applyListCycles();
    scheduleRender();
  });

  renderAll();

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { list, item? }. Shows the list; with an item, opens its
  // dialog. Unknown ids, or a dialog already open → no-op.
  function openSearchTarget(t) {
    if (!t || typeof t.list !== "string" || !listById(t.list)) return;
    // A dialog in progress (maybe with unsaved edits) wins: no jump.
    if (document.querySelector("dialog[open]")) return;
    setActiveList(t.list);
    renderAll();
    if (typeof t.item === "string" && itemById(listById(t.list), t.item)) {
      openItemDialog(t.list, t.item);
    }
  }
  window.__orosOpenAt = openSearchTarget;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("todo");
      if (pendingTarget) openSearchTarget(pendingTarget);
    }
  } catch (e) {}
})();


// ===== orOS deep-link receiver (Wave 7 / #TD4) =====
// Consumed by shell.js (__orosOpenTodo) and notifications.js
// (DL_BRIDGES → "todo:<listId>"). Depends ONLY on the DOM contract
// of renderTabs (#tabs .tab[data-list-id] click switching) — no
// internals of the main IIFE are touched.
(function () {
  "use strict";

  function openList(listId) {
    var btn = document.querySelector('#tabs .tab[data-list-id="' + listId + '"]');
    if (btn) btn.click();   // existing tab wiring switches the active list
  }

  // Live push (shell bridge calls this when the app is running)
  window.__orosTodoOpen = function (listId) {
    if (typeof listId !== "string" || !listId) return;
    openList(listId);
  };

  // Boot: consume a list staged by the shell while the app was
  // closed (sessionStorage — same origin, one-shot).
  try {
    var pending = sessionStorage.getItem("oros-todo-open");
    if (pending) {
      sessionStorage.removeItem("oros-todo-open");
      openList(pending);
    }
  } catch (e) { /* storage blocked — navigation no-ops, nothing breaks */ }
})();