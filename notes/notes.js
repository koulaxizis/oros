// ============================================================
// orOS Notes v0.17.0 — Plain-text wiki notebook
//
// Architecture (unchanged core, v0.13.1 contract):
//   - Flat pages[] {id, parent, title, text, mtime, pos}
//   - tombs {} (delete-wins, prune 30d)
//   - Device-local prefs (never synced): open/current/width
//   - orosSync lives in window.parent when embedded — resolved
//     via syncApi() (ARCHITECTURE REFERENCE, v0.13.1)
//   - Merge: per-page LWW (mtime, tie → lexicographic JSON),
//     tombs union max-ts, orphan → re-parent ROOT, cycle guard
//
// v0.14.0 (Wave 2.1): PAGE LABELS — Todo/Kanban parity.
//   - state.labels = [{id, name, color, mtime, pos}]  (synced registry)
//   - page.labels  = [labelId, ...]                  (attach/detach)
//   - Merge engine extends: labels union LWW + tomb
//     guard, detaches of dead labels pruned at normalize
//   - DATA_VER 1 → 2 (additive migration)
//
// Markdown wave (Obsidian/Joplin parity, no data change): pages stay
// plain text; md.js renders a sanitised preview (Edit / Preview /
// Side by side, device-local prefs.view), a formatting toolbar, task
// checkboxes toggled in the text, [[links]] across notebooks, daily
// note (fixed ids "dly-<nb>" / "dly-<nb>-<yyyymmdd>"), templates
// under a "Templates" page, search in all notebooks, .md export.
// ============================================================
(function () {
  "use strict";

  // #13: single source of truth — the CI-stamped ?v= in the script URL
  var APP_VERSION = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    return m ? m[1] : "0.0.0";
  })();
  var STORAGE_KEY   = "oros-notes-data";
  var PREFS_KEY     = "oros-notes-prefs";
  var DATA_VER      = 3;  // v0.17.1: notebooks added
  var SAVE_DEBOUNCE_MS = 500;
  var TOMB_PRUNE_DAYS  = 30;
  var DAY_MS           = 24 * 60 * 60 * 1000;

  var LABEL_COLORS = [
    "#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf",
    "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"
  ];

  // ---------- 1. State ----------
  var state = {
    ver:       DATA_VER,
    notebooks: [],  // {id, name, mtime, pos}
    pages:     [],  // {id, nb, parent, title, text, mtime, pos, labels:[]}
    labels:    [],  // {id, name, color, mtime, pos}
    tombs:     {}   // pageId -> ts, "lbl:id" -> ts, "nb:id" -> ts
  };

  var prefs = { open: {}, current: null, currentNb: null, width: 270, view: "edit" };
  var pendingId      = null;    // page awaiting debounced save
  var pendingTimer   = null;

  // ---------- 2. Load / migrate / normalize ----------

  // NO-1 — THE SEED NOTEBOOK. Every install needs one notebook to
  // work in. It used to be created with a RANDOM id and stamped
  // "now" (the deterministic seed written for v0.36.00 was never
  // called), so each new device brought one more empty "Notes"
  // notebook into the sync — on every device.
  // Now: ONE fixed id, stamp 0, and as long as nobody has put
  // anything into it or renamed it, it is not part of what this app
  // hands to the sync engine at all (canonNotes drops it).
  var SEED_NB_ID = "nb-default";
  function seedNotebook() {
    return { id: SEED_NB_ID, name: t("book.default"), mtime: 0, pos: 0 };
  }

  function loadData() {
    var raw = null, rawStr = null;
    try { rawStr = localStorage.getItem(STORAGE_KEY); } catch (e0) {}
    try { raw = JSON.parse(rawStr); } catch (e) {}
    if (rawStr && (!raw || typeof raw !== "object")) {
      // NO-9: unreadable stored notes are copied aside before the
      // fresh start below writes over them (rescue copy, never synced).
      try {
        if (!localStorage.getItem(STORAGE_KEY + "-broken")) localStorage.setItem(STORAGE_KEY + "-broken", rawStr);
      } catch (e1) {}
    }
    if (!raw || typeof raw !== "object") {
      // SEED DEFERRAL (v0.36.00): do NOT populate defaults immediately.
      // If a sync pull is pending/completed, the merge engine will
      // create the default notebook/page from remote (or merge them).
      // Only seed when BOTH local AND remote are truly empty.
      state = {
        ver: DATA_VER, notebooks: [], pages: [], labels: [], tombs: {}
      };
      // Let normalizeState() inject the "always ≥1 notebook" invariant
      // only when the slice actually needs it (empty remote + empty local).
      normalizeState();
      saveNow();
      return;
    }

    // v1 → v2: labels
    if (typeof raw.ver === "number" && raw.ver < 2) {
      raw.labels = [];
    }

    // v2 → v3: notebooks — ADDITIVE only. Old data becomes "Book #1".
    if (typeof raw.ver === "number" && raw.ver < 3) {
      // Create default notebook
      var firstNb = { id: uid("nb"), name: t("book.default"), mtime: Date.now(), pos: 0 };
      raw.notebooks = [firstNb];

      // Assign all old pages/labels to the new notebook
      (raw.pages || []).forEach(function (p) {
        p.nb = firstNb.id;
        if (typeof p.pinned !== "boolean") p.pinned = false; // MIGRATION: add missing pinned field
      });
      // Labels: assign nb too (for consistent per-book isolation)
      (raw.labels || []).forEach(function (l) {
        l.nb = firstNb.id;
      });
    }

    // LEGACY COMPATIBILITY: ensure all required fields exist even in v3+ data
    // (migration artifacts, manual edits, or partial restores)
    // Orphan pages without a notebook ref are re-assigned by normalizeState()
    (raw.pages || []).forEach(function (p) {
      if (typeof p.pinned !== "boolean") p.pinned = false;
      if (!Array.isArray(p.labels)) p.labels = [];
    });

    state.ver       = DATA_VER;

    state.notebooks = Array.isArray(raw.notebooks) ? raw.notebooks : [];
    state.pages     = Array.isArray(raw.pages)     ? raw.pages     : [];
    state.labels    = Array.isArray(raw.labels)    ? raw.labels    : [];
    state.tombs     = (raw.tombs && typeof raw.tombs === "object") ? raw.tombs : {};

    normalizeState();
    if (JSON.stringify(raw) !== JSON.stringify(state)) {
      saveNow();
      // v0.36.00: after-load guard — if we just seeded defaults but a
      // sync pull is in-flight or completed, the seed may duplicate
      // remote notebooks/pages. We'll let the merge engine handle it
      // (IDs are now deterministic), but we DO mark dirty so the
      // converged state reaches the cloud.
      markSyncDirty();
    }
  }

  // Normalization is IDEMPOTENT and runs on every load AND on every
  // incoming merge result — both devices converge to identical shape.
  function normalizeState() {
    var labelIds = {};
    state.labels.forEach(function (l) {
      if (l && typeof l.id === "string" &&
          typeof l.name === "string" && l.name.trim() !== "") {
        l.color = (LABEL_COLORS.indexOf(l.color) !== -1) ? l.color : LABEL_COLORS[0];
        l.pos   = (typeof l.pos === "number" && isFinite(l.pos)) ? l.pos : 0;
        l.mtime = (typeof l.mtime === "number" && isFinite(l.mtime)) ? l.mtime : 0;   // NO-1: never "now"
        labelIds[l.id] = true;
      }
    });
    state.labels = state.labels.filter(function (l) { return !!l && labelIds[l.id]; });
	
	    // Normalize notebooks
    var notebookIds = {};
    state.notebooks.forEach(function (n) {
      if (n && typeof n.id === "string" &&
          typeof n.name === "string" && n.name.trim() !== "") {
        n.mtime = (typeof n.mtime === "number" && isFinite(n.mtime)) ? n.mtime : 0;   // NO-1: the seed keeps 0
        n.pos   = (typeof n.pos === "number" && isFinite(n.pos)) ? n.pos : 0;
        notebookIds[n.id] = true;
      }
    });
    state.notebooks = state.notebooks.filter(function (n) { return !!n && notebookIds[n.id]; });

    // #1: invariant — at least one notebook ALWAYS exists. A crafted/
    // corrupted ver-3 store with empty notebooks[] would otherwise
    // crash currentNotebook().id → boot black screen.
    if (!state.notebooks.length) {
      var rescueNb = seedNotebook();          // NO-1: fixed id, stamp 0
      state.notebooks.push(rescueNb);
      notebookIds[rescueNb.id] = true;
    }

    // Orphaned pages/labels (dead notebook ref) → first notebook
    var firstNb = state.notebooks[0];
    if (firstNb) {
      state.pages.forEach(function (p) {
        if (!p.nb || !notebookIds[p.nb]) { p.nb = firstNb.id; }
      });
      state.labels.forEach(function (l) {
        if (!l.nb || !notebookIds[l.nb]) { l.nb = firstNb.id; }
      });
    }

    // De-dupe labels by id (merge can theoretically produce twins
    // on pathological clocks): keep the LWW one.
    state.labels.sort(function (a, b) { return a.mtime - b.mtime; });
    var seenL = {};
    state.labels = state.labels.filter(function (l) {
      if (seenL[l.id]) return false;
      seenL[l.id] = true; return true;
    });

    var alive = {};
    state.pages.forEach(function (p) {
      if (!p || typeof p.id !== "string") return;
      alive[p.id] = true;
    });

    state.pages = state.pages.filter(function (p, i) {
      return p && typeof p.id === "string" &&
             state.pages.findIndex(function (q) { return q && q.id === p.id; }) === i;
    });

    state.pages.forEach(function (p) {
      p.parent = (p.parent === null || alive[p.parent]) ? p.parent : null;
      // #2: parent alive but living in ANOTHER notebook → the page is
      // invisible in the tree (kidsOf filters by nb) yet leaks into
      // exports (childrenSorted ignores nb). Re-parent to ROOT.
      if (p.parent !== null) {
        var par = pageById(p.parent);
        if (par && par.nb !== p.nb) p.parent = null;
      }
      p.pos    = (typeof p.pos === "number" && isFinite(p.pos)) ? p.pos : 0;
      p.mtime  = (typeof p.mtime === "number" && isFinite(p.mtime)) ? p.mtime : 0;   // NO-1
      p.pinned = !!p.pinned;   // v0.35.03 fix: coerce for merged data from unpatched devices
      // labels: array of known, alive label ids, de-duplicated
      var ll = Array.isArray(p.labels) ? p.labels : [];
      var seen = {};
      p.labels = [];
      ll.forEach(function (lid) {
        if (typeof lid === "string" && labelIds[lid] && !seen[lid]) {
          seen[lid] = true;
          p.labels.push(lid);
        }
      });
      // Sort for deterministic comparison in merge/serialize paths
      p.labels.sort();
    });

    // Orphans → ROOT; iterate-until-stable (cycle guard)
    var changedO = true, guard = 0;
    while (changedO && guard++ < 100) {
      changedO = false;
      state.pages.forEach(function (p) {
        // Cycle break: walk up; if we reach ourselves, re-parent to ROOT
        var anc = p.parent, hops = 0;
        while (anc !== null && hops++ < 200) {
          var node = state.pages.find(function (q) { return q.id === anc; });
          if (!node) break;
          if (node.id === p.id) { p.parent = null; changedO = true; break; }
          anc = node.parent;
        }
      });
    }

    // Tombstones: ONE rule, shared with the sync slice and the merge
    // (canonTombs) — a tomb of something alive is dropped, and tombs
    // older than 30 days are pruned against the NEWEST stamp in the
    // data, never against this device's clock. (A wall-clock prune
    // here made two devices disagree about the same tomb and push it
    // back and forth.)
    state.tombs = canonTombs(state.tombs, state.notebooks, state.pages, state.labels);
  }

  function saveNow() {
    normalizeState();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // #4: quota exceeded / private mode — never crash the boot loop
      // or the beforeunload flush; the user gets a visible receipt.
      console.error("[notes] saveNow failed:", e);
      notifyEmit(t("toast.saveFail"),
                 "sf:" + Math.floor(Date.now() / 3600000));
    }
  }

  // Debounced save — burst edits coalesce; the dirty flag reaches
  // the sync engine only ONCE the page settles.
  function flushSave() {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (!pendingId) return;
    saveNow();
    if (state.pages.some(function (p) { return p.id === pendingId; })) {
      markSyncDirty();
    }
    pendingId = null;
  }

  function queueSave(pageId) {
    pendingId = pageId;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  // ---------- 3. i18n ----------

  var STRINGS = {
    en: {
      "tree.empty":         "No pages yet",
      "page.untitled":      "Untitled",
      "page.new":           "New page",
      "page.newchild":      "New sub-page",
      "page.delete":        "Delete",
      "page.share":         "Send to someone…",
      "page.share.empty":   "This page is empty: nothing to send",
      "page.rename":        "Rename",
      "page.move.up":       "Move up",
      "page.move.down":     "Move down",
      "toast.created":      "Page created",
      "toast.fileBig":      "This file is too long for a page.",
      "toast.fileRead":     "The file could not be read.",
      "toast.conflict":     "A page was edited on two devices — both versions were kept",
      "page.conflict":      "conflict copy",
      "book.menu.open":     "Notebook actions",
      "toast.deleted":      "Page deleted",
      "toast.moved":        "Page moved",
      "labels.title":       "Labels",        // v0.14.0
      "labels.none":        "No labels yet",  // v0.14.0
      "labels.new":         "New label…",    // v0.14.0
      "labels.add":         "Add",           // v0.14.0
      "labels.confirm":     "Delete this label?",      // v0.14.0
      "labels.deleted":      "Label deleted",  // v0.35.00 fix
      "page.pin":           "Pin to top",
      "page.unpin":         "Unpin",
      "toast.pinned":       "Pinned to top",
      "toast.unpinned":     "Unpinned",
      "notes.app":           "Notes",
      "notes.title.ph":      "Title",
      "notes.text.ph":       "Start typing…",
      "menu.exportPage":     "Export page (.txt)",
      "menu.exportNotebook": "Export notebook (.zip)",
      "menu.exportCurrent":  "Current notebook (.zip)",
      "menu.exportAll":      "All notebooks (.zip)",
      "book.plusTitle":      "New notebook",
      "search.placeholder":  "Search pages…",
	  "search.hint": "Type at least 2 characters",
	  "search.none": "No results",
	  "search.count": "{n} results",
	  "tags.all": "All labels",
	  "tags.pages": "{n} pages",
	  "tags.back": "Back",
	  "links.out": "Links",
	  "links.back": "Backlinks",
      "links.none": "None",
      "book.default": "Notes",
      "book.new": "New notebook",
      "book.rename": "Rename notebook",
      "book.delete": "Delete notebook",
      "book.menu.title": "Notebook",
      "book.confirm": "Delete this notebook? All its pages and labels will be removed.",
      "book.empty": "No notebooks yet",
      "book.switch": "Switch notebook",
      "toast.nbCreated": "Notebook created",
      "toast.nbRenamed": "Notebook renamed",
      "toast.nbDeleted": "Notebook deleted",
      "toast.saveFail":    "Couldn't save — storage may be full",
      "toast.emptyExport": "Nothing to export yet",
      "menu.showTree":     "Show tree",
      "menu.close":        "Close",
      "page.moveto":       "Move to…",
      "dnd.root":          "Top level",
      "dnd.bad":           "Can't move a page into itself or its sub-pages"
    },
    el: {
      "tree.empty":         "Καμία σελίδα ακόμη",
      "page.untitled":      "Χωρίς τίτλο",
      "page.new":           "Νέα σελίδα",
      "page.newchild":      "Νέα υποσελίδα",
      "page.delete":        "Διαγραφή",
      "page.share":         "Στείλε σε κάποιον…",
      "page.share.empty":   "Η σελίδα είναι άδεια: δεν υπάρχει κάτι να στείλεις",
      "page.rename":        "Μετονομασία",
      "page.move.up":       "Μετακίνηση πάνω",
      "page.move.down":     "Μετακίνηση κάτω",
      "toast.created":      "Η σελίδα δημιουργήθηκε",
      "toast.fileBig":      "Το αρχείο είναι πολύ μεγάλο για μία σελίδα.",
      "toast.fileRead":     "Το αρχείο δεν διαβάστηκε.",
      "toast.conflict":     "Μια σελίδα άλλαξε σε δύο συσκευές — κρατήθηκαν και οι δύο εκδοχές",
      "page.conflict":      "αντίγραφο σύγκρουσης",
      "book.menu.open":     "Ενέργειες σημειωματαρίου",
      "toast.deleted":      "Η σελίδα διαγράφηκε",
      "toast.moved":        "Η σελίδα μετακινήθηκε",
      "labels.title":       "Ετικέτες",        // v0.14.0
      "labels.none":        "Καμία ετικέτα ακόμη",  // v0.14.0
      "labels.new":         "Νέα ετικέτα…",    // v0.14.0
      "labels.add":         "Προσθήκη",        // v0.14.0
      "labels.confirm":     "Διαγραφή αυτής της ετικέτας;",  // v0.14.0
      "labels.deleted":      "Η ετικέτα διαγράφηκε",  // v0.35.00 fix
      "page.pin":           "Καρφίτσωμα στην κορυφή",
      "page.unpin":         "Αφαίρεση καρφιτσίματος",
      "toast.pinned":       "Καρφιτσώθηκε στην κορυφή",
      "toast.unpinned":     "Αφαιρέθηκε το καρφίτσωμα",
      "notes.app":           "Σημειώσεις",
      "notes.title.ph":      "Τίτλος",
      "notes.text.ph":       "Ξεκίνα να γράφεις…",
      "menu.exportPage":     "Εξαγωγή σελίδας (.txt)",
      "menu.exportNotebook": "Εξαγωγή σημειωματαρίου (.zip)",
      "menu.exportCurrent":  "Τρέχον σημειωματάριο (.zip)",
      "menu.exportAll":      "Όλα τα σημειωματάρια (.zip)",
      "book.plusTitle":      "Νέο σημειωματάριο",
      "search.placeholder":  "Αναζήτηση σε σελίδες…",
	  "search.hint": "Πληκτρολόγησε τουλάχιστον 2 χαρακτήρες",
	  "search.none": "Κανένα αποτέλεσμα",
	  "search.count": "{n} αποτελέσματα",
	  "tags.all": "Όλες οι ετικέτες",
	  "tags.pages": "{n} σελίδες",
	  "tags.back": "Πίσω",
	  "links.out": "Σύνδεσμοι",
	  "links.back": "Αναφορές",
	  "links.none": "Κανένα",
      "book.default": "Σημειώσεις",
      "book.new": "Νέο σημειωματάριο",
      "book.rename": "Μετονομασία σημειωματαρίου",
      "book.delete": "Διαγραφή σημειωματαρίου",
      "book.menu.title": "Σημειωματάριο",
      "book.confirm": "Διαγραφή αυτού του σημειωματαρίου; Θα διαγραφούν όλες οι σελίδες και οι ετικέτες του.",
      "book.empty": "Κανένα σημειωματάριο",
      "book.switch": "Αλλαγή σημειωματαρίου",
            "toast.nbCreated": "Δημιουργήθηκε το σημειωματάριο",
      "toast.nbRenamed": "Μετονομαστηκε το σημειωματάριο",
      "toast.nbDeleted": "Διαγράφηκε το σημειωματάριο",
      "toast.saveFail":    "Αποτυχία αποθήκευσης — ίσως γεμάτος αποθηκευτικός χώρος",
      "toast.emptyExport": "Δεν υπάρχει κάτι προς εξαγωγή ακόμα",
      "menu.showTree":     "Εμφάνιση δέντρου",
      "menu.close":        "Κλείσιμο",
      "page.moveto":       "Μετακίνηση σε…",
      "dnd.root":          "Πρώτο επίπεδο",
      "dnd.bad":           "Αδύνατη η μετακίνηση μέσα στην ίδια σελίδα ή τις υποσελίδες της"
    }
  };

  // Markdown wave (view, toolbar, daily note, templates, exports,
  // search in every notebook).
  (function (add) {
    ["en", "el"].forEach(function (lg) {
      Object.keys(add[lg]).forEach(function (k) { STRINGS[lg][k] = add[lg][k]; });
    });
  })({
    en: {
      "view.group": "Page view",
      "view.edit": "Edit",
      "view.preview": "Preview",
      "view.split": "Side by side",
      "fmt.bar": "Formatting",
      "fmt.bold": "Bold",
      "fmt.italic": "Italic",
      "fmt.heading": "Heading",
      "fmt.list": "List",
      "fmt.task": "Checkbox",
      "fmt.link": "Link",
      "fmt.code": "Code",
      "preview.empty": "Nothing here yet. Switch to Edit to write.",
      "daily.btn": "Today",
      "daily.title": "Today's note",
      "page.actions": "Page actions",
      "daily.parent": "Daily",
      "daily.tpl": "# {{date}}\n\n## Tasks\n- [ ] \n\n## Notes\n",
      "tpl.parent": "Templates",
      "tpl.new": "New page from template…",
      "tpl.pick": "Pick a template",
      "tpl.none": "No templates yet. Make a page named Templates and put pages under it: each one becomes a template. {{date}}, {{time}} and {{title}} in it are filled in.",
      "tpl.ask": "Title of the new page",
      "search.all": "All notebooks",
      "link.ambiguous": "Several pages have this title: pick one",
      "menu.exportPage": "Export page (.txt)",
      "menu.exportPageMd": "Export page (.md)",
      "menu.exportNotebook": "Export notebook (.txt, .zip)",
      "menu.exportNotebookMd": "Export notebook (.md, .zip)",
      "menu.exportCurrent": "Current notebook (.txt, .zip)",
      "menu.exportCurrentMd": "Current notebook (.md, .zip)",
      "menu.exportAll": "All notebooks (.txt, .zip)",
      "menu.exportAllMd": "All notebooks (.md, .zip)",
      "menu.export": "Export"
    },
    el: {
      "view.group": "Προβολή σελίδας",
      "view.edit": "Επεξεργασία",
      "view.preview": "Προβολή",
      "view.split": "Δίπλα δίπλα",
      "fmt.bar": "Μορφοποίηση",
      "fmt.bold": "Έντονα",
      "fmt.italic": "Πλάγια",
      "fmt.heading": "Επικεφαλίδα",
      "fmt.list": "Λίστα",
      "fmt.task": "Κουτάκι επιλογής",
      "fmt.link": "Σύνδεσμος",
      "fmt.code": "Κώδικας",
      "preview.empty": "Δεν υπάρχει τίποτα ακόμη. Πάτα Επεξεργασία για να γράψεις.",
      "daily.btn": "Σήμερα",
      "daily.title": "Η σημερινή σελίδα",
      "page.actions": "Ενέργειες σελίδας",
      "daily.parent": "Ημερήσιες",
      "daily.tpl": "# {{date}}\n\n## Εργασίες\n- [ ] \n\n## Σημειώσεις\n",
      "tpl.parent": "Πρότυπα",
      "tpl.new": "Νέα σελίδα από πρότυπο…",
      "tpl.pick": "Διάλεξε πρότυπο",
      "tpl.none": "Δεν υπάρχουν πρότυπα ακόμη. Φτιάξε μια σελίδα με όνομα Πρότυπα και βάλε σελίδες κάτω από αυτήν: η καθεμία γίνεται πρότυπο. Τα {{date}}, {{time}} και {{title}} μέσα τους συμπληρώνονται μόνα τους.",
      "tpl.ask": "Τίτλος της νέας σελίδας",
      "search.all": "Όλα τα σημειωματάρια",
      "link.ambiguous": "Πολλές σελίδες έχουν αυτόν τον τίτλο: διάλεξε μία",
      "menu.exportPage": "Εξαγωγή σελίδας (.txt)",
      "menu.exportPageMd": "Εξαγωγή σελίδας (.md)",
      "menu.exportNotebook": "Εξαγωγή σημειωματαρίου (.txt, .zip)",
      "menu.exportNotebookMd": "Εξαγωγή σημειωματαρίου (.md, .zip)",
      "menu.exportCurrent": "Τρέχον σημειωματάριο (.txt, .zip)",
      "menu.exportCurrentMd": "Τρέχον σημειωματάριο (.md, .zip)",
      "menu.exportAll": "Όλα τα σημειωματάρια (.txt, .zip)",
      "menu.exportAllMd": "Όλα τα σημειωματάρια (.md, .zip)",
      "menu.export": "Εξαγωγή"
    }
  });
  var MD = window.OrosNotesMd;
  // Device-local names the daily note and templates are found by
  // (either language: a notebook may be shared by devices in both).
  var DAILY_NAMES = ["daily", "ημερήσιες"];
  var TEMPLATE_NAMES = ["templates", "πρότυπα"];

  function detectLang() {
    try {
      var p = (window.parent && window.parent.orosLang) || window.orosLang;
      return (p === "el") ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = detectLang();

  function t(key) {
    var d = STRINGS[LANG] || STRINGS.en;
    return (d[key] !== undefined) ? d[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }
  
    function renderNbSelector() {
    var sel = document.getElementById("nb-selector");
    if (!sel) return;
    sel.innerHTML = "";
    state.notebooks.forEach(function (nb) {
      var opt = document.createElement("option");
      opt.value = nb.id;
      opt.textContent = nb.name;
      if (nb.id === currentNotebook().id) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.title = t("book.switch");
    sel.setAttribute("aria-label", t("book.switch"));
  }

  function applyI18n() {
    document.documentElement.setAttribute("lang", LANG);
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    var titled = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < titled.length; j++) {
      titled[j].setAttribute("placeholder", t(titled[j].getAttribute("data-i18n-ph")));
    }
  }

  // ---------- 4. Palette inheritance (shell contract) ----------
  // PAL_VARS: the 11-variable shells' palette vocabulary — identical
  // list to todo.css/kanban.css (ARCHITECTURE REFERENCE, v0.13.1).

  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--panel-bg",
                  "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      // Mirror the theme attribute first (light/dark color-scheme
      // rules in notes.css depend on it — todo.js parity).
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var parentStyle = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {

        var val = parentStyle.getPropertyValue(v);
        if (val && val.trim() !== "") {
          document.documentElement.style.setProperty(v, val.trim());
        }
      });
    } catch (e) { /* standalone (non-embedded) — fallback :root stands */ }
  }

  // Watch data-skin/data-theme mutations on the parent <html> and
  // re-inherit instantly — the app never lags behind a shell
  // skin/theme switch.
  function watchPalette() {
    try {
      var target = window.parent.document.documentElement;
      if (!target || typeof MutationObserver === "undefined") return;
      var mo = new MutationObserver(function () { inheritPalette(); });
      mo.observe(target, { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* not embedded */ }
  }

    // ---------- 5. Render tree (label dots) ----------

  var CARET_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var PAGE_SVG  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var X_SVG     = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var PLUS_SVG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  var SEND_SVG  = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';
  var BURGER_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

  // v0.14.1: HTML ships the buttons EMPTY (icons are injected here —
  // restoring the v0.13.1 contract my v0.14.0 rewrite dropped).
  function paintStaticIcons() {
    var nb = document.getElementById("btn-new-page");
    if (nb && !nb.innerHTML.trim()) nb.innerHTML = PLUS_SVG;
    if (nb) { nb.title = t("page.new"); nb.setAttribute("aria-label", t("page.new")); }
    var sp = document.getElementById("btn-share-page");
    if (sp && !sp.innerHTML.trim()) sp.innerHTML = SEND_SVG;
    if (sp) { sp.title = t("page.share"); sp.setAttribute("aria-label", t("page.share")); }
    var st = document.getElementById("btn-show-tree");
    if (st && !st.innerHTML.trim()) st.innerHTML = BURGER_SVG;
    if (st) {
      st.title = t("menu.showTree");                       // #9
      st.setAttribute("aria-label", t("menu.showTree"));
    }
  }

  // NO-3 — two clocks per page.
  //   mtime : anything changed — life and death of the page (tombs).
  //   st    : pin, position, parent, notebook or labels changed —
  //           orders the STRUCTURE.
  //   ct    : the text or the title changed — orders the CONTENT.
  // Before, one clock ruled the whole page object: pinning a page on
  // one device silently reverted text typed on another, and two
  // devices editing the same page lost one of the two texts.
  //   h     : content stamps this version descends from (recorded
  //           once per sync round), hx = that list was truncated.
  // The merge uses h to tell "a newer edit of what I have" from "a
  // different edit of something older": the second keeps BOTH texts.
  var H_MAX = 60;
  var editedSinceSync = {};     // page ids whose content changed since the engine last read the slice
  // A device still running the PREVIOUS notes.js bumps mtime only.
  // A page whose mtime is newer than both of its clocks was last
  // touched by such a device: for that version mtime speaks for
  // everything (the old whole-page rule), or its edit would lose to
  // an older text carrying the same content stamp.
  function touchedByOldCode(p) {
    return typeof p.ct === "number" && typeof p.st === "number" &&
           (p.mtime || 0) > Math.max(p.ct, p.st);
  }
  function contentStamp(p) {
    if (typeof p.ct !== "number" || touchedByOldCode(p)) return p.mtime || 0;
    return p.ct;
  }
  function structStamp(p) {
    if (typeof p.st !== "number" || touchedByOldCode(p)) return p.mtime || 0;
    return p.st;
  }
  function touchStruct(p) {
    p.ct = contentStamp(p);          // freeze the content clock first
    var now0 = Date.now();
    p.st = now0;
    p.mtime = now0;
  }
  function touchContent(p) {
    var cs = contentStamp(p), ss = structStamp(p);
    if (touchedByOldCode(p)) { delete p.h; delete p.hx; }   // that history is about another text
    p.ct = cs;
    p.st = ss;                       // freeze the structure clock
    if (!editedSinceSync[p.id]) {
      editedSinceSync[p.id] = true;
      var h = Array.isArray(p.h) ? p.h.slice() : [];
      if (h.indexOf(p.ct) === -1) h.push(p.ct);
      if (h.length > H_MAX) { h = h.slice(h.length - H_MAX); p.hx = 1; }
      p.h = h;
    }
    var now = Date.now();
    p.ct = now;
    p.mtime = now;
    if (p.cf) delete p.cf;       // an edited conflict copy is an ordinary page
  }

  function uid(prefix) {
    return (prefix || "p") + Date.now().toString(36) +
           Math.random().toString(36).slice(2, 7);
  }

  function syncApi() {
    // ARCHITECTURE REFERENCE (v0.13.1): orosSync lives on the PARENT
    // window when the app runs inside the shell iframe.
    return (window.parent && window.parent.orosSync) || window.orosSync || null;
  }

  function markSyncDirty() {
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
  }

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
  }

  function toast(text) {
    var d = document.createElement("div");
    d.setAttribute("role", "status");
    d.textContent = text;
    d.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);" +
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--border);" +
      "border-radius:999px;padding:8px 18px;font-size:13px;font-weight:700;" +
      "box-shadow:0 8px 24px var(--shadow);opacity:0;transition:opacity .25s,transform .25s;" +
      "z-index:999;pointer-events:none;max-width:88vw;text-align:center;";
    document.body.appendChild(d);
    requestAnimationFrame(function () {
      d.style.opacity = "1";
      d.style.transform = "translateX(-50%) translateY(0)";
    });
    setTimeout(function () {
      d.style.opacity = "0";
      d.style.transform = "translateX(-50%) translateY(8px)";
      setTimeout(function () { d.remove(); }, 300);
    }, 2200);
  }

  // --- NT-3 (Wave A): custom dialogs — no native confirm/prompt
  // (standing doctrine, mood.js askReset pattern). Styled inline with
  // the shell palette vars so notes.css needs no new rules. <dialog>
  // gives us native Esc/backdrop handling for free. ---
  STRINGS.en["dlg.cancel"] = "Cancel";
  STRINGS.el["dlg.cancel"] = "Ακύρωση";
  STRINGS.en["dlg.ok"] = "OK";
  STRINGS.el["dlg.ok"] = "ΟΚ";

  function closeUiDlg() {
    var d = document.getElementById("nt-dlg");
    if (d) { try { d.close(); } catch (e) {} d.remove(); }
  }

  // uiDlg(title, bodyText, buttons, inputOpts)
  //   buttons: [{label, primary, danger, fn}]
  //   inputOpts: {value, placeholder, onEnter(value)} | null
  function uiDlg(titleText, bodyText, buttons, inputOpts) {
    closeUiDlg();
    var dlg = document.createElement("dialog");
    dlg.id = "nt-dlg";
    dlg.style.cssText =
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--border);" +
      "border-radius:10px;padding:18px 20px 16px;max-width:min(430px,86vw);" +
      "box-shadow:0 12px 36px var(--shadow);";
    var h = document.createElement("h3");
    h.style.cssText = "margin:0 0 8px;font-size:15px;font-weight:700;";
    h.textContent = titleText;
    dlg.appendChild(h);
    if (bodyText) {
      var p = document.createElement("p");
      p.style.cssText =
        "margin:0 0 14px;font-size:13px;line-height:1.5;color:var(--text-dim);" +
        "word-break:break-word;";
      p.textContent = bodyText;
      dlg.appendChild(p);
    }
    var input = null;
    if (inputOpts) {
      input = document.createElement("input");
      input.type = "text";
      input.maxLength = 80;
      input.value = inputOpts.value || "";
      input.placeholder = inputOpts.placeholder || "";
      input.style.cssText =
        "display:block;width:100%;box-sizing:border-box;margin:0 0 14px;padding:8px 10px;" +
        "background:var(--bg);color:var(--text);border:1px solid var(--border);" +
        "border-radius:7px;font-size:13px;";
      dlg.appendChild(input);
    }
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    (buttons || []).forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      btn.style.cssText =
        "padding:8px 14px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;" +
        (b.primary
          ? "background:" + (b.danger ? "#e06c75" : "var(--accent)") +
            ";color:#fff;border:none;"
          : "background:transparent;color:var(--text);border:1px solid var(--border);");
      btn.addEventListener("click", function () {
        closeUiDlg();
        if (b.fn) b.fn(input ? input.value : undefined);
      });
      row.appendChild(btn);
    });
    dlg.appendChild(row);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    if (input) {
      input.focus();
      input.select();
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (inputOpts.onEnter) {
            closeUiDlg();
            inputOpts.onEnter(input.value);
          }
        }
      });
    }
    return dlg;
  }

  function askConfirm(titleText, bodyText, okLabel, onOk) {
    uiDlg(titleText, bodyText, [
      { label: t("dlg.cancel") },
      { label: okLabel, primary: true, danger: true, fn: onOk }
    ], null);
  }

  function askPrompt(titleText, value, placeholder, okLabel, onOk) {
    uiDlg(titleText, null, [
      { label: t("dlg.cancel") },
      { label: okLabel, primary: true, fn: onOk }
    ], { value: value, placeholder: placeholder, onEnter: onOk });
  }

  // --- Unified notifications (Wave 11 migration) ---
  // Ίδιο doctrine με kanban.js: το module ζει στο shell (parent),
  // dynamic resolution, το τοπικό toast() στέκεται ως stale-bundle
  // fallback. Το Notes δεν έχει undo-bearing toasts (τα deletes
  // πάνε σε confirm) — η migration είναι πλήρης.
  function notifyTransient(text) {
    try {
      var N = (window.parent && window.parent.orosNotifs) ||
               window.orosNotifs || null;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "notes", title: text, body: "" });
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    toast(text);
  }

  // Background failure → INBOX (not transient): το saveFail μπορεί
  // να πυροδοτηθεί σε beforeunload/visibilitychange flush, όπου το
  // in-app toast πεθαίνει αόρατο. Το dedupKey sf:<hour> κρατά το
  // quota-full storm υπό έλεγχο (το queueSave τρέχει ανά 500ms —
  // χωρίς dedup θα είχαμε ένα toast ανά keystroke burst).
  function notifyEmit(text, key) {
    try {
      var N = (window.parent && window.parent.orosNotifs) ||
               window.orosNotifs || null;
      if (N && typeof N.emit === "function") {
        N.emit({ ns: "notes", title: text, body: "", key: key || null });
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    toast(text);   // fallback: stale bundle — ο χρήστης το βλέπει ακόμα
  }

  function pageById(id) {
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].id === id) return state.pages[i];
    }
    return null;
  }

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }

  function currentNbId() {
    var nb = currentNotebook();
    return nb ? nb.id : null;
  }

  function kidsOf(parentId) {
    var nbId = currentNbId();
    return state.pages
      .filter(function (p) { return p.parent === parentId && p.nb === nbId; })
      .sort(function (a, b) {
        var ap = a.pinned ? 1 : 0;
        var bp = b.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;   // pinned first
        return (a.pos - b.pos) ||
               (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
      });
  }

  function renderTree() {
    var root = document.getElementById("tree-root");
    if (!root) return;
    root.innerHTML = "";

    if (!state.pages.some(function (p) { return p.nb === currentNbId(); })) {
      var empty = document.createElement("li");
      empty.className = "tree-empty";
      empty.textContent = t("tree.empty");
      root.appendChild(empty);
      return;
    }

    buildNodes(root, null, 0);
  }

  function buildNodes(host, parentId, depth) {
    if (depth > 32) return;                    // pathological-tree guard
    var kids = kidsOf(parentId);
    if (!kids.length) return;

    kids.forEach(function (p) {
      var node = document.createElement("li");
      node.className = "node" + (prefs.open[p.id] ? " open" : "");
      node.dataset.id = p.id;

      var row = document.createElement("div");
      row.className = "node-row" + (prefs.current === p.id ? " active" : "");

      // Caret (only when the page has children)
      var grandKids = kidsOf(p.id);
      var caret = document.createElement("span");
      caret.className = "node-caret" + (grandKids.length ? "" : " hidden");
      caret.innerHTML = CARET_SVG;
      if (grandKids.length) {
        caret.addEventListener("click", function (e) {
          e.stopPropagation();
          prefs.open[p.id] = !prefs.open[p.id];
          savePrefs();
          renderTree();
        });
      }
      row.appendChild(caret);

      var ico = document.createElement("span");
      ico.className = "node-ico";
      ico.innerHTML = PAGE_SVG;
      row.appendChild(ico);

      var lab = document.createElement("span");
      lab.className = "node-label";
      lab.textContent = (p.title !== "" ? p.title : t("page.untitled")) +
        (p.cf ? " · " + t("page.conflict") : "");     // NO-3: conflict copy
      row.appendChild(lab);

      // ---- Label dots (Wave 2.1) ----
      var dots = document.createElement("span");
      dots.className = "node-dots";
      (p.labels || []).forEach(function (lid) {
        var lb = labelById(lid);
        if (!lb) return;
        var dot = document.createElement("span");
        dot.className = "node-dot";
        dot.style.background = lb.color;
        dot.title = lb.name;
        dots.appendChild(dot);
      });
      if (dots.childNodes.length) row.appendChild(dots);

      // ---- Pin icon (Task #1) ----
      if (p.pinned) {
        var pin = document.createElement("span");
        pin.className = "node-ico";
        pin.style.marginLeft = "6px";
        pin.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 12h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2z"/></svg>';
        pin.title = t("page.unpin");
        row.appendChild(pin);
      }

      if (grandKids.length) {
        var cnt = document.createElement("span");
        cnt.className = "node-count";
        cnt.textContent = String(grandKids.length);
        row.appendChild(cnt);
      }

      row.draggable = true;      // #5: DnD target/handler wiring lives
                                 // on #tree-root (attachTreeDnD)
      row.addEventListener("click", function () { selectPage(p.id); });

      // Long-press (touch) + right-click → context menu
      var lpTimer = null;
      row.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        openNodeMenu(p, e.clientX, e.clientY);
      });
      row.addEventListener("touchstart", function (e) {
        var tx = e.touches[0].clientX, ty = e.touches[0].clientY;
        lpTimer = setTimeout(function () {
          openNodeMenu(p, tx, ty);
        }, 550);
      }, { passive: true });
      ["touchend", "touchmove", "touchcancel"].forEach(function (ev) {
        row.addEventListener(ev, function () {
          if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        }, { passive: true });
      });

      node.appendChild(row);

      var ul = document.createElement("ul");
      ul.className = "node-kids";
      buildNodes(ul, p.id, depth + 1);
      node.appendChild(ul);

      host.appendChild(node);
    });
  }

  function renderAll() {
    renderNbSelector();
    renderTree();
    renderEditor();
  }

  // ---------- 5b. Selection + page ops ----------

  function selectPage(id) {
    flushSave();
    prefs.current = id;
    savePrefs();
    renderAll();
    // Mobile: close the tree so the note fills the screen. Desktop
    // shows the tree via @media — the class is a no-op there.
    document.getElementById("notes-app").classList.remove("tree-open");
  }

  var lastRenderedPage = null;   // #7: caret/scroll preservation state
  function syncField(el, value) {
    if (el.value === value) return;
    var focused = (document.activeElement === el);
    var s = 0, e = 0, top = el.scrollTop;
    if (focused) { try { s = el.selectionStart; e = el.selectionEnd; } catch (err) {} }
    el.value = value;
    if (focused) {
      try { el.setSelectionRange(Math.min(s, value.length), Math.min(e, value.length)); } catch (err2) {}
    }
    el.scrollTop = top;
  }

  // "Send to someone" (shell share/): one page as plain text in a link.
  function shareApi() {
    try { return window.parent !== window && window.parent.orosShare ? window.parent.orosShare : null; }
    catch (e) { return null; }
  }
  function sharePage(page) {
    var api = shareApi();
    if (!api || !page) return;
    var title = String(page.title || "").trim(), text = String(page.text || "");
    if (!text.trim() && (!title || title === t("page.untitled"))) { notifyTransient(t("page.share.empty")); return; }
    api.open({ kind: "note", data: { t: title, x: text } });
  }

  function renderEditor() {
    var title = document.getElementById("page-title");
    var text  = document.getElementById("page-text");
    var page  = pageById(prefs.current);
    if (!title || !text) return;

    // #7: full re-render would clobber the caret & scroll mid-typing
    // (label toggle, sync pull while editing). Same page + editor
    // focus → refresh chips/links strip ONLY, leave values alone.
    if (page && page.id === lastRenderedPage &&
        (document.activeElement === title || document.activeElement === text)) {
      // NO-4: "leave the values alone" also left them alone when the
      // page had just changed on ANOTHER device. The cursor merely
      // sitting in the editor was enough: the old text stayed on
      // screen, and the next keystroke saved it over the newer one.
      // The fields follow the data; the caret is put back.
      syncField(title, page.title || "");
      syncField(text, page.text || "");
      renderChips(page);
      renderLinksStrip(page);
      renderPreview();
      return;
    }
    lastRenderedPage = page ? page.id : null;

    title.disabled = !page;
    text.disabled  = !page;
    var shareBtn = document.getElementById("btn-share-page");
    if (shareBtn) shareBtn.hidden = !page || !shareApi();
    var pageMenuBtn = document.getElementById("btn-page-menu");
    if (pageMenuBtn) pageMenuBtn.hidden = !page;
    title.value = page ? page.title : "";
    text.value  = page ? page.text : "";
    renderChips(page);
    renderLinksStrip(page);   // v0.17.0: outgoing [[links]] + backlinks
    var tb = document.getElementById("md-toolbar");
    if (tb) tb.classList.toggle("off", !page);
    renderPreview();
  }
  
    // v0.14.1: visible label chips in the editor header — tags were
  // previously dots-in-the-tree only. Click → picker for this page.
  function renderChips(page) {
    var old = document.getElementById("page-chips");
    if (old) old.remove();
    var header = document.getElementById("editor-header");
    if (!header || !page) return;
    var ids = page.labels || [];
    if (!ids.length) return;

    var wrap = document.createElement("span");
    wrap.id = "page-chips";
    ids.forEach(function (lid) {
      var lb = labelById(lid);
      if (!lb) return;
      var chip = document.createElement("button");
      chip.className = "page-chip";
      chip.type = "button";
      var dot = document.createElement("span");
      dot.className = "page-chip-dot";
      dot.style.background = lb.color;
      chip.appendChild(dot);
      var nm = document.createElement("span");
      nm.textContent = lb.name;
      chip.appendChild(nm);
      chip.title = lb.name;
      chip.setAttribute("aria-label", lb.name);
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        var r = chip.getBoundingClientRect();
        openLabelPicker(page, r.left, r.bottom + 4);
      });
      wrap.appendChild(chip);
    });
    header.appendChild(wrap);
  }

  // init { title, text }: a page handed over by another app ("Save as
  // note" in Reader); without it, an empty page with its title selected.
  // One new page in the data (no save, no render). id: optional fixed
  // id (the daily note), a tomb on it is lifted like any re-creation.
  function insertPage(nbId, parentId, title, text, id) {
    var maxPos = 0;
    state.pages.forEach(function (q) {
      if (q.nb === nbId && q.parent === (parentId || null) && q.pos > maxPos) maxPos = q.pos;
    });
    var p = {
      id: id || uid(), nb: nbId, parent: parentId || null,
      title: title, text: text || "",
      mtime: Date.now(), pos: maxPos + 1, labels: [], pinned: false
    };
    p.ct = p.mtime;
    p.st = p.mtime;
    delete state.tombs[p.id];
    state.pages.push(p);
    return p;
  }

  function newPage(parentId, init) {
    var p = insertPage(currentNbId(), parentId,
      (init && init.title) || t("page.untitled"), (init && init.text) || "");
    if (parentId) prefs.open[parentId] = true;
    saveNow();
    markSyncDirty();
    prefs.current = p.id;
    savePrefs();
    renderAll();
    notifyTransient(t("toast.created"));
    if (init) return;
    // Phones: close the page-list drawer so the new title is in view
    document.getElementById("notes-app").classList.remove("tree-open");
    var titleEl = document.getElementById("page-title");
    if (titleEl) { titleEl.focus(); titleEl.select(); }
  }

  function siblingListByParent(parentId) {
    var nbId = currentNbId();
    return state.pages
      .filter(function (p) { return p.parent === (parentId || null) && p.nb === nbId; })
      .sort(function (a, b) { return a.pos - b.pos; });
  }

  function deletePage(id) {
    var page = pageById(id);
    if (!page) return;
    askConfirm(t("page.delete"),
      '"' + (page.title || t("page.untitled")) + '"',
      t("page.delete"), function () { doDeletePage(id); });
  }

  function doDeletePage(id) {
    // Tombstone — delete wins on merge, resurrected pages revive
    state.tombs[id] = Date.now();
    state.pages = state.pages.filter(function (p) { return p.id !== id; });

    if (prefs.current === id) {
      // NO-8: the next page of THIS notebook (state.pages[0] could
      // belong to another one: tree and editor then disagreed).
      var nbLeft = currentNbId();
      var nextP = state.pages.filter(function (p) { return p.nb === nbLeft; })[0];
      prefs.current = (nextP && nextP.id) || null;
    }
    delete prefs.open[id];
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("toast.deleted"));
  }

  function renamePage(id) {
    var page = pageById(id);
    if (!page) return;
    askPrompt(t("page.rename"), page.title || "", t("page.untitled"),
      t("dlg.ok"), function (val) {
        page.title = val;
        touchContent(page);
        saveNow();
        markSyncDirty();
        renderAll();
        if (prefs.current === id) {
          var titleEl = document.getElementById("page-title");
          if (titleEl) titleEl.value = val;
        }
      });
  }
  
    function togglePin(id) {
    var page = pageById(id);
    if (!page) return;
    page.pinned = !page.pinned;
    touchStruct(page);
    saveNow();
    markSyncDirty();
    renderTree();
    notifyTransient(t(page.pinned ? "toast.pinned" : "toast.unpinned"));
  }

  function movePage(id, dir) {
    var page = pageById(id);
    if (!page) return;
    
    // USE kidsOf() instead of siblingListByParent — pinned ordering matters!
    // siblingListByParent ignores pinned status, causing visual jump in tree
    var sibs = kidsOf(page.parent);
    var idx = -1;
    for (var i = 0; i < sibs.length; i++) if (sibs[i].id === id) { idx = i; break; }
    var swapWith = sibs[idx + dir];
    if (!swapWith) return;
    // #6: zone boundary (pinned ↔ unpinned) — crossing zones is
    // invisible by design (pinned always sits on top): no-op.
    if (!!page.pinned !== !!swapWith.pinned) return;

    // Swap positions — but preserve relative pinned/unpinned grouping
    // by using actual positions from the sorted array
    var tmp = page.pos; page.pos = swapWith.pos; swapWith.pos = tmp;
    // #6: collided positions (duplicate pos from legacy merges) →
    // renumber the sibling group so the sort is stable again
    if (page.pos === swapWith.pos) {
      sibs.forEach(function (s, j) { s.pos = j + 1; });
    }
    
    touchStruct(page);
    touchStruct(swapWith);
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("toast.moved"));
  }
  
    function currentNotebook() {
    if (!prefs.currentNb) {
      prefs.currentNb = state.notebooks[0] && state.notebooks[0].id;
    }
    var nb = state.notebooks.find(function (n) { return n.id === prefs.currentNb; });
    return nb || (state.notebooks[0] || null);
  }

  function createNotebook(name) {
    var maxPos = 0;
    state.notebooks.forEach(function (n) { if (n.pos > maxPos) maxPos = n.pos; });
    var nb = { id: uid("nb"), name: name, mtime: Date.now(), pos: maxPos + 1 };
    state.notebooks.push(nb);
    prefs.currentNb = nb.id;
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("toast.nbCreated"));
    return nb;
  }

  // ---------- Import from Notion (integrations wave 6D, platforms.js) ----------
  // The plan comes from links/notes.js; this is its one write: the
  // "Notion" notebook (once), the new pages, the replaced texts. Undo
  // takes out what came in (tombstoned, like any deletion here), puts
  // back the old texts and drops the notebook again while it is empty.
  function platformApply(pl, doneText) {
    var now = Date.now(), back = { pages: [], upd: [], nb: null };
    if (pl.notebook && !state.notebooks.some(function (n) { return n.id === pl.notebook.id; })) {
      var maxPos = 0;
      state.notebooks.forEach(function (n) { if (n.pos > maxPos) maxPos = n.pos; });
      state.notebooks.push({ id: pl.notebook.id, name: pl.notebook.name, mtime: now, pos: maxPos + 1 });
      delete state.tombs["nb:" + pl.notebook.id];
      back.nb = pl.notebook.id;
    }
    var nbOk = state.notebooks.some(function (n) { return n.id === pl.nb; });
    pl.pages.add.forEach(function (x) {
      if (!nbOk || pageById(x.id)) return;
      var par = x.parent && pageById(x.parent) ? x.parent : null;
      state.pages.push({ id: x.id, nb: pl.nb, parent: par, title: x.title, text: x.text,
                         mtime: now, pos: x.pos, labels: [], pinned: false, ct: now, st: now });
      delete state.tombs[x.id];
      back.pages.push(x.id);
    });
    pl.pages.upd.forEach(function (x) {
      var pg = pageById(x.id);
      if (!pg) return;
      back.upd.push({ id: x.id, title: pg.title, text: pg.text });
      pg.title = x.title;
      pg.text = x.text;
      touchContent(pg);
    });
    if (back.pages.length || back.nb) prefs.currentNb = pl.nb;
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyUndo(doneText, function () { platformUndo(back); });
    return true;
  }
  function platformUndo(back) {
    var now = Date.now(), gone = {};
    back.pages.forEach(function (id) { gone[id] = 1; state.tombs[id] = now; });
    state.pages = state.pages.filter(function (p) { return !gone[p.id]; });
    state.pages.forEach(function (p) { if (p.parent && gone[p.parent]) { p.parent = null; touchStruct(p); } });
    back.upd.forEach(function (u) {
      var pg = pageById(u.id);
      if (!pg) return;
      pg.title = u.title;
      pg.text = u.text;
      touchContent(pg);
    });
    if (back.nb && state.notebooks.length > 1 && !state.pages.some(function (p) { return p.nb === back.nb; })) {
      state.notebooks = state.notebooks.filter(function (n) { return n.id !== back.nb; });
      state.tombs["nb:" + back.nb] = now;
      if (prefs.currentNb === back.nb) prefs.currentNb = state.notebooks[0].id;
    }
    if (prefs.current && gone[prefs.current]) prefs.current = null;
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(PLAT ? PLAT.undone() : "");
  }
  // A notice with an Undo button (the shell's notifications); without
  // the shell there is no import at all.
  function notifyUndo(text, fn) {
    try {
      var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "notes", title: text, body: "", action: { label: PLAT ? PLAT.undoLabel() : "Undo", fn: fn } });
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    toast(text);
  }
  var PLAT = window.OrosNotesPlatforms || null;

  // ---------- Import notes from other apps (notes/import.js) ----------
  // Obsidian vault (folder or .zip), Evernote .enex, Google Keep
  // Takeout, Simplenote, Joplin .jex, any folder / .zip of .md / .txt,
  // a Standard Notes backup. import.js reads and plans; this is the
  // one write: the notebook (once), its new labels, the new pages,
  // the replaced texts. Undo takes all of it out again.
  var IMP = window.OrosNotesImport || null;
  STRINGS.en["imp.btn"] = "Import notes…";
  STRINGS.el["imp.btn"] = "Εισαγωγή σημειώσεων…";
  STRINGS.en["imp.title"] = "Import notes";
  STRINGS.el["imp.title"] = "Εισαγωγή σημειώσεων";
  STRINGS.en["imp.intro"] = "Bring notes from Obsidian (the vault folder or a .zip of it), Evernote (.enex), Google Keep (the Takeout .zip), Simplenote (its export .zip), Joplin (.jex), Standard Notes (a backup file, exported decrypted) or any folder or .zip of Markdown / text files (Bear, Logseq, Notion, Typora…). Folders become pages with sub-pages, tags become labels, [[links]] keep working. They go into a new notebook; nothing leaves this device.";
  STRINGS.el["imp.intro"] = "Φέρε σημειώσεις από το Obsidian (τον φάκελο του vault ή ένα .zip του), το Evernote (.enex), το Google Keep (το .zip του Takeout), το Simplenote (το .zip της εξαγωγής του), το Joplin (.jex), το Standard Notes (αρχείο backup, εξαγωγή χωρίς κρυπτογράφηση) ή οποιονδήποτε φάκελο ή .zip με αρχεία Markdown / κειμένου (Bear, Logseq, Notion, Typora…). Οι φάκελοι γίνονται σελίδες με υποσελίδες, τα tags γίνονται ετικέτες, τα [[links]] συνεχίζουν να δουλεύουν. Μπαίνουν σε νέο σημειωματάριο· τίποτα δεν φεύγει από τη συσκευή.";
  STRINGS.en["imp.folder"] = "Choose folder…";
  STRINGS.el["imp.folder"] = "Επιλογή φακέλου…";
  STRINGS.en["imp.files"] = "Choose files…";
  STRINGS.el["imp.files"] = "Επιλογή αρχείων…";
  STRINGS.en["imp.reading"] = "Reading {n} files…";
  STRINGS.el["imp.reading"] = "Διαβάζω {n} αρχεία…";
  STRINGS.en["imp.src.obsidian"] = "Obsidian vault";
  STRINGS.el["imp.src.obsidian"] = "Vault του Obsidian";
  STRINGS.en["imp.src.standardnotes"] = "Standard Notes backup";
  STRINGS.el["imp.src.standardnotes"] = "Backup του Standard Notes";
  STRINGS.en["imp.src.evernote"] = "Evernote export";
  STRINGS.el["imp.src.evernote"] = "Εξαγωγή του Evernote";
  STRINGS.en["imp.src.keep"] = "Google Keep (Takeout)";
  STRINGS.el["imp.src.keep"] = "Google Keep (Takeout)";
  STRINGS.en["imp.src.simplenote"] = "Simplenote export";
  STRINGS.el["imp.src.simplenote"] = "Εξαγωγή του Simplenote";
  STRINGS.en["imp.src.joplin"] = "Joplin export";
  STRINGS.el["imp.src.joplin"] = "Εξαγωγή του Joplin";
  STRINGS.en["imp.src.markdown"] = "Markdown / text files";
  STRINGS.el["imp.src.markdown"] = "Αρχεία Markdown / κειμένου";
  STRINGS.en["imp.plan"] = "{src}: {a} new pages, {u} to update, {s} already here.";
  STRINGS.el["imp.plan"] = "{src}: {a} νέες σελίδες, {u} για ενημέρωση, {s} υπάρχουν ήδη.";
  STRINGS.en["imp.nb"] = "Into the new notebook “{name}”.";
  STRINGS.el["imp.nb"] = "Στο νέο σημειωματάριο «{name}».";
  STRINGS.en["imp.nbOld"] = "Into the notebook of the earlier import.";
  STRINGS.el["imp.nbOld"] = "Στο σημειωματάριο της προηγούμενης εισαγωγής.";
  STRINGS.en["imp.labels"] = "{n} new labels from the tags.";
  STRINGS.el["imp.labels"] = "{n} νέες ετικέτες από τα tags.";
  STRINGS.en["imp.upd"] = "Replace the text of pages imported before, where it changed in the source";
  STRINGS.el["imp.upd"] = "Αντικατάσταση του κειμένου όσων σελίδων ήρθαν παλιότερα, όπου άλλαξε στην πηγή";
  STRINGS.en["imp.updHint"] = "Off: what you changed here stays as it is.";
  STRINGS.el["imp.updHint"] = "Κλειστό: ό,τι άλλαξες εδώ μένει όπως είναι.";
  STRINGS.en["imp.att"] = "{n} pictures and other files stay out: only the text comes in.";
  STRINGS.el["imp.att"] = "{n} εικόνες και άλλα αρχεία μένουν έξω: έρχεται μόνο το κείμενο.";
  STRINGS.en["imp.trashed"] = "{n} notes in the trash are left out.";
  STRINGS.el["imp.trashed"] = "{n} σημειώσεις του κάδου μένουν έξω.";
  STRINGS.en["imp.encrypted"] = "{n} notes are encrypted. In Standard Notes use Preferences › Backups › Download backup and choose Decrypted.";
  STRINGS.el["imp.encrypted"] = "{n} σημειώσεις είναι κρυπτογραφημένες. Στο Standard Notes: Preferences › Backups › Download backup, με επιλογή Decrypted.";
  STRINGS.en["imp.cut"] = "{n} very long pages were cut to 1 MB of text.";
  STRINGS.el["imp.cut"] = "{n} πολύ μεγάλες σελίδες κόπηκαν στο 1 MB κειμένου.";
  STRINGS.en["imp.capped"] = "Only the first 5,000 pages come in; {n} more stay out.";
  STRINGS.el["imp.capped"] = "Μπαίνουν μόνο οι πρώτες 5.000 σελίδες· άλλες {n} μένουν έξω.";
  STRINGS.en["imp.gone"] = "{n} were deleted here before: they don't come back.";
  STRINGS.el["imp.gone"] = "{n} διαγράφηκαν εδώ παλιότερα: δεν επανέρχονται.";
  STRINGS.en["imp.tooBig"] = "{n} files were too big to read (over 200 MB in total) or could not be read.";
  STRINGS.el["imp.tooBig"] = "{n} αρχεία ήταν πολύ μεγάλα (πάνω από 200 MB συνολικά) ή δεν διαβάστηκαν.";
  STRINGS.en["imp.heavy"] = "This is a lot of text ({mb} MB): syncing it to your other devices takes a while.";
  STRINGS.el["imp.heavy"] = "Είναι πολύ κείμενο ({mb} MB): ο συγχρονισμός στις άλλες συσκευές θα πάρει λίγο χρόνο.";
  STRINGS.en["imp.none"] = "No notes found here. Choose an Obsidian vault folder, an .enex, .jex or .zip file, a folder of .md / .txt files or a Standard Notes backup.";
  STRINGS.el["imp.none"] = "Δεν βρέθηκαν σημειώσεις. Διάλεξε τον φάκελο ενός vault του Obsidian, ένα αρχείο .enex, .jex ή .zip, φάκελο με αρχεία .md / .txt ή backup του Standard Notes.";
  STRINGS.en["imp.nothing"] = "Nothing new: Notes already has all of it.";
  STRINGS.el["imp.nothing"] = "Τίποτα νέο: οι Σημειώσεις τα έχουν ήδη όλα.";
  STRINGS.en["imp.go"] = "Import";
  STRINGS.el["imp.go"] = "Εισαγωγή";
  STRINGS.en["imp.close"] = "Close";
  STRINGS.el["imp.close"] = "Κλείσιμο";
  STRINGS.en["imp.done"] = "Notes imported: {a} new, {u} updated";
  STRINGS.el["imp.done"] = "Εισαγωγή σημειώσεων: {a} νέες, {u} ενημερώθηκαν";
  STRINGS.en["imp.undo"] = "Undo";
  STRINGS.el["imp.undo"] = "Αναίρεση";
  STRINGS.en["imp.undone"] = "Import undone";
  STRINGS.el["imp.undone"] = "Η εισαγωγή αναιρέθηκε";
  STRINGS.en["imp.archive"] = "Archive";
  STRINGS.el["imp.archive"] = "Αρχείο";
  STRINGS.en["imp.notebook"] = "Imported notes";
  STRINGS.el["imp.notebook"] = "Εισαγόμενες σημειώσεις";
  STRINGS.en["imp.err"] = "These files could not be read.";
  STRINGS.el["imp.err"] = "Δεν ήταν δυνατή η ανάγνωση αυτών των αρχείων.";

  function tf(key, params) {
    return t(key).replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }

  function importApply(pl) {
    var now = Date.now(), back = { pages: [], upd: [], nb: null, labels: [] };
    if (pl.notebook && !state.notebooks.some(function (n) { return n.id === pl.notebook.id; })) {
      var maxPos = 0;
      state.notebooks.forEach(function (n) { if (n.pos > maxPos) maxPos = n.pos; });
      state.notebooks.push({ id: pl.notebook.id, name: pl.notebook.name, mtime: now, pos: maxPos + 1 });
      delete state.tombs["nb:" + pl.notebook.id];
      back.nb = pl.notebook.id;
    }
    if (!state.notebooks.some(function (n) { return n.id === pl.nb; })) return false;
    var lPos = 0, lCount = 0;
    state.labels.forEach(function (l) { if (l.pos > lPos) lPos = l.pos; if (l.nb === pl.nb) lCount++; });
    pl.labels.forEach(function (l, i) {
      if (labelById(l.id)) return;
      state.labels.push({ id: l.id, nb: pl.nb, name: l.name, color: LABEL_COLORS[(lCount + i) % LABEL_COLORS.length],
                          mtime: now, pos: lPos + 1 + i });
      delete state.tombs["lbl:" + l.id];
      back.labels.push(l.id);
    });
    var added = {};
    pl.pages.add.forEach(function (x) {
      if (pageById(x.id)) return;
      state.pages.push({ id: x.id, nb: pl.nb, parent: x.parent, title: x.title, text: x.text,
                         mtime: now, pos: x.pos, labels: x.labels.filter(function (id) { return !!labelById(id); }),
                         pinned: !!x.pinned, ct: now, st: now });
      delete state.tombs[x.id];
      added[x.id] = 1;
      back.pages.push(x.id);
    });
    // parents can come after their children in the list (archive)
    state.pages.forEach(function (p) {
      if (added[p.id] && p.parent && !pageById(p.parent)) p.parent = null;
    });
    pl.pages.upd.forEach(function (x) {
      var pg = pageById(x.id);
      if (!pg) return;
      back.upd.push({ id: x.id, title: pg.title, text: pg.text });
      pg.title = x.title;
      pg.text = x.text;
      touchContent(pg);
    });
    prefs.currentNb = pl.nb;
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    var n = IMP.count(pl);
    notifyUndoText(tf("imp.done", { a: n.add, u: n.upd }), t("imp.undo"), function () { importUndo(back); });
    return true;
  }
  function importUndo(back) {
    var now = Date.now(), gone = {};
    back.pages.forEach(function (id) { gone[id] = 1; state.tombs[id] = now; });
    state.pages = state.pages.filter(function (p) { return !gone[p.id]; });
    state.pages.forEach(function (p) { if (p.parent && gone[p.parent]) { p.parent = null; touchStruct(p); } });
    back.upd.forEach(function (u) {
      var pg = pageById(u.id);
      if (!pg) return;
      pg.title = u.title;
      pg.text = u.text;
      touchContent(pg);
    });
    var lgone = {};
    back.labels.forEach(function (id) {
      if (state.pages.some(function (p) { return (p.labels || []).indexOf(id) >= 0; })) return;
      lgone[id] = 1;
      state.tombs["lbl:" + id] = now;
    });
    state.labels = state.labels.filter(function (l) { return !lgone[l.id]; });
    if (back.nb && state.notebooks.length > 1 && !state.pages.some(function (p) { return p.nb === back.nb; })) {
      state.notebooks = state.notebooks.filter(function (n) { return n.id !== back.nb; });
      state.tombs["nb:" + back.nb] = now;
      if (prefs.currentNb === back.nb) prefs.currentNb = state.notebooks[0].id;
    }
    if (prefs.current && gone[prefs.current]) prefs.current = null;
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("imp.undone"));
  }
  // Undo notice: the shell's notifications, else a local bar with a button.
  function notifyUndoText(text, label, fn) {
    try {
      var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "notes", title: text, body: "", action: { label: label, fn: fn } });
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    uiDlg(text, null, [{ label: label, fn: fn }, { label: t("dlg.ok"), primary: true }], null);
  }

  function openImport() {
    if (!IMP) return;
    closeMenus();
    var stale = document.getElementById("nt-imp");
    if (stale) stale.remove();
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    }
    function button(text, cls, fn) {
      var b = el("button", cls || "", text);
      b.type = "button";
      b.addEventListener("click", fn);
      return b;
    }
    var dlg = el("dialog");
    dlg.id = "nt-imp";
    var form = el("form");
    form.method = "dialog";
    dlg.appendChild(form);
    form.appendChild(el("h3", "", t("imp.title")));
    form.appendChild(el("p", "hint", t("imp.intro")));
    var pick = el("div", "imp-pick");
    function picker(dir) {
      var inp = el("input");
      inp.type = "file";
      inp.multiple = true;
      inp.hidden = true;
      if (dir) { inp.setAttribute("webkitdirectory", ""); inp.setAttribute("directory", ""); }
      else inp.accept = ".md,.markdown,.txt,.json,.zip,.enex,.jex,.tar,text/markdown,text/plain,application/json,application/zip";
      inp.addEventListener("change", function () { read(inp.files); inp.value = ""; });
      form.appendChild(inp);
      return inp;
    }
    var dirInp = picker(true), fileInp = picker(false);
    if ("webkitdirectory" in dirInp) pick.appendChild(button(t("imp.folder"), "", function () { dirInp.click(); }));
    pick.appendChild(button(t("imp.files"), "", function () { fileInp.click(); }));
    form.appendChild(pick);
    var updW = el("label", "radio"), updBox = el("input");
    updBox.type = "checkbox";
    updW.appendChild(updBox);
    updW.appendChild(el("span", "", t("imp.upd")));
    var updHint = el("p", "hint", t("imp.updHint"));
    updW.hidden = updHint.hidden = true;
    form.appendChild(updW);
    form.appendChild(updHint);
    var msg = el("div", "plat-msg");
    msg.setAttribute("aria-live", "polite");
    form.appendChild(msg);
    var menu = el("menu");
    var go = button(t("imp.go"), "primary", apply);
    go.disabled = true;
    menu.appendChild(button(t("imp.close"), "", function () { dlg.close(); }));
    menu.appendChild(el("span", "spacer"));
    menu.appendChild(go);
    form.appendChild(menu);
    var parsed = null, plan = null, busy = false;
    updBox.addEventListener("change", function () { if (parsed && !busy) compute(); });

    function line(text, strong) { msg.appendChild(el("p", strong ? "" : "hint", text)); }
    function read(list) {
      var files = Array.prototype.slice.call(list || []);
      if (!files.length || busy) return;
      busy = true;
      go.disabled = true;
      parsed = plan = null;
      msg.textContent = tf("imp.reading", { n: files.length });
      // skip what can never be a note before reading it (pictures, PDFs…)
      var want = /\.(md|markdown|mdown|mkd|txt|text|json|zip|enex|jex|tar)$/i;
      Promise.all(files.map(function (f) {
        var p = f.webkitRelativePath || f.name;
        if (!want.test(f.name) || /(^|\/)\./.test(p) && !/(^|\/)\.obsidian(\/|$)/.test(p)) return { path: p, bytes: new Uint8Array(0) };
        return f.arrayBuffer().then(function (b) { return { path: p, bytes: new Uint8Array(b) }; });
      })).then(function (inputs) {
        return IMP.collect(inputs, window.AtelierZip || null);
      }).then(function (col) {
        busy = false;
        parsed = IMP.parse(col, { untitled: t("page.untitled"), archiveTitle: t("imp.archive") });
        compute();
      }, function () {
        busy = false;
        msg.textContent = t("imp.err");
      });
    }
    function compute() {
      msg.textContent = "";
      if (!parsed.notes.length) { line(t("imp.none"), true); updW.hidden = updHint.hidden = true; go.disabled = true; return; }
      plan = IMP.plan(state, parsed, { upd: updBox.checked, imported: t("imp.notebook") });
      var n = IMP.count(plan), sk = parsed.skipped;
      var have = plan.same + n.upd;
      updW.hidden = updHint.hidden = !have;
      line(tf("imp.plan", { src: t("imp.src." + parsed.source), a: n.add, u: n.upd, s: plan.same }), true);
      if (!n.add && !n.upd) line(t("imp.nothing"));
      else if (plan.notebook) line(tf("imp.nb", { name: plan.notebook.name }));
      else line(t("imp.nbOld"));
      if (n.labels) line(tf("imp.labels", { n: n.labels }));
      if (sk.attachments) line(tf("imp.att", { n: sk.attachments }));
      if (sk.trashed) line(tf("imp.trashed", { n: sk.trashed }));
      if (sk.encrypted) line(tf("imp.encrypted", { n: sk.encrypted }));
      if (sk.cut) line(tf("imp.cut", { n: sk.cut }));
      if (plan.capped) line(tf("imp.capped", { n: plan.capped }));
      if (plan.gone) line(tf("imp.gone", { n: plan.gone }));
      if ((sk.tooBig || 0) + (sk.unreadable || 0)) line(tf("imp.tooBig", { n: (sk.tooBig || 0) + (sk.unreadable || 0) }));
      var chars = 0;
      plan.pages.add.forEach(function (p) { chars += p.text.length; });
      plan.pages.upd.forEach(function (p) { chars += p.text.length; });
      if (chars > 5 * 1024 * 1024) line(tf("imp.heavy", { mb: Math.round(chars / 1048576) }));
      go.disabled = !n.add && !n.upd;
    }
    function apply() {
      if (busy || !plan) return;
      var n = IMP.count(plan);
      if (!n.add && !n.upd) return;
      if (importApply(plan)) dlg.close();
    }
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.showModal();
  }

  function renameNotebook(id, newName) {
    var nb = state.notebooks.find(function (n) { return n.id === id; });
    if (!nb) return;
    nb.name = newName;
    nb.mtime = Date.now();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("toast.nbRenamed"));
  }

  function deleteNotebook(id) {
    var nb = state.notebooks.find(function (n) { return n.id === id; });
    if (!nb) return;
    askConfirm(t("book.delete"),
      '"' + nb.name + '" — ' + t("book.confirm"),
      t("book.delete"), function () { doDeleteNotebook(id); });
  }

  function doDeleteNotebook(id) {
    // Tombstones for notebook + all its pages/labels (delete wins on merge)
    state.tombs["nb:" + id] = Date.now();
    state.pages.forEach(function (p) {
      if (p.nb === id) {
        state.tombs[p.id] = Date.now();
        delete prefs.open[p.id];   // #8: no device-local key leak
      }
    });
    state.labels.forEach(function (l) {
      if (l.nb === id) state.tombs["lbl:" + l.id] = Date.now();
    });
    state.pages     = state.pages.filter(function (p) { return p.nb !== id; });
    state.labels    = state.labels.filter(function (l) { return l.nb !== id; });
    state.notebooks = state.notebooks.filter(function (n) { return n.id !== id; });

    // Never zero notebooks — invariant: at least one always exists
    if (!state.notebooks.length) {
      state.notebooks.push({ id: uid("nb"), name: t("book.default"), mtime: Date.now(), pos: 0 });
    }

    if (prefs.currentNb === id || !pageById(prefs.current)) {
      prefs.currentNb = state.notebooks[0].id;
      prefs.current = null;
    }
    if (!prefs.current) {
      var first = state.pages.filter(function (p) { return p.nb === prefs.currentNb; })[0];
      prefs.current = (first && first.id) || null;
    }
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("toast.nbDeleted"));
  }

  // ---------- 5z. DRAG & DROP (#5: pages in/out of parent pages) -----
  // Delegated on #tree-root (which persists across renderTree passes —
  // renderTree only clears innerHTML). Rows get draggable=true in
  // buildNodes; all handlers live here, attached ONCE.
  // Sync safety: reparentPage bumps mtime → per-page LWW carries the
  // new parent/pos to every device. No merge-engine change needed.

  var DND_CSS_DONE = false;
  function ensureDndCss() {
    if (DND_CSS_DONE) return;
    DND_CSS_DONE = true;
    var st = document.createElement("style");
    st.textContent =
      "#tree-root .node-row.dragging{opacity:.35}" +
      "#tree-root .node-row.drop-target{background:var(--accent-soft);" +
        "outline:1px dashed var(--accent);outline-offset:-1px;border-radius:6px}" +
      "#tree-root .node-kids.drop-target{outline:1px dashed var(--accent);" +
        "outline-offset:-2px;border-radius:6px}";
    document.head.appendChild(st);
  }

  var dragPageId  = null;
  var draggingRow = null;
  var dropHintEl  = null;

  function clearDropHint() {
    if (dropHintEl) { dropHintEl.classList.remove("drop-target"); dropHintEl = null; }
  }

  // Walk UP from targetId: if we ever meet the dragged page, the
  // target lives inside the dragged subtree — invalid.
  function validDropTarget(dragId, targetId) {
    var cur = targetId, hops = 0;
    while (cur && hops++ < 200) {
      if (cur === dragId) return false;
      var pg = pageById(cur);
      if (!pg) return false;
      cur = pg.parent;
    }
    return true;
  }

  function setDropHint(el) {
    if (dropHintEl === el) return;
    clearDropHint();
    dropHintEl = el;
    if (el) el.classList.add("drop-target");
  }

  // Resolve the drop target under the cursor: a row (→ that page),
  // a .node-kids UL (→ its parent page), or the root area.
  function dndTargetInfo(e, rootEl) {
    if (e.target && e.target.closest) {
      var row = e.target.closest(".node-row");
      if (row && row.parentElement && row.parentElement.dataset.id) {
        return { kind: "page", id: row.parentElement.dataset.id, el: row };
      }
      var kids = e.target.closest(".node-kids");
      if (kids && kids.parentElement && kids.parentElement.dataset.id) {
        return { kind: "page", id: kids.parentElement.dataset.id, el: kids };
      }
    }
    return { kind: "root", id: null, el: rootEl };
  }

  function reparentPage(id, newParentId) {
    var p = pageById(id);
    if (!p) return;
    if (newParentId && !validDropTarget(id, newParentId)) {
      notifyTransient(t("dnd.bad"));
      return;
    }
    // Top-level page dropped on the root area: no-op by design —
    // prevents surprise reordering to the end of the root list.
    if (newParentId === null && p.parent === null) return;

    p.parent = newParentId;
    var maxPos = 0;
    siblingListByParent(newParentId).forEach(function (s) {
      if (s.pos > maxPos) maxPos = s.pos;
    });
    p.pos = maxPos + 1;                    // lands at the end of the list
    touchStruct(p);
    if (newParentId) prefs.open[newParentId] = true;   // auto-expand target
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("toast.moved"));
  }

  var DND_ATTACHED = false;
  function attachTreeDnD() {
    if (DND_ATTACHED) return;
    var rootEl = document.getElementById("tree-root");
    if (!rootEl) return;
    DND_ATTACHED = true;
    ensureDndCss();

    rootEl.addEventListener("dragstart", function (e) {
      if (!e.target || !e.target.closest) return;
      var row = e.target.closest(".node-row");
      if (!row || !row.parentElement) return;
      dragPageId = row.parentElement.dataset.id || null;
      if (!dragPageId) return;
      draggingRow = row;
      try {
        e.dataTransfer.setData("text/plain", dragPageId);
        e.dataTransfer.effectAllowed = "move";
      } catch (err) {}
      row.classList.add("dragging");
    });

    rootEl.addEventListener("dragend", function () {
      dragPageId = null;
      clearDropHint();
      if (draggingRow) { draggingRow.classList.remove("dragging"); draggingRow = null; }
    });

    rootEl.addEventListener("dragover", function (e) {
      if (!dragPageId) return;
      var tgt = dndTargetInfo(e, rootEl);
      if (tgt.kind === "page" && !validDropTarget(dragPageId, tgt.id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropHint(tgt.el);
    });

    rootEl.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      clearDropHint();
      if (!dragPageId) return;
      var tgt = dndTargetInfo(e, rootEl);
      if (tgt.kind === "page") {
        var src = pageById(dragPageId);
        var dst = pageById(tgt.id);
        if (!src || !dst || src.nb !== dst.nb) return;   // same-notebook only
        if (!validDropTarget(dragPageId, tgt.id)) {
          notifyTransient(t("dnd.bad"));
          return;
        }
        reparentPage(dragPageId, tgt.id);
      } else {
        reparentPage(dragPageId, null);
      }
      dragPageId = null;
    });
  }

  // Mobile/no-DnD fallback: "Move to…" destination list, built with
  // the same dialog id as uiDlg (nt-dlg) so closeUiDlg()/Esc work.
  function askMoveTo(page) {
    closeMenus();
    var banned = {};   // self + own descendants are not destinations
    (function mark(pid) {
      banned[pid] = true;
      state.pages.forEach(function (q) { if (q.parent === pid) mark(q.id); });
    })(page.id);

    var dlg = document.createElement("dialog");
    dlg.id = "nt-dlg";
    dlg.style.cssText =
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--border);" +
      "border-radius:10px;padding:16px 14px;max-width:min(380px,88vw);" +
      "box-shadow:0 12px 36px var(--shadow);";
    var h = document.createElement("h3");
    h.style.cssText = "margin:0 0 10px;font-size:15px;font-weight:700;";
    h.textContent = t("page.moveto") + " · " +
      (page.title !== "" ? page.title : t("page.untitled"));
    dlg.appendChild(h);

    var list = document.createElement("div");
    list.style.cssText =
      "max-height:50vh;overflow:auto;display:flex;flex-direction:column;gap:2px;";

    function dest(label, depth, targetId) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText =
        "text-align:left;padding:7px 10px;font:inherit;font-size:13px;" +
        "background:transparent;color:var(--text);border:1px solid var(--border);" +
        "border-radius:7px;cursor:pointer;margin-left:" + (depth * 14) + "px;";
      b.addEventListener("click", function () {
        closeUiDlg();
        reparentPage(page.id, targetId);
      });
      list.appendChild(b);
    }

    dest(t("dnd.root"), 0, null);
    (function walk(parentId, depth) {
      if (depth > 32) return;
      kidsOf(parentId).forEach(function (p) {
        if (banned[p.id]) return;
        dest(p.title !== "" ? p.title : t("page.untitled"), depth, p.id);
        walk(p.id, depth + 1);
      });
    })(null, 0);
    dlg.appendChild(list);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;";
    var c = document.createElement("button");
    c.type = "button";
    c.textContent = t("dlg.cancel");
    c.style.cssText =
      "padding:8px 14px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;" +
      "background:transparent;color:var(--text);border:1px solid var(--border);";
    c.addEventListener("click", closeUiDlg);
    row.appendChild(c);
    dlg.appendChild(row);

    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 6. Context menu + label picker (Wave 2.1) ----------

  function closeMenus() {
    var m = document.getElementById("node-menu");
    if (m) m.remove();
    var lp = document.getElementById("label-picker");
    if (lp) lp.remove();
  }

  function clampToViewport(el, x, y) {
    var r = el.getBoundingClientRect();
    el.style.left = Math.max(6, Math.min(x, innerWidth  - r.width  - 6)) + "px";
    el.style.top  = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + "px";
  }
  
    // ---------- 6b. Export plumbing: download + ZIP writer ----------
  // Store-method ZIP, vanilla JS, ZERO dependencies (mantra).
  // writeZip(entries) → Blob; entries = [{ path, data }] with
  // UNIX "/" paths. Names/data are UTF-8 (flag bit 11 set).

  var utf8 = (typeof TextEncoder === "function")
    ? function (s) { return new TextEncoder().encode(s); }
    : function (s) {                      // legacy fallback
        var out = [];
        for (var i = 0; i < s.length; i++) {
          var cp = s.codePointAt(i);
          if (cp > 0xFFFF) i++;           // consume the pair
          if (cp < 0x80) out.push(cp);
          else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
          else if (cp < 0x10000) out.push(0xE0 | (cp >> 12),
                                         0x80 | ((cp >> 6) & 63),
                                         0x80 | (cp & 63));
          else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                        0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        }
        return new Uint8Array(out);
      };

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ZIP timestamps are DOS date/time (2s granularity, 1980-2107)
  function dosDateTime(d) {
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
    };
  }

  function writeZip(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (e) {
      var nameB = utf8(e.path);
      var dataB = utf8(e.data);
      var crc = crc32(dataB);
      var dt = dosDateTime(new Date());

      // Local file header (30 bytes fixed)
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);   // signature
      lh.setUint16(4, 20, true);           // version needed
      lh.setUint16(6, 0x0800, true);       // flags: UTF-8 names
      lh.setUint16(8, 0, true);            // method: STORE
      lh.setUint16(10, dt.time, true);
      lh.setUint16(12, dt.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, dataB.length, true); // compressed size
      lh.setUint32(22, dataB.length, true); // uncompressed size
      lh.setUint16(26, nameB.length, true);
      lh.setUint16(28, 0, true);            // extra field len
      chunks.push(new Uint8Array(lh.buffer), nameB, dataB);

      central.push({ nameB: nameB, crc: crc, size: dataB.length, dt: dt, offset: offset });
      offset += 30 + nameB.length + dataB.length;
    });

    var cdStart = offset;
    central.forEach(function (c) {
      // Central directory header (46 bytes fixed)
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);   // signature
      ch.setUint16(4, 20, true);            // version made by
      ch.setUint16(6, 20, true);            // version needed
      ch.setUint16(8, 0x0800, true);        // flags: UTF-8
      ch.setUint16(10, 0, true);            // method: STORE
      ch.setUint16(12, c.dt.time, true);
      ch.setUint16(14, c.dt.date, true);
      ch.setUint32(16, c.crc, true);
      ch.setUint32(20, c.size, true);
      ch.setUint32(24, c.size, true);
      ch.setUint16(28, c.nameB.length, true);
      // 30/32 extra+comment len, 34/36 attrs — all zero
      ch.setUint32(42, c.offset, true);     // local header offset
      chunks.push(new Uint8Array(ch.buffer), c.nameB);
      offset += 46 + c.nameB.length;
    });

    // End of central directory (22 bytes fixed)
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, central.length, true);
    eocd.setUint16(10, central.length, true);
    eocd.setUint32(12, offset - cdStart, true);
    eocd.setUint32(16, cdStart, true);
    chunks.push(new Uint8Array(eocd.buffer));

    return new Blob(chunks, { type: "application/zip" });
  }

  // Filename sanitizer — strips filesystem-hostile chars
  function sanitizeFilename(name) {
    var s = (name || "").trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    return s || "Untitled";
  }

  function downloadBlob(blob, filename, mime, types) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({
        blob: blob,
        filename: filename,
        mime: mime,
        types: types
      }).then(function (r) { if (r && r.ok) return; });
      return;                         // cancel (ok=false) = silent exit
    }

    // Standalone fallback — classic download (no shell present).
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Late revoke (dialogs.js DLG-1): a download that starts after a
    // browser prompt must still find the URL.
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  
    // ---------- 6c. Export functions (page .txt / notebook .zip) ----------

  function childrenSorted(parentId, nbId) {
    return state.pages
      .filter(function (p) {
        var okParent = parentId ? (p.parent === parentId) : (!p.parent);
        return okParent && (!nbId || p.nb === nbId);   // #2/#5: nb-safe
      })
      .sort(function (a, b) {
        var ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;   // #5: pinned first — tree parity
        return (a.pos || 0) - (b.pos || 0) ||
               (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
      });
  }

  function sanitizeFolder(name) {
    var s = sanitizeFilename(name).replace(/[. ]+$/, ""); // no trailing dots/spaces
    return s || "_";
  }

  // orOS global export rule: every exported file ends with the
  // branding footer. Covers page .txt AND every entry in the
  // notebook .zip — single funnel, zero drift.
  function pageText(page) {
    return page.title + "\n\n" + (page.text || "") +
      "\n\n---\nMade with orOS | useoros.online";
  }

  function exportPageTxt(page) {
    downloadBlob(
      new Blob([pageText(page)], { type: "text/plain;charset=utf-8" }),
      sanitizeFilename(page.title) + ".txt",
      "text/plain;charset=utf-8",
      [{ description: "Plain Text", accept: { "text/plain": [".txt"] } }]
    );
  }

  // Markdown wave: the same page as a .md file ("# Title", the text
  // as written, the orOS line after a rule). Wiki links stay [[…]].
  function exportPageMd(page) {
    downloadBlob(
      new Blob([MD.pageMarkdown(page.title, page.text)], { type: "text/markdown;charset=utf-8" }),
      sanitizeFilename(page.title) + ".md",
      "text/markdown;charset=utf-8",
      [{ description: "Markdown", accept: { "text/markdown": [".md"] } }]
    );
  }

  // md: true → .md files (MD.pageMarkdown), else .txt (pageText).
  function exportNotebookZip(currentOnly, md) {
    var ext = md ? ".md" : ".txt";
    var fileData = md ? function (p) { return MD.pageMarkdown(p.title, p.text); } : pageText;
    // Scope: current notebook only, or everything
    var rootPages = state.pages.filter(function (p) { return !p.parent; });
    if (currentOnly) {
      var nbId = currentNbId();
      rootPages = rootPages.filter(function (p) { return p.nb === nbId; });
    }
    if (!rootPages.length) { notifyTransient(t("toast.emptyExport")); return; }   // #12

    var entries = [];
    var used = {};     // "dir|name" (lowercase) -> duplicate count
    var visited = {};  // cycle guard for malformed merged trees

    function unique(dir, name) {
      var key = dir + "|" + name.toLowerCase();
      var n = used[key] || 0;
      used[key] = n + 1;
      return n ? (name + " (" + (n + 1) + ")") : name;
    }

    function addPage(page, dir, depth) {
      if (depth > 50 || visited[page.id]) { return; } // cycle guard
      visited[page.id] = true;

      var kids = childrenSorted(page.id, page.nb);
      if (kids.length) {
        // Folder-carrying page: its own .txt lives INSIDE its folder
        var sub = dir + sanitizeFolder(page.title) + "/";
        entries.push({
          path: sub + unique(sub, sanitizeFilename(page.title)) + ext,
          data: fileData(page)
        });
        for (var i = 0; i < kids.length; i++) { addPage(kids[i], sub, depth + 1); }
      } else {
        entries.push({
          path: dir + unique(dir, sanitizeFilename(page.title)) + ext,
          data: fileData(page)
        });
      }
    }

    rootPages.forEach(function (r) { addPage(r, "", 0); });

    var d = new Date();
    var stamp = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    downloadBlob(writeZip(entries), "notes-" + stamp + (md ? "-md" : "") + ".zip",
      "application/zip",
      [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }]);
  }
  
    // ---------- 6d. Search (Ctrl+K) + Tags aggregation panel ----------
  // SESSION-ONLY by construction: neither view persists ANY state —
  // no prefs write, no localStorage key. Sync pulls / renderAll can
  // never resurrect them.

  function closeFloating() {
    var so = document.getElementById("search-overlay");
    if (so) so.remove();
    var tp = document.getElementById("tag-panel");
    if (tp) tp.remove();
  }

  function snippetAround(text, needle) {
    if (!text) return "";
    var lower = text.toLowerCase();
    var i = needle ? lower.indexOf(needle) : -1;
    if (i === -1) i = 0;
    var start = Math.max(0, i - 30);
    var end = Math.min(text.length, start + 90);
    var s = text.slice(start, end).replace(/\s+/g, " ");
    if (start > 0) s = "…" + s;
    if (end < text.length) s += "…";
    return s;
  }

  // "All notebooks" in the search box: remembered for this session
  // only (like the rest of search), never stored.
  var searchAll = false;
  function runSearch(q) {
    var out = document.getElementById("search-results");
    if (!out) return;
    out.innerHTML = "";
    var needle = q.trim().toLowerCase();

    if (needle.length < 2) {
      var h = document.createElement("div");
      h.className = "sr-msg";
      h.textContent = t("search.hint");
      out.appendChild(h);
      return;
    }

    var hits = [];
    var nbId = currentNotebook().id;   // #14: no shadowing of currentNbId()
    state.pages.forEach(function (p) {
      if (!searchAll && p.nb !== nbId) return;
      var inTitle = ((p.title || "")).toLowerCase().indexOf(needle) !== -1;
      var inText  = ((p.text  || "")).toLowerCase().indexOf(needle) !== -1;
      if (inTitle || inText) hits.push({ p: p, w: inTitle ? 0 : 1 });
    });
    // Title hits first, then freshest
    hits.sort(function (a, b) { return a.w - b.w || (b.p.mtime || 0) - (a.p.mtime || 0); });

    if (!hits.length) {
      var n = document.createElement("div");
      n.className = "sr-msg";
      n.textContent = t("search.none");
      out.appendChild(n);
      return;
    }

    var cap = Math.min(hits.length, 50);
    var cnt = document.createElement("div");
    cnt.className = "sr-msg";
    cnt.textContent = t("search.count").replace("{n}", String(hits.length));
    out.appendChild(cnt);

    for (var i = 0; i < cap; i++) {
      (function (hit) {
        var row = document.createElement("button");
        row.className = "sr-item";
        row.type = "button";
        var ti = document.createElement("span");
        ti.className = "sr-title";
        ti.textContent = hit.p.title !== "" ? hit.p.title : t("page.untitled");
        row.appendChild(ti);
        if (searchAll && state.notebooks.length > 1) {
          var nbt = document.createElement("span");
          nbt.className = "sr-nb";
          nbt.textContent = nbNameOf(hit.p.nb);
          row.appendChild(nbt);
        }
        var sn = document.createElement("span");
        sn.className = "sr-snippet";
        sn.textContent = snippetAround(hit.p.text, needle);
        row.appendChild(sn);
        row.addEventListener("click", function () {
          closeFloating();
          revealPage(hit.p);
        });
        out.appendChild(row);
      })(hits[i]);
    }
  }

  function openSearch(query, all) {
    closeMenus();
    if (all === true) searchAll = true;
    closeFloating();
    var ov = document.createElement("div");
    ov.id = "search-overlay";
    var box = document.createElement("div");
    box.id = "search-box";
    var inp = document.createElement("input");
    inp.id = "search-input";
    inp.type = "text";
    inp.spellcheck = false;
    inp.placeholder = t("search.placeholder");
    var res = document.createElement("div");
    res.id = "search-results";
    box.appendChild(inp);
    var opt = document.createElement("label");
    opt.className = "sr-opt";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "search-all";
    cb.checked = searchAll;
    cb.addEventListener("change", function () { searchAll = cb.checked; runSearch(inp.value); inp.focus(); });
    opt.appendChild(cb);
    var ol = document.createElement("span");
    ol.textContent = t("search.all");
    opt.appendChild(ol);
    if (state.notebooks.length > 1 || searchAll) box.appendChild(opt);
    box.appendChild(res);
    ov.appendChild(box);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) ov.remove(); });
    inp.addEventListener("input", function () { runSearch(inp.value); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { ov.remove(); return; }
      if (e.key === "Enter") {
        var first = res.querySelector(".sr-item");
        if (first) first.click();
      }
      e.stopPropagation();
    });
    document.body.appendChild(ov);
    if (typeof query === "string") inp.value = query;
    inp.focus();
    runSearch(inp.value);
  }

  function toggleTagPanel() {
    var p = document.getElementById("tag-panel");
    if (p) { p.remove(); return; }
    closeMenus();
    renderTagPanel(null);
  }

  function renderTagPanel(filterId) {
    var old = document.getElementById("tag-panel");
    if (old) old.remove();

    var panel = document.createElement("div");
    panel.id = "tag-panel";

    var head = document.createElement("div");
    head.className = "tp-head";
    if (filterId) {
      var back = document.createElement("button");
      back.className = "tp-back";
      back.type = "button";
      back.textContent = t("tags.back");
      back.addEventListener("click", function () { renderTagPanel(null); });
      head.appendChild(back);
    }
    var ht = document.createElement("span");
    ht.className = "tp-title";
    if (filterId) {
      var lb = labelById(filterId);
      ht.textContent = lb ? lb.name : "";
    } else {
      ht.textContent = t("tags.all");
    }
    head.appendChild(ht);
    var x = document.createElement("button");
    x.className = "tp-close";
    x.type = "button";
    x.innerHTML = X_SVG;
    x.setAttribute("aria-label", t("menu.close"));   // #9
    x.addEventListener("click", function () { panel.remove(); });
    head.appendChild(x);
    panel.appendChild(head);

    var list = document.createElement("div");
    list.className = "tp-list";

    if (!filterId) {
      if (!state.labels.length) {
        var none = document.createElement("div");
        none.className = "tp-none";
        none.textContent = t("labels.none");
        list.appendChild(none);
      } else {
        var nbId = currentNotebook().id;   // #14
        state.labels
          .filter(function (l) { return l.nb === nbId; })
          .slice()
          .sort(function (a, b) { return (a.pos - b.pos) || a.name.localeCompare(b.name); })
          .forEach(function (lb) {
            var cnt = state.pages.filter(function (p) {
              return p.nb === nbId && (p.labels || []).indexOf(lb.id) !== -1;
            }).length;
            var row = document.createElement("button");
            row.className = "tp-item";
            row.type = "button";
            var dot = document.createElement("span");
            dot.className = "tp-dot";
            dot.style.background = lb.color;
            row.appendChild(dot);
            var nm = document.createElement("span");
            nm.className = "tp-name";
            nm.textContent = lb.name;
            row.appendChild(nm);
            var c = document.createElement("span");
            c.className = "tp-count";
            c.textContent = String(cnt);
            row.appendChild(c);
            row.addEventListener("click", function () { renderTagPanel(lb.id); });
            list.appendChild(row);
          });
      }
    } else {
      var nbId = currentNotebook().id;   // #14
      var pages = state.pages
        .filter(function (p) {
          return p.nb === nbId && (p.labels || []).indexOf(filterId) !== -1;
        })
        .sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
      if (!pages.length) {
        var pn = document.createElement("div");
        pn.className = "tp-none";
        pn.textContent = t("search.none");
        list.appendChild(pn);
      } else {
        pages.forEach(function (p) {
          var pr = document.createElement("button");
          pr.className = "tp-page";
          pr.type = "button";
          pr.textContent = p.title !== "" ? p.title : t("page.untitled");
          pr.addEventListener("click", function () {
            panel.remove();
            selectPage(p.id);
          });
          list.appendChild(pr);
        });
      }
    }

    panel.appendChild(list);
    document.body.appendChild(panel);
  }
  
    // ---------- 6e. Wiki-links + backlinks (live, zero storage) ----------
  // Outgoing links: [[Title]] parsed from the page text on the fly.
  // Backlinks: other pages (any notebook) whose [[links]] resolve here.
  // Resolved chip → open; unresolved chip → CREATE (creation-on-click,
  // new page becomes a CHILD of the current page — wiki-tree semantics).

  // Markdown wave: links resolve across notebooks (md.js resolve —
  // the rule is written there and in the help). [[Notebook/Page]]
  // names the notebook; a plain [[Page]] prefers this notebook, then
  // the one page of that title anywhere else.
  function linkIndex() { return MD.buildIndex(state.notebooks, state.pages); }

  function resolveLink(target, fromNb, idx) {
    return MD.resolve(target, fromNb || currentNbId(), idx || linkIndex());
  }

  // Shows a page wherever it lives: its notebook, its open ancestors.
  function revealPage(p) {
    if (!p) return;
    if (p.nb && p.nb !== prefs.currentNb) prefs.currentNb = p.nb;
    var up = p.parent, guard = 0;
    while (up && guard++ < 100) {
      prefs.open[up] = true;
      var pp = pageById(up);
      up = pp ? pp.parent : null;
    }
    selectPage(p.id);
  }

  function openOrCreateFromLink(target) {
    var from = pageById(prefs.current);
    var r = resolveLink(target, from ? from.nb : currentNbId());
    if (r.page) { revealPage(r.page); return; }
    if (r.ambiguous) {
      notifyTransient(t("link.ambiguous"));
      openSearch(r.ambiguous[0].title || target, true);
      return;
    }
    var title = r.title || target;
    if (r.nb && r.nb !== currentNbId()) {
      // [[Notebook/Page]] to a page that notebook doesn't have yet:
      // it is made at the top of that notebook.
      flushSave();
      prefs.currentNb = r.nb;
      newPage(null, { title: title });
      return;
    }
    // Creation-on-click: new page as CHILD of current, at end.
    newPage(prefs.current || null);
    var fresh = pageById(prefs.current);
    if (fresh) {
      fresh.title = title;
      touchContent(fresh);
      saveNow();
      markSyncDirty();
      renderAll();
      // NT-1: renderEditor's #7 shortcut (same page + focused input)
      // skips the value update — paint the REAL title into the input
      // or the user sees "Untitled" while the data already holds the
      // link title (typing would clobber it back).
      var ntTitleEl = document.getElementById("page-title");
      if (ntTitleEl && prefs.current === fresh.id) {
        ntTitleEl.value = title;
        ntTitleEl.focus();
        ntTitleEl.select();
      }
    }
  }

  // Pages (any notebook) with a [[link]] that resolves to `current`.
  function backlinkPages(current, idx) {
    var title = ((current && current.title) || "").trim().toLowerCase();
    if (!title) return [];
    idx = idx || linkIndex();
    return state.pages.filter(function (p) {
      if (p.id === current.id) return false;
      var low = (p.text || "").toLowerCase();
      if (low.indexOf("[[") === -1 || low.indexOf(title) === -1) return false;
      return MD.wikiTargets(p.text).some(function (tg) {
        var r = resolveLink(tg, p.nb, idx);
        return !!(r.page && r.page.id === current.id);
      });
    });
  }

  function chip(label, cls, onclick) {
    var c = document.createElement("button");
    c.type = "button";
    c.className = "lk-chip " + (cls || "");
    c.textContent = label;
    c.addEventListener("click", function (e) { e.stopPropagation(); onclick(); });
    return c;
  }

  function nbNameOf(id) {
    var nb = state.notebooks.find(function (n) { return n.id === id; });
    return nb ? nb.name : "";
  }

  function renderLinksStrip(page) {
    var old = document.getElementById("links-strip");
    if (old) old.remove();

    var pane = document.getElementById("editor-pane");
    if (!pane || !page || !MD) return;

    var idx = linkIndex();
    var outTitles = MD.wikiTargets(page.text);
    var backs = backlinkPages(page, idx);
    if (!outTitles.length && !backs.length) return;

    var strip = document.createElement("div");
    strip.id = "links-strip";

    if (outTitles.length) {
      var so = document.createElement("div");
      so.className = "lk-section";
      so.textContent = t("links.out");
      strip.appendChild(so);
      outTitles.forEach(function (title) {
        var r = resolveLink(title, page.nb, idx);
        strip.appendChild(chip(title, r.page ? "ok" : (r.ambiguous ? "amb" : "new"), function () {
          openOrCreateFromLink(title);
        }));
      });
    }

    if (backs.length) {
      var sb = document.createElement("div");
      sb.className = "lk-section";
      sb.textContent = t("links.back");
      strip.appendChild(sb);
      backs.forEach(function (src) {
        var label = src.title !== "" ? src.title : t("page.untitled");
        if (src.nb !== page.nb) label = nbNameOf(src.nb) + " / " + label;
        strip.appendChild(chip(label, "back", function () { revealPage(src); }));
      });
    }

    pane.appendChild(strip);
  }
  var linksTimer = null;
  function queueLinksStrip() {
    if (linksTimer) clearTimeout(linksTimer);
    linksTimer = setTimeout(function () {
      linksTimer = null;
      renderLinksStrip(pageById(prefs.current));
    }, 300);
  }

  // ---------- 6f. Markdown view: preview, toolbar, Edit / Preview ----------
  // The page text is never changed by viewing it. View mode is a
  // device-local pref (prefs.view: edit | preview | split); "split"
  // needs a wide window and reads as "edit" on a narrow one.
  var WIDE_MQ = (window.matchMedia ? window.matchMedia("(min-width: 900px)") : null);
  function effectiveView() {
    var v = prefs.view || "edit";
    if (v === "split" && !(WIDE_MQ && WIDE_MQ.matches)) v = "edit";
    return v;
  }
  function applyView() {
    var app = document.getElementById("notes-app");
    if (!app) return;
    var v = effectiveView();
    app.classList.remove("view-edit", "view-preview", "view-split");
    app.classList.add("view-" + v);
    var btns = document.querySelectorAll("#md-toolbar .vw-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].dataset.view === v ? "true" : "false");
    }
    var pv = document.getElementById("page-preview");
    if (pv) pv.hidden = (v === "edit");
    renderPreview();
  }
  function setView(v) {
    flushSave();
    prefs.view = v;
    savePrefs();
    applyView();
    if (v === "edit" || v === "split") {
      var ta = document.getElementById("page-text");
      if (ta && !ta.disabled && !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) ta.focus();
    }
  }

  function renderPreview() {
    var pv = document.getElementById("page-preview");
    if (!pv || effectiveView() === "edit" || !MD) return;
    var page = pageById(prefs.current);
    if (!page) { pv.innerHTML = ""; return; }
    if (!String(page.text || "").trim()) {
      pv.innerHTML = "";
      var em = document.createElement("p");
      em.className = "md-empty";
      em.textContent = t("preview.empty");
      pv.appendChild(em);
      return;
    }
    var idx = linkIndex();
    // MD.render escapes every character of the text and builds only
    // allow-listed tags (md.js header): the string is safe as markup.
    pv.innerHTML = MD.render(page.text, {
      wiki: function (target) {
        var r = resolveLink(target, page.nb, idx);
        return r.page ? "ok" : (r.ambiguous ? "amb" : "new");
      }
    });
  }
  var previewTimer = null;
  function queuePreview() {
    if (effectiveView() !== "split") return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(function () { previewTimer = null; renderPreview(); }, 150);
  }

  function wirePreview() {
    var pv = document.getElementById("page-preview");
    if (!pv) return;
    function wikiFrom(e) {
      var a = e.target && e.target.closest ? e.target.closest("a.md-wiki") : null;
      return a && pv.contains(a) ? a.getAttribute("data-wiki") : null;
    }
    pv.addEventListener("click", function (e) {
      var w = wikiFrom(e);
      if (w) { e.preventDefault(); openOrCreateFromLink(w); }
    });
    pv.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var w = wikiFrom(e);
      if (w) { e.preventDefault(); openOrCreateFromLink(w); }
    });
    pv.addEventListener("change", function (e) {
      var box = e.target;
      if (!box || box.tagName !== "INPUT" || !box.hasAttribute("data-line")) return;
      var p = pageById(prefs.current);
      var next = p ? MD.toggleTask(p.text || "", parseInt(box.getAttribute("data-line"), 10)) : null;
      if (next === null) { renderPreview(); return; }
      p.text = next;
      touchContent(p);
      queueSave(p.id);
      var ta = document.getElementById("page-text");
      if (ta) syncField(ta, next);
    });
  }

  var FMT_ICONS = {
    bold: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h7a4 4 0 0 1 0 8H6z"/><path d="M6 12h8a4 4 0 0 1 0 8H6z"/></svg>',
    italic: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    heading: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12"/></svg>',
    list: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    task: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="8 12 11 15 16 9"/></svg>',
    link: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    code: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
  };
  var VIEW_ICONS = {
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    preview: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    split: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>'
  };

  // Replaces the textarea's text through the editing commands where
  // the browser has them, so the browser's own Undo still works.
  function replaceEditorText(ta, next, a, b) {
    var cur = ta.value;
    if (cur !== next) {
      var p = 0, max = Math.min(cur.length, next.length);
      while (p < max && cur.charAt(p) === next.charAt(p)) p++;
      var sfx = 0;
      while (sfx < max - p && cur.charAt(cur.length - 1 - sfx) === next.charAt(next.length - 1 - sfx)) sfx++;
      var ins = next.slice(p, next.length - sfx);
      var ok = false;
      try {
        ta.focus();
        ta.setSelectionRange(p, cur.length - sfx);
        ok = ins ? document.execCommand("insertText", false, ins) : document.execCommand("delete");
      } catch (e) { ok = false; }
      if (!ok || ta.value !== next) {
        ta.value = next;
        ta.dispatchEvent(new Event("input"));
      }
    }
    try { ta.focus(); ta.setSelectionRange(a, b); } catch (e2) {}
  }

  function applyFormat(kind) {
    var ta = document.getElementById("page-text");
    var page = pageById(prefs.current);
    if (!ta || ta.disabled || !page || !MD) return;
    var r = MD.format(ta.value, ta.selectionStart, ta.selectionEnd, kind);
    replaceEditorText(ta, r.text, r.a, r.b);
  }

  function buildToolbar() {
    var bar = document.getElementById("md-toolbar");
    if (!bar || bar.childNodes.length) return;
    bar.setAttribute("aria-label", t("fmt.bar"));
    var fmt = document.createElement("div");
    fmt.className = "fmt-group";
    ["bold", "italic", "heading", "list", "task", "link", "code"].forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fmt-btn";
      b.dataset.fmt = k;
      b.title = t("fmt." + k);
      b.setAttribute("aria-label", t("fmt." + k));
      b.innerHTML = FMT_ICONS[k];
      // keep the textarea's focus and selection (no keyboard flicker)
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () { applyFormat(k); });
      fmt.appendChild(b);
    });
    bar.appendChild(fmt);
    var vw = document.createElement("div");
    vw.className = "vw-group";
    vw.setAttribute("role", "group");
    vw.setAttribute("aria-label", t("view.group"));
    ["edit", "preview", "split"].forEach(function (v) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "vw-btn" + (v === "split" ? " only-wide" : "");
      b.dataset.view = v;
      b.title = t("view." + v);
      b.setAttribute("aria-label", t("view." + v));
      b.innerHTML = VIEW_ICONS[v];
      var lab = document.createElement("span");
      lab.className = "vw-label";
      lab.textContent = t("view." + v);
      b.appendChild(lab);
      b.addEventListener("click", function () { setView(v); });
      vw.appendChild(b);
    });
    bar.appendChild(vw);
    if (WIDE_MQ) {
      var onMq = function () { applyView(); };
      if (WIDE_MQ.addEventListener) WIDE_MQ.addEventListener("change", onMq);
      else if (WIDE_MQ.addListener) WIDE_MQ.addListener(onMq);
    }
  }

  // ---------- 6g. Daily note + templates ----------
  function titleKey(p) { return String((p && p.title) || "").trim().toLowerCase(); }

  // Template pages: everything under a top-level page named Templates
  // (or Πρότυπα), in any notebook — this notebook's first.
  function templatePages() {
    var roots = state.pages.filter(function (p) {
      return !p.parent && TEMPLATE_NAMES.indexOf(titleKey(p)) !== -1;
    });
    var out = [], seen = {};
    function walk(id, depth) {
      if (depth > 32) return;
      childrenSorted(id, null).forEach(function (c) {
        if (seen[c.id]) return;
        seen[c.id] = true;
        out.push(c);
        walk(c.id, depth + 1);
      });
    }
    roots.forEach(function (r) { seen[r.id] = true; walk(r.id, 0); });
    var cur = currentNbId();
    return out.sort(function (a, b) {
      return ((a.nb === cur ? 0 : 1) - (b.nb === cur ? 0 : 1)) ||
             titleKey(a).localeCompare(titleKey(b));
    });
  }

  function openToday() {
    if (!MD) return;
    flushSave();
    closeMenus();
    var nbId = currentNbId(), now = new Date(), day = MD.ymd(now);
    var parent = state.pages.filter(function (p) {
      return p.nb === nbId && !p.parent && DAILY_NAMES.indexOf(titleKey(p)) !== -1;
    })[0];
    if (!parent) {
      // A fixed id per notebook: two devices that make it before they
      // sync make the SAME page, not two "Daily" pages.
      var pid = "dly-" + nbId;
      parent = insertPage(nbId, null, t("daily.parent"), "", pageById(pid) ? null : pid);
    }
    var page = state.pages.filter(function (p) {
      return p.nb === nbId && p.parent === parent.id && titleKey(p) === day;
    })[0];
    if (!page) {
      var tpl = templatePages().filter(function (p) { return DAILY_NAMES.indexOf(titleKey(p)) !== -1; })[0];
      var text = MD.fillTemplate(tpl ? tpl.text : t("daily.tpl"), { date: day, time: MD.hm(now), title: day });
      var id = "dly-" + nbId + "-" + day.replace(/-/g, "");
      page = insertPage(nbId, parent.id, day, text, pageById(id) ? null : id);
    }
    prefs.open[parent.id] = true;
    saveNow();
    markSyncDirty();
    revealPage(page);
  }

  function newFromTemplate() {
    closeMenus();
    var list = templatePages();
    if (!list.length) {
      uiDlg(t("tpl.new").replace(/…$/, ""), t("tpl.none"), [{ label: t("dlg.ok"), primary: true }], null);
      return;
    }
    var dlg = document.createElement("dialog");
    dlg.id = "nt-dlg";
    dlg.className = "nt-list-dlg";
    var h = document.createElement("h3");
    h.textContent = t("tpl.pick");
    dlg.appendChild(h);
    var box = document.createElement("div");
    box.className = "nt-list";
    var cur = currentNbId();
    list.forEach(function (tp) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "nt-list-item";
      var nm = document.createElement("span");
      nm.textContent = tp.title !== "" ? tp.title : t("page.untitled");
      b.appendChild(nm);
      if (tp.nb !== cur) {
        var nbl = document.createElement("span");
        nbl.className = "nt-list-sub";
        nbl.textContent = nbNameOf(tp.nb);
        b.appendChild(nbl);
      }
      b.addEventListener("click", function () {
        closeUiDlg();
        var now = new Date();
        var suggest = MD.fillTemplate(tp.title, { date: MD.ymd(now), time: MD.hm(now), title: "" }).trim();
        askPrompt(t("tpl.ask"), suggest, t("page.untitled"), t("dlg.ok"), function (val) {
          var title = String(val || "").replace(/\s+/g, " ").trim() || t("page.untitled");
          var at = new Date();
          var text = MD.fillTemplate(tp.text, { date: MD.ymd(at), time: MD.hm(at), title: title });
          newPage(null, { title: title, text: text });
        });
      });
      box.appendChild(b);
    });
    dlg.appendChild(box);
    var row = document.createElement("div");
    row.className = "nt-list-actions";
    var c = document.createElement("button");
    c.type = "button";
    c.className = "nt-btn";
    c.textContent = t("dlg.cancel");
    c.addEventListener("click", closeUiDlg);
    row.appendChild(c);
    dlg.appendChild(row);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function openNodeMenu(page, x, y) {
    closeMenus();
    var menu = document.createElement("div");
    menu.id = "node-menu";

    // ---- Notebook actions (top of menu) ----
    var nb = currentNotebook();
    var nbActions = [
      [t("book.menu.title"), null],
      [t("book.rename"), function () {
        askPrompt(t("book.rename"), nb.name, "",
          t("dlg.ok"), function (val) {
            if (val && val.trim()) renameNotebook(nb.id, val.trim());
          });
      }],
      [t("book.delete"), function () {
        deleteNotebook(nb.id);
      }]
    ];

    nbActions.forEach(function (pair) {
      if (pair[1] === null) {
        // Separator/title row — styled by .node-menu-separator (notes.css)
        var sep = document.createElement("div");
        sep.className = "node-menu-separator";
        sep.textContent = pair[0];
        menu.appendChild(sep);
      } else {
        var b = document.createElement("button");
        b.className = "node-menu-item";
        b.textContent = pair[0];
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          closeMenus();
          pair[1]();
        });
        menu.appendChild(b);
      }
    });

    // Divider between notebook and page actions
    var hr = document.createElement("hr");
    hr.className = "node-menu-divider";
    menu.appendChild(hr);

    var actions = [
      [t("page.newchild"), function () { newPage(page.id); }],
      [t("page.rename"),   function () { renamePage(page.id); }],
      [t("page.move.up"),  function () { movePage(page.id, -1); }],
      [t("page.move.down"),function () { movePage(page.id, +1); }],
      [t("page.moveto"),   function () { askMoveTo(page); }],
      [page.pinned ? t("page.unpin") : t("page.pin"), function () { togglePin(page.id); }],
      [t("labels.title"),  function () { openLabelPicker(page, x, y); }],
      [t("tpl.new"),               function () { newFromTemplate(); }],
      [t("menu.exportPage"),       function () { exportPageTxt(page); }],
      [t("menu.exportPageMd"),     function () { exportPageMd(page); }],
      [t("menu.exportNotebook"),   function () { exportNotebookZip(true); }],
      [t("menu.exportNotebookMd"), function () { exportNotebookZip(true, true); }],
      [t("page.delete"),   function () { deletePage(page.id); }]
    ];
    if (shareApi()) actions.splice(actions.length - 1, 0, [t("page.share"), function () { sharePage(page); }]);
    actions.forEach(function (pair) {
      var b = document.createElement("button");
      b.className = "node-menu-item";
      b.textContent = pair[0];
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        closeMenus();
        pair[1]();
      });
      menu.appendChild(b);
    });

    document.body.appendChild(menu);
    clampToViewport(menu, x, y);
  }

  // -------- Label picker popover --------

  function openLabelPicker(page, x, y) {
    closeMenus();
    var box = document.createElement("div");
    box.id = "label-picker";

    var title = document.createElement("div");
    title.className = "lp-title";
    title.textContent = t("labels.title") + " · " +
      (page.title !== "" ? page.title : t("page.untitled"));
    box.appendChild(title);

    var nbLabels = state.labels.filter(function (l) { return l.nb === currentNbId(); });
    if (!nbLabels.length) {
      var none = document.createElement("div");
      none.className = "lp-none";
      none.textContent = t("labels.none");
      box.appendChild(none);
    } else {
      nbLabels
        .slice()
        .sort(function (a, b) { return a.pos - b.pos || a.name.localeCompare(b.name); })
        .forEach(function (lb) {
          box.appendChild(buildLabelRow(page, lb));
        });
    }

    // ---- New label area: input + swatches + Add ----
    var newArea = document.createElement("div");
    newArea.className = "lp-new";

    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("labels.new");
    input.maxLength = 40;
    newArea.appendChild(input);

    var swatches = document.createElement("div");
    swatches.className = "lp-swatches";
    var selColor = LABEL_COLORS[0];
    LABEL_COLORS.forEach(function (c, i) {
      var sw = document.createElement("button");
      sw.className = "lp-swatch" + (i === 0 ? " sel" : "");
      sw.style.background = c;
      sw.setAttribute("aria-label", c);
      sw.addEventListener("click", function () {
        selColor = c;
        Array.prototype.forEach.call(swatches.children, function (s) {
          s.classList.remove("sel");
        });
        sw.classList.add("sel");
      });
      swatches.appendChild(sw);
    });
    newArea.appendChild(swatches);

    var addBtn = document.createElement("button");
    addBtn.className = "lp-add";
    addBtn.textContent = t("labels.add");
    addBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      var lb = createLabel(name, selColor);
      toggleAttach(page, lb.id);           // create → attach immediately
      input.value = "";
      refreshPicker(page, lb.id);
    });
    newArea.appendChild(addBtn);

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addBtn.click(); }
      e.stopPropagation();
    });

    box.appendChild(newArea);
    document.body.appendChild(box);
    clampToViewport(box, x, y);
    if (!nbLabels.length) input.focus();
  }

  // Rebuilds the picker in place after create/attach/detach/delete —
  // keeps position and context, no flicker dance.
  function refreshPicker(page, focusLabelId) {
    var old = document.getElementById("label-picker");
    if (!old) return;
    var x = parseFloat(old.style.left) || 60;
    var y = parseFloat(old.style.top)  || 60;
    openLabelPicker(page, x, y);
    if (focusLabelId) {
      var el = document.querySelector('#label-picker .lp-item[data-lid="' + focusLabelId + '"]');
      if (el) el.focus();
    }
  }

  function buildLabelRow(page, lb) {
    var row = document.createElement("button");
    row.className = "lp-item" + ((page.labels || []).indexOf(lb.id) !== -1 ? " attached" : "");
    row.dataset.lid = lb.id;

    var dot = document.createElement("span");
    dot.className = "lp-dot";
    dot.style.background = lb.color;
    row.appendChild(dot);

    var name = document.createElement("span");
    name.className = "lp-name";
    name.textContent = lb.name;
    row.appendChild(name);

    var x = document.createElement("span");
    x.className = "lp-x";
    x.title = t("labels.confirm");
    x.innerHTML = X_SVG;
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      askConfirm(t("labels.confirm"), '"' + lb.name + '"',
        t("page.delete"), function () {
          deleteLabel(lb.id);
          refreshPicker(page, null);
        });
    });
    row.appendChild(x);

    row.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".lp-x")) return;
      toggleAttach(page, lb.id);
      refreshPicker(page, lb.id);
    });
    return row;
  }

  function createLabel(name, color) {
    var maxPos = 0;
    state.labels.forEach(function (l) { if (l.pos > maxPos) maxPos = l.pos; });
    var lb = { id: uid("l"), nb: currentNbId(), name: name, color: color, mtime: Date.now(), pos: maxPos + 1 };
    state.labels.push(lb);
    saveNow();
    markSyncDirty();
    return lb;
  }

  // Delete = label tombstone ("lbl:" prefix rides in the SAME
  // state.tombs map — Part 1 normalize keeps unknown-prefix entries
  // for 30 days). Merge drops any label whose tomb outweighs its
  // mtime; refs on pages get pruned by normalizeState. Deterministic
  // on both devices, no new top-level field.
  function deleteLabel(id) {
    state.tombs["lbl:" + id] = Date.now();
    state.labels = state.labels.filter(function (l) { return l.id !== id; });
    state.pages.forEach(function (p) {
      var idx = (p.labels || []).indexOf(id);
      if (idx !== -1) { p.labels.splice(idx, 1); touchStruct(p); }
    });
    saveNow();
    markSyncDirty();
    renderAll();
    notifyTransient(t("labels.deleted")); // v0.35.00 fix: correct message for LABEL deletion
  }

  function toggleAttach(page, labelId) {
    if (!page.labels) page.labels = [];
    var idx = page.labels.indexOf(labelId);
    if (idx === -1) page.labels.push(labelId);
    else page.labels.splice(idx, 1);
    page.labels.sort();                     // deterministic serialization
    touchStruct(page);
    saveNow();
    markSyncDirty();
        renderAll();     // v0.14.1: chips must refresh too, not just tree dots
  }

  // ---------- 7. Merge engine (pages + labels, deterministic) ----------
  function pickByLWW(l, r, keyFn) {
    var ls = JSON.stringify(l), rs = JSON.stringify(r);
    if (ls === rs) return l;
    return keyFn(r) > keyFn(l) ? r : (keyFn(l) > keyFn(r) ? l :
           (ls < rs ? l : r));             // tie → lexicographic JSON
  }
  function byPosId(x, y) {
    return ((x.pos || 0) - (y.pos || 0)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  }

  // NO-2 — ONE canonical form (R26), used by the getter AND the merge:
  // fixed key order per entity, fixed list order, one tombstone rule.
  // (The getter used to hand over the lists in whatever order this
  // device held them while the merge returned them sorted, and each
  // side pruned tombstones by a different rule — the same data could
  // differ from itself, which costs uploads and "1 section updated".)
  function canonEntity(src, keys) {
    var out = {}, i;
    for (i = 0; i < keys.length; i++) if (src[keys[i]] !== undefined) out[keys[i]] = src[keys[i]];
    Object.keys(src).sort().forEach(function (k) {
      if (out[k] === undefined && src[k] !== undefined) out[k] = src[k];
    });
    return out;
  }
  var NB_KEYS    = ["id", "name", "mtime", "pos"];
  var LABEL_KEYS = ["id", "nb", "name", "color", "mtime", "pos"];
  var PAGE_KEYS  = ["id", "nb", "parent", "title", "text", "mtime", "pos", "labels", "pinned", "ct", "st", "h", "hx", "cf"];

  function canonTombs(tombs, notebooks, pages, labels) {
    var alive = {}, maxTs = 0, src = tombs || {}, out = {};
    (pages || []).forEach(function (p) { alive[p.id] = true; if ((p.mtime || 0) > maxTs) maxTs = p.mtime; });
    (labels || []).forEach(function (l) { alive["lbl:" + l.id] = true; if ((l.mtime || 0) > maxTs) maxTs = l.mtime; });
    (notebooks || []).forEach(function (n) { alive["nb:" + n.id] = true; if ((n.mtime || 0) > maxTs) maxTs = n.mtime; });
    Object.keys(src).forEach(function (k) { if ((src[k] || 0) > maxTs) maxTs = src[k]; });
    var cutoff = maxTs - TOMB_PRUNE_DAYS * DAY_MS;
    Object.keys(src).sort().forEach(function (k) {
      if (alive[k]) return;                       // it lives: the tomb is history
      if ((src[k] || 0) < cutoff) return;         // older than 30 days of DATA time
      out[k] = src[k];
    });
    return out;
  }

  function canonNotes(d) {
    d = d || {};
    var pages = (d.pages || []).filter(function (p) { return p && typeof p.id === "string"; });
    var labels = (d.labels || []).filter(function (l) { return l && typeof l.id === "string"; });
    var used = {};
    pages.forEach(function (p) { used[p.nb] = true; });
    labels.forEach(function (l) { used[l.nb] = true; });
    var notebooks = (d.notebooks || []).filter(function (n) {
      if (!n || typeof n.id !== "string") return false;
      // NO-1: the untouched seed is nobody's data.
      if (n.id === SEED_NB_ID && !(n.mtime > 0) && !used[n.id]) return false;
      return true;
    });
    notebooks = notebooks.map(function (n) { return canonEntity(n, NB_KEYS); }).sort(byPosId);
    labels = labels.map(function (l) { return canonEntity(l, LABEL_KEYS); }).sort(byPosId);
    pages = pages.map(function (p) {
      var c = canonEntity(p, PAGE_KEYS);
      c.labels = (Array.isArray(c.labels) ? c.labels.slice() : []).sort();
      c.pinned = !!c.pinned;
      // Both clocks are always spelled out (a page written by older
      // code has none; one last touched by older code has stale
      // ones) — the same page reads the same from every side.
      var old = touchedByOldCode(c);
      var cs = contentStamp(c), ss = structStamp(c);
      if (old) { delete c.h; delete c.hx; }
      c.ct = cs;
      c.st = ss;
      return canonEntity(c, PAGE_KEYS);
    }).sort(function (x, y) {
      return ((x.mtime || 0) - (y.mtime || 0)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    });
    return {
      ver: DATA_VER,
      notebooks: notebooks,
      pages: pages,
      labels: labels,
      tombs: canonTombs(d.tombs, notebooks, pages, labels)
    };
  }

  // NO-3 — is `older` a version that `newer` was written on top of?
  //   · no history on the newer one (written by older code) → yes
  //     (the behavior before this change);
  //   · its content stamp is in the history → yes;
  //   · older than everything in a COMPLETE history → yes;
  //   · otherwise it is a different edit of something earlier.
  function descendsFrom(newer, older) {
    if (!Array.isArray(newer.h) || touchedByOldCode(newer)) return true;
    var oc = contentStamp(older);
    if (newer.h.indexOf(oc) !== -1) return true;
    if (!newer.hx) {
      var min = Infinity;
      for (var i = 0; i < newer.h.length; i++) if (newer.h[i] < min) min = newer.h[i];
      if (oc < min) return true;
    }
    return false;
  }

  // Two versions of ONE page → one page (+ possibly the other text,
  // kept as a conflict copy).
  // Tie-break key for two structures with the SAME stamp: first the
  // fields the merge never rewrites, then notebook and parent (which
  // it may repair afterwards).
  function structKey(p) {
    return JSON.stringify([p.pos, (Array.isArray(p.labels) ? p.labels.slice().sort() : []), !!p.pinned]) +
           "|" + JSON.stringify([p.nb, (p.parent === undefined ? null : p.parent)]);
  }
  function mergePage(x, y, copies) {
    var sx = JSON.stringify(x), sy = JSON.stringify(y);
    if (sx === sy) return x;
    // Structure: newer st; on a tie the smaller key of the STRUCTURE
    // fields only (a whole-object tie-break would change its answer
    // once the content of the other side was folded in).
    var stx = structStamp(x), sty = structStamp(y), S;
    if (stx !== sty) S = (stx > sty) ? x : y;
    else S = (structKey(x) <= structKey(y)) ? x : y;
    var cx = contentStamp(x), cy = contentStamp(y), C;
    if (cx !== cy) C = (cx > cy) ? x : y;                                 // content
    else {
      var kx = JSON.stringify([x.title, x.text]), ky = JSON.stringify([y.title, y.text]);
      C = (kx === ky) ? S : (kx < ky ? x : y);
    }
    var other = (C === x) ? y : x;
    var out = {};
    Object.keys(S).forEach(function (k) { out[k] = S[k]; });
    out.title = C.title;
    out.text  = C.text;
    out.mtime = Math.max(x.mtime || 0, y.mtime || 0);
    // Both clocks are written out from the effective stamps, so the
    // result never depends on which side it is merged with again
    // (and mtime == max(ct, st): it does not look "touched by old code").
    out.ct = contentStamp(C);
    out.st = structStamp(S);
    if (Array.isArray(C.h) && !touchedByOldCode(C)) out.h = C.h.slice(); else delete out.h;
    if (C.hx && !touchedByOldCode(C)) out.hx = 1; else delete out.hx;
    if (C.cf) out.cf = 1; else delete out.cf;
    if ((other.text || "") !== (C.text || "") && (other.text || "") !== "" &&
        !descendsFrom(C, other)) {
      var oc = contentStamp(other);
      copies.push({
        id: x.id + "~c" + oc, nb: out.nb, parent: (out.parent === undefined ? null : out.parent),
        title: other.title, text: other.text, mtime: oc, pos: out.pos,
        labels: Array.isArray(other.labels) ? other.labels.slice() : [],
        pinned: false, ct: oc, cf: 1
      });
    }
    return out;
  }

  function mergeNotesStates(a, b) {
    if (!a && !b) return null;
    a = a || { ver: DATA_VER, notebooks: [], pages: [], labels: [], tombs: {} };
    b = b || { ver: DATA_VER, notebooks: [], pages: [], labels: [], tombs: {} };

    // -- Tombs: union, max ts (pages, "lbl:", "nb:") --
    var tombs = {};
    var keys = {};
    Object.keys(a.tombs || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(b.tombs || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var ta = (a.tombs || {})[k] || 0;
      var tb = (b.tombs || {})[k] || 0;
      tombs[k] = Math.max(ta, tb);
    });

    // -- Notebooks: per-id LWW, then tomb-drop --
    var nbMap = {};
    [].concat(a.notebooks || [], b.notebooks || []).forEach(function (n) {
      if (!n || typeof n.id !== "string") return;
      nbMap[n.id] = nbMap[n.id]
        ? pickByLWW(nbMap[n.id], n, function (x) { return x.mtime || 0; })
        : n;
    });
    var notebooks = Object.keys(nbMap).map(function (k) { return nbMap[k]; })
      .filter(function (n) {
        var tomb = tombs["nb:" + n.id];
        return !(typeof tomb === "number" && tomb >= (n.mtime || 0));
      })
      .sort(byPosId);

    // v0.35.04 SALVAGE TARGET: pages / labels without a living notebook
    // are ADOPTED by the first notebook (lowest pos, then id) instead
    // of being dropped. NO-1: the untouched seed is not a target while
    // any real notebook exists (it would be dropped right after).
    var real = notebooks.filter(function (n) { return !(n.id === SEED_NB_ID && !(n.mtime > 0)); });
    var fallbackNb = (real.length ? real : notebooks)[0];
    if (!fallbackNb) {
      // Degenerate: pages exist but no notebook survived on EITHER
      // side — enforce the app's "always >= 1 notebook" invariant.
      fallbackNb = { id: SEED_NB_ID, name: "Notes", mtime: 0, pos: 0 };
      notebooks = [fallbackNb];
    }
    var fallbackNbId = fallbackNb.id;

    // -- Labels: per-id LWW, then tomb-drop --
    var notebookIdsInMerge = {};
    notebooks.forEach(function (n) { notebookIdsInMerge[n.id] = true; });
    var labelMap = {};
    [].concat(a.labels || [], b.labels || []).forEach(function (l) {
      if (!l || typeof l.id !== "string") return;
      // nb salvage first (schema-old peers send no nb), on a copy —
      // same reason as for pages below.
      if (!notebookIdsInMerge[l.nb]) {
        var lf = {};
        Object.keys(l).forEach(function (k) { lf[k] = l[k]; });
        lf.nb = fallbackNbId;
        l = lf;
      }
      labelMap[l.id] = labelMap[l.id]
        ? pickByLWW(labelMap[l.id], l, function (x) { return x.mtime || 0; })
        : l;
    });
    var labels = Object.keys(labelMap).map(function (k) { return labelMap[k]; })
      .filter(function (l) {
        var tomb = tombs["lbl:" + l.id];
        return !(typeof tomb === "number" && tomb >= (l.mtime || 0));
      });
    var labelIdsInMerge = {};
    labels.forEach(function (l) { labelIdsInMerge[l.id] = true; });

    // -- Pages: per id, structure by mtime + content by ct (NO-3) --
    var pageMap = {}, copies = [];
    [].concat(a.pages || [], b.pages || []).forEach(function (p) {
      if (!p || typeof p.id !== "string") return;
      // nb salvage BEFORE the two versions are compared: a dead
      // notebook reference must not take part in a tie-break and then
      // be rewritten afterwards.
      if (!notebookIdsInMerge[p.nb]) {
        var fixed = {};
        Object.keys(p).forEach(function (k) { fixed[k] = p[k]; });
        fixed.nb = fallbackNbId;
        p = fixed;
      }
      pageMap[p.id] = pageMap[p.id] ? mergePage(pageMap[p.id], p, copies) : p;
    });
    copies.forEach(function (c) { if (!pageMap[c.id]) pageMap[c.id] = c; });
    var pages = Object.keys(pageMap).map(function (k) { return pageMap[k]; })
      .filter(function (p) {
        var tomb = tombs[p.id];
        return !(typeof tomb === "number" && tomb >= (p.mtime || 0));
      })
      .map(function (p) {
        var c = {}; Object.keys(p).forEach(function (k) { c[k] = p[k]; });
        if (!notebookIdsInMerge[c.nb]) c.nb = fallbackNbId;     // nb salvage
        if (typeof c.pinned !== "boolean") c.pinned = false;
        // Dead label refs never survive
        c.labels = (c.labels || []).filter(function (lid) { return labelIdsInMerge[lid]; });
        return c;
      });
    // A page whose parent is gone, or sits in another notebook, moves
    // to the top level — same rule as normalizeState, applied here so
    // the merge result is already what the app will store.
    var byId = {};
    pages.forEach(function (p) { byId[p.id] = p; });
    pages.forEach(function (p) {
      if (p.parent === undefined) p.parent = null;
      if (p.parent !== null && (!byId[p.parent] || byId[p.parent].nb !== p.nb)) p.parent = null;
    });

    return canonNotes({ ver: DATA_VER, notebooks: notebooks, pages: pages, labels: labels, tombs: tombs });
  }

  // ---------- 8. Sync slice registration ----------
  function sliceGet() {
    // Canonical deep copy (NO-2) — never the live objects: the engine
    // stringifies for comparison, a live reference would race the
    // debounce timer mid-edit.
    // Whatever was edited up to here is about to be compared with, or
    // sent to, the cloud: the next edit starts a new ancestry step.
    editedSinceSync = {};
    return canonNotes(JSON.parse(JSON.stringify({
      ver: state.ver, notebooks: state.notebooks,
      pages: state.pages, labels: state.labels, tombs: state.tombs
    })));
  }

  function sliceSet(data, info) {
    if (!data || typeof data !== "object") return;
    var incoming = JSON.stringify(canonNotes(data));
    var mine = JSON.stringify(canonNotes({
      ver: state.ver, notebooks: state.notebooks, pages: state.pages,
      labels: state.labels, tombs: state.tombs
    }));
    if (incoming === mine) return;          // echo suppression — no re-render/toast
    var hadCopies = {};
    state.pages.forEach(function (p) { if (p.cf) hadCopies[p.id] = true; });
    state.ver       = DATA_VER;
    state.notebooks = Array.isArray(data.notebooks) ? data.notebooks : [];
    state.pages     = Array.isArray(data.pages)     ? data.pages     : [];
    state.labels = Array.isArray(data.labels) ? data.labels : [];
    state.tombs  = (data.tombs && typeof data.tombs === "object") ? data.tombs : {};
    normalizeState();
    saveNow();
    // What is stored now is what the cloud knows: the next local edit
    // of any page starts a new ancestry step (NO-3).
    editedSinceSync = {};
    // Deleted current page (or its notebook)? Re-anchor selection
    // within the CURRENT notebook — editor and tree never disagree.
    var cur = pageById(prefs.current);
    var nbId = currentNbId();
    if (!cur || cur.nb !== nbId) {
      var first = state.pages.filter(function (p) { return p.nb === nbId; })[0];
      prefs.current = (first && first.id) || null;
    }
    savePrefs();
    renderAll();
    // NO-3: a page was edited on two devices — say that both texts
    // are here (the copy sits next to the page, marked in the tree).
    var newCopy = state.pages.some(function (p) { return p.cf && !hadCopies[p.id]; });
    if (newCopy) notifyTransient(t("toast.conflict"));
    if (info && info.merged) {
      // #38: push the merged state back only when it really differs
      // from what came in — compared in canonical form (the stored
      // lists are in this device's order; comparing them raw called
      // every merge "different" and cost an upload each time).
      var after = JSON.stringify(canonNotes({
        ver: state.ver, notebooks: state.notebooks, pages: state.pages,
        labels: state.labels, tombs: state.tombs
      }));
      if (after !== incoming) markSyncDirty();
    }
  }

  function registerNotesSlice() {
    var api = syncApi();
    
    // CRITICAL: retry if orosSync isn't ready yet (race condition fix)
    // This happens when shell.js loads before orosSync is fully initialized.
    if (api && typeof api.registerSlice === "function") {
      api.registerSlice("notes", sliceGet, sliceSet, STORAGE_KEY, mergeNotesStates);
      console.log('[notes] Slice registered successfully');
      return;
    }
    
    // Retry for up to 5 seconds — shell may still be booting
    console.warn('[notes] orosSync not ready yet, retrying for 5s...');
    var attempts = 0;
    var maxAttempts = 50; // 50 × 100ms = 5s
    
    var retryTimer = setInterval(function () {
      attempts++;
      api = syncApi();
      
      if (api && typeof api.registerSlice === "function") {
        clearInterval(retryTimer);
        api.registerSlice("notes", sliceGet, sliceSet, STORAGE_KEY, mergeNotesStates);
        console.log('[notes] Slice registered after ' + attempts + ' retries');
        return;
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(retryTimer);
        console.error('[notes] CRITICAL: orosSync never became available — sync WILL FAIL');
        console.error('[notes] Check shell.js boot order and sync.js initialization');
      }
    }, 100);
  }

  // ---------- 9. Wiring & boot ----------

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function loadPrefs() {
    try {
      var raw = JSON.parse(localStorage.getItem(PREFS_KEY));
      if (raw && typeof raw === "object") {
        prefs.open       = (raw.open && typeof raw.open === "object") ? raw.open : {};
        prefs.current    = (typeof raw.current === "string") ? raw.current : null;
        prefs.currentNb  = (typeof raw.currentNb === "string") ? raw.currentNb : null;
        prefs.width      = (typeof raw.width === "number" && raw.width >= 200 && raw.width <= 480)
                           ? raw.width : 270;
        prefs.view       = (raw.view === "preview" || raw.view === "split") ? raw.view : "edit";
      }
    } catch (e) {}
    if (prefs.current && !pageByIdQuick(prefs.current)) prefs.current = null;
  }
  function pageByIdQuick(id) {
    try {
      var d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return !!(d && d.pages && d.pages.some(function (p) { return p.id === id; }));
    } catch (e) { return false; }
  }
  
      // Notebook selector
    var nbSel = document.getElementById("nb-selector");
    if (nbSel) {
      nbSel.addEventListener("change", function () {
        var newNbId = nbSel.value;
        if (newNbId !== prefs.currentNb) {
          prefs.currentNb = newNbId;
          var cur = pageById(prefs.current);
          if (!cur || cur.nb !== newNbId) {
            var first = state.pages.filter(function (p) { return p.nb === newNbId; })[0];
            prefs.current = (first && first.id) || null;
          }
          savePrefs();
          renderAll();
        }
      });
      // NO-6: the notebook menu (rename / delete) existed only as the
      // RIGHT-CLICK menu of the selector — no touch screen can open
      // that. A small button next to the selector opens the same menu.
      var nbMore = document.createElement("button");
      nbMore.id = "btn-nb-menu";
      nbMore.type = "button";
      nbMore.className = "icon-btn";
      nbMore.title = t("book.menu.open");
      nbMore.setAttribute("aria-label", t("book.menu.open"));
      nbMore.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
      nbMore.addEventListener("click", function (e) {
        e.stopPropagation();
        if (document.getElementById("node-menu")) { closeMenus(); return; }
        var r = nbMore.getBoundingClientRect();
        openNbMenu(r.left, r.bottom + 4);
      });
      if (nbSel.parentNode) {
        nbSel.parentNode.style.display = "flex";
        nbSel.parentNode.style.alignItems = "center";
        nbSel.parentNode.style.gap = "4px";
        nbSel.style.flex = "1 1 auto";
        nbSel.style.minWidth = "0";
        nbSel.parentNode.appendChild(nbMore);
      }
      // Context menu for notebook actions
      nbSel.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openNbMenu(e.clientX, e.clientY);
      });
    }
    function openNbMenu(menuX, menuY) {
      {
        var nb = currentNotebook();
        if (!nb) return;
        
        closeMenus();   // v0.35.03 fix: kill any open #node-menu — prevents duplicate-id stale menu
        
        // REUSE #node-menu styling — no inline cssText (design system parity)
        var menu = document.createElement("div");
        menu.id = "node-menu"; 
        
        var actions = [
          [t("book.menu.title"), null],
          [t("book.rename"), function () {
            askPrompt(t("book.rename"), nb.name, "",
              t("dlg.ok"), function (val) {
                if (val && val.trim()) {
                  renameNotebook(nb.id, val.trim());
                }
              });
          }],
          [t("book.delete"), function () {
            deleteNotebook(nb.id);
          }]
        ];
        if (IMP) actions.push([t("imp.btn"), openImport]);
        
        actions.forEach(function (pair) {
          if (pair[1] === null) {
            var sep = document.createElement("div");
            sep.className = "node-menu-separator";
            sep.textContent = pair[0];
            menu.appendChild(sep);
          } else {
            var b = document.createElement("button");
            b.className = "node-menu-item";
            b.textContent = pair[0];
            b.addEventListener("click", function () {
              menu.remove();
              pair[1]();
            });
            menu.appendChild(b);
          }
        });
        
        document.body.appendChild(menu);
        clampToViewport(menu, menuX, menuY);   // #11: on-screen always
        
        // Close on outside click
        setTimeout(function () {
          document.addEventListener("click", function closeMenu(ev) {
            if (!menu.contains(ev.target)) {
              menu.remove();
              document.removeEventListener("click", closeMenu);
            }
          }, { once: true });
        }, 0);
      }
    }

  function initSplitter() {
    var sp = document.getElementById("pane-splitter");
    var tp = document.getElementById("tree-pane");
    if (!sp || !tp) return;

    function setWidth(w) {
      w = Math.max(200, Math.min(480, w));
      prefs.width = w;
      tp.style.flexBasis = w + "px";
    }
    setWidth(prefs.width);

    var dragging = false;
    sp.addEventListener("pointerdown", function (e) {
      dragging = true;
      sp.classList.add("dragging");
      document.body.classList.add("resizing");
      sp.setPointerCapture && sp.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    sp.addEventListener("pointermove", function (e) {
      if (dragging) setWidth(e.clientX);
    });
    sp.addEventListener("pointerup", function () {
      dragging = false;
      sp.classList.remove("dragging");
      document.body.classList.remove("resizing");
      savePrefs();
    });
  }

  function wireUI() {
	      paintStaticIcons();
    var shareBtn = document.getElementById("btn-share-page");
    if (shareBtn) shareBtn.addEventListener("click", function () { sharePage(pageById(prefs.current)); });
    var showTree = document.getElementById("btn-show-tree");
    if (showTree) {
      showTree.addEventListener("click", function () {
        document.getElementById("notes-app").classList.toggle("tree-open");
      });
    }
    // Phones: a tap on the editor beside the open page-list drawer closes it
    var edPane = document.getElementById("editor-pane");
    if (edPane) {
      edPane.addEventListener("click", function (e) {
        var app = document.getElementById("notes-app");
        if (!app.classList.contains("tree-open") || window.innerWidth >= 720) return;
        app.classList.remove("tree-open");
        e.preventDefault();
        e.stopPropagation();
      }, true);
    }

    var newBtn = document.getElementById("btn-new-page");
    if (newBtn) newBtn.addEventListener("click", function () { newPage(null); });

    // ---- Runtime-injected tree-footer buttons ----
    // v0.15.0: export notebook (ZIP)
    // v0.16.0: search + tags panel
    if (newBtn && newBtn.parentNode) {
      var SEARCH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      var DL_SVG     = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      var TAG_SVG    = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';

      // Search ← before +
      var seBtn = document.createElement("button");
      seBtn.id = "btn-search";
      seBtn.type = "button";
      seBtn.className = "icon-btn";
      seBtn.title = t("search.placeholder");
      seBtn.setAttribute("aria-label", t("search.placeholder"));
      seBtn.innerHTML = SEARCH_SVG;
      seBtn.addEventListener("click", function () { openSearch(); });
      newBtn.parentNode.insertBefore(seBtn, newBtn);

      // Export → if single notebook, straight to current export (no menu)
      var exBtn = document.createElement("button");
      exBtn.id = "btn-export-notebook";
      exBtn.type = "button";
      exBtn.className = "icon-btn";
      exBtn.title = t("menu.export");
      exBtn.setAttribute("aria-label", t("menu.export"));
      exBtn.innerHTML = DL_SVG;
      exBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        closeMenus();
        var menu = document.createElement("div");
        menu.id = "node-menu";
        var choices = [["menu.exportCurrent", true, false], ["menu.exportCurrentMd", true, true]];
        if (state.notebooks.length > 1) choices.push(["menu.exportAll", false, false], ["menu.exportAllMd", false, true]);
        var curPage = pageById(prefs.current);
        if (curPage) choices.push(["menu.exportPage", null, false], ["menu.exportPageMd", null, true]);
        choices.forEach(function (pair) {
          var b = document.createElement("button");
          b.className = "node-menu-item";
          b.textContent = t(pair[0]);
          b.addEventListener("click", function (ev) {
            ev.stopPropagation();
            closeMenus();
            if (pair[1] === null) { if (pair[2]) exportPageMd(curPage); else exportPageTxt(curPage); }
            else exportNotebookZip(pair[1], pair[2]);
          });
          menu.appendChild(b);
        });
        document.body.appendChild(menu);
        var r = exBtn.getBoundingClientRect();
        clampToViewport(menu, r.left, r.bottom + 6);
      });
      newBtn.parentNode.insertBefore(exBtn, newBtn.nextSibling);

      // Import notes from other apps, right after export
      if (IMP) {
        var imBtn = document.createElement("button");
        imBtn.id = "btn-import-notes";
        imBtn.type = "button";
        imBtn.className = "icon-btn";
        imBtn.title = t("imp.btn");
        imBtn.setAttribute("aria-label", t("imp.btn"));
        imBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
        imBtn.addEventListener("click", function (e) { e.stopPropagation(); openImport(); });
        newBtn.parentNode.insertBefore(imBtn, exBtn.nextSibling);
      }

      // New page from template (Markdown wave), right after +
      var tpBtn = document.createElement("button");
      tpBtn.id = "btn-template";
      tpBtn.type = "button";
      tpBtn.className = "icon-btn";
      tpBtn.title = t("tpl.new");
      tpBtn.setAttribute("aria-label", t("tpl.new"));
      tpBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
      tpBtn.addEventListener("click", function (e) { e.stopPropagation(); newFromTemplate(); });
      newBtn.parentNode.insertBefore(tpBtn, exBtn);

      // Tags
      var tgBtn = document.createElement("button");
      tgBtn.id = "btn-tag-panel";
      tgBtn.type = "button";
      tgBtn.className = "icon-btn";
      tgBtn.title = t("tags.all");
      tgBtn.setAttribute("aria-label", t("tags.all"));
      tgBtn.innerHTML = TAG_SVG;
      tgBtn.addEventListener("click", toggleTagPanel);
      newBtn.parentNode.appendChild(tgBtn);

      // New notebook → last, distinct book+plus icon (task #2)
      var BOOKPLUS_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>';
      var nbBtn = document.createElement("button");
      nbBtn.id = "btn-new-notebook";
      nbBtn.type = "button";
      nbBtn.className = "icon-btn";
      nbBtn.title = t("book.plusTitle");
      nbBtn.setAttribute("aria-label", t("book.plusTitle"));
      nbBtn.innerHTML = BOOKPLUS_SVG;
      nbBtn.addEventListener("click", function () {
        askPrompt(t("book.new"), t("book.default"), t("book.default"),
          t("dlg.ok"), function (val) {
            if (val && val.trim()) {
              createNotebook(val.trim());
            }
          });
      });
      newBtn.parentNode.appendChild(nbBtn);

      // Import from Notion (wave 6D): only inside the orOS shell
      if (PLAT && PLAT.has()) {
        PLAT.init({ lang: LANG, data: function () { return state; }, apply: platformApply });
        var CLOUD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/><polyline points="9.5 13.5 12 16 14.5 13.5"/><line x1="12" y1="10" x2="12" y2="16"/></svg>';
        var ntBtn = document.createElement("button");
        ntBtn.id = "btn-notion";
        ntBtn.type = "button";
        ntBtn.className = "icon-btn";
        ntBtn.title = PLAT.label();
        ntBtn.setAttribute("aria-label", PLAT.label());
        ntBtn.innerHTML = CLOUD_SVG;
        ntBtn.addEventListener("click", function (e) { e.stopPropagation(); closeMenus(); PLAT.open(); });
        newBtn.parentNode.appendChild(ntBtn);
      }
    }

    var title = document.getElementById("page-title");
    if (title) {
      title.addEventListener("input", function () {
        var p = pageById(prefs.current);
        if (!p) return;
        p.title = title.value;
        touchContent(p);
        queueSave(p.id);
        renderTree();
      });
    }

    var text = document.getElementById("page-text");
    if (text) {
      text.addEventListener("input", function () {
        var p = pageById(prefs.current);
        if (!p) return;
        p.text  = text.value;
        touchContent(p);
        queueSave(p.id);
        queueLinksStrip();     // chips follow the typing (debounced)
        queuePreview();        // side by side: the preview too
      });
      // Ctrl/Cmd+B, Ctrl/Cmd+I: bold and italic (Markdown wave)
      text.addEventListener("keydown", function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        var k = e.key && e.key.toLowerCase();
        if (k === "b" || k === "i") { e.preventDefault(); applyFormat(k === "b" ? "bold" : "italic"); }
      });
    }

    // Today (daily note) in the editor header, next to the title
    var header = document.getElementById("editor-header");
    if (header && !document.getElementById("btn-today")) {
      var todayBtn = document.createElement("button");
      todayBtn.id = "btn-today";
      todayBtn.type = "button";
      todayBtn.className = "icon-btn";
      todayBtn.title = t("daily.title");
      todayBtn.setAttribute("aria-label", t("daily.title"));
      todayBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="8" y="14" width="3" height="3" rx=".5"/></svg>';
      todayBtn.addEventListener("click", function (e) { e.stopPropagation(); openToday(); });
      var shareRef = document.getElementById("btn-share-page");
      header.insertBefore(todayBtn, shareRef || null);
    }
    // Page actions (⋮) in the editor header: the tree menu (rename, move,
    // delete…) is otherwise reachable only by right-click or long-press in
    // the drawer, which phones hide and draggable rows can swallow.
    if (header && !document.getElementById("btn-page-menu")) {
      var pmBtn = document.createElement("button");
      pmBtn.id = "btn-page-menu";
      pmBtn.type = "button";
      pmBtn.className = "icon-btn";
      pmBtn.title = t("page.actions");
      pmBtn.setAttribute("aria-label", t("page.actions"));
      pmBtn.setAttribute("aria-haspopup", "menu");
      pmBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
      pmBtn.hidden = !pageById(prefs.current);
      pmBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var page = pageById(prefs.current);
        if (!page) return;
        if (document.getElementById("node-menu")) { closeMenus(); return; }
        var r = pmBtn.getBoundingClientRect();
        openNodeMenu(page, r.right, r.bottom);
      });
      header.appendChild(pmBtn);
    }
    buildToolbar();
    wirePreview();
    applyView();

    // Outside-click closes menus (menus stopPropagation internally)
    document.addEventListener("click", function (e) {
      if (!e.target.closest || (!e.target.closest("#node-menu") && !e.target.closest("#label-picker"))) {
        closeMenus();
      }
      // v0.16.0: floating views close on outside click / backdrop
      var tp = document.getElementById("tag-panel");
      if (tp && (!e.target.closest || !e.target.closest("#tag-panel"))) {
        var pb = document.getElementById("btn-tag-panel");
        if (!(pb && pb.contains(e.target))) tp.remove();
      }
      var so = document.getElementById("search-overlay");
      if (so && e.target === so) so.remove();
    });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === "Escape") { closeMenus(); closeFloating(); }
    });
	
	// Contract Β: shell-owned combos (Ctrl+Alt+Shift+*) — canonical
    // capture-phase forwarding (parity with todo/kanban/writer).
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = window.parent;
      if (!(p && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);

    // Last-chance flush before tab death
    window.addEventListener("beforeunload", flushSave);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushSave();
    });
  }

  // ---------- Boot ----------
  // BOOT MARKER (Bible Part VII §16 + Checklist F): stale-bundle
  // detection (R3/R11). Printed BEFORE any heavy work so a stalled
  // boot is instantly visible in the console.
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    console.log("notes.js v" + (m ? m[1] : "?") + " boot");
  })();

  loadPrefs();
  loadData();
  applyI18n();
  inheritPalette();
  renderAll();
  registerNotesSlice();
  wireUI();
  attachTreeDnD();     // #5: tree drag & drop (guard: attach once)
  initSplitter();
  watchPalette();

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { page, nb }. Switches to the page's notebook, opens its
  // ancestors in the tree and selects it. Unknown page → no-op.
  // Target { add: { title, text } } (another app's "Save as note"):
  // a new top-level page in the current notebook, plain text only.
  // Target { newPage: true } (the phone's home-screen widget): a new
  // empty page, its title ready to type.
  // Target { openFile: { token } }: a .txt / .md file from the
  // system's "Open with" or Android's Share (shell fileopen.js), taken
  // once from the shell: a new page titled after the file, its text
  // as is (plain text, never markup).
  var FILE_MAX = 200000;
  function openFileTarget(o) {
    var f = null;
    try {
      var w = window.parent;
      if (o && typeof o.token === "string" && w && w !== window && typeof w.__orosTakeFile === "function")
        f = w.__orosTakeFile(o.token);
    } catch (e) { f = null; }
    if (!f) return;
    if (f.size > FILE_MAX * 4) { notifyTransient(t("toast.fileBig")); return; }
    f.text().then(function (txt) {
      txt = String(txt).replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
      if (txt.length > FILE_MAX) { notifyTransient(t("toast.fileBig")); return; }
      var title = String(f.name || "").replace(/\.(txt|md|markdown)$/i, "").replace(/\s+/g, " ").trim().slice(0, 200);
      newPage(null, { title: title || t("page.untitled"), text: txt });
    }, function () { notifyTransient(t("toast.fileRead")); });
  }
  function openSearchTarget(t) {
    if (t && t.openFile) { openFileTarget(t.openFile); return; }
    if (t && t.newPage === true) { newPage(null); return; }   // the phone's home-screen widget: "+ Note"
    if (t && t.add && typeof t.add === "object") {
      var nt = String(t.add.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
      var nx = String(t.add.text || "").slice(0, 20000);
      if (nt || nx) newPage(null, { title: nt, text: nx });
      return;
    }
    var p = t && typeof t.page === "string" ? pageById(t.page) : null;
    if (!p) return;
    revealPage(p);
  }
  window.__orosOpenAt = openSearchTarget;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("notes");
      if (pendingTarget) openSearchTarget(pendingTarget);
    }
  } catch (e) {}

  // Console debugging handle (Lesson 4 culture)
  window.__notesDebug = {
    version: APP_VERSION,
    state: state,
    merge: mergeNotesStates,
    canon: canonNotes,
    sliceGet: sliceGet
  };
})();