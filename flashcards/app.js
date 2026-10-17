// ============================================================
// orOS Flashcards — the app inside the shell frame
// Decks + day start: slice "flashcards" (localStorage oros-flashcards-data).
// Notes and answers: files on the orOS disk that only this device
// writes (core.js header). Schedules: replayed through FSRS (fsrs.js).
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → read the disk → take a pending deep link.
// Rules: R8 (shell APIs from window.parent, guarded, so ?standalone
// works), 5-argument registerSlice, a pulled slice never marks dirty
// (R6), user text only through textContent.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("flashcards/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "flashcards";
  var STORAGE_KEY = "oros-flashcards-data";
  var DEV_KEY = "oros-flashcards-dev";        // device-local: this device's file id, never synced
  var PREFS_KEY = "oros-flashcards-prefs";    // device-local: last deck, last card kind
  var C = window.FlashcardsCore, F = window.FlashcardsFsrs;

  // ---------- 1. Language (every string in English and Greek) ----------
  var STR = {
    en: {
      "app.name": "Flashcards",
      "btn.back": "Back", "btn.newDeck": "New deck", "btn.addCard": "Add card", "btn.settings": "Settings",
      "btn.study": "Study", "btn.deckSettings": "Deck settings", "btn.more": "Show more", "btn.undo": "Undo",
      "btn.edit": "Edit", "btn.backDecks": "Back to decks", "btn.show": "Show answer", "btn.delete": "Delete",
      "btn.cancel": "Cancel", "btn.save": "Save", "btn.saveNext": "Save and add another", "btn.create": "Create",
      "btn.ok": "OK", "btn.cloze": "Make a gap", "btn.clozeSame": "Gap with the same number",
      "g.1": "Again", "g.2": "Hard", "g.3": "Good", "g.4": "Easy",
      "nofs": "Flashcards keeps cards on the orOS disk. Open it inside orOS to save them.",
      "home.emptyTitle": "No decks yet",
      "home.empty": "A deck holds cards on one subject. Make your first deck, then add cards to it.",
      "home.unsorted": "Cards without a deck",
      "home.cards": "{n} cards", "home.card1": "1 card",
      "filter.label": "Find a card", "filter.ph": "Find a card…",
      "deck.empty": "No cards in this deck yet. Press Add card.",
      "deck.none": "No card matches.",
      "deck.sub": "{n} cards in all, {d} decks inside",
      "deck.subOne": "{n} cards in all",
      "cnt.new": "New", "cnt.learn": "Learning", "cnt.due": "To review",
      "st.new": "New", "st.learn": "Learning", "st.due": "Due {d}", "st.today": "Due today",
      "kind.basic": "Basic", "kind.rev": "Basic and reversed", "kind.cloze": "Fill in the gap",
      "study.doneTitle": "Done for now",
      "study.done": "No more cards to study in this deck today.",
      "study.later": "More cards come back at {t}. Leave the app open or come back then.",
      "study.empty": "This deck has nothing to study right now.",
      "dlg.newDeck": "New deck", "dlg.deck": "Deck settings", "dlg.newCard": "Add card", "dlg.editCard": "Edit card",
      "dlg.settings": "Flashcards settings",
      "f.name": "Name", "f.parent": "Inside deck", "f.top": "(top level)",
      "f.nd": "New cards per day", "f.rd": "Reviews per day", "f.ret": "How much to remember",
      "f.retHint": "The scheduler shows each card just before you would forget it. A higher aim means more reviews.",
      "f.deck": "Deck", "f.kind": "Card type", "f.front": "Front", "f.back": "Back", "f.text": "Text",
      "f.extra": "Extra (shown with the answer)", "f.tags": "Tags (separated by spaces)",
      "f.clozeHint": "Select words and press Make a gap. Each gap number becomes its own card.",
      "f.dayStart": "A new study day starts at",
      "f.where": "Your decks and settings sync with orOS sync. Cards and your answers are files in the orOS disk folder Flashcards, so they also follow you to your other devices, and nothing gets lost when two devices study offline.",
      "need.name": "Give the deck a name.",
      "need.front": "Write something on the front.",
      "need.cloze": "Make at least one gap: select words and press Make a gap.",
      "need.deck": "Make a deck first.",
      "saved": "Card saved", "deleted": "Deleted", "undone": "Answer undone",
      "conf.note": "Delete this card? Its answers are kept but no longer counted.",
      "conf.deck": "Delete the deck “{n}” with its {c} cards and every deck inside it?",
      "conf.deckEmpty": "Delete the deck “{n}”?",
      "full": "This device is out of storage space. The change was not saved.",
      "diskFail": "The card could not be written to the orOS disk.",
      "u.m": "{n} min", "u.h": "{n} h", "u.d": "{n} d", "u.mo": "{n} mo", "u.y": "{n} y",
      "ret.pct": "{n}%"
    },
    el: {
      "app.name": "Κάρτες μελέτης",
      "btn.back": "Πίσω", "btn.newDeck": "Νέα τράπουλα", "btn.addCard": "Νέα κάρτα", "btn.settings": "Ρυθμίσεις",
      "btn.study": "Μελέτη", "btn.deckSettings": "Ρυθμίσεις τράπουλας", "btn.more": "Περισσότερες", "btn.undo": "Αναίρεση",
      "btn.edit": "Επεξεργασία", "btn.backDecks": "Πίσω στις τράπουλες", "btn.show": "Δείξε την απάντηση", "btn.delete": "Διαγραφή",
      "btn.cancel": "Άκυρο", "btn.save": "Αποθήκευση", "btn.saveNext": "Αποθήκευση και επόμενη", "btn.create": "Δημιουργία",
      "btn.ok": "Εντάξει", "btn.cloze": "Κάνε κενό", "btn.clozeSame": "Κενό με τον ίδιο αριθμό",
      "g.1": "Ξανά", "g.2": "Δύσκολη", "g.3": "Καλή", "g.4": "Εύκολη",
      "nofs": "Οι κάρτες αποθηκεύονται στον δίσκο του orOS. Άνοιξε την εφαρμογή μέσα από το orOS για να αποθηκευτούν.",
      "home.emptyTitle": "Δεν υπάρχουν τράπουλες ακόμα",
      "home.empty": "Μια τράπουλα κρατά κάρτες για ένα θέμα. Φτιάξε την πρώτη σου τράπουλα και πρόσθεσε κάρτες σε αυτήν.",
      "home.unsorted": "Κάρτες χωρίς τράπουλα",
      "home.cards": "{n} κάρτες", "home.card1": "1 κάρτα",
      "filter.label": "Βρες μια κάρτα", "filter.ph": "Βρες μια κάρτα…",
      "deck.empty": "Η τράπουλα δεν έχει κάρτες ακόμα. Πάτησε Νέα κάρτα.",
      "deck.none": "Καμία κάρτα δεν ταιριάζει.",
      "deck.sub": "{n} κάρτες συνολικά, {d} τράπουλες μέσα",
      "deck.subOne": "{n} κάρτες συνολικά",
      "cnt.new": "Νέες", "cnt.learn": "Σε εκμάθηση", "cnt.due": "Για επανάληψη",
      "st.new": "Νέα", "st.learn": "Σε εκμάθηση", "st.due": "Επανάληψη {d}", "st.today": "Επανάληψη σήμερα",
      "kind.basic": "Απλή", "kind.rev": "Απλή και αντίστροφη", "kind.cloze": "Συμπλήρωσε το κενό",
      "study.doneTitle": "Τελείωσες για τώρα",
      "study.done": "Δεν έχει άλλες κάρτες για μελέτη σε αυτή την τράπουλα σήμερα.",
      "study.later": "Κι άλλες κάρτες επιστρέφουν στις {t}. Άφησε την εφαρμογή ανοιχτή ή γύρνα τότε.",
      "study.empty": "Η τράπουλα δεν έχει τίποτα για μελέτη αυτή τη στιγμή.",
      "dlg.newDeck": "Νέα τράπουλα", "dlg.deck": "Ρυθμίσεις τράπουλας", "dlg.newCard": "Νέα κάρτα", "dlg.editCard": "Επεξεργασία κάρτας",
      "dlg.settings": "Ρυθμίσεις: Κάρτες μελέτης",
      "f.name": "Όνομα", "f.parent": "Μέσα στην τράπουλα", "f.top": "(στο πρώτο επίπεδο)",
      "f.nd": "Νέες κάρτες τη μέρα", "f.rd": "Επαναλήψεις τη μέρα", "f.ret": "Πόσο να θυμάσαι",
      "f.retHint": "Ο προγραμματισμός δείχνει κάθε κάρτα λίγο πριν την ξεχάσεις. Υψηλότερος στόχος σημαίνει περισσότερες επαναλήψεις.",
      "f.deck": "Τράπουλα", "f.kind": "Τύπος κάρτας", "f.front": "Μπροστά", "f.back": "Πίσω", "f.text": "Κείμενο",
      "f.extra": "Επιπλέον (φαίνεται με την απάντηση)", "f.tags": "Ετικέτες (χωρισμένες με κενά)",
      "f.clozeHint": "Επίλεξε λέξεις και πάτησε Κάνε κενό. Κάθε αριθμός κενού γίνεται ξεχωριστή κάρτα.",
      "f.dayStart": "Η νέα μέρα μελέτης ξεκινά στις",
      "f.where": "Οι τράπουλες και οι ρυθμίσεις συγχρονίζονται με το sync του orOS. Οι κάρτες και οι απαντήσεις σου είναι αρχεία στον φάκελο Flashcards του δίσκου του orOS, οπότε σε ακολουθούν κι αυτές στις άλλες συσκευές σου και δεν χάνεται τίποτα όταν δύο συσκευές μελετούν offline.",
      "need.name": "Δώσε όνομα στην τράπουλα.",
      "need.front": "Γράψε κάτι στο μπροστά μέρος.",
      "need.cloze": "Φτιάξε τουλάχιστον ένα κενό: επίλεξε λέξεις και πάτησε Κάνε κενό.",
      "need.deck": "Φτιάξε πρώτα μια τράπουλα.",
      "saved": "Η κάρτα αποθηκεύτηκε", "deleted": "Διαγράφηκε", "undone": "Η απάντηση αναιρέθηκε",
      "conf.note": "Να διαγραφεί αυτή η κάρτα; Οι απαντήσεις της μένουν αλλά δεν μετράνε πια.",
      "conf.deck": "Να διαγραφεί η τράπουλα «{n}» με τις {c} κάρτες της και όλες τις τράπουλες μέσα της;",
      "conf.deckEmpty": "Να διαγραφεί η τράπουλα «{n}»;",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε.",
      "diskFail": "Η κάρτα δεν γράφτηκε στον δίσκο του orOS.",
      "u.m": "{n} λεπ.", "u.h": "{n} ώρ.", "u.d": "{n} ημ.", "u.mo": "{n} μήν.", "u.y": "{n} έτ.",
      "ret.pct": "{n}%"
    }
  };

  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);   // other languages: translators' packs
  function locale() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  function t(k, vars) {
    var s = (STR[LANG] || STR.en)[k] || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-label]"), function (n) {
      n.setAttribute("aria-label", t(n.getAttribute("data-i18n-label")));
      n.title = t(n.getAttribute("data-i18n-label"));
    });
    document.title = t("app.name") + " · orOS";
  }
  function ivlText(ms) {
    var p = C.ivlParts(ms);
    return t("u." + p.u, { n: p.n.toLocaleString(locale()) });
  }

  // ---------- 2. Data ----------
  var slice = C.empty();          // decks + settings (synced slice)
  var notes = {};                 // id → newest note version (all devices)
  var reviews = [];               // every answer, sorted (all devices)
  var sched = {};                 // card key → { note, ord, deck, card, first, revs }
  var dev = "";                   // this device's file id
  var mine = { notes: null, reviews: null };   // { path, items } of this device's current files
  var disk = false;               // the orOS disk is reachable
  var writeChain = Promise.resolve();

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || null; } catch (e) { return null; }
  }
  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function prefs() { try { return JSON.parse(readLS(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setPref(k, v) { var p = prefs(); p[k] = v; writeLS(PREFS_KEY, JSON.stringify(p)); }

  function deviceId() {
    var id = readLS(DEV_KEY);
    if (!id || !C.DEV_RE.test(id)) { id = C.newDevId(); writeLS(DEV_KEY, id); }
    return id;
  }

  function load() {
    try { slice = C.normalize(JSON.parse(readLS(STORAGE_KEY) || "null")); }
    catch (e) { slice = C.empty(); }
    dev = deviceId();
  }
  function persist() {
    if (writeLS(STORAGE_KEY, C.serialize(slice))) return true;
    toast(t("full"));
    return false;
  }
  // Every deck edit by the user ends here: write, then tell sync.
  function saveSlice(next) {
    slice = next;
    if (!persist()) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    rebuild();
  }
  function sliceGet() { return C.normalize(slice); }
  function sliceSet(incoming) {
    var merged = C.merge(slice, incoming);
    if (C.serialize(merged) === C.serialize(slice)) return;
    slice = merged;
    persist();
    rebuild();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }   // 5 args, always
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  // ---------- 3. The disk: read every device's files, write our own ----------
  function listDir(Fs, dir) {
    return Fs.ls(dir).catch(function (e) {
      if (e && e.code === "ENOENT") return [];
      throw e;
    }).then(function (list) {
      return (list || []).filter(function (e) { return e && !e.dir && C.parseFileName(e.name); }).map(function (e) { return e.name; });
    });
  }
  function readAll(Fs, dir, kind) {
    return listDir(Fs, dir).then(function (names) {
      return Promise.all(names.map(function (name) {
        return Fs.readText(dir + "/" + name).then(function (txt) {
          return { name: name, items: C.readFile(txt, kind) || [] };
        }, function () { return { name: name, items: [] }; });
      }));
    });
  }
  var loading = null, reloadAgain = false;
  function loadDisk() {
    var Fs = fsApi();
    if (!Fs || typeof Fs.ls !== "function") { disk = false; $("nofs").hidden = false; return Promise.resolve(); }
    if (loading) { reloadAgain = true; return loading; }
    loading = Promise.resolve(typeof Fs.ready === "function" ? Fs.ready() : null).then(function () {
      return Promise.all([readAll(Fs, C.NOTES_DIR, "notes"), readAll(Fs, C.REVIEWS_DIR, "reviews")]);
    }).then(function (res) {
      disk = true;
      $("nofs").hidden = true;
      var nmap = {}, revs = [], now = Date.now();
      var myNotes = C.fileName(dev, now), myRevs = C.fileName(dev, now);
      res[0].forEach(function (f) {
        nmap = C.foldNotes(nmap, f.items);
        if (f.name === myNotes && !mine.notes) mine.notes = { path: C.NOTES_DIR + "/" + f.name, items: f.items };
      });
      res[1].forEach(function (f) {
        revs = C.mergeReviews(revs, f.items);
        if (f.name === myRevs && !mine.reviews) mine.reviews = { path: C.REVIEWS_DIR + "/" + f.name, items: f.items };
      });
      // What this device wrote and has not reached the disk yet stays in.
      if (mine.notes) nmap = C.foldNotes(nmap, mine.notes.items);
      if (mine.reviews) revs = C.mergeReviews(revs, mine.reviews.items);
      notes = nmap;
      reviews = revs;
    }).catch(function (e) {
      console.warn("[flashcards] disk read failed", e);
      disk = false;
      $("nofs").hidden = false;
    }).then(function () {
      loading = null;
      rebuild();
      if (reloadAgain) { reloadAgain = false; return loadDisk(); }
    });
    return loading;
  }
  // Our own file of this month (a new month starts a new file).
  function ownFile(kind) {
    var now = Date.now();
    var path = kind === "notes" ? C.notesPath(dev, now) : C.reviewsPath(dev, now);
    if (!mine[kind] || mine[kind].path !== path) mine[kind] = { path: path, items: [] };
    return mine[kind];
  }
  function writeOwn(kind) {
    var f = mine[kind];
    if (!f) return Promise.resolve(true);
    var Fs = fsApi();
    if (!disk || !Fs || typeof Fs.writeText !== "function") return Promise.resolve(false);
    var text = C.writeFile(kind, dev, f.items);
    writeChain = writeChain.then(function () { return Fs.writeText(f.path, text); })
      .then(function () { return true; }, function (e) {
        console.warn("[flashcards] write failed", e);
        toast(t("diskFail"));
        return false;
      });
    return writeChain;
  }
  function saveNotes(versions) {
    var f = ownFile("notes");
    f.items = C.mergeNotes(f.items, versions);
    notes = C.foldNotes(notes, versions);
    rebuild();
    return writeOwn("notes");
  }
  var revTimer = 0;
  function addReviewRow(row) {
    var f = ownFile("reviews");
    f.items.push(row);
    reviews.push(row);
    if (reviews.length > 1 && reviews[reviews.length - 2].t > row.t) {
      reviews = C.mergeReviews(reviews, []);
    }
    clearTimeout(revTimer);
    revTimer = setTimeout(function () { writeOwn("reviews"); }, 800);
  }
  function flushReviews() {
    if (!revTimer) return;
    clearTimeout(revTimer);
    revTimer = 0;
    writeOwn("reviews");
  }
  var seq = 0;
  function rowId(now) { return "r" + now.toString(36) + dev + (seq++).toString(36); }

  function rebuild() {
    sched = C.schedule(slice, notes, reviews, F);
    render();
  }

  // ---------- 4. Palette: follow the shell's theme and skin (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- 5. Screen helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }
  function deckById(id) { return C.normalize(slice).decks.filter(function (x) { return x.id === id; })[0] || null; }
  function deckName(id) {
    if (id === C.DEFAULT_DECK) return t("home.unsorted");
    var d = deckById(id);
    return d ? d.n || "…" : t("home.unsorted");
  }
  function countsNode(q) {
    var box = el("span", "counts");
    [["cn", q.n, "cnt.new"], ["cl", q.l, "cnt.learn"], ["cr", q.r, "cnt.due"]].forEach(function (x) {
      var s = el("span", x[1] ? x[0] : "zero", String(x[1]));
      s.title = t(x[2]);
      s.setAttribute("aria-label", t(x[2]) + ": " + x[1]);
      box.appendChild(s);
    });
    return box;
  }
  function cardsIn(ids) {
    var n = 0;
    Object.keys(notes).forEach(function (id) {
      var x = notes[id];
      if (!x.del && ids[deckById(x.dk) ? x.dk : C.DEFAULT_DECK]) n += C.ords(x).length;
    });
    return n;
  }
  function plural(n) { return n === 1 ? t("home.card1") : t("home.cards", { n: n }); }
  function hasOrphans() {
    return Object.keys(notes).some(function (id) { return !notes[id].del && !deckById(notes[id].dk); });
  }

  // ---------- 6. Views ----------
  var view = "home", curDeck = "", shown = 300;
  function show(v) {
    view = v;
    document.body.classList.toggle("studying", v === "study");
    $("home").hidden = v !== "home";
    $("deck-view").hidden = v !== "deck";
    $("study").hidden = v !== "study";
    $("back-btn").hidden = v === "home";
    $("new-deck-btn").hidden = v !== "home";
    $("add-card-btn").hidden = v === "study";
    $("settings-btn").hidden = v === "study";
    if (v !== "study") stopLaterTimer();
    render();
  }
  function render() {
    if (view === "home") renderHome();
    else if (view === "deck") renderDeck();
    else if (view === "study") renderStudyCounts();
  }

  function renderHome() {
    $("title").textContent = t("app.name");
    var list = $("deck-list"), tree = C.deckTree(slice), now = Date.now();
    list.textContent = "";
    var rows = tree.map(function (x) { return { id: x.deck.id, n: x.deck.n || "…", depth: x.depth }; });
    if (hasOrphans()) rows.push({ id: C.DEFAULT_DECK, n: t("home.unsorted"), depth: 0 });
    rows.forEach(function (r) {
      var li = el("li");
      li.tabIndex = 0;
      li.dataset.id = r.id;
      li.style.paddingLeft = (10 + Math.min(r.depth, 6) * 18) + "px";
      var name = el("span", "name", r.n);
      name.appendChild(el("span", "sub", plural(cardsIn(C.subtree(slice, r.id)))));
      li.appendChild(name);
      li.appendChild(countsNode(C.studyQueue(slice, sched, reviews, r.id, now)));
      var go = el("button", "chip", t("btn.study"));
      go.type = "button";
      go.addEventListener("click", function (ev) { ev.stopPropagation(); startStudy(r.id); });
      li.appendChild(go);
      li.addEventListener("click", function () { openDeck(r.id); });
      li.addEventListener("keydown", function (ev) { if (ev.code === "Enter") openDeck(r.id); });
      list.appendChild(li);
    });
    if (rows.length) {
      var add = el("li", "add-row");
      var b = el("button", "chip", "+ " + t("btn.newDeck"));
      b.type = "button";
      b.addEventListener("click", function (ev) { ev.stopPropagation(); deckDialog(""); });
      add.appendChild(b);
      add.style.cursor = "default";
      add.style.background = "none";
      add.style.border = "0";
      list.appendChild(add);
    }
    $("home-empty").hidden = rows.length > 0;
  }

  function openDeck(id) {
    curDeck = id;
    shown = 300;
    $("filter").value = "";
    setPref("deck", id);
    show("deck");
  }
  function cardState(key) {
    var c = sched[key];
    if (!c || !c.card.st) return t("st.new");
    if (c.card.st === 1 || c.card.st === 3) return t("st.learn");
    if (c.card.due < C.dayEnd(Date.now(), slice.set.ro)) return t("st.today");
    return t("st.due", { d: new Date(c.card.due).toLocaleDateString(locale(), { day: "numeric", month: "short" }) });
  }
  // Case, accents and final sigma folded (\u03c2 → \u03c3) for the card filter.
  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u03c2/g, "\u03c3"); }
  function renderDeck() {
    $("title").textContent = deckName(curDeck);
    var ids = C.subtree(slice, curDeck), now = Date.now();
    var q = C.studyQueue(slice, sched, reviews, curDeck, now);
    var box = $("deck-counts");
    box.textContent = "";
    box.appendChild(countsNode(q));
    $("study-btn").disabled = !q.queue.length;
    $("deck-edit-btn").hidden = curDeck === C.DEFAULT_DECK;
    var kids = Object.keys(ids).length - 1, total = cardsIn(ids);
    $("deck-note").textContent = kids > 0 ? t("deck.sub", { n: total, d: kids }) : t("deck.subOne", { n: total });
    var words = fold($("filter").value).split(/\s+/).filter(Boolean);
    var list = $("card-list");
    list.textContent = "";
    var all = C.liveNotes(notes).filter(function (n) { return ids[deckById(n.dk) ? n.dk : C.DEFAULT_DECK]; });
    var hits = all.filter(function (n) {
      if (!words.length) return true;
      var hay = fold([C.noteTitle(n), n.f.a || "", n.f.e || "", n.tg.join(" ")].join(" "));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    hits.slice(0, shown).forEach(function (n) {
      var li = el("li");
      li.tabIndex = 0;
      li.dataset.id = n.id;
      var name = el("span", "name", C.noteTitle(n) || "…");
      var o = C.ords(n);
      var sub = t("kind." + n.k) + (o.length ? " · " + cardState(C.cardKey(n.id, o[0])) : "");
      if (n.tg.length) sub += " · " + n.tg.map(function (x) { return "#" + x; }).join(" ");
      if (kids > 0 && n.dk !== curDeck) sub += " · " + deckName(n.dk);
      name.appendChild(el("span", "sub", sub));
      li.appendChild(name);
      li.addEventListener("click", function () { noteDialog(n.id); });
      li.addEventListener("keydown", function (ev) { if (ev.code === "Enter") noteDialog(n.id); });
      list.appendChild(li);
    });
    $("more-cards").hidden = hits.length <= shown;
    $("deck-empty").hidden = all.length > 0;
    if (all.length && !hits.length) { $("deck-empty").hidden = false; $("deck-empty").textContent = t("deck.none"); }
    else $("deck-empty").textContent = t("deck.empty");
  }

  // ---------- 7. Study ----------
  var study = { deck: "", key: "", shownAt: 0, back: false, undo: [], last: "" };
  var laterTimer = 0;
  function stopLaterTimer() { clearTimeout(laterTimer); laterTimer = 0; }
  function startStudy(id) {
    curDeck = id;
    study = { deck: id, key: "", shownAt: 0, back: false, undo: [], last: "" };
    $("title").textContent = deckName(id);
    show("study");
    nextCard();
  }
  function paramsFor(deckId) {
    var d = deckById(deckId);
    return F.params({ ret: d ? d.cfg.ret : C.CFG_DEF.ret });
  }
  function renderStudyCounts() {
    var q = C.studyQueue(slice, sched, reviews, study.deck, Date.now());
    var box = $("study-counts");
    box.textContent = "";
    box.appendChild(countsNode(q));
    $("undo-btn").disabled = !study.undo.length;
    $("title").textContent = deckName(study.deck);
    // A card edited or deleted elsewhere: show the current state.
    if (study.key && !sched[study.key]) nextCard();
    return q;
  }
  function nextCard() {
    stopLaterTimer();
    var now = Date.now();
    var q = C.studyQueue(slice, sched, reviews, study.deck, now);
    var key = q.queue[0] || "";
    if (key && key === study.last && q.queue.length > 1) key = q.queue[1];
    study.key = key;
    study.back = false;
    renderStudyCounts();
    var has = !!key;
    $("card-box").hidden = !has;
    $("study-foot").hidden = !has;
    $("done-box").hidden = has;
    $("edit-cur-btn").hidden = !has;
    if (!has) {
      $("done-text").textContent = q.next ? t("study.later", { t: new Date(q.next).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })
        : (study.undo.length ? t("study.done") : t("study.empty"));
      if (q.next) laterTimer = setTimeout(nextCard, Math.max(1000, Math.min(q.next - Date.now() - 20 * 60000 + 1000, 2147483000)));
      return;
    }
    study.shownAt = now;
    drawCard();
    $("show-btn").hidden = false;
    $("grade-btns").hidden = true;
    $("show-btn").focus({ preventScroll: true });
  }
  function drawSide(box, note, ord, back) {
    box.textContent = "";
    if (note.k === "cloze") {
      C.clozeSegments(note.f.x, ord, back).forEach(function (s) {
        if ("t" in s) box.appendChild(document.createTextNode(s.t));
        else if ("a" in s) box.appendChild(el("span", "ans", s.a));
        else box.appendChild(el("span", "gap", "[" + (s.h || "…") + "]"));
      });
      if (back && note.f.e) box.appendChild(el("span", "extra", note.f.e));
      return;
    }
    var txt = C.cardText(note, ord);
    box.textContent = back ? txt.back : txt.front;
  }
  function drawCard() {
    var c = sched[study.key];
    if (!c) return;
    var cloze = c.note.k === "cloze";
    drawSide($("side-front"), c.note, c.ord, cloze && study.back);
    $("side-line").hidden = !study.back || cloze;
    $("side-back").hidden = !study.back || cloze;
    if (study.back && !cloze) drawSide($("side-back"), c.note, c.ord, true);
  }
  function showAnswer() {
    if (view !== "study" || !study.key || study.back) return;
    study.back = true;
    drawCard();
    var c = sched[study.key], now = Date.now();
    var pv = F.preview(c.card, now, paramsFor(c.deck));
    [].forEach.call(document.querySelectorAll("#grade-btns .grade"), function (b) {
      var g = +b.dataset.g;
      b.querySelector(".gi").textContent = ivlText(pv[g].due - now);
    });
    $("show-btn").hidden = true;
    $("grade-btns").hidden = false;
    var good = document.querySelector("#grade-btns .g3");
    if (good) good.focus({ preventScroll: true });
  }
  function answer(g) {
    if (view !== "study" || !study.key || !study.back) return;
    var c = sched[study.key];
    if (!c) { nextCard(); return; }
    var now = Math.max(Date.now(), c.card.last + 1);
    var row = { i: rowId(now), c: study.key, t: now, g: g, ms: Math.min(3599999, now - study.shownAt) };
    addReviewRow(row);
    // Only this card changes: step it here instead of replaying everything.
    c.card = F.next(c.card, now, g, paramsFor(c.deck));
    c.revs++;
    if (!c.first) c.first = now;
    study.undo.push({ row: row.i, key: study.key });
    if (study.undo.length > 50) study.undo.shift();
    study.last = study.key;
    nextCard();
  }
  function undoAnswer() {
    var u = study.undo.pop();
    if (!u) return;
    var now = Date.now();
    addReviewRow({ i: rowId(now), u: u.row, t: now });
    sched = C.schedule(slice, notes, reviews, F);
    study.last = "";
    toast(t("undone"));
    stopLaterTimer();
    if (sched[u.key]) {
      study.key = u.key;
      study.back = false;
      study.shownAt = now;
      $("card-box").hidden = false;
      $("study-foot").hidden = false;
      $("done-box").hidden = true;
      $("edit-cur-btn").hidden = false;
      renderStudyCounts();
      drawCard();
      $("show-btn").hidden = false;
      $("grade-btns").hidden = true;
    } else nextCard();
  }

  // ---------- 8. Dialogs ----------
  var dlg = null;   // { ok(), alt?(), del?() }
  function openDialog(title, body, opts) {
    $("dlg-title").textContent = title;
    var b = $("dlg-body");
    b.textContent = "";
    if (body) b.appendChild(body);
    $("dlg-ok").textContent = opts.okText || t("btn.save");
    $("dlg-alt").hidden = !opts.alt;
    if (opts.alt) $("dlg-alt").textContent = opts.altText;
    $("dlg-del").hidden = !opts.del;
    $("dlg-cancel").hidden = !!opts.noCancel;
    dlg = opts;
    $("veil").hidden = false;
    var first = b.querySelector("input, select, textarea");
    (first || $("dlg-ok")).focus();
  }
  function closeDialog() { $("veil").hidden = true; dlg = null; }
  function field(labelKey, input) {
    var l = el("label", "field");
    l.appendChild(el("span", "", t(labelKey)));
    l.appendChild(input);
    return l;
  }
  function input(type, value, max) {
    var i = el("input");
    i.type = type;
    if (max) i.maxLength = max;
    i.value = value == null ? "" : String(value);
    return i;
  }
  function select(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    return s;
  }
  function textarea(value) {
    var a = el("textarea");
    a.maxLength = C.LIMITS.field;
    a.value = value || "";
    return a;
  }
  function confirmBox(text, okText, onOk) {
    var p = el("p", "", text);
    openDialog(t("btn.delete"), p, { okText: okText, ok: function () { closeDialog(); onOk(); } });
  }
  function deckOptions(skip) {
    return C.deckTree(slice).filter(function (x) { return !skip || !skip[x.deck.id]; }).map(function (x) {
      return [x.deck.id, new Array(x.depth + 1).join("— ") + (x.deck.n || "…")];
    });
  }

  function deckDialog(id) {
    var d = id ? deckById(id) : null;
    var body = el("div");
    var name = input("text", d ? d.n : "", C.LIMITS.name);
    body.appendChild(field("f.name", name));
    var skip = id ? C.subtree(slice, id) : null;
    var par = select([["", t("f.top")]].concat(deckOptions(skip)), d && d.par ? d.par : (id ? "" : (view === "deck" && curDeck !== C.DEFAULT_DECK ? curDeck : "")));
    body.appendChild(field("f.parent", par));
    var cfg = d ? d.cfg : C.CFG_DEF;
    var two = el("div", "two");
    var nd = input("number", cfg.nd); nd.min = 0; nd.max = 9999;
    var rd = input("number", cfg.rd); rd.min = 0; rd.max = 99999;
    two.appendChild(field("f.nd", nd));
    two.appendChild(field("f.rd", rd));
    body.appendChild(two);
    var rets = [0.8, 0.85, 0.9, 0.93, 0.95, 0.97];
    if (rets.indexOf(cfg.ret) < 0) rets.push(cfg.ret);
    var ret = select(rets.sort().map(function (r) { return [String(r), t("ret.pct", { n: Math.round(r * 100) })]; }), String(cfg.ret));
    body.appendChild(field("f.ret", ret));
    body.appendChild(el("p", "hint", t("f.retHint")));
    openDialog(t(id ? "dlg.deck" : "dlg.newDeck"), body, {
      okText: t(id ? "btn.save" : "btn.create"),
      ok: function () {
        var n = name.value.replace(/\s+/g, " ").trim();
        if (!n) { toast(t("need.name")); name.focus(); return; }
        var c = { nd: +nd.value, rd: +rd.value, ret: +ret.value };
        var now = Date.now();
        if (id) saveSlice(C.updateDeck(slice, id, { n: n, par: par.value, cfg: c }, now));
        else {
          var newId = C.newId("d", now);
          saveSlice(C.addDeck(slice, n, now, { id: newId, par: par.value || undefined, cfg: c }));
          id = newId;
        }
        closeDialog();
        if (view === "study") render(); else openDeck(id);
      },
      del: id ? function () { deleteDeck(id); } : null
    });
  }
  function deleteDeck(id) {
    var d = deckById(id);
    if (!d) return;
    var ids = C.subtree(slice, id), count = cardsIn(ids);
    confirmBox(count ? t("conf.deck", { n: d.n, c: count }) : t("conf.deckEmpty", { n: d.n }), t("btn.delete"), function () {
      var now = Date.now(), next = slice;
      Object.keys(ids).forEach(function (x) { if (x !== C.DEFAULT_DECK) next = C.removeDeck(next, x, now); });
      var gone = Object.keys(notes).filter(function (n) { return !notes[n].del && ids[notes[n].dk]; })
        .map(function (n) { return { id: n, m: Math.max(now, notes[n].m + 1), del: 1 }; });
      saveSlice(next);
      if (gone.length) saveNotes(gone);
      toast(t("deleted"));
      show("home");
    });
  }

  function settingsDialog() {
    var body = el("div");
    var hours = [];
    for (var h = 0; h < 24; h++) hours.push([String(h), (h < 10 ? "0" : "") + h + ":00"]);
    var ro = select(hours, String(slice.set.ro));
    body.appendChild(field("f.dayStart", ro));
    body.appendChild(el("p", "hint", t("f.where")));
    openDialog(t("dlg.settings"), body, {
      ok: function () {
        if (+ro.value !== slice.set.ro) saveSlice(C.setDayStart(slice, +ro.value, Date.now()));
        closeDialog();
      }
    });
  }

  function noteDialog(id, preset) {
    var n = id ? notes[id] : null;
    if (id && (!n || n.del)) return;
    var decks = deckOptions(null);
    if (!decks.length && !n) { toast(t("need.deck")); deckDialog(""); return; }
    var p = prefs();
    var deckDefault = n ? n.dk : (view !== "home" && deckById(curDeck) ? curDeck : (deckById(p.deck) ? p.deck : (decks[0] ? decks[0][0] : C.DEFAULT_DECK)));
    if (n && !deckById(n.dk)) decks.unshift([C.DEFAULT_DECK, t("home.unsorted")]);
    var kind = n ? n.k : (preset && preset.k) || (["basic", "rev", "cloze"].indexOf(p.kind) >= 0 ? p.kind : "basic");
    var body = el("div");
    var two = el("div", "two");
    var deckSel = select(decks, deckDefault);
    var kindSel = select([["basic", t("kind.basic")], ["rev", t("kind.rev")], ["cloze", t("kind.cloze")]], kind);
    two.appendChild(field("f.deck", deckSel));
    two.appendChild(field("f.kind", kindSel));
    body.appendChild(two);
    var q = textarea(n && n.k !== "cloze" ? n.f.q : (preset && preset.q) || "");
    var a = textarea(n && n.k !== "cloze" ? n.f.a : (preset && preset.a) || "");
    var x = textarea(n && n.k === "cloze" ? n.f.x : (preset && preset.x) || "");
    var e = textarea(n && n.k === "cloze" ? n.f.e : "");
    var fq = field("f.front", q), fa = field("f.back", a), fx = field("f.text", x), fe = field("f.extra", e);
    var bar = el("div", "cloze-bar");
    var cz = el("button", "chip", t("btn.cloze")); cz.type = "button";
    var cz2 = el("button", "chip", t("btn.clozeSame")); cz2.type = "button";
    bar.appendChild(cz); bar.appendChild(cz2);
    bar.appendChild(el("p", "hint", t("f.clozeHint")));
    [fq, fa, fx, bar, fe].forEach(function (f) { body.appendChild(f); });
    var tags = input("text", n ? n.tg.join(" ") : "", 600);
    body.appendChild(field("f.tags", tags));
    function sync() {
      var c = kindSel.value === "cloze";
      fq.hidden = fa.hidden = c;
      fx.hidden = fe.hidden = bar.hidden = !c;
    }
    kindSel.addEventListener("change", function () {
      // Carry the text over when the type changes.
      if (kindSel.value === "cloze" && !x.value && q.value) x.value = q.value + (a.value ? "\n" + a.value : "");
      if (kindSel.value !== "cloze" && !q.value && x.value) q.value = x.value.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1");
      sync();
    });
    function makeGap(same) {
      var nums = C.clozeNums(x.value), num = nums.length ? nums[nums.length - 1] + (same ? 0 : 1) : 1;
      var s = x.selectionStart, en = x.selectionEnd, v = x.value;
      var mid = v.slice(s, en) || "…";
      var ins = "{{c" + num + "::" + mid + "}}";
      x.value = v.slice(0, s) + ins + v.slice(en);
      x.focus();
      x.setSelectionRange(s + ins.length, s + ins.length);
    }
    cz.addEventListener("click", function () { makeGap(false); });
    cz2.addEventListener("click", function () { makeGap(true); });
    sync();
    function collect() {
      var k = kindSel.value, now = Date.now();
      var v = { id: n ? n.id : C.newId("n", now), m: n ? Math.max(now, n.m + 1) : now, k: k, dk: deckSel.value,
        tg: tags.value.split(/[\s,]+/) };
      if (k === "cloze") {
        if (!C.clozeNums(x.value).length) { toast(t("need.cloze")); x.focus(); return null; }
        v.f = { x: x.value, e: e.value };
      } else {
        if (!q.value.trim()) { toast(t("need.front")); q.focus(); return null; }
        v.f = { q: q.value, a: a.value };
      }
      return C.normNote(v);
    }
    function store(v) {
      setPref("kind", v.k);
      setPref("deck", v.dk);
      saveNotes([v]);
      toast(t("saved"));
    }
    openDialog(t(n ? "dlg.editCard" : "dlg.newCard"), body, {
      ok: function () {
        var v = collect();
        if (!v) return;
        store(v);
        closeDialog();
        if (view === "study") { if (sched[study.key]) drawCard(); else nextCard(); }
      },
      alt: n ? null : function () {
        var v = collect();
        if (!v) return;
        store(v);
        n = null;
        q.value = a.value = x.value = e.value = "";
        (kindSel.value === "cloze" ? x : q).focus();
      },
      altText: t("btn.saveNext"),
      del: n ? function () {
        confirmBox(t("conf.note"), t("btn.delete"), function () {
          saveNotes([{ id: n.id, m: Math.max(Date.now(), n.m + 1), del: 1 }]);
          toast(t("deleted"));
          if (view === "study") nextCard();
        });
      } : null
    });
  }

  // ---------- 9. Wiring ----------
  function goBack() {
    if (!$("veil").hidden) { closeDialog(); return; }
    if (view === "study") { flushReviews(); if (curDeck && study.deck) openDeck(study.deck); else show("home"); }
    else if (view === "deck") show("home");
  }
  function wire() {
    $("back-btn").addEventListener("click", goBack);
    $("new-deck-btn").addEventListener("click", function () { deckDialog(""); });
    $("first-deck-btn").addEventListener("click", function () { deckDialog(""); });
    $("add-card-btn").addEventListener("click", function () { noteDialog(""); });
    $("settings-btn").addEventListener("click", settingsDialog);
    $("study-btn").addEventListener("click", function () { startStudy(curDeck); });
    $("deck-edit-btn").addEventListener("click", function () { deckDialog(curDeck); });
    $("filter").addEventListener("input", function () { shown = 300; renderDeck(); });
    $("more-cards").addEventListener("click", function () { shown += 300; renderDeck(); });
    $("show-btn").addEventListener("click", showAnswer);
    [].forEach.call(document.querySelectorAll("#grade-btns .grade"), function (b) {
      b.addEventListener("click", function () { answer(+b.dataset.g); });
    });
    $("undo-btn").addEventListener("click", undoAnswer);
    $("edit-cur-btn").addEventListener("click", function () {
      var c = sched[study.key];
      if (c) noteDialog(c.note.id);
    });
    $("done-back").addEventListener("click", function () { flushReviews(); show("home"); });
    $("dlg-ok").addEventListener("click", function () { if (dlg && dlg.ok) dlg.ok(); });
    $("dlg-alt").addEventListener("click", function () { if (dlg && dlg.alt) dlg.alt(); });
    $("dlg-del").addEventListener("click", function () { if (dlg && dlg.del) dlg.del(); });
    $("dlg-cancel").addEventListener("click", closeDialog);
    $("veil").addEventListener("click", function (ev) { if (ev.target === $("veil")) closeDialog(); });

    // Contract Β: Ctrl+Alt+Shift belongs to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // App keys (e.code, never e.key).
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.altKey && e.shiftKey) return;
      if (!$("veil").hidden) {
        if (e.code === "Escape") { e.preventDefault(); closeDialog(); }
        else if (e.code === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (dlg && dlg.ok) dlg.ok(); }
        return;
      }
      var tag = (e.target && e.target.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.code === "Escape" && view !== "home") { e.preventDefault(); goBack(); return; }
      if (view !== "study") return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undoAnswer(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!study.back && (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter")) { e.preventDefault(); showAnswer(); return; }
      var m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
      if (m && study.back) { e.preventDefault(); answer(+m[1]); return; }
      if (study.back && e.code === "Space") { e.preventDefault(); answer(3); }
    });

    // Our answers reach the disk before the frame goes away.
    window.addEventListener("pagehide", flushReviews);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) flushReviews();
      else loadDisk();
    });
    // Files from other devices: read again after each Vault Drive round.
    try {
      var V = window.parent && window.parent.orosVault;
      if (V && typeof V.onStatus === "function") {
        var off = V.onStatus(function (kind) { if (kind === "done") loadDisk(); });
        window.addEventListener("pagehide", function () { try { off(); } catch (e) {} });
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 10. Deep link: search hits and other apps ----------
  // target = { deck } | { note } | { study: deckId }. Unknown ids are ignored;
  // nothing happens while a dialog is open (unsaved edits win).
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object" || !$("veil").hidden) return;
    if (typeof target.note === "string") {
      var n = notes[target.note];
      if (!n || n.del) {
        // The disk may still be loading: try once more after it.
        if (loading) loading.then(function () { if (notes[target.note]) window.__orosOpenAt(target); });
        return;
      }
      openDeck(deckById(n.dk) ? n.dk : C.DEFAULT_DECK);
      noteDialog(n.id);
    } else if (typeof target.deck === "string" && (deckById(target.deck) || target.deck === C.DEFAULT_DECK)) {
      openDeck(target.deck);
    } else if (typeof target.study === "string" && (deckById(target.study) || target.study === C.DEFAULT_DECK)) {
      if (loading) loading.then(function () { startStudy(target.study); });
      else startStudy(target.study);
    }
  };
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 11. Boot (last, after every declaration) ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    show("home");
    loadDisk().then(takePending);
  }
  boot();
})();
