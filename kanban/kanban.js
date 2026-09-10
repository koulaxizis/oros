// ============================================================
// orOS Kanban — App logic (v0.5)
// Νέο στο v0.5 (cross-device MERGE — προσαρμογή προτύπου todo.js v0.4):
//   - Κάθε οντότητα (στήλη / κάρτα / ετικέτα) φέρει mtime (έκδοση
//     περιεχομένου) + pos; κάθε στήλη φέρει om (έκδοση σειράς των
//     καρτών της) και η ρίζα φέρει om (έκδοση σειράς στηλών).
//     Κάθε μεταβολή δημιουργεί stamp.
//   - Soft deletes: state.deleted = { [id]: ts } tombstones,
//     καθαρίζονται (pruned) μετά από 30 ημέρες. Η διαγραφή μιας
//     στήλης προκαλεί τη δημιουργία tombstones σε όλες τις κάρτες
//     της (κλιμακούμενη — cascade); μια κάρτα της οποίας η
//     τοποθέτηση στη στήλη έχει αφαιρεθεί, παραμένει νεκρή
//     (κανόνας orphan — χωρίς κρυφή επαναφορά).
//   - mergeKanbanStates(local, remote): deterministic, symmetric —
//     και οι δύο συσκευές υπολογίζουν το ΙΔΙΟ συγκλίνων αποτέλεσμα.
//       · περιεχόμενο κάρτας — μεγαλύτερο mtime κερδίζει (σε
//         ισοβαθμία → λεξικογραφικό JSON); η ΚΕΡΔΙΖΟΥΣΑ πλευρά
//         καθορίζει τη στήλη τοποθέτησης της κάρτας (σε ισοβαθμία →
//         μικρότερο id στήλης — συμμετρικό)
//       · επικεφαλίδες στηλών — LWW βάσει mtime, δομικά: οι
//         αλλαγές στην επικεφαλίδα δεν αντικαθιστούν (clobber) τις
//         αλλαγές των καρτών από την άλλη πλευρά
//       · σειρά τοποθέτησης — το ριζικό om καθορίζει τη σειρά των
//         στηλών, το om της στήλης καθορίζει τη σειρά των καρτών
//         (σε ισοβαθμία → λεξικογραφική ακολουθία id μέσω pickRef);
//         οι άγνωστες οντότητες προστίθενται στο τέλος
//       · tombstones — ένωση με μέγιστο χρονική σήμανση (ts)· η
//         διαγραφή υπερισχύει των παλαιότερων επεξεργασιών, ενώ
//         υποχωρεί έναντι των νεότερων
//   - Η αναιρέση (Undo) καθιστά ΟΛΟ το snapshot ως το πιο πρόσφατο
//     (κατάσταση stampAll) — η αναίρεση υπερισχύει του remote,
//     και αυτό εφαρμόζεται παντού.
//   - DATA_VER 3 → 4 additive migration (om/mtime/pos/deleted).
// Μεταφέρθηκε από το v0.4 (Wave 3): drag των στηλών για
//   αναδιάταξη, μολύβι μετονομασίας; Wave 2: ετικέτες, αναζήτηση,
//   φιλτράρισμα; Wave 1: υποεργασίες, επιπλέον στοιχεία,
//   αντιγραφή (duplicate).
// Ενότητες:
//   1. Σταθερές, i18n, βοηθητικές συναρτήσεις (helpers)
//   2. Μοντέλο δεδομένων, αποθήκευση, migration
//   2b. Μηχανή συγχρονισμού μεταξύ συσκευών (v0.5)
//   3. Εμφάνιση (Render): στήλες + κάρτες (chips / subtask chip /
//      προεπισκόπηση επιπλέον στοιχείων)
//   4. Γρήγορη προσθήκη (ανά στήλη)
//   5. Διάλογος καρτών (ζωντανή επεξεργασία: ετικέτες,
//      υποεργασίες, επιπλέον στοιχεία, αντιγραφή)
//   6. Διάλογος στηλών
//   7. Αναζήτηση & φιλτράρισμα (γραμμή πίνακα)
//   8. Drag & drop καρτών (με δείκτη(pointer), με όριο.threshold)
//   8b. Drag αναδιάταξης στηλών (με δείκτη, με όριο)
//   9. Undo / toast
//  10. Sync slice (Dropbox, με καταχώρηση merge) + παλέτα
//  11. Σύνδεση (Wiring) & εκκίνηση (boot)
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-kanban-data";
  var DATA_VER = 4;
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 ημέρες

  // ---------- 1. Σταθερές, i18n, βοηθητικές συναρτήσεις ----------
  // Η γλώσσα προέρχεται από το shell (ίδια προέλευση, κοινό
  // localStorage).
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "board.title":      "Kanban",
      "col.add":          "Add column",
      "col.add.title":    "Add column",
      "col.rename":       "Rename column",
      "empty.title":      "No columns yet",
      "empty.hint":       "Add your first column with the button above.",
      "quick.add":        "Add a card…",
      "search.ph":        "Search…",
      "search.clear":     "Clear search",
      "filter.title":     "Filter by label",
      "filter.empty":     "No labels yet — add one from a card.",
      "filter.del":       "Delete label",
      "card.title":       "Card",
      "card.text":        "Text",
      "card.notes":       "Notes",
      "card.labels":      "Labels",
      "card.labels.manage": "Add / manage labels",
      "labels.chipRemove": "Click to remove",
      "labels.newph":     "New label…",
      "labels.add":       "Add",
      "labels.none":      "No labels yet — create one below.",
      "card.subtasks":    "Subtasks",
      "card.subph":       "New subtask…",
      "card.add":         "Add",
      "card.info":        "Extra info",
      "card.info.add":    "Add field",
      "card.info.label":  "Field",
      "card.info.value":  "Value",
      "card.delete":      "Delete",
      "card.duplicate":   "Duplicate",
      "dup.suffix":       " (copy)",
      "toast.duplicated": "Duplicated",
      "toast.labeladd":   "Label created",
      "toast.labeldel":   "Label deleted",
      "toast.merged":     "Synced changes from another device",
      "save":             "Save",
      "col.settings":     "Column settings",
      "col.name":         "Name",
      "col.delete":       "Delete column",
      "toast.deleted":    "Deleted",
      "toast.undone":     "Restored",
      "toast.coldel":     "Column deleted",
      "undo":             "Undo",
      "confirm.carddel":  "Delete this card?",
      "confirm.coldel":   "Delete this column and all its cards?",
      "confirm.lbldel":   "Delete this label? It will be removed from all cards.",
      "new.col":          "New column"
    },
    el: {
      "board.title":      "Kanban",
      "col.add":          "Προσθήκη στήλης",
      "col.add.title":    "Προσθήκη στήλης",
      "col.rename":       "Μετονομασία στήλης",
      "empty.title":      "Δεν υπάρχουν στήλες ακόμα",
      "empty.hint":       "Πρόσθεσε την πρώτη σου στήλη με το κουμπί παραπάνω.",
      "quick.add":        "Προσθήκη κάρτας…",
      "search.ph":        "Αναζήτηση…",
      "search.clear":     "Καθαρισμός αναζήτησης",
      "filter.title":     "Φιλτράρισμα ανά ετικέτα",
      "filter.empty":     "Δεν υπάρχουν ετικέτες — πρόσθεσε από κάποια κάρτα.",
      "filter.del":       "Διαγραφή ετικέτας",
      "card.title":       "Κάρτα",
      "card.text":        "Κείμενο",
      "card.notes":       "Σημειώσεις",
      "card.labels":      "Ετικέτες",
      "card.labels.manage": "Προσθήκη / διαχείριση ετικετών",
      "labels.chipRemove": "Κλικ για αφαίρεση",
      "labels.newph":     "Νέα ετικέτα…",
      "labels.add":       "Προσθήκη",
      "labels.none":      "Δεν υπάρχουν ετικέτες — δημιούργησε από κάτω.",
      "card.subtasks":    "Υπο-εργασίες",
      "card.subph":       "Νέα υπο-εργασία…",
      "card.add":         "Προσθήκη",
      "card.info":        "Επιπλέον στοιχεία",
      "card.info.add":    "Προσθήκη πεδίου",
      "card.info.label":  "Πεδίο",
      "card.info.value":  "Τιμή",
      "card.delete":      "Διαγραφή",
      "card.duplicate":   "Αντίγραφο",
      "dup.suffix":       " (αντίγραφο)",
      "toast.duplicated": "Αντιγράφηκε",
      "toast.labeladd":   "Η ετικέτα δημιουργήθηκε",
      "toast.labeldel":   "Η ετικέτα διαγράφηκε",
      "toast.merged":     "Συγχρονίστηκαν αλλαγές από άλλη συσκευή",
      "save":             "Αποθήκευση",
      "col.settings":     "Ρυθμίσεις στήλης",
      "col.name":         "Όνομα",
      "col.delete":       "Διαγραφή στήλης",
      "toast.deleted":    "Διαγράφηκε",
      "toast.undone":     "Επαναφέρθηκε",
      "toast.coldel":     "Η στήλη διαγράφηκε",
      "undo":             "Αναίρεση",
      "confirm.carddel":  "Διαγραφή αυτής της κάρτας;",
      "confirm.coldel":   "Διαγραφή στήλης και όλων των καρτών της;",
      "confirm.lbldel":   "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις κάρτες.",
      "new.col":          "Νέα στήλη"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }

  // ---------- 2. Μοντέλο δεδομένων, αποθήκευση, migration ----------
  // state = {
  //   ver: 4,
  //   om: <έκδοση σειράς στηλών>,
  //   deleted: { <id οντότητας>: <χρονική σήμανση tombstone> }, // καθαρίζονται μετά από 30 ημέρες
  //   labels: [{ id, name, color, mtime, pos }],
  //   columns: [{
  //     id, name, mtime, om, pos,        // om = η σειρά των ΚΑΡΤΩΝ αυτής της στήλης
  //     cards: [{
  //       id, text, notes,
  //       labels:   [<label id>],
  //       subtasks: [{ id, text, completed }],
  //       info:     [{ id, label, value }],
  //       mtime, pos
  //     }]
  //   }]
  // }
  //   mtime — έκδοση περιεχομένου: το μεγαλύτερο υπερισχύει στις
  //           συγκρούσεις συγχρονισμού (merge)
  //   om/pos — έκδοση σειράς τοποθέτησης: οι αναδιατάξεις ανεβάζουν την
  //           τιμή του om + επαναγράφουν το pos· οι αλλαγές στο
  //           περιεχόμενο δεν επηρεάζουν ποτέ τη σειρά
  //   Η τοποθέτηση μιας κάρτας σε μια στήλη αποφασίζεται από την
  //   ΚΕΡΔΙΖΟΥΣΑ πλευρά της (αυτή που έχει το νεότερο mtime της κάρτας)
  //   — οι μετακινήσεις μεταξύ στηλών καλούν touch(card), ώστε να
  //   υπολογίζονται ως πραγματικές αλλαγές στο περιεχόμενο.
  var state = null;
  var renderQueued = false;

  var SWATCH_COLORS = ["#d4af37", "#4caf50", "#f44336", "#2196f3",
                       "#ff9800", "#9c27b0", "#e91e63", "#03a9f4"];
  var FALLBACK_COLOR = "#d4af37";

  // --- χρονικές σημάνσεις εκδόσεων ---
  function touch(ent)     { ent.mtime = Date.now(); }
  function tombstone(id) {
    if (!state.deleted) state.deleted = {};
    state.deleted[id] = Date.now();
  }
  // Πολιτική Undo: το snapshot που επαναφέρεται καθιερώνεται ως η πιο
  // πρόσφατη κατάσταση παντού → υπερισχύει του επόμενου merge και
  // διαδίδεται σε όλες τις συσκευές.
  function stampAll() {
    var nowMs = Date.now();
    state.om = nowMs;
    (state.labels || []).forEach(function (lb) { lb.mtime = nowMs; });
    (state.columns || []).forEach(function (col) {
      col.mtime = nowMs;
      col.om = nowMs;
      (col.cards || []).forEach(function (c) { c.mtime = nowMs; });
    });
  }

  function defaultState() {
    var names = LANG === "el"
      ? ["Εκκρεμεί", "Σε εξέλιξη", "Ολοκληρωμένα"]
      : ["To Do", "Doing", "Done"];
    return {
      ver: DATA_VER,
      om: Date.now(),
      deleted: {},
      labels: [],
      columns: names.map(function (n, i) {
        var c = newColumnObj(n);
        c.pos = i;
        return c;
      })
    };
  }

  function newColumnObj(name) {
    return {
      id: uid(),
      name: name,
      mtime: Date.now(),
      om: 0,                          // έκδοση σειράς (η σειρά των καρτών αυτής της στήλης)
      pos: 0,                         // θέση εντός του state.columns
      cards: []
    };
  }

  function newCardObj(text) {
    return {
      id: uid(),
      text: text,
      notes: "",
      labels: [],
      subtasks: [],
      info: [],
      mtime: Date.now(),
      pos: 0
    };
  }

  // Προσθετική (additive) migration: μεταφέρει ΟΠΟΙΟΔΗΠΟТЕ παλιό
  // σχήμα (shape) στην τρέχουσα DATA_VER. Ποτέ nicht καταστροφική — οι
  // παλιές δημιουργίες αντιγράφων ασφαλείας (backups), τα v1/v2 slices
  // και τα δεδομένα v3 φορτώνονται εξίσου.
  // v3 → v4: merge stamps (root om, mtime/om/pos ανά στήλη,
  // mtime/pos ανά κάρτα + ετικέτα, tombstone map). Οι αγνώστες
  // χρονικές σημάνσεις (stamps) ορίζονται σε 0 = "παλαιότερο
  // δυνατό": τα πραγματικά δεδομένα από το remote (αν υπάρχουν)
  // υπερισχύουν των μετατραμένων δεδομένων — ποτέ το αντίστροφο.
  function migrate(data) {
    if (!data || !Array.isArray(data.columns)) return null;
    if (typeof data.om !== "number") data.om = 0;
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
    if (!Array.isArray(data.labels)) data.labels = [];
    data.labels.forEach(function (lb) {
      if (typeof lb.mtime !== "number") lb.mtime = 0;
      if (typeof lb.pos !== "number") lb.pos = 0;
    });
    data.columns.forEach(function (col) {
      if (typeof col.mtime !== "number") col.mtime = 0;
      if (typeof col.om !== "number") col.om = 0;
      if (typeof col.pos !== "number") col.pos = 0;
      if (!Array.isArray(col.cards)) col.cards = [];
      col.cards.forEach(function (card) {
        if (!Array.isArray(card.labels)) card.labels = [];
        if (!Array.isArray(card.subtasks)) card.subtasks = [];
        if (!Array.isArray(card.info)) card.info = [];
        if (typeof card.mtime !== "number") card.mtime = 0;
        if (typeof card.pos !== "number") card.pos = 0;
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
        if (data && Array.isArray(data.columns) && data.columns.length > 0) {
          state = data;
          pruneTombstones(state);
          save();                       // διατήρηση του μετατραμμένου σχήματος
          return;
        }
      }
    } catch (e) { /* κατεστραμμένα → νέα εκκίνηση */ }
    state = defaultState();
    save();
  }

  // Αυτόματη αποθήκευση: κάθε μεταβολή τελειώνει με save() +
  // scheduleRender().
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* όριο αποθήκευσης (quota) — τίποτα λογικό να γίνει offline */ }
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

  function colById(id) {
    for (var i = 0; i < state.columns.length; i++) {
      if (state.columns[i].id === id) return state.columns[i];
    }
    return null;
  }

  function cardById(col, cardId) {
    if (!col) return null;
    for (var i = 0; i < col.cards.length; i++) {
      if (col.cards[i].id === cardId) return col.cards[i];
    }
    return null;
  }

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }
  
  
  // ---------- 2b. Cross-device merge engine (v0.5) ----------
  // Συμβόλαιο (καταναλώνεται από το sync.js μέσω του 5ου ορίσματος
  // της registerSlice):
  //   mergeKanbanStates(local, remote) → merged state.
  // Deterministic + symmetric: merge(A,B) === merge(B,A). Η σύγκλιση
  // και στις δύο συσκευές σταματά το ping-pong push/pull.
  //
  //   · tombstones — ένωση με max ts. Μια οντότητα επιβιώνει μόνο αν
  //     το mtime του περιεχομένου της είναι ΝΕΟΤΕΡΟ από το
  //     tombstone της (edit-after-delete ανασταίνει)· αλλιώς η
  //     διαγραφή νικά.
  //   · περιεχόμενο (headers στηλών, κάρτες, ετικέτες) — μεγαλύτερο
  //     mtime νικά· σε ισοβαθμία → λεξικογραφικά μεγαλύτερο JSON
  //     (πανομοιότυπη απόφαση και στις δύο πλευρές, χωρίς κοίνια)
  //   · τοποθέτηση κάρτας σε στήλη — την αποφασίζει η ΚΕΡΔΙΖΟΥΣΑ
  //     πλευρά του card (νεότερο mtime). Ένα cross-column drag
  //     κάνει touch(card), άρα η μετακίνηση είναι αληθινή αλλαγή
  //     περιεχομένου και κερδίζει το merge. Ισοβαθμία mtime →
  //     lexicographic compare του συνδυασμού (JSON, colId) —
  //     συμμετρικό, κανένα flip-flop.
  //   · ordering — η πλευρά με το μεγαλύτερο om προσφέρει τις θέσεις:
  //     ριζικό om για τη σειρά στηλών και των ετικετών, om στήλης
  //     για τη σειρά καρτών ΜΕΣΑ της· οι άγνωστες οντότητες (π.χ.
  //     κάρτα που μετακινήθηκε εδώ από άλλη στήλη) μπαίνουν στο
  //     τέλος, παλαιότερο mtime πρώτα.
  //   · orphan rule — κάρτα που νικά το merge αλλά η στήλη
  //     τοποθέτησής της δεν επιβιώνει ΠΕΘΑΙΝΕΙ μαζί της (η διαγραφή
  //     στήλης κάνει cascade tombstones και στα cards της — και αν
  //     κάποιο card αναστηθεί από νεότερο edit χωρίς ζωντανή στήλη,
  //     ΔΕΝ δένεται κρυφά σε άλλη στήλη).
  //
  // Τα timestamps προέρχονται από διαφορετικά ρολόγια συσκευών — το
  // clock skew απλώς προκαθορίζει νικητές, η determinism εγγυάται
  // καμία ταλάντευση.

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

  // Whole-entity LWW για φύλλα (cards, labels, headers στηλών):
  // μεγαλύτερο mtime νικά; ισοβαθμία → μεγαλύτερο serialized JSON
  // (deterministic — ίδια απόφαση σε κάθε σειρά ορισμάτων).
  function newerEntity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  // Ένωση δύο πινάκων οντοτήτων κατά id (LWW περιεχομένου). Οι
  // tombstoned οντότητες απορρίπτονται ΕΔΩ — ένα merge δεν ανασταίνει
  // ποτέ μια διαγραφή εκτός αν το επιβιώσαν περιεχόμενο είναι
  // πραγματικά νεότερο.
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

  // Ταξινομεί τις merged οντότητες κατά τη σειρά της πλευράς-
  // αναφοράς (η πλευρά με το μεγαλύτερο om). Οι οντότητες άγνωστες
  // στην αναφορά πάνε στο τέλος, παλαιότερες πρώτα. Αναθέτει φρέσκο
  // διαδοχικό pos.
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

  // Συμμετρική επιλογή ordering-reference: μεγαλύτερο om νικά·
  // ΙΣΟΒΑΘΜΙΕΣ σπάονται με λεξικογραφική ακολουθία ids (πανομοιότυπη
  // απόφαση σε κάθε συσκευή — ποτέ «τοπικά κερδίζει», αυτό
  // flip-flopάρει στο άπειρο).
  function pickRef(aArr, bArr, aOm, bOm) {
    if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
    var ka = JSON.stringify((aArr || []).map(function (e) { return e.id; }));
    var kb = JSON.stringify((bArr || []).map(function (e) { return e.id; }));
    return ka >= kb ? aArr : bArr;
  }

  // Flatten μιας πλευράς: κάθε κάρτα του board με το colId που τη
  // φιλοξενεί. Απαραίτητο επειδή το ΊΔΙΟ card id μπορεί να ζει σε
  // ΔΙΑΦΟΡΕΤΙΚΕΣ στήλες ανά πλευρά (cross-column drag) — το merge
  // τοποθέτησης πρέπει να βλέπει το board επίπεδα, όχι ανά ζεύγος
  // στηλών.
  function flattenSide(st) {
    var out = {};
    ((st && st.columns) || []).forEach(function (col) {
      (col.cards || []).forEach(function (card) {
        out[card.id] = { card: card, colId: col.id };
      });
    });
    return out;
  }

  // Νικητής τοποθέτησης κάρτας: μεγαλύτερο mtime νικά (παίρνει το
  // card ΚΑΙ τη στήλη του)· ισοβαθμία → lexicographic compare του
  // συνδυασμού (JSON card, colId). Συμμετρικό — ποτέ «τοπικά νικά».
  function newerPlacement(pa, pb) {
    if ((pa.card.mtime || 0) !== (pb.card.mtime || 0)) {
      return (pa.card.mtime || 0) > (pb.card.mtime || 0) ? pa : pb;
    }
    var ka = JSON.stringify(pa.card) + "|" + pa.colId;
    var kb = JSON.stringify(pb.card) + "|" + pb.colId;
    return ka >= kb ? pa : pb;
  }

  // Headers στηλών κάνουν merge ΔΟΜΙΚΑ: LWW στο περιεχόμενο του
  // header, om = max των δύο πλευρών. Οι κάρτες mergeάρουν
  // ανεξάρτητα (flatten) — ένα rename στήλης σε μία συσκευή δεν
  // πατάει ποτέ αλλαγές καρτών στην άλλη.
  function mergeColHeaders(la, lb) {
    var strip = function (c) {
      var h = JSON.parse(JSON.stringify(c));
      delete h.cards;
      return h;
    };
    var head = newerEntity(strip(la), strip(lb));
    head.om = Math.max(la.om || 0, lb.om || 0);
    return head;
  }

  function mergeKanbanStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = mergeEntityMaps(a.deleted, b.deleted);
    // Prune ληξιαγμένων tombstones ΜΕΣΑ στο merge — και οι δύο
    // πλευρές συρρικνώνονται πανομοιότυπα, άρα το pruning είναι
    // από μόνο του convergence-safe.
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(tomb).forEach(function (id) {
      if (tomb[id] < cutoff) delete tomb[id];
    });

    // --- 1. Ετικέτες: LWW περιεχομένου, σειρά από το ριζικό om ---
    var labels = unionEntities(a.labels || [], b.labels || [], tomb);

    // --- 2. Headers στηλών: ζεύγη κατά id ---
    var colPairs = {};
    var pairColumns = function (arr) {
      (arr || []).forEach(function (col) {
        if (colPairs[col.id]) colPairs[col.id].push(col);
        else                  colPairs[col.id] = [col];
      });
    };
    pairColumns(a.columns); pairColumns(b.columns);

    // mergedCols[id] = { head, cards[], refA, refB } — τα refA/refB
    // είναι οι ΠΡΩΤΕΣ στήλες κάθε πλευράς για αυτό το id (χρειάζονται
    // για το ordering reference των καρτών: om στήλης).
    var mergedCols = {};
    Object.keys(colPairs).forEach(function (id) {
      var pair = colPairs[id];
      var head;
      if (pair.length === 2) head = mergeColHeaders(pair[0], pair[1]);
      else                   head = (function (c) {
                                 var h = JSON.parse(JSON.stringify(c));
                                 delete h.cards;
                                 return h;
                               })(pair[0]);
      if (!entAlive(head, tomb)) return;     // διαγεγραμμένη στήλη
      mergedCols[id] = {
        head: head,
        cards: [],
        refA: pair.length > 0 ? pair[0] : null,
        refB: pair.length > 1 ? pair[1] : null
      };
    });

    // --- 3. Κάρτες: flatten και των δύο πλευρών, νικητής ανά id ---
    // Ο νικητής φέρνει ΚΑΙ το περιεχόμενο ΚΑΙ τη στήλη τοποθέτησής
    // του. Orphan rule: αν η στήλη τοποθέτησης δεν επιβιώνει στο
    // merge, η κάρτα πεθαίνει μαζί της (δεν ξαναδένεται πουθενά).
    var fa = flattenSide(a);
    var fb = flattenSide(b);
    var cardIds = {};
    Object.keys(fa).forEach(function (id) { cardIds[id] = true; });
    Object.keys(fb).forEach(function (id) { cardIds[id] = true; });

    Object.keys(cardIds).forEach(function (id) {
      var pa = fa[id], pb = fb[id];
      var win;
      if (pa && pb) win = newerPlacement(pa, pb);
      else          win = pa || pb;
      if (!win) return;

      // tombstone ελέγχεται στο ΕΠΙΒΙΩΣΑΝ περιεχόμενο (η νικηφόρα
      // εκδοχή ανασταίνεται μόνο αν είναι νεότερη από τον τάφο της)
      if (!entAlive(win.card, tomb)) return;

      // orphan rule — νεκρή/άγνωστη στήλη τοποθέτησης ⇒ drop
      var mc = mergedCols[win.colId];
      if (!mc) return;

      mc.cards.push(win.card);
    });

    // --- 4. Σειρά καρτών ανά στήλη: ref = η πλευρά με το μεγαλύτερο
    // om ΤΗΣ ΣΤΗΛΗΣ. Κάρτες άγνωστες στην αναφορά (μετακομισμένες
    // από αλλού) appending στο τέλος, παλαιότερο mtime πρώτα. ---
    Object.keys(mergedCols).forEach(function (id) {
      var mc = mergedCols[id];
      var refArr =
        pickRef((mc.refA && mc.refA.cards) || [],
                (mc.refB && mc.refB.cards) || [],
                mc.refA ? mc.refA.om || 0 : 0,
                mc.refB ? mc.refB.om || 0 : 0);
      orderEntities(mc.cards, refArr);
    });

    // --- 5. Συγκρότηση εξόδου ---
    var out = {
      ver: DATA_VER,
      om: Math.max(a.om || 0, b.om || 0),
      deleted: tomb,
      labels: [],
      columns: []
    };

    out.labels =
      orderEntities(labels, pickRef(a.labels || [], b.labels || [],
                                     a.om || 0, b.om || 0));

    var cols = [];
    Object.keys(mergedCols).forEach(function (id) {
      var mc = mergedCols[id];
      mc.head.cards = mc.cards;
      cols.push(mc.head);
    });
    out.columns =
      orderEntities(cols, pickRef(a.columns || [], b.columns || [],
                                  a.om || 0, b.om || 0));

    // Μετα-συνθήκη: ποτέ μην στέλνεις κενό state (fallback σε
    // plain apply από το sync.js — fresh-install προστασία)
    if (out.columns.length === 0) return null;

    return out;
  }
  
  
  // ---------- 3. Render: columns + cards ----------
  // Το renderAll ζωγραφίζει το board με σεβασμό στο search + filters.
  // Ο counter της στήλης δείχνει ΟΡΑΤΕΣ κάρτες (search/filter aware).
  // Lesson 2: κάθε DOM control που δένεται με state ξανασυγχρονίζεται
  // εδώ — στο Kanban αυτό είναι το filter popover (αν είναι ανοιχτό
  // τη στιγμή ενός merge, πρέπει να ξαναχτίσει τη λίστα labels του).
  function renderAll() {
    var host = $("columns");
    host.innerHTML = "";
    $("empty").hidden = !(state.columns.length === 0);

    state.columns.forEach(function (col) {
      host.appendChild(makeColumnEl(col));
    });

    // lesson 2 — το popover δένεται με state.labels: μετά από merge
    // μπορεί να έχουν μπει/ληξι Deadline ετικέτες από άλλη συσκευή
    if (!$("filter-pop").hidden) renderFilterPop();
    updateFilterBtn();
  }

  function makeColumnEl(col) {
    var el = document.createElement("div");
    el.className = "k-col";
    el.dataset.colId = col.id;

    // Head: title (dblclick → rename) + rename pencil + visible count.
    // Όλο το head είναι η λαβή drag της στήλης.
    var head = document.createElement("div");
    head.className = "col-head";

    var title = document.createElement("span");
    title.className = "col-title";
    title.textContent = col.name;
    title.title = col.name;
    title.addEventListener("dblclick", function () { openColDialog(col.id); });
    head.appendChild(title);

    // Rename pencil (#22) — ίδιο dialog με dblclick, πάντα ορατό
    var rename = document.createElement("button");
    rename.type = "button";
    rename.className = "col-rename";
    rename.setAttribute("aria-label", t("col.rename"));
    rename.title = t("col.rename");
    rename.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
    rename.addEventListener("click", function (e) {
      e.stopPropagation();
      openColDialog(col.id);
    });
    head.appendChild(rename);

    var visible = 0;
    col.cards.forEach(function (c) { if (cardMatchesView(c)) visible++; });

    var count = document.createElement("span");
    count.className = "col-count";
    count.textContent = String(visible);
    head.appendChild(count);

    el.appendChild(head);

    // Body: οι ορατές κάρτες
    var body = document.createElement("div");
    body.className = "col-body";
    col.cards.forEach(function (card) {
      if (!cardMatchesView(card)) return;
      body.appendChild(makeCardEl(col, card));
    });
    el.appendChild(body);

    // Foot: quick-add (input + φιλικό προς ποντίκι κουμπί)
    var foot = document.createElement("div");
    foot.className = "col-foot";

    var quick = document.createElement("input");
    quick.type = "text";
    quick.className = "col-quick";
    quick.setAttribute("placeholder", t("quick.add"));
    quick.autocomplete = "off";
    quick.spellcheck = false;
    quick.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); quickAdd(col, quick); }
    });
    foot.appendChild(quick);

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "col-add-btn";
    addBtn.setAttribute("aria-label", t("quick.add"));
    addBtn.title = t("quick.add");
    addBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    addBtn.addEventListener("click", function () {
      quickAdd(col, quick);
      quick.focus();
    });
    foot.appendChild(addBtn);

    el.appendChild(foot);

    // Column reorder drag — το head είναι η λαβή (αφού υπάρχει πια)
    attachColDrag(head, el, col);

    return el;
  }

  function makeCardEl(col, card) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "card";
    el.dataset.cardId = card.id;

    var text = document.createElement("div");
    text.className = "text";
    text.textContent = card.text;
    el.appendChild(text);

    if (card.notes) {
      var prev = document.createElement("div");
      prev.className = "notes-preview";
      prev.textContent = card.notes;
      el.appendChild(prev);
    }

    // Label chips πάνω στην κάρτα
    if (card.labels && card.labels.length > 0) {
      var chipHost = document.createElement("div");
      chipHost.className = "chips";
      card.labels.forEach(function (lid) {
        var label = labelById(lid);
        if (!label) return;
        var chip = document.createElement("span");
        chip.className = "chip";
        chip.style.background = label.color || FALLBACK_COLOR;
        chip.textContent = label.name;
        chip.title = label.name;
        chipHost.appendChild(chip);
      });
      if (chipHost.childNodes.length > 0) el.appendChild(chipHost);
    }

    // Subtask progress chip: "x/y" + slim bar (μόνο με subtasks)
    if (card.subtasks && card.subtasks.length > 0) {
      var done = 0;
      card.subtasks.forEach(function (s) { if (s.completed) done++; });
      var pct = Math.round((done / card.subtasks.length) * 100);

      var ind = document.createElement("div");
      ind.className = "sub-ind";
      ind.appendChild(document.createTextNode(done + "/" + card.subtasks.length));

      var bar = document.createElement("span");
      bar.className = "bar";
      var fill = document.createElement("span");
      fill.className = "fill";
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      ind.appendChild(bar);
      el.appendChild(ind);
    }

    // Extra info preview: μία dim, περικομμένη γραμμή "label: value · …"
    var infoParts = [];
    (card.info || []).forEach(function (f) {
      var l = (f.label || "").trim();
      var v = (f.value || "").trim();
      if (l && v) infoParts.push(l + ": " + v);
    });
    if (infoParts.length > 0) {
      var ip = document.createElement("div");
      ip.className = "info-preview";
      ip.textContent = infoParts.join("  ·  ");
      el.appendChild(ip);
    }

    el.addEventListener("click", function () { openCardDialog(col.id, card.id); });
    attachCardDrag(el, col, card);
    return el;
  }

  // ---------- 4. Quick-add ----------
  function quickAdd(col, input) {
    var raw = input.value.trim();
    if (!raw) return;
    var card = newCardObj(raw);          // φρέσκο mtime — νέα οντότητα
    col.cards.unshift(card);
    col.cards.forEach(function (c, i) { c.pos = i; });
    input.value = "";
    save(); scheduleRender();
    // Επαν-εστίαση στο φρέσκο input (το render αντικατέστησε τον παλιό κόμβο)
    var fresh = findQuickInput(col.id);
    if (fresh) fresh.focus();
  }

  function findQuickInput(colId) {
    var cols = document.querySelectorAll(".k-col");
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].dataset.colId === colId) {
        return cols[i].querySelector(".col-quick");
      }
    }
    return null;
  }

  // ---------- 5. Card dialog (live editing) ----------
  var editingColId = null;
  var editingCardId = null;
  var pickedSwatch = FALLBACK_COLOR;     // νέο-ετικέτας χρώμα (accent default)

  // Μικρό helper: η κάρτα που είναι αυτή τη στιγμή ανοιχτή στο
  // διάλογο (ή null). Κοιτάζει by-id στο ΤΡΕΧΟΝ state — μετά από
  // merge δείχνει στη merged εκδοχή.
  function editingCard() {
    return cardById(colById(editingColId), editingCardId);
  }

  function openCardDialog(colId, cardId) {
    var col = colById(colId);
    if (!col) return;
    var card = cardById(col, cardId);
    if (!card) return;

    editingColId = colId;
    editingCardId = cardId;

    $("c-text").value = card.text;
    $("c-notes").value = card.notes || "";

    renderCardLabels(card);
    renderSubtasks(card);
    renderInfo(card);
    $("c-lbl-picker").hidden = true;

    $("dlg-card").showModal();
    setTimeout(function () { $("c-text").focus(); }, 50);
  }

  // Live-editing μοντέλο:
  //   - δομικές αλλαγές (check / add / remove / label attach) →
  //     touch() + save() ΤΩΡΑ
  //   - πληκτρολόγηση σε text fields → μόνο στη μνήμη, γράφεται
  //     στο κλείσιμο του dialog (το 'close' καλείται για submit
  //     ΚΑΙ Esc — τίποτα δεν χάνεται ποτέ)

  // --- Labels μέσα στο card dialog ---
  function renderCardLabels(card) {
    var host = $("c-lbl-chips");
    host.innerHTML = "";
    (card.labels || []).forEach(function (lid) {
      var label = labelById(lid);
      if (!label) return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lbl-chip";
      chip.style.background = label.color || FALLBACK_COLOR;
      chip.title = t("labels.chipRemove");
      var name = document.createElement("span");
      name.textContent = label.name;
      chip.appendChild(name);
      chip.addEventListener("click", function () {
        card.labels = card.labels.filter(function (id) { return id !== lid; });
        touch(card);
        save(); scheduleRender();
        renderCardLabels(card);
      });
      host.appendChild(chip);
    });
  }

  // Picker: όλες οι ετικέτες του board — κλικ κάνει toggle
  // attach/detach σε αυτή την κάρτα.
  function renderLblPicker() {
    var list = $("c-lbl-list");
    list.innerHTML = "";

    if (state.labels.length === 0) {
      var none = document.createElement("div");
      none.className = "lbl-none";
      none.textContent = t("labels.none");
      list.appendChild(none);
      return;
    }

    var card = editingCard();
    state.labels.forEach(function (label) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "lbl-item";
      if (card && card.labels.indexOf(label.id) !== -1) {
        item.classList.add("attached");
      }

      var dot = document.createElement("span");
      dot.className = "fl-dot";
      dot.style.background = label.color || FALLBACK_COLOR;
      item.appendChild(dot);

      var name = document.createElement("span");
      name.className = "fl-name";
      name.textContent = label.name;
      item.appendChild(name);

      item.addEventListener("click", function () {
        var c = editingCard();
        if (!c) return;
        var pos = c.labels.indexOf(label.id);
        if (pos === -1) c.labels.push(label.id);
        else            c.labels.splice(pos, 1);
        touch(c);                     // attach/detach = αλλαγή περιεχομένου
        save(); scheduleRender();
        renderCardLabels(c);
        renderLblPicker();
      });

      list.appendChild(item);
    });
  }

  function renderLblSwatches() {
    var host = $("c-lbl-swatches");
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
    var input = $("c-lbl-name");
    var name = input.value.trim();
    if (!name) return;

    var label = {
      id: uid(), name: name, color: pickedSwatch,
      mtime: Date.now(), pos: state.labels.length
    };
    state.labels.push(label);

    var card = editingCard();
    if (card) { card.labels.push(label.id); touch(card); }

    pickedSwatch = FALLBACK_COLOR;
    input.value = "";

    save(); scheduleRender();
    if (card) renderCardLabels(card);
    renderLblPicker();
    input.focus();                      // διατηρεί focus → γρήγορα batch ετικετών
    showToast(t("toast.labeladd"), false);
  }

  // --- Subtasks μέσα στο card dialog ---
  // Όλη η επεξεργασία subtasks συμβαίνει μέσα στο dialog: κάνουμε
  // τροποποιήσεις στη δομή ΤΩΡΑ, το flush στο close κάνει touch().
  // Το touch γίνεται πάντα στο close-handler — πουθενά αλλού.
  function renderSubtasks(card) {
    var host = $("c-sub-list");
    host.innerHTML = "";
    card.subtasks.forEach(function (sub) {
      host.appendChild(makeSubRow(card, sub));
    });
  }

  function makeSubRow(card, sub) {
    var row = document.createElement("div");
    row.className = "sub-row";

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!sub.completed;
    cb.addEventListener("change", function () {
      sub.completed = cb.checked;
      txt.classList.toggle("completed", cb.checked);
      // Ζωντανή προβολή ενημερώνεται με το επόμενο render· το
      // περιεχόμενο καταγράφεται στο κλείσιμο του dialog (flush touch).
      scheduleRender();
    });
    row.appendChild(cb);

    var txt = document.createElement("input");
    txt.type = "text";
    txt.className = "s-text" + (sub.completed ? " completed" : "");
    txt.value = sub.text;
    txt.autocomplete = "off";
    txt.addEventListener("input", function () { sub.text = txt.value; });
    row.appendChild(txt);

    row.appendChild(makeRemoveBtn(function () {
      card.subtasks = card.subtasks.filter(function (s) { return s !== sub; });
      scheduleRender();
      renderSubtasks(card);
    }));

    return row;
  }

  function makeRemoveBtn(onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sub-x info-x";
    b.setAttribute("aria-label", t("card.delete"));
    b.title = t("card.delete");
    b.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    b.addEventListener("click", onClick);
    return b;
  }

  function addSubtask() {
    var card = editingCard();
    if (!card) return;
    var input = $("c-sub-new");
    var raw = input.value.trim();
    if (!raw) return;
    card.subtasks.push({ id: uid(), text: raw, completed: false });
    input.value = "";
    scheduleRender();
    renderSubtasks(card);
    input.focus();
  }

  // --- Extra info μέσα στο card dialog ---
  function renderInfo(card) {
    var host = $("c-info-list");
    host.innerHTML = "";
    card.info.forEach(function (f) {
      host.appendChild(makeInfoRow(card, f));
    });
  }

  function makeInfoRow(card, f) {
    var row = document.createElement("div");
    row.className = "info-row";

    var lbl = document.createElement("input");
    lbl.type = "text";
    lbl.className = "i-label";
    lbl.setAttribute("placeholder", t("card.info.label"));
    lbl.value = f.label;
    lbl.autocomplete = "off";
    lbl.addEventListener("input", function () { f.label = lbl.value; });
    row.appendChild(lbl);

    var val = document.createElement("input");
    val.type = "text";
    val.className = "i-value";
    val.setAttribute("placeholder", t("card.info.value"));
    val.value = f.value;
    val.autocomplete = "off";
    val.addEventListener("input", function () { f.value = val.value; });
    row.appendChild(val);

    row.appendChild(makeRemoveBtn(function () {
      card.info = card.info.filter(function (x) { return x !== f; });
      renderInfo(card);
    }));

    return row;
  }

  function addInfo() {
    var card = editingCard();
    if (!card) return;
    card.info.push({ id: uid(), label: "", value: "" });
    renderInfo(card);
    // εστίαση στο φρέσκο label για άμεση πληκτρολόγηση
    var rows = $("c-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector(".i-label");
      if (l) l.focus();
    }
  }

  // --- Duplicate card ---
  // Deep clone (φρέσκα ids παντού), πρόσφυμα "(copy)", τοποθέτηση
  // ακριβώς μετά το πρωτότυπο στην ίδια στήλη. Φρέσκο mtime = now
  // (νέα οντότητα). Labels αντιγράφονται κατά id (παραπέμπουν στο
  // κοινό board-wide store).
  function duplicateCard() {
    var col = colById(editingColId);
    var card = editingCard();
    if (!col || !card) return;

    var copy = newCardObj(card.text + t("dup.suffix"));
    copy.notes = card.notes || "";
    copy.labels = card.labels.slice();
    copy.subtasks = JSON.parse(JSON.stringify(card.subtasks || []));
    copy.info = JSON.parse(JSON.stringify(card.info || []));
    copy.subtasks.forEach(function (s) { s.id = uid(); });
    copy.info.forEach(function (f) { f.id = uid(); });
    touch(copy);                        // φρέσκο mtime — νικά το merge ως ΝΕΑ οντότητα

    var idx = col.cards.indexOf(card);
    col.cards.splice(idx + 1, 0, copy);
    stampColOrder(col);                 // νέα σειρά τοποθέτησης στη στήλη

    save(); scheduleRender();
    showToast(t("toast.duplicated"), false);
  }

  // Stampάρει τη σειρά μιας στήλης: φρέσκο om + καθαρό διαδοχικό
  // pos. Οι ενoriaκα mtime των καρτών ΜΕΝΟΥΝ ανέγγιχτα (η σειρά είναι
  // θέμα ordering, όχι περιεχομένου).
  function stampColOrder(col) {
    col.om = Date.now();
    col.cards.forEach(function (c, i) { c.pos = i; });
  }

  // Flush typed-but-unsaved text όταν το dialog κλείνει από ΟΠΟΙΟΔΗΠΟΤΕ
  // path (Save, Esc) — καμία απώλεια δεδομένων. Κάθε flush κάνει
  // touch(): οι επεξεργασίες του dialog είναι ΠΡΑΓΜΑΤΙΚΕΣ μεταβολές.
  // Καθαρίζει επίσης κενά info πεδία (ούτε label ούτε value) που θα
  // ήταν σκέτος θόρυβος.
  $("dlg-card").addEventListener("close", function () {
    if (editingColId === null) return;
    var card = editingCard();
    editingColId = null;
    editingCardId = null;
    if (!card) return;
    card.info = (card.info || []).filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    });
    card.text  = $("c-text").value.trim() || card.text;
    card.notes = $("c-notes").value;
    touch(card);
    save(); scheduleRender();
  });

  // ---------- 6. Column dialog ----------
  function openColDialog(colId) {
    var col = colById(colId);
    if (!col) return;

    editingColId = colId;
    editingCardId = null;

    $("col-name").value = col.name;

    $("dlg-col").showModal();
    setTimeout(function () { $("col-name").focus(); }, 50);
  }

  function createColumn() {
    var col = newColumnObj(t("new.col"));
    col.pos = state.columns.length;
    state.om = Date.now();          // νέα έκδοση σειράς στηλών
    state.columns.push(col);
    state.columns.forEach(function (c, i) { c.pos = i; });
    save(); scheduleRender();
    openColDialog(col.id);     // κατευθείαν στις ρυθμίσεις για ονομασία
  }

  // ---------- 7. Search & filter ----------
  // Session-only (ΔΕΝ αποθηκεύονται ποτέ): ένα pull από άλλη συσκευή
  // δεν πρέπει να αναστήσει μια "παλιά" οθόνη αναζήτησης/φίλτρου.
  var searchQuery = "";
  var activeFilters = [];

  // Συνδυασμένη πύλη εμφάνισης: search (substring) AND filter (≥1
  // ενεργή ετικέτα).
  function cardMatchesView(card) {
    if (searchQuery && !matchesSearch(card)) return false;
    if (activeFilters.length > 0 && !matchesFilters(card)) return false;
    return true;
  }

  // Search καλύπτει: τίτλο, notes, info labels ΚΑΙ values, ονόματα
  // attached labels.
  function matchesSearch(card) {
    if ((card.text || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    if ((card.notes || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    for (var i = 0; i < (card.info || []).length; i++) {
      var f = card.info[i];
      if ((f.label || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
      if ((f.value || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    for (var j = 0; j < (card.labels || []).length; j++) {
      var label = labelById(card.labels[j]);
      if (label && label.name.toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    return false;
  }

  // OR στις επιλεγμένες ετικέτες — μια κάρτα φαίνεται αν έχει ΟΠΟΙΑΔΗΠΟΤΕ ενεργή ετικέτα.
  function matchesFilters(card) {
    if (!card.labels || card.labels.length === 0) return false;
    for (var i = 0; i < activeFilters.length; i++) {
      if (card.labels.indexOf(activeFilters[i]) !== -1) return true;
    }
    return false;
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

  // Η διαγραφή ετικέτας αποσπά την από ΠΑΝΤΟΥ και τη βγάζει από τα
  // ενεργά φίλτρα → κανένα orphan id σε κάρτες, κανένα ghost στο
  // filter. Soft-delete μέσω tombstone + touch() στις κάρτες που τη
  // φορούσαν: η άλλη συσκευή κάνει merge τη διαγραφή αντί να
  // αναστήσει την ετικέτα από stale τοπικό αντίγραφο — και οι κάρτες
  // της ΝΙΚΗΦΟΡΑΣ πλευράς (παλαιότερο mtime) δεν ξανακουβαλούν
  // νεκρό label id.
  function deleteLabel(labelId) {
    state.labels = state.labels.filter(function (l) { return l.id !== labelId; });
    state.columns.forEach(function (col) {
      col.cards.forEach(function (card) {
        var had = (card.labels || []).indexOf(labelId) !== -1;
        card.labels = (card.labels || []).filter(function (id) { return id !== labelId; });
        if (had) touch(card);       // αφαίρεση ετικέτας = αλλαγή περιεχομένου
      });
    });
    tombstone(labelId);             // merge-safe διαγραφή
    activeFilters = activeFilters.filter(function (id) { return id !== labelId; });

    updateFilterBtn();
    save(); scheduleRender();
    if (!$("filter-pop").hidden) renderFilterPop();
    var card = editingCard();
    if (card) renderCardLabels(card);
    showToast(t("toast.labeldel"), false);
  }

  // ---------- 8. Card drag & drop ----------
  // Pointer-based, threshold-gated: απλό tap δεν ξεκινά ποτέ drag
  // (το click → dialog δουλεύει). Κάθετη κίνηση αφής κάνει scroll
  // τη λίστα στηλών (touch-action: pan-y); οριζόντια κίνηση
  // ανήκει σε εμάς → drag μεταξύ στηλών.
  var DRAG_THRESHOLD = 8;

  // Έκδοση σειράς μιας στήλης: rename/hdr edit ΔΕΝ αγγίζει το om —
  // μόνο το πληθυσμιακό/σειρακά γεγονός των καρτών την ανεβάζει.
  function stampColOrder(col) { col.om = Date.now(); }

  function attachCardDrag(el, col, card) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;   // μόνο primary
      // ποτέ drag όσο είναι ανοιχτό το card dialog
      if ($("dlg-card").open) return;

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        el.classList.add("dragging");
        el.style.pointerEvents = "none";   // elementFromPoint βλέπει ΜΕΣΑ από εμάς
        document.body.classList.add("is-dragging");
      }

      function clearMarks() {
        var marked = document.querySelectorAll(
          ".drag-over-above, .drag-over-below, .k-col.drag-over, " +
          ".k-col.drag-over-left, .k-col.drag-over-right");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-above", "drag-over-below",
                                     "drag-over", "drag-over-left", "drag-over-right");
        }
      }

      function mark(x, y) {
        clearMarks();
        var hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest) return;
        var cardEl = hit.closest(".card");
        if (cardEl && cardEl !== el) {
          var r = cardEl.getBoundingClientRect();
          if (y < r.top + r.height / 2) cardEl.classList.add("drag-over-above");
          else                          cardEl.classList.add("drag-over-below");
          return;
        }
        var colEl = hit.closest(".k-col");
        if (colEl && colEl.dataset.colId !== col.id) colEl.classList.add("drag-over");
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          beginDrag();
        }
        ev.preventDefault();
        mark(ev.clientX, ev.clientY);
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        if (!started) return;              // ήταν tap — τίποτα προς αναίρεση

        // Υπολογισμός προορισμού ΠΡΩΤΑ (το pointerEvents hack ακόμα ενεργό)
        var hit = document.elementFromPoint(ev.clientX, ev.clientY);

        el.classList.remove("dragging");
        el.style.pointerEvents = "";
        document.body.classList.remove("is-dragging");
        clearMarks();

        if (!hit || !hit.closest) return;
        var destCard = hit.closest(".card");
        var destColEl = hit.closest(".k-col");

        if (destCard && destCard !== el) {
          var r = destCard.getBoundingClientRect();
          var before = ev.clientY < r.top + r.height / 2;
          moveCard(col, card,
                   destCard.closest(".k-col").dataset.colId,
                   destCard.dataset.cardId, before);
        } else if (destColEl) {
          moveCard(col, card, destColEl.dataset.colId, null, false);
        }
        // else: ρίχτηκε εκτός πίνακα — θέση αμετάβλητη

        save(); scheduleRender();
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (started) {
          el.classList.remove("dragging");
          el.style.pointerEvents = "";
          document.body.classList.remove("is-dragging");
          clearMarks();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  // moveCard: η ΟΝΤΟΤΗΤΑ-ΚΑΡΤΑ перемещείται· με βάση αυτό καταγράφει
  // την σειρά. Ίδια περίπτωση στήλης → ΜΟΝΟ om/source+dest + rewrite
  // pos (τα card mtimes ΑΝΕΠΑΦΗ — μηδενικό ordering noise).
  // Cross-column → touch(card) ΕΠΙΣΗΣ: η μετακίνηση είναι αληθινή
  // αλλαγή τοποθέτησης που πρέπει να κερδίζει το merge placement.
  function moveCard(srcCol, card, destColId, beforeCardId, before) {
    var srcIdx = srcCol.cards.indexOf(card);
    if (srcIdx === -1) return;
    var dest = colById(destColId);
    if (!dest) return;

    srcCol.cards.splice(srcIdx, 1);

    var at = dest.cards.length;
    if (beforeCardId) {
      var bi = -1;
      dest.cards.forEach(function (c, i) { if (c.id === beforeCardId) bi = i; });
      if (bi !== -1) at = before ? bi : bi + 1;
    }
    dest.cards.splice(at, 0, card);

    var sameCol = srcCol.id === destColId;
    var nowMs = Date.now();

    if (sameCol) {
      // αναδιάταξη εντός στήλης: owner εδώ = om της στήλης
      col.om = nowMs;
      col.cards.forEach(function (c, i) { c.pos = i; });
    } else {
      // cross-column: η αλλαγή του πληθυσμού είναι πραγματική
      // αλλαγή → touch(card) + om KAI στις δύο στήλες
      touch(card);
      srcCol.om = nowMs;
      dest.om = nowMs;
      srcCol.cards.forEach(function (c, i) { c.pos = i; });
      dest.cards.forEach(function (c, i) { c.pos = i; });
    }
  }

  // ---------- 8b. Column drag reorder ----------
  // Ίδιο συμβόλαιο με το card drag: pointer-based, threshold-gated,
  // όχι HTML5 dragstart. Το head είναι η λαβή (grab cursor); το
  // κουμπί μολυβιού και το dblclick-rename εξαιρούνται. Ο δείκτης
  // δείχνει ΑΡΙΣΤΕΡΑ ή ΔΕΞΙΑ του hovered στόχου με βάση το μισό pointer.
  function attachColDrag(headEl, colEl, col) {
    headEl.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      // τα pencils/dlg opens χειρίζονται από τους δικούς τους listeners — ποτέ drag
      if (e.target.closest(".col-rename")) return;
      if ($("dlg-card").open || $("dlg-col").open) return;
      if (state.columns.length < 2) return;   // τίποτα προς αναδιάταξη

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        colEl.classList.add("drag-src");
        colEl.style.pointerEvents = "none";  // elementFromPoint βλέπει ΜΕΣΑ από εμάς
        document.body.classList.add("is-dragging");
      }

      function clearMarks() {
        var marked = document.querySelectorAll(
          ".drag-over-above, .drag-over-below, .k-col.drag-over, " +
          ".k-col.drag-over-left, .k-col.drag-over-right");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-above", "drag-over-below",
                                     "drag-over", "drag-over-left", "drag-over-right");
        }
      }

      function mark(x, y) {
        clearMarks();
        var hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest) return;
        var target = hit.closest(".k-col");
        if (!target || target === colEl) return;
        var r = target.getBoundingClientRect();
        if (x < r.left + r.width / 2) target.classList.add("drag-over-left");
        else                          target.classList.add("drag-over-right");
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          // Horizontal bias: η αναδιάταξη στηλών είναι οριζόντια χειρονομία.
          // Κυρίως-κάθετη πρόθεση (ή μικρές τρεμουλιαστές) δεν την ξεκινά ποτέ.
          if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
          beginDrag();
        }
        ev.preventDefault();
        mark(ev.clientX, ev.clientY);
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        if (!started) return;              // tap/dblclick start — noop

        // Υπολογισμός προορισμού ΠΡΩΤΑ (το pointerEvents hack ακόμα ενεργό)
        var hit = document.elementFromPoint(ev.clientX, ev.clientY);

        colEl.classList.remove("drag-src");
        colEl.style.pointerEvents = "";
        document.body.classList.remove("is-dragging");
        clearMarks();

        if (!hit || !hit.closest) { save(); scheduleRender(); return; }
        var target = hit.closest(".k-col");
        if (target && target !== colEl) {
          var r = target.getBoundingClientRect();
          var before = ev.clientX < r.left + r.width / 2;
          moveColumn(col, target.dataset.colId, before);
        }
        // else: ρίχτηκε έξω — η σειρά δεν άλλαξε

        save(); scheduleRender();
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (started) {
          colEl.classList.remove("drag-src");
          colEl.style.pointerEvents = "";
          document.body.classList.remove("is-dragging");
          clearMarks();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  // Αφαίρεση της στήλης-πηγής, επανατοποθέτηση στόχου (οι δείκτες
  // μετατοπίζονται μετά το splice!), εισαγωγή πριν/μετά. Stamps το
  // ριζικό om: αυτή η πλευρά OWNηρε τη σειρά των στηλών τώρα.
  function moveColumn(srcCol, destColId, before) {
    var from = state.columns.indexOf(srcCol);
    if (from === -1) return;

    state.columns.splice(from, 1);

    var to = -1;
    for (var i = 0; i < state.columns.length; i++) {
      if (state.columns[i].id === destColId) { to = i; break; }
    }
    if (to === -1) {                     // paranoia — restore source
      state.columns.splice(from, 0, srcCol);
      return;
    }

    state.columns.splice(before ? to : to + 1, 0, srcCol);
    state.om = Date.now();               // αυτό το τμήμα έχει πλέον τη σειρά στηλών
    state.columns.forEach(function (c, i) { c.pos = i; });
  }
  
  
  // ---------- 9. Undo / toast ----------
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
    stampAll();              // το restored snapshot είναι η πιο ΝΕΑ αλήθεια —
                             // ΚΑΙ στις σειρές (om ρίζας + στηλών), όχι μόνο
                             // στο περιεχόμενο. Κερδίζει το επόμενο merge
                             // και διαδίδεται.
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

    void el.offsetWidth;                 // επανεκκίνηση transition
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  // ---------- 10. Sync slice (merge-registered) + palette ----------
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
    } catch (e) { /* standalone (απευθείας) open — fallback palette */ }
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
    // v0.5: 5ο όρισμα — η merge συνάρτηση. Με αυτήν, ένα pull ποτέ
    // δεν κάνει wholesale-overwrite το τοπικό state — local και
    // remote συγκλίνουν.
    api.registerSlice("kanban", sliceGet, sliceSet,
                      "oros-kanban-data", mergeKanbanStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  // data — merged αποτέλεσμα (ή plain remote σε legacy LWW paths)
  // info — { merged: true } όταν η τιμή ήρθε μέσω mergeKanbanStates
  //        (συμβόλαιο του sync.js)· οτιδήποτε άλλο = wholesale apply.
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || Array.isArray(data.columns) === false || data.columns.length === 0) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      pruneTombstones(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    scheduleRender();

    if (info && info.merged) {
      showToast(t("toast.merged"), false);   // ορατή σύγκλιση
    }
  }
  
    // Contract Β: shell-owned combos (Ctrl+Shift+*) forward FIRST.
  // Standalone listener — does not touch existing keydown handling.
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (window.parent.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);   // capture phase: runs BEFORE the app's own bubble listeners

  // ---------- 11. Wiring & boot ----------
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
    var ph = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < ph.length; k++) {
      ph[k].setAttribute("placeholder", t(ph[k].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // Νέα στήλη
    $("col-add").addEventListener("click", createColumn);

    // --- Search ---
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

    // --- Filter popover: toggle + κλείσιμο με εξωτερικό κλικ ---
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

    // --- Card dialog ---
    // Text/notes flush στο κλείσιμο του dialog — κανένα save-spam
    // ανά πληκτρολόγημα. Όλες οι αλλαγές του dialog γίνονται commit
    // με touch() από τον close handler (todo v0.4 pattern).
    $("c-text").addEventListener("input", function () {
      var card = editingCard();
      if (card) card.text = $("c-text").value;
    });
    $("c-notes").addEventListener("input", function () {
      var card = editingCard();
      if (card) card.notes = $("c-notes").value;
    });

    // Submit = "Save & close". Η validation ζει στη φόρμα (required).
    // Η διατήρηση γίνεται στο close handler — διπλό-commit ποτέ.
    $("card-form").addEventListener("submit", function (e) {
      e.preventDefault();
      $("dlg-card").close();
    });

    // Delete: tombstone (merge-safe) + τοπική αφαίρεση. Τα editing
    // ids γίνονται null ΠΡΙΝ το close() ώστε ο close-commit να
    // προσπεράσει — η κάρτα είναι ήδη διαγραμμένη, δεν υπάρχει τίποτα
    // προς flush.
    $("c-delete").addEventListener("click", function () {
      if (!confirm(t("confirm.carddel"))) return;
      var col = colById(editingColId);
      if (col) {
        pushUndo("toast.deleted");
        tombstone(editingCardId);          // merge-safe διαγραφή
        col.cards = col.cards.filter(function (c) { return c.id !== editingCardId; });
      }
      editingColId = null;
      editingCardId = null;
      $("dlg-card").close();
      save(); scheduleRender();
    });

    // Labels (μέσα στο dialog)
    $("c-lbl-toggle").addEventListener("click", function () {
      var picker = $("c-lbl-picker");
      if (picker.hidden) {
        renderLblPicker();
        renderLblSwatches();
        picker.hidden = false;
      } else {
        picker.hidden = true;
      }
    });
    $("c-lbl-new-add").addEventListener("click", createNewLabel);
    $("c-lbl-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); createNewLabel(); }
    });

    // Subtasks
    $("c-sub-add").addEventListener("click", addSubtask);
    $("c-sub-new").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addSubtask(); }
    });

    // Extra info
    $("c-info-add").addEventListener("click", addInfo);

    // Duplicate
    $("c-duplicate").addEventListener("click", duplicateCard);

    // --- Column dialog ---
    $("col-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var col = colById(editingColId);
      if (!col) { $("dlg-col").close(); return; }

      var name = $("col-name").value.trim();
      if (!name) return;

      // Επικεφαλίδα: LWW στο mtime της στήλης — ΔΟΜΙΚΟ, δεν πατάει
      // ποτέ αλλαγές καρτών της από την άλλη συσκευή.
      if (name !== col.name) {
        col.name = name;
        touch(col);
      }
      editingColId = null;
      save(); scheduleRender();
      $("dlg-col").close();
    });

    $("col-delete").addEventListener("click", function () {
      var col = colById(editingColId);
      if (!col) return;
      if (!confirm(t("confirm.coldel"))) return;

      pushUndo("toast.coldel");
      // Cascade tombstones: η στήλη ΠΑΙΡΝΕΙ τις κάρτες της — αν
      // κάποια κάρτα αναστηθεί από νεότερο edit, το orphan rule τη
      // κρατά νεκρή μέχρι η στήλη τοποθέτησής της να ζήσει ξανά.
      tombstone(col.id);
      col.cards.forEach(function (c) { tombstone(c.id); });
      state.columns = state.columns.filter(function (c) { return c.id !== col.id; });

      if (state.columns.length === 0) {
        var fresh = newColumnObj(t("new.col"));
        fresh.pos = 0;
        state.columns.push(fresh);
      }
      state.om = Date.now();          // ο πληθυσμός στηλών άλλαξε
      state.columns.forEach(function (c, i) { c.pos = i; });

      editingColId = null;
      $("dlg-col").close();
      save(); renderAll();
    });
  }

  function boot() {
    document.documentElement.setAttribute("lang", LANG);
    applyI18n();
    load();
    wire();
    registerSync();       // ΠΡΕΠΕΙ μετά το load(): το sliceGet διαβάζει state
    inheritPalette();
    watchPalette();
    scheduleRender();
  }

  boot();
})();