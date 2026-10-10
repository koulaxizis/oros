// ============================================================
// orOS Media Shelf — App logic (v1.0.0)
// A wishlist and tracker for books, films, series, music,
// podcasts and games.
//   - four states: Want → Now → Done, or Dropped; every start,
//     finish and drop is kept, so re-reads and re-watches count
//   - progress in pages, minutes, episodes or hours, with the
//     pace and a "done in ~N days" estimate
//   - half-star ratings, favourites, a short review, tags
//   - yearly goals and statistics, all derived (never stored)
//   - JSON export / import (import merges, never replaces)
// Data:
//   - synced slice "shelf" (oros-shelf-data): items LWW by mtime,
//     sessions (the progress / status log) LWW by id, goals LWW,
//     tombstones shared by items and sessions (R5, R17, R26).
//     The current page is NEVER stored: it is the highest value
//     logged since the last start, so two devices never conflict.
//   - device-local (R10): oros-shelf-prefs (tab, type filter, sort)
// Sections:
//   1. Constants, i18n, helpers
//   2. Model: normalize items, sessions, goals
//   3. Merge (sync + import)
//   4. Derived: progress, pace, completions, goal, statistics
//   5. Storage, prefs
//   6. Actions (status, progress, rating, edit, delete)
//   7. UI: toolbar, tabs, list, cards
//   8. Item dialog (details, progress, rating, history)
//   9. Edit dialog, goals dialog
//  10. Statistics view
//  11. Export / import (R33)
//  12. Toasts, keyboard (Contract Β)
//  13. Sync slice + palette
//  14. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-shelf-data";
  var PREFS_KEY   = "oros-shelf-prefs";
  var DATA_VER    = 1;
  var TYPES       = ["book", "film", "series", "album", "podcast", "game"];
  var STATES      = ["want", "now", "done", "drop"];
  var KINDS       = ["s", "p", "d", "x"];          // start, progress, done, drop
  var FORMATS     = ["p", "e", "a"];               // print, e-book, audiobook
  var TITLE_LEN   = 200;
  var BY_LEN      = 120;
  var REV_LEN     = 4000;
  var SRC_LEN     = 200;
  var PLAT_LEN    = 40;
  var TAG_LEN     = 30;
  var MAX_TAGS    = 10;
  var MAX_SIZE    = 100000;
  var MAX_ITEMS   = 5000;
  var MAX_GOAL    = 1000;
  var NCOLORS     = 10;
  var COLORS = ["#e85d75", "#f29e4c", "#f1c453", "#8bc34a", "#2ec4b6",
                "#3a86ff", "#7b61ff", "#c86bfa", "#ff7eb6", "#8d99ae"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app": "Media Shelf",
      "tab.now": "Now", "tab.want": "Wishlist", "tab.hist": "History", "tab.stats": "Statistics",
      "type.all": "All", "type.book": "Book", "type.film": "Film", "type.series": "Series",
      "type.album": "Music", "type.podcast": "Podcast", "type.game": "Game",
      "types.book": "Books", "types.film": "Films", "types.series": "Series",
      "types.album": "Music", "types.podcast": "Podcasts", "types.game": "Games",
      "st.want": "Want", "st.now.book": "Reading", "st.now.film": "Watching", "st.now.series": "Watching",
      "st.now.album": "Listening", "st.now.podcast": "Listening", "st.now.game": "Playing",
      "st.done.book": "Read", "st.done.film": "Watched", "st.done.series": "Watched",
      "st.done.album": "Listened", "st.done.podcast": "Listened", "st.done.game": "Finished",
      "st.drop": "Dropped",
      "unit.book": "pages", "unit.audio": "minutes", "unit.film": "minutes", "unit.series": "episodes",
      "unit.album": "tracks", "unit.podcast": "episodes", "unit.game": "hours",
      "size.book": "Pages", "size.audio": "Length (minutes)", "size.film": "Runtime (minutes)",
      "size.series": "Episodes", "size.album": "Tracks", "size.podcast": "Episodes", "size.game": "Hours to beat",
      "by.book": "Author", "by.film": "Director", "by.series": "Creator", "by.album": "Artist",
      "by.podcast": "Host", "by.game": "Studio",
      "fmt.p": "Print", "fmt.e": "E-book", "fmt.a": "Audiobook",
      "btn.add": "Add", "btn.more": "More", "search": "Search title, creator, tag…",
      "sort.recent": "Recent", "sort.title": "Title", "sort.by": "Creator", "sort.rating": "Rating",
      "sort.year": "Year", "sort.aria": "Sort",
      "empty.now": "Nothing in progress. Start something from your wishlist.",
      "empty.want": "Your wishlist is empty. Add a book, film, album or game you want.",
      "empty.hist": "Finished and dropped titles appear here.",
      "empty.search": "Nothing matches.",
      "empty.first": "Your shelf is empty.", "empty.firstBtn": "Add your first title",
      "prio": "High priority", "fav": "Favourite",
      "prog.at": "{v} / {n} {u}", "prog.atNo": "{v} {u}", "prog.pct": "{p}%",
      "prog.ep": "Episode {v} of {n}", "prog.epNo": "Episode {v}",
      "prog.label.book": "I'm at page", "prog.label.audio": "Minutes listened",
      "prog.label.series": "Episodes watched", "prog.label.podcast": "Episodes listened",
      "prog.label.game": "Hours played", "prog.save": "Update",
      "prog.plus1": "+1 episode", "prog.plusH": "+1 hour",
      "prog.eta": "At your pace (~{r} {u} a day) you finish in about {d} days.",
      "prog.eta1": "At your pace (~{r} {u} a day) you finish in about a day.",
      "prog.finish": "Reached the end. Mark as {st}?", "prog.markDone": "Mark done",
      "rate": "Rating", "rate.none": "Not rated", "rate.aria": "Rating, {v} of 5 stars",
      "review": "Review / notes", "review.ph": "What did you think?",
      "hist.title": "History", "hist.s": "Started", "hist.p": "Progress: {v}",
      "hist.d": "Finished", "hist.x": "Dropped", "hist.del": "Remove this entry",
      "hist.times": "Finished {n} times",
      "act.start.book": "Start reading", "act.start.film": "Start watching", "act.start.series": "Start watching",
      "act.start.album": "Start listening", "act.start.podcast": "Start listening", "act.start.game": "Start playing",
      "act.again.book": "Read again", "act.again.film": "Watch again", "act.again.series": "Watch again",
      "act.again.album": "Listen again", "act.again.podcast": "Listen again", "act.again.game": "Play again",
      "act.done": "Mark done", "act.drop": "Drop", "act.want": "Back to wishlist", "act.resume": "Resume",
      "act.edit": "Edit", "act.delete": "Delete", "act.close": "Close",
      "f.type": "Type", "f.title": "Title", "f.year": "Year", "f.fmt": "Format", "f.plat": "Platform",
      "f.tags": "Tags (comma separated)", "f.src": "Where I heard of it", "f.color": "Cover colour",
      "f.status": "Status", "f.new": "New title", "f.edit": "Edit title", "f.save": "Save", "f.cancel": "Cancel",
      "f.color.n": "Colour {n}",
      "stats.year": "Year {y}", "stats.prev": "Previous year", "stats.next": "Next year",
      "stats.done": "Finished in {y}", "stats.pages": "Pages read", "stats.avg": "Average rating",
      "stats.now": "In progress", "stats.want": "On the wishlist", "stats.months": "By month",
      "stats.top": "Top creators", "stats.tags": "Top tags", "stats.none": "Nothing finished in {y} yet.",
      "goal.title": "Goals for {y}", "goal.set": "Set goals", "goal.of": "{v} of {n}",
      "goal.ahead": "{n} ahead of schedule", "goal.behind": "{n} behind schedule", "goal.on": "On schedule",
      "goal.done": "Goal reached!", "goal.hint": "Leave 0 for no goal.", "goal.none": "No goals for {y}.",
      "menu.export": "Export (JSON)", "menu.import": "Import (JSON)",
      "toast.added": "Added to your shelf", "toast.saved": "Saved", "toast.deleted": "“{t}” deleted",
      "toast.undo": "Undo", "toast.save": "Could not save: storage is full",
      "toast.needTitle": "Give it a title", "toast.max": "Up to {n} titles",
      "toast.st": "“{t}”: {st}", "toast.entry": "Entry removed",
      "toast.exported": "Exported {n} titles", "toast.imported": "Imported: {n} titles on your shelf",
      "toast.badFile": "This is not a Media Shelf file", "toast.big": "The file is too large",
      "months": "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec"
    },
    el: {
      "app": "Το ράφι μου",
      "tab.now": "Τώρα", "tab.want": "Wishlist", "tab.hist": "Ιστορικό", "tab.stats": "Στατιστικά",
      "type.all": "Όλα", "type.book": "Βιβλίο", "type.film": "Ταινία", "type.series": "Σειρά",
      "type.album": "Μουσική", "type.podcast": "Podcast", "type.game": "Παιχνίδι",
      "types.book": "Βιβλία", "types.film": "Ταινίες", "types.series": "Σειρές",
      "types.album": "Μουσική", "types.podcast": "Podcasts", "types.game": "Παιχνίδια",
      "st.want": "Θέλω", "st.now.book": "Διαβάζω", "st.now.film": "Βλέπω", "st.now.series": "Βλέπω",
      "st.now.album": "Ακούω", "st.now.podcast": "Ακούω", "st.now.game": "Παίζω",
      "st.done.book": "Διαβάστηκε", "st.done.film": "Το είδα", "st.done.series": "Την είδα",
      "st.done.album": "Το άκουσα", "st.done.podcast": "Το άκουσα", "st.done.game": "Τερματίστηκε",
      "st.drop": "Το παράτησα",
      "unit.book": "σελίδες", "unit.audio": "λεπτά", "unit.film": "λεπτά", "unit.series": "επεισόδια",
      "unit.album": "κομμάτια", "unit.podcast": "επεισόδια", "unit.game": "ώρες",
      "size.book": "Σελίδες", "size.audio": "Διάρκεια (λεπτά)", "size.film": "Διάρκεια (λεπτά)",
      "size.series": "Επεισόδια", "size.album": "Κομμάτια", "size.podcast": "Επεισόδια", "size.game": "Ώρες για τερματισμό",
      "by.book": "Συγγραφέας", "by.film": "Σκηνοθέτης", "by.series": "Δημιουργός", "by.album": "Καλλιτέχνης",
      "by.podcast": "Παρουσιαστής", "by.game": "Studio",
      "fmt.p": "Χάρτινο", "fmt.e": "E-book", "fmt.a": "Audiobook",
      "btn.add": "Προσθήκη", "btn.more": "Περισσότερα", "search": "Αναζήτηση τίτλου, δημιουργού, ετικέτας…",
      "sort.recent": "Πρόσφατα", "sort.title": "Τίτλος", "sort.by": "Δημιουργός", "sort.rating": "Βαθμολογία",
      "sort.year": "Έτος", "sort.aria": "Ταξινόμηση",
      "empty.now": "Τίποτα σε εξέλιξη. Ξεκίνα κάτι από τη wishlist σου.",
      "empty.want": "Η wishlist είναι άδεια. Πρόσθεσε ένα βιβλίο, ταινία, δίσκο ή παιχνίδι που θέλεις.",
      "empty.hist": "Εδώ εμφανίζονται όσα τελείωσες ή παράτησες.",
      "empty.search": "Δεν βρέθηκε τίποτα.",
      "empty.first": "Το ράφι σου είναι άδειο.", "empty.firstBtn": "Πρόσθεσε τον πρώτο τίτλο",
      "prio": "Υψηλή προτεραιότητα", "fav": "Αγαπημένο",
      "prog.at": "{v} / {n} {u}", "prog.atNo": "{v} {u}", "prog.pct": "{p}%",
      "prog.ep": "Επεισόδιο {v} από {n}", "prog.epNo": "Επεισόδιο {v}",
      "prog.label.book": "Είμαι στη σελίδα", "prog.label.audio": "Λεπτά που άκουσα",
      "prog.label.series": "Επεισόδια που είδα", "prog.label.podcast": "Επεισόδια που άκουσα",
      "prog.label.game": "Ώρες παιχνιδιού", "prog.save": "Ενημέρωση",
      "prog.plus1": "+1 επεισόδιο", "prog.plusH": "+1 ώρα",
      "prog.eta": "Με τον ρυθμό σου (~{r} {u} τη μέρα) τελειώνεις σε περίπου {d} μέρες.",
      "prog.eta1": "Με τον ρυθμό σου (~{r} {u} τη μέρα) τελειώνεις σε περίπου μία μέρα.",
      "prog.finish": "Έφτασες στο τέλος. Να γίνει «{st}»;", "prog.markDone": "Τελείωσε",
      "rate": "Βαθμολογία", "rate.none": "Χωρίς βαθμολογία", "rate.aria": "Βαθμολογία, {v} από 5 αστέρια",
      "review": "Κριτική / σημειώσεις", "review.ph": "Τι σου άρεσε;",
      "hist.title": "Ιστορικό", "hist.s": "Ξεκίνησε", "hist.p": "Πρόοδος: {v}",
      "hist.d": "Τελείωσε", "hist.x": "Παρατήθηκε", "hist.del": "Αφαίρεση εγγραφής",
      "hist.times": "Ολοκληρώθηκε {n} φορές",
      "act.start.book": "Αρχίζω να διαβάζω", "act.start.film": "Αρχίζω να βλέπω", "act.start.series": "Αρχίζω να βλέπω",
      "act.start.album": "Αρχίζω να ακούω", "act.start.podcast": "Αρχίζω να ακούω", "act.start.game": "Αρχίζω να παίζω",
      "act.again.book": "Ξαναδιαβάζω", "act.again.film": "Το ξαναβλέπω", "act.again.series": "Την ξαναβλέπω",
      "act.again.album": "Το ξανακούω", "act.again.podcast": "Το ξανακούω", "act.again.game": "Το ξαναπαίζω",
      "act.done": "Τελείωσε", "act.drop": "Το παρατάω", "act.want": "Πίσω στη wishlist", "act.resume": "Συνεχίζω",
      "act.edit": "Επεξεργασία", "act.delete": "Διαγραφή", "act.close": "Κλείσιμο",
      "f.type": "Τύπος", "f.title": "Τίτλος", "f.year": "Έτος", "f.fmt": "Μορφή", "f.plat": "Πλατφόρμα",
      "f.tags": "Ετικέτες (με κόμμα)", "f.src": "Από πού το έμαθα", "f.color": "Χρώμα εξωφύλλου",
      "f.status": "Κατάσταση", "f.new": "Νέος τίτλος", "f.edit": "Επεξεργασία τίτλου", "f.save": "Αποθήκευση", "f.cancel": "Άκυρο",
      "f.color.n": "Χρώμα {n}",
      "stats.year": "Έτος {y}", "stats.prev": "Προηγούμενο έτος", "stats.next": "Επόμενο έτος",
      "stats.done": "Ολοκληρώθηκαν το {y}", "stats.pages": "Σελίδες που διάβασες", "stats.avg": "Μέση βαθμολογία",
      "stats.now": "Σε εξέλιξη", "stats.want": "Στη wishlist", "stats.months": "Ανά μήνα",
      "stats.top": "Κορυφαίοι δημιουργοί", "stats.tags": "Κορυφαίες ετικέτες", "stats.none": "Τίποτα ολοκληρωμένο το {y} ακόμα.",
      "goal.title": "Στόχοι {y}", "goal.set": "Ορισμός στόχων", "goal.of": "{v} από {n}",
      "goal.ahead": "{n} μπροστά από το πρόγραμμα", "goal.behind": "{n} πίσω από το πρόγραμμα", "goal.on": "Στο πρόγραμμα",
      "goal.done": "Ο στόχος επιτεύχθηκε!", "goal.hint": "Άφησε 0 για κανέναν στόχο.", "goal.none": "Κανένας στόχος για το {y}.",
      "menu.export": "Εξαγωγή (JSON)", "menu.import": "Εισαγωγή (JSON)",
      "toast.added": "Μπήκε στο ράφι σου", "toast.saved": "Αποθηκεύτηκε", "toast.deleted": "Το «{t}» διαγράφηκε",
      "toast.undo": "Αναίρεση", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.needTitle": "Δώσε έναν τίτλο", "toast.max": "Έως {n} τίτλοι",
      "toast.st": "«{t}»: {st}", "toast.entry": "Η εγγραφή αφαιρέθηκε",
      "toast.exported": "Εξήχθησαν {n} τίτλοι", "toast.imported": "Εισαγωγή: {n} τίτλοι στο ράφι σου",
      "toast.badFile": "Δεν είναι αρχείο του Ραφιού", "toast.big": "Το αρχείο είναι πολύ μεγάλο",
      "months": "Ιαν,Φεβ,Μαρ,Απρ,Μαΐ,Ιουν,Ιουλ,Αυγ,Σεπ,Οκτ,Νοε,Δεκ"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // Local calendar dates as "YYYY-MM-DD"; day arithmetic on UTC day
  // numbers, so a DST change never shifts a day.
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function isYmd(s) {
    var m = typeof s === "string" && YMD_RE.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }
  function dayNum(ymd) {
    var m = YMD_RE.exec(ymd);
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  function fmtDate(ymd) {
    var m = YMD_RE.exec(ymd);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
  }
  function fmtNum(n, dec) {
    try {
      return Number(n).toLocaleString(LANG === "el" ? "el-GR" : "en-GB",
        { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
    } catch (e) { return String(n); }
  }

  // Accent- and case-insensitive text for search and sorting (Greek too).
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("shelf.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Model ----------
  // item = { id, m (mtime), a (added), type, title, by, year (0 = none),
  //          size (0 = unknown), fmt (book: p|e|a), plat (game), st,
  //          prio 0|1, rate 0–10 (half stars; 0 = none), fav 0|1,
  //          tags[], rev, src, col 0–9 }
  // sess = { id, m, it (item id), k (s|p|d|x), d (YYYY-MM-DD), v (p only) }
  // goals = { "YYYY-type": { m, n } }
  // data = { ver, items[] by id, sess[] by id, goals {} by key, tombs {} by id }
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var GOAL_RE = /^(\d{4})-(book|film|series|album|podcast|game)$/;

  function clipLine(s, n) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  function clipText(s, n) {
    if (typeof s !== "string") return "";
    return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
            .replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
  }
  function intIn(v, lo, hi, dflt) { return isInt(v) && v >= lo && v <= hi ? v : dflt; }

  function normTags(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var x = clipLine(s, TAG_LEN).replace(/,/g, "");
      var k = fold(x);
      if (x && !seen[k] && out.length < MAX_TAGS) { seen[k] = 1; out.push(x); }
    });
    return out;
  }
  function parseTags(s) { return normTags(String(s || "").split(",")); }

  function normItem(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var title = clipLine(x.title, TITLE_LEN);
    if (!title || TYPES.indexOf(x.type) < 0) return null;
    return {
      id: x.id, m: x.m, a: intIn(x.a, 0, 1e14, x.m),
      type: x.type, title: title, by: clipLine(x.by, BY_LEN),
      year: intIn(x.year, 0, 9999, 0), size: intIn(x.size, 0, MAX_SIZE, 0),
      fmt: x.type === "book" && FORMATS.indexOf(x.fmt) >= 0 ? x.fmt : (x.type === "book" ? "p" : ""),
      plat: x.type === "game" ? clipLine(x.plat, PLAT_LEN) : "",
      st: STATES.indexOf(x.st) >= 0 ? x.st : "want",
      prio: x.prio === 1 ? 1 : 0, rate: intIn(x.rate, 0, 10, 0), fav: x.fav === 1 ? 1 : 0,
      tags: normTags(x.tags), rev: clipText(x.rev, REV_LEN), src: clipLine(x.src, SRC_LEN),
      col: intIn(x.col, 0, NCOLORS - 1, 0)
    };
  }

  function normSess(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0 || typeof x.it !== "string" || !ID_RE.test(x.it) ||
        KINDS.indexOf(x.k) < 0 || !isYmd(x.d)) return null;
    var s = { id: x.id, m: x.m, it: x.it, k: x.k, d: x.d };
    if (x.k === "p") {
      if (!isInt(x.v) || x.v < 0 || x.v > MAX_SIZE) return null;
      s.v = x.v;
    }
    return s;
  }

  function normGoal(g) {
    if (!g || typeof g !== "object" || !isInt(g.m) || g.m < 0) return null;
    return { m: g.m, n: intIn(g.n, 0, MAX_GOAL, 0) };
  }

  // Progress-capable types and their unit.
  function hasProgress(it) { return it.type === "book" || it.type === "series" || it.type === "podcast" || it.type === "game"; }
  function unitKey(it) { return it.type === "book" && it.fmt === "a" ? "audio" : it.type; }

  // ---------- 3. Merge ----------
  // Items and sessions: LWW per id (newer m wins; equal m: the larger
  // canonical JSON). Tombstones max-merged, delete wins ties, a newer
  // edit resurrects (R17). Goals LWW per key (equal m: larger JSON).
  // Symmetric, associative, idempotent and canonical (R5, R26).
  function lwwList(lists, norm, tombs) {
    var best = {};
    lists.forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = norm(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m ||
            (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var out = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      out.push(best[id]);
    });
    return out;
  }

  function mergeShelf(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var items = lwwList([a.items, b.items], normItem, tombs);
    var sess = lwwList([a.sess, b.sess], normSess, tombs);
    var gbest = {};
    [a.goals, b.goals].forEach(function (gs) {
      if (!gs || typeof gs !== "object" || Array.isArray(gs)) return;
      Object.keys(gs).forEach(function (k) {
        if (!GOAL_RE.test(k)) return;
        var g = normGoal(gs[k]);
        if (!g) return;
        var cur = gbest[k];
        if (!cur || g.m > cur.m || (g.m === cur.m && JSON.stringify(g) > JSON.stringify(cur))) gbest[k] = g;
      });
    });
    var goals = {};
    Object.keys(gbest).sort(cmpStr).forEach(function (k) { goals[k] = gbest[k]; });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, items: items, sess: sess, goals: goals, tombs: sortedTombs };
  }

  // ---------- 4. Derived ----------
  function cmpSess(x, y) { return cmpStr(x.d, y.d) || (x.m - y.m) || cmpStr(x.id, y.id); }

  // Sessions of one item, oldest first.
  function sessOf(D, id) {
    return D.sess.filter(function (s) { return s.it === id; }).sort(cmpSess);
  }
  // The current run: everything from the latest start on.
  function currentRun(list) {
    var at = 0;
    list.forEach(function (s, i) { if (s.k === "s") at = i; });
    return list.slice(at);
  }
  // Current progress: the highest value logged in the current run.
  function progressOf(list) {
    var v = 0;
    currentRun(list).forEach(function (s) { if (s.k === "p" && s.v > v) v = s.v; });
    return v;
  }
  function completions(list) { return list.filter(function (s) { return s.k === "d"; }); }
  // The run's first day (its start, else its first entry).
  function runStart(list) {
    var run = currentRun(list);
    return run.length ? run[0].d : null;
  }

  // Pace (units per day) since the run started, and the days left.
  // Needs at least one progress entry; null when nothing to say.
  function paceOf(it, list, today) {
    var run = currentRun(list), cur = progressOf(list);
    var any = run.some(function (s) { return s.k === "p"; });
    if (!any || cur <= 0 || !run.length) return null;
    var days = dayNum(today) - dayNum(run[0].d) + 1;
    if (days < 1) days = 1;
    var rate = cur / days;
    var left = it.size > cur ? Math.ceil((it.size - cur) / rate) : 0;
    return { rate: rate, days: it.size > cur ? left : 0 };
  }

  // Goal for a year: how far ahead (+) or behind (−) of an even pace.
  function goalState(n, done, year, today) {
    var ty = +today.slice(0, 4), expected;
    if (year < ty) expected = n;
    else if (year > ty) expected = 0;
    else {
      var d0 = dayNum(year + "-01-01"), d1 = dayNum((year + 1) + "-01-01");
      expected = n * (dayNum(today) - d0 + 1) / (d1 - d0);
    }
    return { pct: n ? Math.min(100, Math.round(done * 100 / n)) : 0,
             diff: Math.round(done - expected) || 0, reached: n > 0 && done >= n };
  }

  // Statistics for one year (every finish counts, re-reads too).
  function yearStats(D, year) {
    var live = {}, y = String(year);
    D.items.forEach(function (it) { live[it.id] = it; });
    var out = { done: {}, total: 0, pages: 0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                rated: 0, rateSum: 0, by: {}, tags: {}, now: 0, want: 0 };
    TYPES.forEach(function (tp) { out.done[tp] = 0; });
    var seenRate = {};
    D.sess.forEach(function (s) {
      var it = live[s.it];
      if (!it || s.k !== "d" || s.d.slice(0, 4) !== y) return;
      out.done[it.type]++;
      out.total++;
      out.months[+s.d.slice(5, 7) - 1]++;
      if (it.type === "book" && it.fmt !== "a") out.pages += it.size;
      if (it.rate && !seenRate[it.id]) { seenRate[it.id] = 1; out.rated++; out.rateSum += it.rate; }
      if (it.by) {
        var k = fold(it.by);
        if (!out.by[k]) out.by[k] = { name: it.by, n: 0 };
        out.by[k].n++;
      }
      it.tags.forEach(function (tg) {
        var tk = fold(tg);
        if (!out.tags[tk]) out.tags[tk] = { name: tg, n: 0 };
        out.tags[tk].n++;
      });
    });
    D.items.forEach(function (it) { if (it.st === "now") out.now++; else if (it.st === "want") out.want++; });
    function top(map) {
      return Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (p, q) { return (q.n - p.n) || cmpStr(fold(p.name), fold(q.name)); }).slice(0, 5);
    }
    out.topBy = top(out.by);
    out.topTags = top(out.tags);
    out.avg = out.rated ? out.rateSum / out.rated / 2 : 0;
    return out;
  }

  // Search / filter / sort of the list views.
  function matches(it, q) {
    if (!q) return true;
    var hay = fold([it.title, it.by, it.plat, it.src].concat(it.tags).join(" "));
    return fold(q).split(/\s+/).every(function (w) { return !w || hay.indexOf(w) >= 0; });
  }
  function lastActivity(D, it) {
    var last = it.a;
    D.sess.forEach(function (s) { if (s.it === it.id && s.m > last) last = s.m; });
    return Math.max(last, it.m);
  }
  function viewList(D, tab, type, q, sort) {
    var list = D.items.filter(function (it) {
      if (type !== "all" && it.type !== type) return false;
      if (tab === "now" && it.st !== "now") return false;
      if (tab === "want" && it.st !== "want") return false;
      if (tab === "hist" && it.st !== "done" && it.st !== "drop") return false;
      return matches(it, q);
    });
    var act = {};
    if (sort === "recent") list.forEach(function (it) { act[it.id] = lastActivity(D, it); });
    list.sort(function (x, y) {
      var r = 0;
      if (tab === "want" && sort === "recent") r = y.prio - x.prio;
      if (!r) {
        if (sort === "title") r = cmpStr(fold(x.title), fold(y.title));
        else if (sort === "by") r = cmpStr(fold(x.by || "￿"), fold(y.by || "￿"));
        else if (sort === "rating") r = y.rate - x.rate;
        else if (sort === "year") r = (y.year || 0) - (x.year || 0);
        else r = act[y.id] - act[x.id];
      }
      return r || cmpStr(fold(x.title), fold(y.title)) || cmpStr(x.id, y.id);
    });
    return list;
  }

  // Cover: initials of the first two words.
  function initials(title) {
    var w = String(title).replace(/^(the|a|an|ο|η|το|οι|τα)\s+/i, "").split(/\s+/).filter(Boolean);
    var s = (w[0] ? Array.from(w[0])[0] : "") + (w[1] ? Array.from(w[1])[0] : "");
    return s.toUpperCase() || "?";
  }
  function inkFor(hex) {
    var v = parseInt(hex.slice(1), 16);
    var lin = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin(v >> 16 & 255) + 0.7152 * lin(v >> 8 & 255) + 0.0722 * lin(v & 255);
    return L > 0.33 ? "#1b1b1b" : "#ffffff";
  }

  // ---------- 5. Storage, prefs ----------
  var data = null, prefs = null;

  function emptyData() { return { ver: DATA_VER, items: [], sess: [], goals: {}, tombs: {} }; }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
          data = mergeShelf(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] shelf: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  function saveNow() {
    data = mergeShelf(data, data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  var SORTS = ["recent", "title", "by", "rating", "year"];
  var TABS = ["now", "want", "hist", "stats"];
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      tab: TABS.indexOf(p.tab) >= 0 ? p.tab : "now",
      type: p.type === "all" || TYPES.indexOf(p.type) >= 0 ? p.type : "all",
      sort: SORTS.indexOf(p.sort) >= 0 ? p.sort : "recent"
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 6. Actions ----------
  function today() { return ymdOf(new Date()); }
  function now() { return Date.now(); }
  function itemById(id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }
  // Bump an item's mtime past its previous one (R27: only on a real change).
  function touch(it) { it.m = Math.max(now(), it.m + 1); }
  function addSess(it, k, v) {
    var s = { id: newId(), m: now(), it: it.id, k: k, d: today() };
    if (k === "p") s.v = v;
    data.sess.push(s);
    return s;
  }
  function tombIds(ids) {
    var ts = now();
    ids.forEach(function (id) { data.tombs[id] = Math.max(ts, (data.tombs[id] || 0) + 1); });
  }

  function stLabel(it, st) {
    if (st === "now" || st === "done") return t("st." + st + "." + it.type);
    return t("st." + st);
  }

  // Status change, with the matching history entry and an Undo.
  function setStatus(it, st, quiet) {
    if (it.st === st) return;
    var before = JSON.parse(JSON.stringify(it)), added = [];
    if (st === "now") added.push(addSess(it, "s"));
    if (st === "done") {
      if (hasProgress(it) && it.size > 0 && progressOf(sessOf(data, it.id)) < it.size) added.push(addSess(it, "p", it.size));
      added.push(addSess(it, "d"));
    }
    if (st === "drop") added.push(addSess(it, "x"));
    it.st = st;
    touch(it);
    saveNow();
    renderAll();
    if (quiet) return;
    undoToast(t("toast.st", { t: it.title, st: stLabel(it, st) }), function () {
      var cur = itemById(before.id);
      if (!cur) return;
      tombIds(added.map(function (s) { return s.id; }));
      Object.keys(before).forEach(function (k) { cur[k] = before[k]; });
      touch(cur);
      saveNow();
      renderAll();
    });
  }

  // Log progress. A lower value is a correction: the run's higher
  // entries are removed, so "current = highest" stays true.
  function logProgress(it, v) {
    v = Math.max(0, Math.min(MAX_SIZE, Math.round(v)));
    var list = sessOf(data, it.id), cur = progressOf(list);
    if (v === cur) return;
    if (it.st === "want" || it.st === "drop" || it.st === "done") {
      if (it.st === "done" && v < cur) { /* correcting a finished run: keep the status */ }
      else { addSess(it, "s"); it.st = "now"; touch(it); }
    }
    if (v < cur) {
      tombIds(currentRun(sessOf(data, it.id)).filter(function (s) { return s.k === "p" && s.v > v; })
        .map(function (s) { return s.id; }));
    }
    if (v > 0) addSess(it, "p", v);
    saveNow();
    renderAll();
    if (it.st === "now" && it.size > 0 && v >= it.size) {
      actionToast(t("prog.finish", { st: stLabel(it, "done") }), t("prog.markDone"), function () {
        var x = itemById(it.id);
        if (x) setStatus(x, "done");
      });
    }
  }

  function setField(it, key, val) {
    if (JSON.stringify(it[key]) === JSON.stringify(val)) return false;
    it[key] = val;
    touch(it);
    saveNow();
    return true;
  }

  function deleteItem(it) {
    var snapItem = JSON.parse(JSON.stringify(it));
    var snapSess = sessOf(data, it.id).map(function (s) { return JSON.parse(JSON.stringify(s)); });
    tombIds([it.id].concat(snapSess.map(function (s) { return s.id; })));
    saveNow();
    renderAll();
    undoToast(t("toast.deleted", { t: snapItem.title }), function () {
      // A newer mtime resurrects past the tombstones (R17).
      var ts = now() + 1;
      snapItem.m = Math.max(ts, (data.tombs[snapItem.id] || 0) + 1);
      data.items.push(snapItem);
      snapSess.forEach(function (s) {
        s.m = Math.max(ts, (data.tombs[s.id] || 0) + 1);
        data.sess.push(s);
      });
      saveNow();
      renderAll();
    });
  }

  function deleteSess(s) {
    var snap = JSON.parse(JSON.stringify(s));
    tombIds([s.id]);
    saveNow();
    renderAll();
    undoToast(t("toast.entry"), function () {
      snap.m = Math.max(now() + 1, (data.tombs[snap.id] || 0) + 1);
      data.sess.push(snap);
      saveNow();
      renderAll();
    });
  }

  function setGoal(year, type, n) {
    var k = year + "-" + type, cur = data.goals[k];
    if ((cur ? cur.n : 0) === n) return;
    data.goals[k] = { m: Math.max(now(), cur ? cur.m + 1 : 0), n: n };
  }

  // ---------- 7. UI ----------
  var UI = {
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    more:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.9 1.3 5.4 3.1 1.5-1.8 3.3-3.1 5.4-3.1 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>',
    heartO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.9 1.3 5.4 3.1 1.5-1.8 3.3-3.1 5.4-3.1 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>',
    flag:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    book:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
    film:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18"/></svg>',
    series: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M8 2l4 4 4-4"/></svg>',
    album: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    podcast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>',
    game:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 2l1.1-1.5h7l1.1 1.5A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6z"/></svg>',
    all:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="M16.5 4.5l3.8 1-3.9 15-3.8-1"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;                       // static icon markup only
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function renderTabs() {
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) {
      var on = b.getAttribute("data-tab") === prefs.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var counts = { now: 0, want: 0, hist: 0 };
    data.items.forEach(function (it) {
      if (prefs.type !== "all" && it.type !== prefs.type) return;
      if (it.st === "now") counts.now++;
      else if (it.st === "want") counts.want++;
      else counts.hist++;
    });
    ["now", "want", "hist"].forEach(function (k) { $("cnt-" + k).textContent = counts[k] ? String(counts[k]) : ""; });
    $("list-bar").hidden = prefs.tab === "stats";
  }

  function renderTypes() {
    var box = $("types");
    box.textContent = "";
    ["all"].concat(TYPES).forEach(function (tp) {
      var b = el("button", "chip" + (prefs.type === tp ? " on" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.type === tp ? "true" : "false");
      b.innerHTML = UI[tp];
      b.appendChild(el("span", "", t(tp === "all" ? "type.all" : "types." + tp)));
      b.addEventListener("click", function () {
        prefs.type = tp;
        savePrefs();
        renderAll();
      });
      box.appendChild(b);
    });
  }

  function cover(it, big) {
    var c = el("div", "cover" + (big ? " big" : ""));
    var bg = COLORS[it.col];
    c.style.background = bg;
    c.style.color = inkFor(bg);
    c.setAttribute("aria-hidden", "true");
    c.appendChild(el("span", "cv-ini", initials(it.title)));
    var ic = el("span", "cv-ic");
    ic.innerHTML = UI[it.type];
    c.appendChild(ic);
    return c;
  }

  function starsText(rate) {
    var full = Math.floor(rate / 2), half = rate % 2;
    return "★★★★★".slice(0, full) + (half ? "⯪" : "") + "☆☆☆☆☆".slice(0, 5 - full - half);
  }

  function progText(it, v) {
    var u = t("unit." + unitKey(it));
    if (it.type === "series" || it.type === "podcast") {
      return it.size ? t("prog.ep", { v: v, n: it.size }) : t("prog.epNo", { v: v });
    }
    return it.size ? t("prog.at", { v: fmtNum(v), n: fmtNum(it.size), u: u }) : t("prog.atNo", { v: fmtNum(v), u: u });
  }

  function progBar(it, v) {
    var w = el("div", "bar");
    var f = el("i");
    f.style.width = (it.size ? Math.min(100, v * 100 / it.size) : 0) + "%";
    w.appendChild(f);
    return w;
  }

  function card(it) {
    var li = el("li");
    var b = el("button", "card");
    b.type = "button";
    b.appendChild(cover(it));
    var body = el("div", "c-body");
    var top = el("div", "c-title", it.title);
    body.appendChild(top);
    var sub = [it.by, it.year ? String(it.year) : ""].filter(Boolean).join(" · ");
    body.appendChild(el("div", "c-sub", sub || t("type." + it.type)));
    var list = sessOf(data, it.id);
    if (it.st === "now" && hasProgress(it)) {
      var v = progressOf(list);
      body.appendChild(el("div", "c-meta", progText(it, v)));
      if (it.size) body.appendChild(progBar(it, v));
    } else if (it.st === "done" || it.st === "drop") {
      var meta = el("div", "c-meta");
      if (it.rate) meta.appendChild(el("span", "stars", starsText(it.rate)));
      var last = null;
      list.forEach(function (s) { if (s.k === (it.st === "done" ? "d" : "x")) last = s; });
      meta.appendChild(el("span", "", (it.st === "drop" ? t("st.drop") + " · " : "") + (last ? fmtDate(last.d) : "")));
      body.appendChild(meta);
    } else if (it.st === "now") {
      body.appendChild(el("div", "c-meta", stLabel(it, "now")));
    } else if (it.tags.length) {
      body.appendChild(el("div", "c-meta", it.tags.join(" · ")));
    }
    b.appendChild(body);
    var marks = el("div", "c-marks");
    if (it.fav) { var h = el("span", "mk fav"); h.innerHTML = UI.heart; h.title = t("fav"); marks.appendChild(h); }
    if (it.st === "want" && it.prio) { var p = el("span", "mk prio"); p.innerHTML = UI.flag; p.title = t("prio"); marks.appendChild(p); }
    b.appendChild(marks);
    b.setAttribute("aria-label", it.title + (sub ? ", " + sub : "") + ", " + stLabel(it, it.st));
    b.addEventListener("click", function () { itemDialog(it.id); });
    li.appendChild(b);
    return li;
  }

  function renderList() {
    var ul = $("list"), empty = $("empty");
    ul.textContent = "";
    empty.textContent = "";
    if (prefs.tab === "stats") { ul.hidden = true; empty.hidden = true; return; }
    ul.hidden = false;
    var q = $("q").value.trim();
    var list = viewList(data, prefs.tab, prefs.type, q, prefs.sort);
    list.forEach(function (it) { ul.appendChild(card(it)); });
    empty.hidden = list.length > 0;
    if (!list.length) {
      if (!data.items.length) {
        empty.appendChild(el("p", "", t("empty.first")));
        var b = button(t("empty.firstBtn"), "primary", function () { editDialog(null); });
        empty.appendChild(b);
      } else {
        empty.appendChild(el("p", "", q ? t("empty.search") : t("empty." + prefs.tab)));
      }
    }
  }

  function renderAll() {
    renderTabs();
    renderTypes();
    renderList();
    renderStats();
    refreshItemDialog();
  }

  // ---------- 8. Item dialog ----------
  var openItem = null;          // id of the item in the open details dialog

  function itemDialog(id) {
    var it = itemById(id);
    if (!it) return;
    openItem = id;
    var dlg = makeDialog("sh-item", "item-dlg");
    dlg.addEventListener("close", function () { flushReview(); openItem = null; });
    document.body.appendChild(dlg);
    fillItemDialog(dlg, it);
    dlg.showModal();
    var f = dlg.querySelector(".dlg-close");
    if (f) f.focus();
  }

  var reviewBox = null;
  function flushReview() {
    if (!reviewBox) return;
    var it = itemById(reviewBox.getAttribute("data-id"));
    if (it) setField(it, "rev", clipText(reviewBox.value, REV_LEN));
    reviewBox = null;
  }

  function refreshItemDialog() {
    if (!openItem) return;
    var dlg = $("sh-item");
    if (!dlg) { openItem = null; return; }
    var it = itemById(openItem);
    if (!it) { dlg.close(); return; }
    // Keep a review being typed, and the scroll position.
    var typing = reviewBox && document.activeElement === reviewBox ? reviewBox.value : null;
    var progIn = dlg.querySelector("#sh-prog-in"), progVal = progIn && document.activeElement === progIn ? progIn.value : null;
    var st = dlg.scrollTop;
    fillItemDialog(dlg, it);
    if (typing !== null) { reviewBox.value = typing; reviewBox.focus(); }
    if (progVal !== null) { var pi = dlg.querySelector("#sh-prog-in"); if (pi) { pi.value = progVal; pi.focus(); } }
    dlg.scrollTop = st;
  }

  function fillItemDialog(dlg, it) {
    reviewBox = null;
    parkToast();                 // the toast may live in this dialog (R32)
    dlg.textContent = "";
    var list = sessOf(data, it.id);

    var head = el("div", "it-head");
    head.appendChild(cover(it, true));
    var hb = el("div", "it-hb");
    hb.appendChild(el("div", "it-type", t("type." + it.type) +
      (it.type === "book" ? " · " + t("fmt." + it.fmt) : "") +
      (it.plat ? " · " + it.plat : "")));
    var h = el("h2", "it-title", it.title);
    h.id = "sh-item-title";
    hb.appendChild(h);
    var sub = [it.by, it.year ? String(it.year) : ""].filter(Boolean).join(" · ");
    if (sub) hb.appendChild(el("div", "it-sub", sub));
    var favB = iconBtn("mini fav-btn" + (it.fav ? " on" : ""), it.fav ? UI.heart : UI.heartO, t("fav"), function () {
      setField(it, "fav", it.fav ? 0 : 1);
      renderAll();
    });
    favB.setAttribute("aria-pressed", it.fav ? "true" : "false");
    head.appendChild(hb);
    head.appendChild(favB);
    dlg.appendChild(head);
    dlg.setAttribute("aria-labelledby", "sh-item-title");

    // Status and the actions that move it on.
    var stRow = el("div", "it-st");
    stRow.appendChild(el("span", "pill st-" + it.st, stLabel(it, it.st)));
    var dn = completions(list).length;
    if (dn > 1) stRow.appendChild(el("span", "it-times", t("hist.times", { n: dn })));
    dlg.appendChild(stRow);

    var acts = el("div", "it-acts");
    function act(label, st, primary) {
      acts.appendChild(button(label, primary ? "primary" : "", function () { setStatus(it, st); }));
    }
    if (it.st === "want") { act(t("act.start." + it.type), "now", true); act(t("act.done"), "done"); }
    else if (it.st === "now") { act(t("act.done"), "done", true); act(t("act.drop"), "drop"); act(t("act.want"), "want"); }
    else if (it.st === "done") { act(t("act.again." + it.type), "now", true); }
    else { act(t("act.resume"), "now", true); act(t("act.want"), "want"); }
    if (it.st === "want") {
      var pr = button(t("prio"), "toggle" + (it.prio ? " on" : ""), function () { setField(it, "prio", it.prio ? 0 : 1); renderAll(); });
      pr.setAttribute("aria-pressed", it.prio ? "true" : "false");
      acts.appendChild(pr);
    }
    dlg.appendChild(acts);

    // Progress (books, series, podcasts, games), while it runs.
    if (hasProgress(it) && it.st === "now") {
      var v = progressOf(list);
      var sec = el("section", "it-sec");
      sec.appendChild(el("div", "it-line", progText(it, v) + (it.size ? " · " + t("prog.pct", { p: Math.min(100, Math.round(v * 100 / it.size)) }) : "")));
      if (it.size) sec.appendChild(progBar(it, v));
      var form = el("form", "prog-row");
      var lab = el("label", "dlg-lbl", t("prog.label." + unitKey(it)));
      lab.setAttribute("for", "sh-prog-in");
      var inp = el("input");
      inp.id = "sh-prog-in";
      inp.type = "number";
      inp.inputMode = "numeric";
      inp.min = "0";
      inp.max = String(it.size || MAX_SIZE);
      inp.value = String(v);
      var ok = el("button", "dlg-btn primary", t("prog.save"));
      ok.type = "submit";
      form.appendChild(inp);
      form.appendChild(ok);
      if (it.type === "series" || it.type === "podcast" || it.type === "game") {
        form.appendChild(button(it.type === "game" ? t("prog.plusH") : t("prog.plus1"), "", function () { logProgress(it, progressOf(sessOf(data, it.id)) + 1); }));
      }
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var n = parseInt(inp.value, 10);
        if (isFinite(n)) logProgress(it, n);
      });
      sec.appendChild(lab);
      sec.appendChild(form);
      var pace = paceOf(it, list, today());
      if (pace && pace.days > 0) {
        var r = pace.rate >= 10 ? fmtNum(pace.rate) : fmtNum(pace.rate, 1);
        sec.appendChild(el("p", "hint", t(pace.days === 1 ? "prog.eta1" : "prog.eta",
          { r: r, u: t("unit." + unitKey(it)), d: pace.days })));
      }
      dlg.appendChild(sec);
    }

    // Rating: five stars, half steps (tap the left half for ½).
    var rs = el("section", "it-sec");
    rs.appendChild(el("div", "dlg-lbl", t("rate")));
    var rrow = el("div", "rate-row");
    var stars = el("div", "rate");
    stars.tabIndex = 0;
    stars.setAttribute("role", "slider");
    stars.setAttribute("aria-valuemin", "0");
    stars.setAttribute("aria-valuemax", "5");
    stars.setAttribute("aria-valuenow", String(it.rate / 2));
    stars.setAttribute("aria-valuetext", it.rate ? t("rate.aria", { v: fmtNum(it.rate / 2, it.rate % 2) }) : t("rate.none"));
    stars.setAttribute("aria-label", t("rate"));
    for (var i = 1; i <= 5; i++) {
      var s = el("span", "star");
      var fill = Math.max(0, Math.min(2, it.rate - (i - 1) * 2));
      s.classList.add(fill === 2 ? "full" : (fill === 1 ? "half" : "empty"));
      s.textContent = "★";
      stars.appendChild(s);
    }
    function rateTo(n) { setField(it, "rate", Math.max(0, Math.min(10, n))); renderAll(); }
    stars.addEventListener("click", function (e) {
      var r = stars.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width * 10;
      var n = Math.max(1, Math.min(10, Math.ceil(x)));
      rateTo(n === it.rate ? 0 : n);
    });
    stars.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowRight" || k === "ArrowUp") { e.preventDefault(); rateTo(it.rate + 1); }
      else if (k === "ArrowLeft" || k === "ArrowDown") { e.preventDefault(); rateTo(it.rate - 1); }
      else if (k === "Home" || k === "Delete" || k === "Backspace" || k === "0") { e.preventDefault(); rateTo(0); }
      else if (k === "End") { e.preventDefault(); rateTo(10); }
      else if (/^[1-5]$/.test(k)) { e.preventDefault(); rateTo(+k * 2); }
      else return;
      var again = $("sh-item") && $("sh-item").querySelector(".rate");
      if (again) again.focus();
    });
    rrow.appendChild(stars);
    rrow.appendChild(el("span", "rate-v", it.rate ? fmtNum(it.rate / 2, it.rate % 2) + " / 5" : t("rate.none")));
    rs.appendChild(rrow);
    dlg.appendChild(rs);

    // Review.
    var rv = el("section", "it-sec");
    var rl = el("label", "dlg-lbl", t("review"));
    rl.setAttribute("for", "sh-rev");
    var ta = el("textarea");
    ta.id = "sh-rev";
    ta.maxLength = REV_LEN;
    ta.rows = 3;
    ta.placeholder = t("review.ph");
    ta.value = it.rev;
    ta.setAttribute("data-id", it.id);
    ta.addEventListener("change", flushReview);
    reviewBox = ta;
    rv.appendChild(rl);
    rv.appendChild(ta);
    dlg.appendChild(rv);

    // Details.
    var info = [];
    if (it.size && !(hasProgress(it) && it.st === "now")) info.push(fmtNum(it.size) + " " + t("unit." + unitKey(it)));
    if (it.src) info.push(it.src);
    if (info.length || it.tags.length) {
      var ds = el("section", "it-sec");
      if (info.length) ds.appendChild(el("p", "it-info", info.join(" · ")));
      if (it.tags.length) {
        var tg = el("div", "tags");
        it.tags.forEach(function (x) { tg.appendChild(el("span", "tag", x)); });
        ds.appendChild(tg);
      }
      dlg.appendChild(ds);
    }

    // History, newest first.
    if (list.length) {
      var hs = el("section", "it-sec");
      hs.appendChild(el("div", "dlg-lbl", t("hist.title")));
      var ol = el("ol", "hist");
      list.slice().reverse().forEach(function (x) {
        var li = el("li");
        li.appendChild(el("span", "h-d", fmtDate(x.d)));
        li.appendChild(el("span", "h-w", x.k === "p" ? t("hist.p", { v: x.v === it.size && it.size ? progText(it, x.v) : fmtNum(x.v) }) : t("hist." + x.k)));
        li.appendChild(iconBtn("mini danger", UI.x, t("hist.del"), function () { deleteSess(x); }));
        ol.appendChild(li);
      });
      hs.appendChild(ol);
      dlg.appendChild(hs);
    }

    var foot = el("div", "dlg-actions");
    foot.appendChild(button(t("act.delete"), "danger", function () { dlg.close(); deleteItem(it); }));
    foot.appendChild(button(t("act.edit"), "", function () { dlg.close(); editDialog(it); }));
    var cl = button(t("act.close"), "dlg-close", function () { dlg.close(); });
    foot.appendChild(cl);
    dlg.appendChild(foot);
    if (dlg.open) hostToast();
  }

  // ---------- 9. Edit dialog, goals dialog ----------
  function editDialog(existing) {
    if (!existing && data.items.length >= MAX_ITEMS) { showToast(t("toast.max", { n: MAX_ITEMS })); return; }
    var draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      type: prefs.type !== "all" ? prefs.type : "book", fmt: "p",
      st: prefs.tab === "now" ? "now" : (prefs.tab === "hist" ? "done" : "want"),
      col: randCol()
    };
    var dlg = makeDialog("sh-edit", "edit-dlg");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "f.edit" : "f.new")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;

    // Type picker.
    form.appendChild(el("div", "dlg-lbl", t("f.type")));
    var tp = el("div", "seg types-seg");
    tp.setAttribute("role", "radiogroup");
    tp.setAttribute("aria-label", t("f.type"));
    TYPES.forEach(function (x) {
      var b = el("button", "chip");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-type", x);
      b.innerHTML = UI[x];
      b.appendChild(el("span", "", t("type." + x)));
      b.addEventListener("click", function () { capture(); draft.type = x; layout(); });
      tp.appendChild(b);
    });
    form.appendChild(tp);

    function field(id, label, inp) {
      var w = el("div", "fld");
      w.id = id + "-w";
      var l = el("label", "dlg-lbl", label);
      l.setAttribute("for", id);
      l.id = id + "-l";
      inp.id = id;
      w.appendChild(l);
      w.appendChild(inp);
      form.appendChild(w);
      return inp;
    }
    function input(max, type) {
      var i = el("input");
      i.autocomplete = "off";
      if (type) i.type = type;
      if (max) i.maxLength = max;
      return i;
    }
    var fTitle = field("sh-f-title", t("f.title"), input(TITLE_LEN));
    var fBy = field("sh-f-by", "", input(BY_LEN));
    var row = el("div", "fld-row");
    form.appendChild(row);
    var fYear = field("sh-f-year", t("f.year"), input(0, "number"));
    fYear.min = "0"; fYear.max = "9999"; fYear.inputMode = "numeric";
    var fSize = field("sh-f-size", "", input(0, "number"));
    fSize.min = "0"; fSize.max = String(MAX_SIZE); fSize.inputMode = "numeric";
    row.appendChild(fYear.parentNode);
    row.appendChild(fSize.parentNode);
    var fFmt = el("select");
    FORMATS.forEach(function (f) { var o = el("option", "", t("fmt." + f)); o.value = f; fFmt.appendChild(o); });
    field("sh-f-fmt", t("f.fmt"), fFmt);
    var fPlat = field("sh-f-plat", t("f.plat"), input(PLAT_LEN));
    var fSt = null;
    if (!existing) {
      fSt = el("select");
      field("sh-f-st", t("f.status"), fSt);
    }
    var fTags = field("sh-f-tags", t("f.tags"), input(MAX_TAGS * (TAG_LEN + 2)));
    var fSrc = field("sh-f-src", t("f.src"), input(SRC_LEN));

    form.appendChild(el("div", "dlg-lbl", t("f.color")));
    var sw = el("div", "swatches");
    sw.setAttribute("role", "radiogroup");
    sw.setAttribute("aria-label", t("f.color"));
    COLORS.forEach(function (c, i) {
      var b = el("button", "sw");
      b.type = "button";
      b.style.background = c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", t("f.color.n", { n: i + 1 }));
      b.addEventListener("click", function () { draft.col = i; layout(); });
      sw.appendChild(b);
    });
    form.appendChild(sw);

    function capture() {
      draft.title = fTitle.value;
      draft.by = fBy.value;
      draft.year = parseInt(fYear.value, 10) || 0;
      draft.size = parseInt(fSize.value, 10) || 0;
      draft.fmt = fFmt.value;
      draft.plat = fPlat.value;
      draft.tags = parseTags(fTags.value);
      draft.src = fSrc.value;
      if (fSt) draft.st = fSt.value;
    }
    function layout() {
      var x = draft.type, uk = x === "book" && draft.fmt === "a" ? "audio" : x;
      [].forEach.call(tp.children, function (b) {
        var on = b.getAttribute("data-type") === x;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      form.querySelector("#sh-f-by-l").textContent = t("by." + x);
      form.querySelector("#sh-f-size-l").textContent = t("size." + uk);
      form.querySelector("#sh-f-fmt-w").hidden = x !== "book";
      form.querySelector("#sh-f-plat-w").hidden = x !== "game";
      if (fSt) {
        var keep = draft.st;
        fSt.textContent = "";
        STATES.forEach(function (s) {
          var o = el("option", "", stLabel({ type: x }, s));
          o.value = s;
          fSt.appendChild(o);
        });
        fSt.value = keep;
      }
      [].forEach.call(sw.children, function (b, i) {
        b.classList.toggle("on", i === draft.col);
        b.setAttribute("aria-checked", i === draft.col ? "true" : "false");
      });
    }
    fTitle.value = draft.title || "";
    fBy.value = draft.by || "";
    fYear.value = draft.year ? String(draft.year) : "";
    fSize.value = draft.size ? String(draft.size) : "";
    fFmt.value = draft.fmt || "p";
    fPlat.value = draft.plat || "";
    fTags.value = (draft.tags || []).join(", ");
    fSrc.value = draft.src || "";
    fFmt.addEventListener("change", function () { capture(); layout(); });
    layout();

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    var ok = el("button", "dlg-btn primary", t("f.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      capture();
      var title = clipLine(draft.title, TITLE_LEN);
      if (!title) { showToast(t("toast.needTitle")); fTitle.focus(); return; }
      var ts = now();
      var cand = normItem({
        id: existing ? existing.id : newId(), m: ts, a: existing ? existing.a : ts,
        type: draft.type, title: title, by: draft.by, year: draft.year, size: draft.size,
        fmt: draft.fmt, plat: draft.plat, st: existing ? existing.st : draft.st,
        prio: existing ? existing.prio : 0, rate: existing ? existing.rate : 0,
        fav: existing ? existing.fav : 0, tags: draft.tags, rev: existing ? existing.rev : "",
        src: draft.src, col: draft.col
      });
      if (!cand) return;
      if (existing) {
        var cur = itemById(existing.id);
        if (cur) {
          var changed = false;
          ["type", "title", "by", "year", "size", "fmt", "plat", "tags", "src", "col"].forEach(function (k) {
            if (JSON.stringify(cur[k]) !== JSON.stringify(cand[k])) { cur[k] = cand[k]; changed = true; }
          });
          if (changed) { touch(cur); saveNow(); showToast(t("toast.saved")); }
        }
        dlg.close();
        renderAll();
        if (cur) itemDialog(cur.id);
        return;
      }
      data.items.push(cand);
      if (cand.st === "now") addSess(cand, "s");
      if (cand.st === "done") addSess(cand, "d");
      if (cand.st === "drop") addSess(cand, "x");
      saveNow();
      dlg.close();
      // Show the tab the new title went to.
      prefs.tab = cand.st === "now" ? "now" : (cand.st === "want" ? "want" : "hist");
      if (prefs.type !== "all" && prefs.type !== cand.type) prefs.type = "all";
      savePrefs();
      renderAll();
      showToast(t("toast.added"));
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    fTitle.focus();
  }

  function randCol() {
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    return r[0] % NCOLORS;
  }

  function goalsDialog(year) {
    var dlg = makeDialog("sh-goals", "");
    dlg.appendChild(el("div", "dlg-title", t("goal.title", { y: year })));
    var form = el("form");
    form.method = "dialog";
    var ins = {};
    TYPES.forEach(function (tp) {
      var w = el("div", "goal-fld");
      var l = el("label", "", t("types." + tp));
      l.setAttribute("for", "sh-g-" + tp);
      var i = el("input");
      i.id = "sh-g-" + tp;
      i.type = "number";
      i.min = "0";
      i.max = String(MAX_GOAL);
      i.inputMode = "numeric";
      var g = data.goals[year + "-" + tp];
      i.value = g ? String(g.n) : "0";
      ins[tp] = i;
      w.appendChild(l);
      w.appendChild(i);
      form.appendChild(w);
    });
    form.appendChild(el("p", "hint", t("goal.hint")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    var ok = el("button", "dlg-btn primary", t("f.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      TYPES.forEach(function (tp) {
        var n = parseInt(ins[tp].value, 10);
        setGoal(year, tp, isFinite(n) ? Math.max(0, Math.min(MAX_GOAL, n)) : 0);
      });
      saveNow();
      dlg.close();
      renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    ins.book.focus();
    ins.book.select();
  }

  // ---------- 10. Statistics view ----------
  var statsYear = new Date().getFullYear();

  function renderStats() {
    var box = $("stats");
    box.hidden = prefs.tab !== "stats";
    if (box.hidden) return;
    box.textContent = "";
    var y = statsYear, td = today(), S = yearStats(data, y);

    var nav = el("div", "y-nav");
    nav.appendChild(iconBtn("icon-btn", UI.left, t("stats.prev"), function () { statsYear--; renderStats(); }));
    nav.appendChild(el("h2", "y-title", String(y)));
    var nx = iconBtn("icon-btn", UI.right, t("stats.next"), function () { statsYear++; renderStats(); });
    nx.disabled = y >= new Date().getFullYear() + 1;
    nav.appendChild(nx);
    box.appendChild(nav);

    // Goals.
    var gs = el("section", "st-sec");
    var gh = el("div", "sec-head");
    gh.appendChild(el("h3", "", t("goal.title", { y: y })));
    gh.appendChild(el("span", "spacer"));
    gh.appendChild(button(t("goal.set"), "small", function () { goalsDialog(y); }));
    gs.appendChild(gh);
    var anyGoal = false;
    TYPES.forEach(function (tp) {
      var g = data.goals[y + "-" + tp];
      if (!g || !g.n) return;
      anyGoal = true;
      var done = S.done[tp], st = goalState(g.n, done, y, td);
      var row = el("div", "goal");
      var top = el("div", "goal-top");
      var ic = el("span", "g-ic");
      ic.innerHTML = UI[tp];
      top.appendChild(ic);
      top.appendChild(el("span", "g-name", t("types." + tp)));
      top.appendChild(el("span", "g-v", t("goal.of", { v: done, n: g.n })));
      row.appendChild(top);
      var bar = el("div", "bar");
      var f = el("i");
      f.style.width = st.pct + "%";
      bar.appendChild(f);
      row.appendChild(bar);
      var msg = st.reached ? t("goal.done") : (st.diff > 0 ? t("goal.ahead", { n: st.diff }) :
        (st.diff < 0 ? t("goal.behind", { n: -st.diff }) : t("goal.on")));
      row.appendChild(el("div", "g-msg" + (st.reached ? " ok" : (st.diff < 0 ? " low" : "")), msg));
      gs.appendChild(row);
    });
    if (!anyGoal) gs.appendChild(el("p", "hint", t("goal.none", { y: y })));
    box.appendChild(gs);

    // Tiles.
    var ts = el("section", "st-sec");
    ts.appendChild(el("h3", "", t("stats.done", { y: y })));
    var tiles = el("div", "tiles");
    TYPES.forEach(function (tp) {
      var ti = el("div", "tile");
      var ic = el("span", "t-ic");
      ic.innerHTML = UI[tp];
      ti.appendChild(ic);
      ti.appendChild(el("span", "t-n", fmtNum(S.done[tp])));
      ti.appendChild(el("span", "t-l", t("types." + tp)));
      tiles.appendChild(ti);
    });
    ts.appendChild(tiles);
    var facts = el("div", "facts");
    function fact(l, v) {
      var f = el("div", "fact");
      f.appendChild(el("span", "f-v", v));
      f.appendChild(el("span", "f-l", l));
      facts.appendChild(f);
    }
    fact(t("stats.pages"), fmtNum(S.pages));
    fact(t("stats.avg"), S.rated ? fmtNum(S.avg, 1) + " ★" : "—");
    fact(t("stats.now"), fmtNum(S.now));
    fact(t("stats.want"), fmtNum(S.want));
    ts.appendChild(facts);
    box.appendChild(ts);

    if (!S.total) {
      box.appendChild(el("p", "hint center", t("stats.none", { y: y })));
      return;
    }

    // Months.
    var ms = el("section", "st-sec");
    ms.appendChild(el("h3", "", t("stats.months")));
    var chart = el("div", "months");
    var max = Math.max.apply(null, S.months), names = t("months").split(",");
    S.months.forEach(function (n, i) {
      var c = el("div", "mo");
      c.title = names[i] + ": " + n;
      var b = el("div", "mo-bar");
      var f = el("i");
      f.style.height = (max ? n * 100 / max : 0) + "%";
      b.appendChild(f);
      c.appendChild(el("span", "mo-n", n ? String(n) : ""));
      c.appendChild(b);
      c.appendChild(el("span", "mo-l", names[i]));
      chart.appendChild(c);
    });
    ms.appendChild(chart);
    box.appendChild(ms);

    function topList(title, rows) {
      if (!rows.length) return;
      var s = el("section", "st-sec");
      s.appendChild(el("h3", "", title));
      var ol = el("ol", "top");
      rows.forEach(function (r) {
        var li = el("li");
        li.appendChild(el("span", "tp-n", r.name));
        li.appendChild(el("span", "tp-c", String(r.n)));
        ol.appendChild(li);
      });
      s.appendChild(ol);
      box.appendChild(s);
    }
    topList(t("stats.top"), S.topBy);
    topList(t("stats.tags"), S.topTags);
  }

  // ---------- 11. Export / import (R33) ----------
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0] ? inp.files[0] : null;
        inp.remove();
        resolve(f);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  function exportJson() {
    var payload = { app: "oros-shelf", ver: DATA_VER, exported: new Date().toISOString(), data: mergeShelf(data, data) };
    var text = JSON.stringify(payload, null, 1);
    var name = "oros-media-shelf-" + today() + ".json";
    var done = function () { showToast(t("toast.exported", { n: data.items.length })); };
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      // Text, not a Blob: a Blob made in this frame fails the shell's
      // `instanceof Blob` check (another realm) and would save empty.
      dlg.saveFile({ text: text, filename: name, mime: "application/json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }] })
        .then(function (r) { if (r && r.ok) done(); });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: "application/json" })), a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    done();
  }

  // An import is a merge: nothing on this device is replaced or lost.
  function importPayload(obj) {
    var inc = obj && typeof obj === "object" && obj.app === "oros-shelf" ? obj.data : obj;
    if (!inc || typeof inc !== "object" || !Array.isArray(inc.items)) return null;
    return mergeShelf(inc, inc);
  }

  function importJson() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(".json,application/json") : localPickFile(".json,application/json");
    Promise.resolve(pick).then(function (file) {
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { showToast(t("toast.big")); return; }
      file.text().then(function (txt) {
        var inc = null;
        try { inc = importPayload(JSON.parse(txt)); } catch (e) {}
        if (!inc) { showToast(t("toast.badFile")); return; }
        data = mergeShelf(data, inc);
        saveNow();
        renderAll();
        showToast(t("toast.imported", { n: data.items.length }));
      });
    });
  }

  function moreMenu() {
    var dlg = makeDialog("sh-more", "menu-dlg");
    dlg.appendChild(el("div", "dlg-title", t("btn.more")));
    var col = el("div", "menu-col");
    col.appendChild(button(t("menu.export"), "", function () { dlg.close(); exportJson(); }));
    col.appendChild(button(t("menu.import"), "", function () { dlg.close(); importJson(); }));
    col.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(col);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 12. Toasts, keyboard ----------
  function makeDialog(id, cls) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg" + (cls ? " " + cls : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "shelf", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null, null);
  }
  // Undo / action toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, t("toast.undo"), onUndo); }
  function actionToast(text, label, fn) { localToast(text, label, fn); }

  var toastTimer = null;
  function localToast(text, label, fn) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.textContent = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (fn) {
      var b = el("button", "", label);
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        fn();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, fn ? 8000 : 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // "/" search, "n" new title (not while typing, not in a dialog)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "/") { e.preventDefault(); if (prefs.tab === "stats") { prefs.tab = "now"; renderAll(); } $("q").focus(); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); editDialog(null); }
    });
  }

  // ---------- 13. Sync slice + palette ----------
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
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("shelf", sliceGet, sliceSet, STORAGE_KEY, mergeShelf);
  }

  function sliceGet() {
    flushReview();
    return mergeShelf(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.items)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeShelf(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge (sync feedback = taskbar dot)
    renderAll();
  }

  // ---------- 14. Wiring & boot ----------
  function applyI18n() {
    document.title = t("app") + " · orOS";
    $("app-name").textContent = t("app");
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("add-btn").innerHTML = UI.plus;
    $("add-btn").appendChild(el("span", "", t("btn.add")));
    $("add-btn").setAttribute("aria-label", t("btn.add") + " (N)");
    $("more-btn").innerHTML = UI.more;
    $("more-btn").setAttribute("aria-label", t("btn.more"));
    $("more-btn").title = t("btn.more");
    $("q-ic").innerHTML = UI.search;
    $("q").placeholder = t("search");
    $("q").setAttribute("aria-label", t("search"));
    var so = $("sort");
    so.setAttribute("aria-label", t("sort.aria"));
    so.textContent = "";
    SORTS.forEach(function (s) { var o = el("option", "", t("sort." + s)); o.value = s; so.appendChild(o); });
    so.value = prefs.sort;
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) {
      b.addEventListener("click", function () {
        prefs.tab = b.getAttribute("data-tab");
        savePrefs();
        renderAll();
      });
    });
    $("add-btn").addEventListener("click", function () { editDialog(null); });
    $("more-btn").addEventListener("click", moreMenu);
    $("q").addEventListener("input", renderList);
    $("q").addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("q").value) { e.preventDefault(); $("q").value = ""; renderList(); }
    });
    $("sort").addEventListener("change", function () {
      prefs.sort = $("sort").value;
      savePrefs();
      renderList();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushReview();
    });
    window.addEventListener("pagehide", flushReview);
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("shelf");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { item }. Opens the item's details dialog. Unknown item →
  // no-op; an open dialog → no-op (unsaved edits win).
  function openSearchTarget(t) {
    if (!t || typeof t.item !== "string" || document.querySelector("dialog[open]")) return;
    if (itemById(t.item)) itemDialog(t.item);
  }
  window.__orosOpenAt = openSearchTarget;

  boot();
})();
