// ============================================================
// orOS Media Shelf — App logic (v1.5.0)
// A wishlist and tracker for books, films, series, music,
// podcasts and games.
//   - four states: Want → Now → Done, or Dropped; every start,
//     finish and drop is kept, so re-reads and re-watches count
//   - progress in pages, minutes, episodes or hours, with the
//     pace and a "done in ~N days" estimate
//   - half-star ratings, favourites, a short review, tags
//   - yearly goals and statistics, all derived (never stored)
//   - JSON export / import (import merges, never replaces)
//   - Goodreads / Letterboxd CSV import with a preview; titles already
//     on the shelf are skipped; Undo takes an import back (1.1.0)
//   - Library link (1.4.0, BR-LIB-SHELF): Library's "Add to Media Shelf"
//     makes a linked book; its progress follows Library's place and
//     "Read in Library" opens it there
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
//  4b. CSV import (Goodreads, Letterboxd): parse, detect, plan
//  4d. Library link: read Library's place, plan the entries to log
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
      "lib.read": "Read in Library",
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
      "menu.csv": "Import from Goodreads / Letterboxd (CSV)",
      "csv.title": "Import from Goodreads / Letterboxd", "csv.found": "Found {n} titles.",
      "csv.dup": "{n} already on your shelf: skipped.", "csv.none": "Nothing new to import.",
      "csv.unknown": "Not a Goodreads or Letterboxd export: {f}",
      "csv.line": "{type}: {n} ({parts})", "csv.go": "Import {n}",
      "csv.hint": "Goodreads: My Books → Import and export → Export library. Letterboxd: Settings → Data → Export your data, unzip, then pick the CSV files (you can pick several).",
      "toast.csv": "Imported {n} titles", "toast.csvMax": "Only {n} more titles fit on your shelf",
      "f.rel": "Release date (optional)", "it.rel": "Out {d}",
      "menu.rem": "Reading reminder", "rem.title": "Reading reminder", "rem.on": "Remind me once a day",
      "rem.at": "From", "rem.done": "Done",
      "rem.hint": "Only when something is in Now and you haven't logged anything that day. It names the title you were on. It arrives while orOS is open, on this device only; quiet hours and the Media Shelf switch in Settings → Notifications apply.",
      "rem.toastOn": "Reading reminder on", "rem.toastOff": "Reading reminder off",
      "lk.btn": "Find details online", "lk.title": "Find details online",
      "lk.note": "This sends the title and creator you typed to {host} and nothing else. It never runs on its own, only when you tap this button.",
      "lk.go": "Search", "lk.wait": "Searching {host}…", "lk.src": "From {host}. Pick one to fill in the form, then check it and Save.",
      "lk.none": "No matches. Try a shorter title or leave the creator empty.",
      "lk.offline": "You are offline. Fill in the details by hand or try again later.",
      "lk.fail": "Could not reach {host}. Try again later.", "lk.needTitle": "Type a title first",
      "lk.filled": "Filled in. Check it and Save",
      "lk.from": "Search on", "lk.wd": "Wikidata", "lk.tmdb": "TMDB",
      "lk.more": "Getting the details…",
      "lk.cc0": "Details from Wikidata (CC0). Pictures from Wikimedia Commons, each under its own free licence.",
      "tmdb.notice": "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      "menu.tmdb": "Film and series details (TMDB key)", "tmdb.title": "TMDB key (optional)",
      "tmdb.text": "Films and series are looked up on Wikidata, with no key. If you have a free TMDB account you can also search TMDB, which has more posters: paste your own API key (v3) or API read access token here. It stays on this device and is sent only to api.themoviedb.org, only when you search.",
      "tmdb.key": "Your TMDB API key or read access token", "tmdb.get": "Get a key on themoviedb.org",
      "tmdb.bad": "That doesn't look like a TMDB key", "tmdb.saved": "TMDB key saved on this device",
      "tmdb.removed": "TMDB key removed", "tmdb.remove": "Remove key",
      "lk.badKey": "TMDB did not accept your key. Check it in More → Film and series details.",
      "cv.label": "Cover", "cv.remove": "Remove cover", "cv.removed": "The cover will be removed when you save",
      "cv.commons": "Cover: {by} · {lic} · Wikimedia Commons", "cv.commonsNo": "Cover: Wikimedia Commons",
      "cv.tmdb": "Poster and details: TMDB", "cv.tmdbD": "Details: TMDB", "cv.wd": "Details: Wikidata (CC0)",
      "rd.title": "Reading in {y}", "rd.pages": "Pages read", "rd.perDay": "Pages a day",
      "rd.days": "Days you read", "rd.streak": "Days in a row", "rd.best": "Best day",
      "rd.last": "The last 30 days", "rd.none": "Log your page in a book you're reading, and your pages per day show up here.",
      "rd.bestV": "{n} on {d}",
      "plan.left": "{n} to go · {d} days left", "plan.week": "About {n} a week", "plan.month": "about {n} a month",
      "plan.pages": "about {n} pages a day", "plan.proj": "At this pace: about {n} by the end of the year",
      "goal.strip": "Reading goal {y}: {v} of {n} books",
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
      "tab.now": "Τώρα", "tab.want": "Επιθυμίες", "tab.hist": "Ιστορικό", "tab.stats": "Στατιστικά",
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
      "fmt.p": "Χάρτινο", "fmt.e": "Ηλεκτρονικό", "fmt.a": "Ηχητικό",
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
      "lib.read": "Διάβασέ το στη Βιβλιοθήκη",
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
      "menu.csv": "Εισαγωγή από Goodreads / Letterboxd (CSV)",
      "csv.title": "Εισαγωγή από Goodreads / Letterboxd", "csv.found": "Βρέθηκαν {n} τίτλοι.",
      "csv.dup": "{n} υπάρχουν ήδη στο ράφι σου: παραλείπονται.", "csv.none": "Τίποτα καινούργιο για εισαγωγή.",
      "csv.unknown": "Δεν είναι εξαγωγή Goodreads ή Letterboxd: {f}",
      "csv.line": "{type}: {n} ({parts})", "csv.go": "Εισαγωγή {n}",
      "csv.hint": "Goodreads: My Books → Import and export → Export library. Letterboxd: Settings → Data → Export your data, αποσυμπίεσε και διάλεξε τα αρχεία CSV (μπορείς πολλά μαζί).",
      "toast.csv": "Εισήχθησαν {n} τίτλοι", "toast.csvMax": "Χωράνε μόνο {n} ακόμα τίτλοι στο ράφι σου",
      "f.rel": "Ημερομηνία κυκλοφορίας (προαιρετικά)", "it.rel": "Κυκλοφορεί {d}",
      "menu.rem": "Υπενθύμιση ανάγνωσης", "rem.title": "Υπενθύμιση ανάγνωσης", "rem.on": "Θύμισέ μου μία φορά τη μέρα",
      "rem.at": "Από", "rem.done": "Έτοιμο",
      "rem.hint": "Μόνο όταν έχεις κάτι στο Τώρα και δεν έχεις γράψει τίποτα εκείνη τη μέρα. Αναφέρει τον τίτλο που έχεις ξεκινήσει. Έρχεται όσο το orOS είναι ανοιχτό, μόνο σε αυτή τη συσκευή· ισχύουν οι ώρες ησυχίας και ο διακόπτης του Ραφιού στις Ρυθμίσεις → Ειδοποιήσεις.",
      "rem.toastOn": "Η υπενθύμιση ανάγνωσης άνοιξε", "rem.toastOff": "Η υπενθύμιση ανάγνωσης έκλεισε",
      "lk.btn": "Βρες στοιχεία online", "lk.title": "Βρες στοιχεία online",
      "lk.note": "Στέλνει στο {host} μόνο τον τίτλο και τον δημιουργό που έγραψες. Δεν τρέχει ποτέ μόνο του, μόνο όταν πατάς αυτό το κουμπί.",
      "lk.go": "Αναζήτηση", "lk.wait": "Αναζήτηση στο {host}…", "lk.src": "Από το {host}. Διάλεξε ένα για να συμπληρωθεί η φόρμα, έλεγξέ το και πάτα Αποθήκευση.",
      "lk.none": "Δεν βρέθηκε τίποτα. Δοκίμασε πιο σύντομο τίτλο ή άφησε κενό τον δημιουργό.",
      "lk.offline": "Είσαι εκτός σύνδεσης. Συμπλήρωσε τα στοιχεία με το χέρι ή δοκίμασε αργότερα.",
      "lk.fail": "Δεν ήταν δυνατή η σύνδεση με το {host}. Δοκίμασε αργότερα.", "lk.needTitle": "Γράψε πρώτα έναν τίτλο",
      "lk.filled": "Συμπληρώθηκε. Έλεγξέ το και πάτα Αποθήκευση",
      "lk.from": "Αναζήτηση στο", "lk.wd": "Wikidata", "lk.tmdb": "TMDB",
      "lk.more": "Φέρνω τα στοιχεία…",
      "lk.cc0": "Στοιχεία από το Wikidata (CC0). Εικόνες από τα Wikimedia Commons, η καθεμιά με τη δική της ελεύθερη άδεια.",
      "tmdb.notice": "Αυτό το προϊόν χρησιμοποιεί το TMDB API αλλά δεν είναι εγκεκριμένο ή πιστοποιημένο από το TMDB.",
      "menu.tmdb": "Στοιχεία ταινιών και σειρών (κλειδί TMDB)", "tmdb.title": "Κλειδί TMDB (προαιρετικό)",
      "tmdb.text": "Οι ταινίες και οι σειρές αναζητούνται στο Wikidata, χωρίς κλειδί. Αν έχεις δωρεάν λογαριασμό στο TMDB, μπορείς να ψάχνεις και εκεί, που έχει περισσότερες αφίσες: επικόλλησε εδώ το δικό σου API key (v3) ή το read access token. Μένει σε αυτή τη συσκευή και στέλνεται μόνο στο api.themoviedb.org, μόνο όταν ψάχνεις.",
      "tmdb.key": "Το API key ή το read access token σου στο TMDB", "tmdb.get": "Πάρε κλειδί στο themoviedb.org",
      "tmdb.bad": "Αυτό δεν μοιάζει με κλειδί TMDB", "tmdb.saved": "Το κλειδί TMDB αποθηκεύτηκε σε αυτή τη συσκευή",
      "tmdb.removed": "Το κλειδί TMDB αφαιρέθηκε", "tmdb.remove": "Αφαίρεση κλειδιού",
      "lk.badKey": "Το TMDB δεν δέχτηκε το κλειδί σου. Έλεγξέ το στο Περισσότερα → Στοιχεία ταινιών και σειρών.",
      "cv.label": "Εξώφυλλο", "cv.remove": "Αφαίρεση εξωφύλλου", "cv.removed": "Το εξώφυλλο θα φύγει όταν πατήσεις Αποθήκευση",
      "cv.commons": "Εξώφυλλο: {by} · {lic} · Wikimedia Commons", "cv.commonsNo": "Εξώφυλλο: Wikimedia Commons",
      "cv.tmdb": "Αφίσα και στοιχεία: TMDB", "cv.tmdbD": "Στοιχεία: TMDB", "cv.wd": "Στοιχεία: Wikidata (CC0)",
      "rd.title": "Διάβασμα το {y}", "rd.pages": "Σελίδες που διάβασες", "rd.perDay": "Σελίδες τη μέρα",
      "rd.days": "Μέρες με διάβασμα", "rd.streak": "Μέρες στη σειρά", "rd.best": "Καλύτερη μέρα",
      "rd.last": "Οι τελευταίες 30 μέρες", "rd.none": "Γράψε τη σελίδα σου σε ένα βιβλίο που διαβάζεις και εδώ θα δεις τις σελίδες σου τη μέρα.",
      "rd.bestV": "{n} στις {d}",
      "plan.left": "Μένουν {n} · {d} μέρες ακόμα", "plan.week": "Περίπου {n} την εβδομάδα", "plan.month": "περίπου {n} τον μήνα",
      "plan.pages": "περίπου {n} σελίδες τη μέρα", "plan.proj": "Με αυτόν τον ρυθμό: περίπου {n} ως το τέλος της χρονιάς",
      "goal.strip": "Στόχος ανάγνωσης {y}: {v} από {n} βιβλία",
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

  var ITEM_KEYS = ["id", "m", "a", "type", "title", "by", "year", "size", "fmt", "plat", "st",
                   "prio", "rate", "fav", "tags", "rev", "src", "col", "rel",
                   "cov", "cvby", "cvlc", "cvpg", "wd", "tmdb"];
  var EXTRA_RE = /^[a-z][a-z0-9]{0,15}$/;
  var COV_RE = /^https:\/\/(upload\.wikimedia\.org|image\.tmdb\.org)\/[^\s"'<>\\]{1,460}$/;
  var CVPG_RE = /^https:\/\/commons\.wikimedia\.org\/wiki\/[^\s"'<>\\]{1,440}$/;
  var WD_RE = /^Q[1-9][0-9]{0,11}$/;
  var TMDB_RE = /^(movie|tv)\/[1-9][0-9]{0,11}$/;

  function normItem(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var title = clipLine(x.title, TITLE_LEN);
    if (!title || TYPES.indexOf(x.type) < 0) return null;
    var o = {
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
    // Release date (YYYY-MM-DD, since 1.2.0): only present when set, so
    // items without one keep their 1.1 bytes.
    if (isYmd(x.rel)) o.rel = x.rel;
    // Cover and source ids found online (1.5.0): only present when set;
    // only https pictures on the two image hosts, the credit as text.
    if (typeof x.cov === "string" && COV_RE.test(x.cov)) {
      o.cov = x.cov;
      var cb = clipLine(x.cvby, BY_LEN), cl = clipLine(x.cvlc, 60);
      if (cb) o.cvby = cb;
      if (cl) o.cvlc = cl;
      if (typeof x.cvpg === "string" && CVPG_RE.test(x.cvpg)) o.cvpg = x.cvpg;
    }
    if (typeof x.wd === "string" && WD_RE.test(x.wd)) o.wd = x.wd;
    if (typeof x.tmdb === "string" && TMDB_RE.test(x.tmdb)) o.tmdb = x.tmdb;
    // Forward compatibility: a field this version does not know rides
    // along (flat name, string <= 500 / finite number / boolean, at
    // most 16, sorted), so a newer device's additions survive here.
    var extra = Object.keys(x).filter(function (k) {
      if (ITEM_KEYS.indexOf(k) >= 0 || !EXTRA_RE.test(k)) return false;
      var v = x[k];
      return (typeof v === "string" && v.length <= 500) || typeof v === "boolean" ||
             (typeof v === "number" && isFinite(v));
    }).sort(cmpStr).slice(0, 16);
    extra.forEach(function (k) { o[k] = x[k]; });
    return o;
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

  // ---------- 4b. CSV import (Goodreads, Letterboxd) ----------
  // Pure: files [{name, text}] → a plan { items, sess, counts, dup, unknown }
  // of NEW rows only; nothing is written until the user confirms.
  // Goodreads: the library export (goodreads_library_export.csv).
  // Letterboxd: the CSV files from the export zip (watchlist, watched,
  // ratings, diary, reviews). Titles already on the shelf are skipped.
  var CSV_MAX_ROWS = 20000;

  // RFC 4180: quoted fields, "" escapes, CRLF / LF / CR, BOM.
  function parseCsv(text) {
    var s = String(text || "").replace(/^﻿/, "");
    var rows = [], row = [], f = "", q = false, i = 0, n = s.length;
    while (i < n) {
      var c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') { f += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        f += c; i++; continue;
      }
      if (c === '"' && f === "") { q = true; i++; continue; }
      if (c === ",") { row.push(f); f = ""; i++; continue; }
      if (c === "\r" || c === "\n") {
        row.push(f); f = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        if (c === "\r" && s[i + 1] === "\n") i++;
        i++;
        if (rows.length > CSV_MAX_ROWS) break;
        continue;
      }
      f += c; i++;
    }
    if (f !== "" || row.length) { row.push(f); if (row.length > 1 || row[0] !== "") rows.push(row); }
    return rows;
  }
  function csvObjects(rows) {
    if (!rows.length) return { head: [], list: [] };
    var head = rows[0].map(function (h) { return String(h).trim(); });
    var list = rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, k) { o[h] = r[k] !== undefined ? String(r[k]) : ""; });
      return o;
    });
    return { head: head, list: list };
  }

  // Which export a file is, from its header (and name for Letterboxd).
  function csvKind(head, name) {
    var has = function (h) { return head.indexOf(h) >= 0; };
    if (has("Title") && has("Author") && has("Exclusive Shelf")) return "gr";
    if (has("Name") && has("Letterboxd URI")) {
      var nm = String(name || "").toLowerCase();
      if (has("Review")) return "lb-reviews";
      if (has("Watched Date")) return "lb-diary";
      if (has("Rating")) return "lb-ratings";
      return /watchlist/.test(nm) ? "lb-watchlist" : "lb-watched";
    }
    return null;
  }

  function csvYmd(s) {
    var x = String(s || "").trim().replace(/\//g, "-").slice(0, 10);
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(x);
    if (!m) return "";
    x = m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]);
    return isYmd(x) ? x : "";
  }
  function ymdNoon(ymd) {
    var m = YMD_RE.exec(ymd);
    return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  }
  function csvInt(s, lo, hi) {
    var v = parseInt(String(s || "").replace(/[^0-9-]/g, ""), 10);
    return isFinite(v) && v >= lo && v <= hi ? v : 0;
  }
  // Goodreads reviews carry <br/> and a few tags: keep the text only.
  function stripHtml(s) {
    return String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  }
  function colorFor(title) {
    var h = 0, s = fold(title);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % NCOLORS;
  }
  function dupKey(type, title, by, year) {
    return type + "\u0001" + fold(clipLine(title, TITLE_LEN)) + "\u0001" +
      (type === "film" ? String(year || "") : fold(clipLine(by, BY_LEN)));
  }
  var GR_SHELVES = ["read", "currently-reading", "to-read"];
  var DROP_RE = /dnf|did-?not-?finish|abandon|dropped|gave-?up|παρατ/i;

  function planImport(files, D, opts) {
    var now0 = opts.now, today0 = opts.today;
    var have = {};
    D.items.forEach(function (it) { have[dupKey(it.type, it.title, it.by, it.year)] = 1; });
    var out = { items: [], sess: [], counts: {}, dup: 0, unknown: [], found: 0 };
    var seen = {}, m = now0;
    function stamp() { return m++; }
    function add(it, sessList) {
      var k = dupKey(it.type, it.title, it.by, it.year);
      if (seen[k]) return;
      seen[k] = 1;
      out.found++;
      if (have[k]) { out.dup++; return; }
      it.id = newId();
      it.m = stamp();
      var x = normItem(it);
      if (!x) return;
      out.items.push(x);
      sessList.forEach(function (s) {
        var y = normSess({ id: newId(), m: stamp(), it: x.id, k: s.k, d: s.d, v: s.v });
        if (y) out.sess.push(y);
      });
      var c = out.counts[x.type] || (out.counts[x.type] = { want: 0, now: 0, done: 0, drop: 0 });
      c[x.st]++;
    }

    var lb = {}, lbOrder = [];
    function film(o) {
      // Name + year: diary and review URIs point at the log entry, not the film.
      var k = fold(clipLine(o.Name, TITLE_LEN)) + "|" + String(o.Year || "").trim();
      if (!lb[k]) { lb[k] = { name: o.Name, year: o.Year, want: false, watched: "", diary: [], rate: 0, logRate: 0, logAt: "", rev: "", tags: [], added: "" }; lbOrder.push(k); }
      return lb[k];
    }
    var rank = { "lb-watchlist": 0, "lb-watched": 1, "lb-ratings": 2, "lb-diary": 3, "lb-reviews": 4, gr: 5 };
    var parsed = files.map(function (f) {
      var o = csvObjects(parseCsv(f.text));
      return { name: f.name, kind: csvKind(o.head, f.name), list: o.list };
    });
    parsed.forEach(function (p) { if (!p.kind) out.unknown.push(p.name); });
    parsed.filter(function (p) { return p.kind; })
      .sort(function (a, b) { return rank[a.kind] - rank[b.kind]; })
      .forEach(function (p) {
        p.list.forEach(function (o) {
          if (p.kind === "gr") {
            var sh = String(o["Exclusive Shelf"] || "").trim().toLowerCase();
            var st = sh === "read" ? "done" : sh === "currently-reading" ? "now" :
                     sh === "to-read" ? "want" : (DROP_RE.test(sh) ? "drop" : "want");
            var added = csvYmd(o["Date Added"]), read = csvYmd(o["Date Read"]);
            var bind = String(o.Binding || "").toLowerCase();
            var tags = String(o.Bookshelves || "").split(",").map(function (x) { return x.trim(); })
              .filter(function (x) { return x && GR_SHELVES.indexOf(x.toLowerCase()) < 0 && !(st === "drop" && x.toLowerCase() === sh); });
            var sl = [];
            if (st === "now") sl.push({ k: "s", d: added || today0 });
            if (st === "done") sl.push({ k: "d", d: read || added || today0 });
            if (st === "drop") sl.push({ k: "x", d: added || today0 });
            add({
              a: added ? ymdNoon(added) : now0, type: "book", title: o.Title, by: o.Author,
              year: csvInt(o["Original Publication Year"], 1, 9999) || csvInt(o["Year Published"], 1, 9999),
              size: csvInt(o["Number of Pages"], 0, MAX_SIZE),
              fmt: /audio|audible/.test(bind) ? "a" : (/kindle|ebook|e-book|nook|kobo/.test(bind) ? "e" : "p"),
              st: st, rate: csvInt(o["My Rating"], 0, 5) * 2, tags: tags,
              rev: clipText(stripHtml(o["My Review"]), REV_LEN), col: colorFor(o.Title)
            }, sl);
            return;
          }
          if (!clipLine(o.Name, TITLE_LEN)) return;
          var f = film(o), d = csvYmd(o.Date);
          if (d && (!f.added || d < f.added)) f.added = d;
          if (p.kind === "lb-watchlist") f.want = true;
          if (p.kind === "lb-watched") f.watched = f.watched || d || today0;
          var r = parseFloat(String(o.Rating || "").replace(",", "."));
          if (isFinite(r) && r > 0) {
            r = Math.max(1, Math.min(10, Math.round(r * 2)));
            // ratings.csv is the current rating; a log's rating is a fallback (newest log wins).
            if (p.kind === "lb-ratings") f.rate = r;
            else if (!f.logAt || d >= f.logAt) { f.logRate = r; f.logAt = d; }
          }
          if (p.kind === "lb-diary") {
            var wd = csvYmd(o["Watched Date"]) || d;
            if (wd && f.diary.indexOf(wd) < 0) f.diary.push(wd);
          }
          if (p.kind === "lb-diary" || p.kind === "lb-reviews") {
            String(o.Tags || "").split(",").forEach(function (x) { x = x.trim(); if (x && f.tags.indexOf(x) < 0) f.tags.push(x); });
          }
          if (p.kind === "lb-reviews" && o.Review) f.rev = clipText(stripHtml(o.Review), REV_LEN);
        });
      });
    lbOrder.forEach(function (k) {
      var f = lb[k];
      var dates = f.diary.slice().sort();
      if (!dates.length && (f.watched || f.rate || f.logRate || f.rev)) dates = [f.watched || f.added || today0];
      var st = dates.length ? "done" : "want";
      add({
        a: f.added ? ymdNoon(f.added) : now0, type: "film", title: f.name, by: "",
        year: csvInt(f.year, 1, 9999), st: st, rate: f.rate || f.logRate, tags: f.tags, rev: f.rev, col: colorFor(f.name)
      }, dates.map(function (x) { return { k: "d", d: x }; }));
    });
    return out;
  }

  // ---------- 4c. Online lookup (Open Library, MusicBrainz) ----------
  // Opt-in and on a tap only: the title and creator typed in the form
  // are the only things sent. Books → Open Library, albums →
  // MusicBrainz; no API key, no account. Answers are plain data and go
  // through the same clipping as typed input; nothing is saved until
  // the user presses Save.
  var LOOKUP_HOSTS = { book: "openlibrary.org", album: "musicbrainz.org" };
  var LOOKUP_MAX = 8;
  function luceneQ(s) { return '"' + s.replace(/[\\"]/g, "\\$&") + '"'; }
  function lookupUrl(type, title, by) {
    title = clipLine(title, TITLE_LEN);
    by = clipLine(by, BY_LEN);
    if (!title || !LOOKUP_HOSTS[type]) return "";
    if (type === "book") {
      return "https://openlibrary.org/search.json?limit=" + LOOKUP_MAX +
        "&fields=title,author_name,first_publish_year,number_of_pages_median" +
        "&title=" + encodeURIComponent(title) + (by ? "&author=" + encodeURIComponent(by) : "");
    }
    return "https://musicbrainz.org/ws/2/release/?fmt=json&limit=" + LOOKUP_MAX + "&query=" +
      encodeURIComponent("release:" + luceneQ(title) + (by ? " AND artist:" + luceneQ(by) : ""));
  }
  function parseLookup(type, json) {
    var out = [], seen = {};
    function add(r) {
      var c = {
        title: clipLine(r.title, TITLE_LEN), by: clipLine(r.by, BY_LEN),
        year: intIn(r.year, 1, 9999, 0), size: intIn(r.size, 1, MAX_SIZE, 0),
        rel: isYmd(r.rel) ? r.rel : ""
      };
      var k = fold(c.title) + "|" + fold(c.by) + "|" + c.year + "|" + c.size + "|" + c.rel;
      if (!c.title || seen[k] || out.length >= LOOKUP_MAX) return;
      seen[k] = 1;
      out.push(c);
    }
    function str(v) { return typeof v === "string" ? v : ""; }
    if (!json || typeof json !== "object") return out;
    if (type === "book" && Array.isArray(json.docs)) {
      json.docs.forEach(function (d) {
        if (!d || typeof d !== "object") return;
        add({ title: d.title, year: d.first_publish_year, size: d.number_of_pages_median,
              by: Array.isArray(d.author_name) ? d.author_name.filter(str).slice(0, 3).join(", ") : "" });
      });
    } else if (type === "album" && Array.isArray(json.releases)) {
      json.releases.forEach(function (r) {
        if (!r || typeof r !== "object") return;
        var by = Array.isArray(r["artist-credit"]) ? r["artist-credit"].map(function (a) {
          return a && typeof a === "object" ? str(a.name) + str(a.joinphrase) : "";
        }).join("") : "";
        var date = str(r.date);
        add({ title: r.title, by: by, year: parseInt(date.slice(0, 4), 10), size: r["track-count"], rel: date });
      });
    }
    return out;
  }

  // Films and series (1.5.0): Wikidata (CC0, no key) or, when the user
  // has entered their own key, TMDB. Both only on a tap. Wikidata:
  // wbsearchentities finds items by name, wbgetentities reads their
  // class, date, runtime / episodes, director / creator and picture;
  // the picture's credit and licence come from Wikimedia Commons.
  // Answers are plain data, clipped like typed input.
  var WD_API = "https://www.wikidata.org/w/api.php?format=json&origin=*&";
  var CM_API = "https://commons.wikimedia.org/w/api.php?format=json&origin=*&";
  var TMDB_API = "https://api.themoviedb.org/3/";
  var TMDB_IMG = "https://image.tmdb.org/t/p/w342";
  // Classes (P31) that count as a film or a series.
  var WD_CLASSES = {
    film: ["Q11424", "Q24869", "Q506240", "Q202866", "Q226730", "Q24862", "Q229390", "Q93204", "Q20667187"],
    series: ["Q5398426", "Q1259759", "Q581714", "Q117467246", "Q63952888", "Q526877", "Q21191270", "Q15416"]
  };
  function lkLang(lang) { return lang === "el" ? "el" : "en"; }
  function wdSearchUrl(title, lang) {
    title = clipLine(title, TITLE_LEN);
    if (!title) return "";
    lang = lkLang(lang);
    return WD_API + "action=wbsearchentities&type=item&limit=20&language=" + lang + "&uselang=" + lang +
      "&search=" + encodeURIComponent(title);
  }
  // → [{ id, label, desc }] in the order Wikidata ranked them.
  function parseWdSearch(json) {
    var out = [], seen = {};
    var list = json && Array.isArray(json.search) ? json.search : [];
    list.forEach(function (h) {
      if (!h || typeof h !== "object" || typeof h.id !== "string" || !WD_RE.test(h.id) || seen[h.id]) return;
      seen[h.id] = 1;
      out.push({ id: h.id, label: clipLine(h.label, TITLE_LEN), desc: clipLine(h.description, 200) });
    });
    return out;
  }
  function wdEntitiesUrl(ids, lang, props) {
    ids = (ids || []).filter(function (x) { return WD_RE.test(x); }).slice(0, 50);
    if (!ids.length) return "";
    lang = lkLang(lang);
    return WD_API + "action=wbgetentities&props=" + encodeURIComponent(props || "claims|labels") +
      "&languages=" + encodeURIComponent(lang === "en" ? "en" : lang + "|en") + "&ids=" + encodeURIComponent(ids.join("|"));
  }
  function wdValues(ent, prop) {
    var cl = ent && ent.claims && Array.isArray(ent.claims[prop]) ? ent.claims[prop] : [];
    var out = [];
    cl.forEach(function (c) {
      if (!c || c.rank === "deprecated" || !c.mainsnak || c.mainsnak.snaktype !== "value" || !c.mainsnak.datavalue) return;
      out.push(c.mainsnak.datavalue.value);
    });
    return out;
  }
  function wdIds(ent, prop) {
    return wdValues(ent, prop).map(function (v) { return v && typeof v === "object" ? v.id : ""; })
      .filter(function (x) { return typeof x === "string" && WD_RE.test(x); });
  }
  function wdLabel(ent, lang) {
    var L = ent && ent.labels && typeof ent.labels === "object" ? ent.labels : {};
    var x = L[lkLang(lang)] || L.en;
    return x && typeof x.value === "string" ? clipLine(x.value, TITLE_LEN) : "";
  }
  var WD_UNITS = { Q7727: 1, Q11574: 1 / 60, Q25235: 60 };      // minute, second, hour
  // → candidates { title, by: "", byIds[], year, size, rel, wd, img, desc }
  // in search order, only items of the type's classes.
  function parseWdEntities(type, json, hits, lang) {
    var ents = json && json.entities && typeof json.entities === "object" ? json.entities : {};
    var cls = WD_CLASSES[type] || [], out = [];
    (hits || []).forEach(function (h) {
      var e = ents[h.id];
      if (!e || typeof e !== "object" || out.length >= LOOKUP_MAX) return;
      var isA = wdIds(e, "P31");
      if (!isA.some(function (q) { return cls.indexOf(q) >= 0; })) return;
      // the earliest publication date; a day only with day precision
      var best = null;
      wdValues(e, "P577").forEach(function (v) {
        var m = v && typeof v.time === "string" ? /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(v.time) : null;
        if (!m || !(v.precision >= 9)) return;
        var d = { y: +m[1], ymd: m[1] + "-" + m[2] + "-" + m[3], day: v.precision >= 11 };
        if (!best || d.ymd < best.ymd) best = d;
      });
      var size = 0;
      if (type === "film") {
        wdValues(e, "P2047").some(function (v) {
          var u = v && typeof v.unit === "string" ? WD_UNITS[v.unit.replace(/^.*\//, "")] : 0;
          var a = v ? parseFloat(v.amount) : NaN;
          if (!u || !isFinite(a) || a <= 0) return false;
          size = Math.round(a * u);
          return true;
        });
      } else {
        wdValues(e, "P1113").some(function (v) {
          var a = v ? parseFloat(v.amount) : NaN;
          if (!isFinite(a) || a <= 0) return false;
          size = Math.round(a);
          return true;
        });
      }
      var byIds = wdIds(e, type === "film" ? "P57" : "P170");
      if (!byIds.length && type === "series") byIds = wdIds(e, "P57");
      var img = "";
      wdValues(e, "P3383").concat(wdValues(e, "P18")).some(function (v) {
        if (typeof v === "string" && v.length <= 240 && !/[\/\\<>"|\u0000-\u001f]/.test(v)) { img = v; return true; }
        return false;
      });
      out.push({
        title: wdLabel(e, lang) || h.label, by: "", byIds: byIds.slice(0, 3),
        year: best && best.y >= 1 && best.y <= 9999 ? best.y : 0, rel: best && best.day && isYmd(best.ymd) ? best.ymd : "",
        size: intIn(size, 1, MAX_SIZE, 0), wd: h.id, img: img, desc: h.desc || ""
      });
    });
    return out;
  }
  // { Qid: label } from a labels-only wbgetentities answer.
  function parseWdLabels(json, lang) {
    var ents = json && json.entities && typeof json.entities === "object" ? json.entities : {}, out = {};
    Object.keys(ents).forEach(function (id) {
      if (!WD_RE.test(id)) return;
      var l = wdLabel(ents[id], lang);
      if (l) out[id] = clipLine(l, BY_LEN);
    });
    return out;
  }
  function commonsUrl(file) {
    if (typeof file !== "string" || !file) return "";
    return CM_API + "action=query&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=320" +
      "&iiextmetadatafilter=Artist%7CLicenseShortName&titles=" + encodeURIComponent("File:" + file);
  }
  // → { cov, cvby, cvlc, cvpg } or null: the thumbnail and its credit.
  function parseCommons(json) {
    var pages = json && json.query && json.query.pages && typeof json.query.pages === "object" ? json.query.pages : {};
    var out = null;
    Object.keys(pages).some(function (k) {
      var ii = pages[k] && Array.isArray(pages[k].imageinfo) ? pages[k].imageinfo[0] : null;
      if (!ii || typeof ii.thumburl !== "string" || !COV_RE.test(ii.thumburl)) return false;
      var md = ii.extmetadata && typeof ii.extmetadata === "object" ? ii.extmetadata : {};
      function meta(n) { return md[n] && typeof md[n].value === "string" ? md[n].value : ""; }
      out = { cov: ii.thumburl, cvby: clipLine(stripHtml(meta("Artist")), BY_LEN), cvlc: clipLine(stripHtml(meta("LicenseShortName")), 60) };
      if (typeof ii.descriptionurl === "string" && CVPG_RE.test(ii.descriptionurl)) out.cvpg = ii.descriptionurl;
      return true;
    });
    return out;
  }
  // TMDB with the user's own key: a v3 API key goes in the address, a
  // v4 read access token (a long JWT) in the Authorization header.
  function tmdbKeyOk(k) { return typeof k === "string" && /^[A-Za-z0-9._-]{16,600}$/.test(k); }
  function tmdbReq(path, params, key) {
    if (!tmdbKeyOk(key)) return null;
    var bearer = key.length > 40;
    var q = Object.keys(params).sort(cmpStr).map(function (k) { return k + "=" + encodeURIComponent(params[k]); });
    if (!bearer) q.push("api_key=" + encodeURIComponent(key));
    var headers = { Accept: "application/json" };
    if (bearer) headers.Authorization = "Bearer " + key;
    return { url: TMDB_API + path + "?" + q.join("&"), headers: headers };
  }
  function tmdbKind(type) { return type === "film" ? "movie" : "tv"; }
  function tmdbLang(lang) { return lang === "el" ? "el-GR" : "en-US"; }
  function tmdbSearchReq(type, title, key, lang) {
    title = clipLine(title, TITLE_LEN);
    if (!title || !WD_CLASSES[type]) return null;
    return tmdbReq("search/" + tmdbKind(type), { query: title, include_adult: "false", language: tmdbLang(lang) }, key);
  }
  function tmdbDetailsReq(type, ref, key, lang) {
    if (!TMDB_RE.test(ref || "")) return null;
    var p = { language: tmdbLang(lang) };
    if (type === "film") p.append_to_response = "credits";
    return tmdbReq(ref, p, key);
  }
  function tmdbPoster(p) {
    return typeof p === "string" && /^\/[A-Za-z0-9_-]{1,120}\.(jpg|jpeg|png|webp)$/i.test(p) ? TMDB_IMG + p : "";
  }
  function parseTmdbSearch(type, json) {
    var out = [];
    var list = json && Array.isArray(json.results) ? json.results : [];
    list.forEach(function (r) {
      if (!r || typeof r !== "object" || !isInt(r.id) || r.id <= 0 || out.length >= LOOKUP_MAX) return;
      var date = type === "film" ? r.release_date : r.first_air_date;
      if (!isYmd(date)) date = "";
      var title = clipLine(type === "film" ? r.title : r.name, TITLE_LEN);
      if (!title) return;
      var c = { title: title, by: "", year: date ? +date.slice(0, 4) : 0, rel: date, size: 0,
                tmdb: tmdbKind(type) + "/" + r.id, desc: clipLine(r.overview, 200) };
      var cov = tmdbPoster(r.poster_path);
      if (cov) c.cov = cov;
      out.push(c);
    });
    return out;
  }
  // → { by, size } from a details answer (director / creators, runtime / episodes).
  function parseTmdbDetails(type, json) {
    var out = { by: "", size: 0 };
    if (!json || typeof json !== "object") return out;
    function names(list) {
      return (Array.isArray(list) ? list : []).map(function (p) { return p && typeof p.name === "string" ? clipLine(p.name, BY_LEN) : ""; })
        .filter(Boolean).slice(0, 3).join(", ");
    }
    if (type === "film") {
      var crew = json.credits && Array.isArray(json.credits.crew) ? json.credits.crew : [];
      out.by = names(crew.filter(function (p) { return p && p.job === "Director"; }));
      out.size = intIn(json.runtime, 1, MAX_SIZE, 0);
    } else {
      out.by = names(json.created_by);
      out.size = intIn(json.number_of_episodes, 1, MAX_SIZE, 0);
    }
    out.by = clipLine(out.by, BY_LEN);
    return out;
  }
  // Where an item's cover came from: "commons" | "tmdb" | "".
  function coverSource(it) {
    if (!it || !it.cov) return "";
    return /^https:\/\/image\.tmdb\.org\//.test(it.cov) ? "tmdb" : "commons";
  }

  // ---------- 4e. Reading: pages per day, the yearly goal plan ----------
  // Pages read per day ("YYYY-MM-DD" → pages) from the log of print and
  // e-books: every page logged past the previous one counts on the day
  // it was logged; a finish counts the pages still left that day (a
  // book marked done with no progress counts whole on its finish day,
  // which is how imported books count). A new start (re-read) begins
  // again from page 0. Audiobooks are not pages.
  function pagesByDay(D) {
    var by = {}, books = {}, per = {};
    D.items.forEach(function (it) { if (it.type === "book" && it.fmt !== "a") books[it.id] = it; });
    D.sess.forEach(function (s) { if (books[s.it]) (per[s.it] || (per[s.it] = [])).push(s); });
    Object.keys(per).sort(cmpStr).forEach(function (id) {
      var it = books[id], cur = 0;
      per[id].sort(cmpSess).forEach(function (s) {
        var add = 0;
        if (s.k === "s") { cur = 0; return; }
        if (s.k === "p" && s.v > cur) { add = s.v - cur; cur = s.v; }
        else if (s.k === "d" && it.size > cur) { add = it.size - cur; cur = it.size; }
        if (add > 0) by[s.d] = (by[s.d] || 0) + add;
      });
    });
    return by;
  }
  function ymdOfNum(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  // Pages in a year: total, reading days, pages per day over the days
  // gone by (the whole year once it is over), the best day, the streak
  // of days in a row up to today (or yesterday, today not read yet)
  // and the last 30 days.
  function readingSummary(byDay, year, today) {
    var y = String(year), total = 0, days = 0, best = null;
    Object.keys(byDay).sort(cmpStr).forEach(function (d) {
      if (d.slice(0, 4) !== y || !(byDay[d] > 0)) return;
      total += byDay[d];
      days++;
      if (!best || byDay[d] > best.n) best = { d: d, n: byDay[d] };
    });
    var d0 = dayNum(y + "-01-01"), d1 = dayNum((year + 1) + "-01-01"), tn = dayNum(today);
    var span = tn < d0 ? 0 : Math.min(tn, d1 - 1) - d0 + 1;
    var k = tn, streak = 0;
    if (!(byDay[ymdOfNum(k)] > 0)) k--;
    while (byDay[ymdOfNum(k)] > 0 && streak < 3660) { streak++; k--; }
    var last = [];
    for (var i = 29; i >= 0; i--) { var dd = ymdOfNum(tn - i); last.push({ d: dd, n: byDay[dd] || 0 }); }
    return { total: total, days: days, best: best, span: span, perDay: span ? total / span : 0, streak: streak, last: last };
  }
  // Average pages of the print and e-books finished in a year (else of
  // every such book with a page count); 0 when nothing is known.
  function avgBookPages(D, year) {
    var live = {}, y = String(year), n = 0, sum = 0, seen = {};
    D.items.forEach(function (it) { if (it.type === "book" && it.fmt !== "a" && it.size > 0) live[it.id] = it; });
    D.sess.forEach(function (s) {
      if (s.k !== "d" || s.d.slice(0, 4) !== y || !live[s.it] || seen[s.it]) return;
      seen[s.it] = 1; n++; sum += live[s.it].size;
    });
    if (!n) Object.keys(live).forEach(function (id) { n++; sum += live[id].size; });
    return n ? Math.round(sum / n) : 0;
  }
  // What a yearly goal of n titles (done so far) needs from here on:
  // { left, daysLeft (today included), perWeek, perMonth, projected
  // (the whole year at the pace so far), pagesPerDay (books, from the
  // average book) }.
  function goalPlan(n, done, year, today, pagesPerBook) {
    var ty = +today.slice(0, 4);
    var d0 = dayNum(year + "-01-01"), d1 = dayNum((year + 1) + "-01-01"), tn = dayNum(today);
    var len = d1 - d0, left = Math.max(0, n - done);
    var daysLeft = year < ty ? 0 : (year > ty ? len : d1 - tn);
    var gone = year < ty ? len : (year > ty ? 0 : tn - d0 + 1);
    return {
      left: left, daysLeft: daysLeft,
      perWeek: daysLeft && left ? left * 7 / daysLeft : 0,
      perMonth: daysLeft && left ? left * len / 12 / daysLeft : 0,
      projected: gone ? Math.round(done * len / gone) : 0,
      pagesPerDay: daysLeft && left && pagesPerBook > 0 ? Math.ceil(left * pagesPerBook / daysLeft) : 0
    };
  }

  // ---------- 4d. Library link (BR-LIB-SHELF) ----------
  // A book can carry `lib`, the id of the same book in Library ("b" + 16
  // hex; an extra field, so it rides along everywhere). Library's data
  // (oros-library-data) is only read here, never written. Progress =
  // Library's place x the item's size and only moves forward; a book
  // marked finished in Library finishes the current run. A dropped or
  // finished item is left alone (reading again is the person's call).
  var LIB_KEY = "oros-library-data";
  var LIB_ID_RE = /^b[0-9a-f]{16}$/;
  // → { pct (0–1000), fin ("YYYY-MM-DD" | ""), pages } | null
  function libOf(libData, lib) {
    if (!libData || typeof libData !== "object" || !LIB_ID_RE.test(lib)) return null;
    var tombs = libData.tombs && typeof libData.tombs === "object" ? libData.tombs : {};
    var b = null;
    (Array.isArray(libData.books) ? libData.books : []).forEach(function (x) {
      if (x && x.id === lib && isInt(x.m) && !(isInt(tombs[lib]) && tombs[lib] >= x.m)) b = x;
    });
    if (!b) return null;
    var p = libData.pos && typeof libData.pos === "object" ? libData.pos[lib] : null;
    return {
      pct: p && isInt(p.pct) ? Math.max(0, Math.min(1000, p.pct)) : 0,
      fin: isYmd(b.fin) ? b.fin : "",
      pages: isInt(b.pages) && b.pages > 0 && b.pages <= MAX_SIZE ? b.pages : 0
    };
  }
  // What to log for a linked item: { start, v, done } or null.
  function libPlan(it, list, info) {
    if (!info || it.type !== "book" || it.st === "done" || it.st === "drop") return null;
    var cur = it.st === "now" ? progressOf(list) : 0;
    var v = it.size > 0 ? Math.min(it.size, Math.round(info.pct * it.size / 1000)) : 0;
    var rs = it.st === "now" ? runStart(list) : null;
    var done = !!info.fin && (!rs || info.fin >= rs);
    var more = v > cur ? v : 0;
    if (!more && !done) return null;
    return { start: it.st === "want", v: more, done: done };
  }
  // A new book item for Library's "Add to Media Shelf" (null if invalid).
  function libItem(b, id, ts, col) {
    if (!b || typeof b !== "object" || !LIB_ID_RE.test(b.lib)) return null;
    return normItem({
      id: id, m: ts, a: ts, type: "book", fmt: "e", title: b.title, by: b.by,
      year: isInt(b.year) ? b.year : 0, size: isInt(b.size) && b.size > 0 ? Math.min(b.size, MAX_SIZE) : 0,
      st: "want", tags: [], rev: "", src: "", col: col || 0, lib: b.lib
    });
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
      sort: SORTS.indexOf(p.sort) >= 0 ? p.sort : "recent",
      lk: p.lk === 1 ? 1 : 0,         // said yes to the online lookup note (books, music)
      lkw: p.lkw === 1 ? 1 : 0,       // ... and to Wikidata (films, series; 1.5.0)
      lks: p.lks === "wd" || p.lks === "tmdb" ? p.lks : ""   // films / series: last source used
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

  // Library progress into linked books (boot and when orOS comes back).
  function readLib() {
    try { return JSON.parse(localStorage.getItem(LIB_KEY) || "null"); } catch (e) { return null; }
  }
  function libItemOf(lib) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].lib === lib) return data.items[i];
    return null;
  }
  function libSync() {
    var raw = readLib();
    if (!raw) return false;
    var changed = false;
    data.items.forEach(function (it) {
      if (!it.lib) return;
      var plan = libPlan(it, sessOf(data, it.id), libOf(raw, it.lib));
      if (!plan) return;
      var st = null;
      if (plan.start) { st = addSess(it, "s"); it.st = "now"; }
      if (plan.v) {
        var ps = addSess(it, "p", plan.v);
        if (st && ps.m <= st.m) ps.m = st.m + 1;     // the start sorts first: its run holds the page
      }
      if (plan.done) {
        var last = null;
        if (it.size > 0 && progressOf(sessOf(data, it.id)) < it.size) last = addSess(it, "p", it.size);
        var ds = addSess(it, "d");
        if (last && ds.m <= last.m) ds.m = last.m + 1;
        it.st = "done";
      }
      touch(it);
      changed = true;
    });
    if (changed) { saveNow(); renderAll(); }
    return changed;
  }
  // Library's "Add to Media Shelf": the linked item, made once.
  function libAdd(b) {
    var it = b && LIB_ID_RE.test(b.lib) ? libItemOf(b.lib) : null;
    if (!it) {
      if (data.items.length >= MAX_ITEMS) { showToast(t("toast.max", { n: MAX_ITEMS })); return; }
      it = libItem(b, newId(), now(), randCol());
      if (!it) return;
      data.items.push(it);
      saveNow();
      libSync();
      it = itemById(it.id);
      renderAll();
      showToast(t("toast.added"));
    }
    if (it) itemDialog(it.id);
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
    // A picture found online (normItem allows only https on the two
    // image hosts) covers the generated one; offline or broken, the
    // generated cover stays.
    if (it.cov) {
      var img = el("img", "cv-img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", function () { img.remove(); });
      img.src = it.cov;
      c.appendChild(img);
    }
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
    if (prefs.tab === "stats") { ul.hidden = true; empty.hidden = true; if ($("goal-box")) $("goal-box").hidden = true; return; }
    ul.hidden = false;
    var q = $("q").value.trim();
    var list = viewList(data, prefs.tab, prefs.type, q, prefs.sort);
    var gsBox = $("goal-box");
    if (gsBox) {
      gsBox.textContent = "";
      var gst = q ? null : goalStrip();
      if (gst) gsBox.appendChild(gst);
      gsBox.hidden = !gst;
    }
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
    if (it.rel) hb.appendChild(el("div", "it-sub it-rel", t("it.rel", { d: fmtDate(it.rel) })));
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
    if (it.lib) {
      acts.appendChild(button(t("lib.read"), "", function () {
        var lib = it.lib;
        dlg.close();
        try { window.parent.__orosOpenAt("library", { book: lib }); } catch (e) {}
      }));
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

    var cred = creditBox(it);
    if (cred) dlg.appendChild(cred);

    var foot = el("div", "dlg-actions");
    foot.appendChild(button(t("act.delete"), "danger", function () { dlg.close(); deleteItem(it); }));
    foot.appendChild(button(t("act.edit"), "", function () { dlg.close(); editDialog(it); }));
    var cl = button(t("act.close"), "dlg-close", function () { dlg.close(); });
    foot.appendChild(cl);
    dlg.appendChild(foot);
    if (dlg.open) hostToast();
  }

  // Where the cover and the details came from (Commons credit and
  // licence, Wikidata CC0, the TMDB notice). Links are built here from
  // checked ids and addresses only, and open in a new tab.
  function extLink(text, href) {
    var a = el("a", "", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function creditBox(it) {
    var src = coverSource(it);
    if (!src && !it.wd && !it.tmdb) return null;
    var box = el("div", "it-credit");
    if (src === "commons") {
      var txt = it.cvby || it.cvlc ? t("cv.commons", { by: it.cvby || "?", lic: it.cvlc || "?" }) : t("cv.commonsNo");
      var p = el("p");
      p.appendChild(it.cvpg ? extLink(txt, it.cvpg) : el("span", "", txt));
      box.appendChild(p);
    }
    if (it.wd) {
      var q = el("p");
      q.appendChild(extLink(t("cv.wd"), "https://www.wikidata.org/wiki/" + it.wd));
      box.appendChild(q);
    }
    if (it.tmdb || src === "tmdb") {
      var r = el("p");
      var tl = t(src === "tmdb" ? "cv.tmdb" : "cv.tmdbD");
      r.appendChild(it.tmdb ? extLink(tl, "https://www.themoviedb.org/" + it.tmdb) : el("span", "", tl));
      box.appendChild(r);
      box.appendChild(el("p", "", t("tmdb.notice")));
    }
    return box;
  }

  // ---------- 9. Edit dialog, goals dialog ----------
  // pre (a new title only): fields already normalised by normAsNew.
  function editDialog(existing, pre) {
    if (!existing && data.items.length >= MAX_ITEMS) { showToast(t("toast.max", { n: MAX_ITEMS })); return; }
    var draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      type: prefs.type !== "all" ? prefs.type : "book", fmt: "p",
      st: prefs.tab === "now" ? "now" : (prefs.tab === "hist" ? "done" : "want"),
      col: randCol()
    };
    if (!existing && pre) Object.keys(pre).forEach(function (k) { if (pre[k]) draft[k] = pre[k]; });
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
    var lkW = el("div", "fld lk-w");
    lkW.id = "sh-f-lk-w";
    var lkB = button(t("lk.btn"), "lk-btn", function () { capture(); lookupFlow(draft, applyPick); });
    lkB.id = "sh-f-lk";
    lkW.appendChild(lkB);
    form.appendChild(lkW);
    // The cover found online, with a way to drop it.
    var cvW = el("div", "fld cv-row");
    form.appendChild(cvW);
    function drawCover() {
      cvW.textContent = "";
      cvW.hidden = !draft.cov;
      if (!draft.cov) return;
      cvW.appendChild(cover({ type: draft.type, title: fTitle.value || "?", col: draft.col || 0, cov: draft.cov }));
      var cb = el("div", "cv-row-b");
      cb.appendChild(el("div", "dlg-lbl", t("cv.label")));
      var src = coverSource(draft);
      cb.appendChild(el("div", "hint", src === "tmdb" ? t("cv.tmdb") :
        (draft.cvby || draft.cvlc ? t("cv.commons", { by: draft.cvby || "?", lic: draft.cvlc || "?" }) : t("cv.commonsNo"))));
      cb.appendChild(button(t("cv.remove"), "small", function () {
        ["cov", "cvby", "cvlc", "cvpg"].forEach(function (k) { delete draft[k]; });
        drawCover();
        showToast(t("cv.removed"));
      }));
      cvW.appendChild(cb);
    }
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
    var fRel = field("sh-f-rel", t("f.rel"), input(0, "date"));
    fRel.min = "1900-01-01"; fRel.max = "2999-12-31";
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
      draft.rel = fRel.value;
      if (fSt) draft.st = fSt.value;
    }
    // A pick from the online lookup fills the form; Save still decides.
    function applyPick(c) {
      fTitle.value = c.title;
      if (c.by) fBy.value = c.by;
      if (c.year) fYear.value = String(c.year);
      if (c.size && !(draft.type === "book" && fFmt.value === "a")) fSize.value = String(c.size);
      if (c.rel) fRel.value = c.rel;
      // films / series: the source ids, and the cover when one came
      if (c.wd) draft.wd = c.wd;
      if (c.tmdb) draft.tmdb = c.tmdb;
      if (c.cov) {
        ["cov", "cvby", "cvlc", "cvpg"].forEach(function (k) { if (c[k]) draft[k] = c[k]; else delete draft[k]; });
      }
      drawCover();
      capture();
      showToast(t("lk.filled"));
      fTitle.focus();
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
      lkW.hidden = !lookupSources(x).length;
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
    fRel.value = draft.rel || "";
    fFmt.addEventListener("change", function () { capture(); layout(); });
    layout();
    drawCover();

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
        src: draft.src, col: draft.col, rel: draft.rel,
        cov: draft.cov, cvby: draft.cvby, cvlc: draft.cvlc, cvpg: draft.cvpg, wd: draft.wd, tmdb: draft.tmdb
      });
      if (!cand) return;
      if (existing) {
        var cur = itemById(existing.id);
        if (cur) {
          var changed = false;
          ["type", "title", "by", "year", "size", "fmt", "plat", "tags", "src", "col", "rel",
           "cov", "cvby", "cvlc", "cvpg", "wd", "tmdb"].forEach(function (k) {
            if (JSON.stringify(cur[k]) === JSON.stringify(cand[k])) return;
            if (cand[k] === undefined) delete cur[k]; else cur[k] = cand[k];
            changed = true;
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

  // Online lookup flow (section 4c): a one-time note on what is sent,
  // then a results dialog over the edit form. Cancel aborts the request.
  // Books: Open Library; music: MusicBrainz; films and series: Wikidata,
  // or TMDB when this device has the user's own TMDB key (a switch in
  // the results dialog picks between the two).
  var SRC_HOST = { ol: "openlibrary.org", mb: "musicbrainz.org", wd: "wikidata.org", tmdb: "themoviedb.org" };
  var TMDB_KEY = "oros-shelf-tmdb";          // device-local, never synced (R10)
  function tmdbKey() {
    var k = "";
    try { k = localStorage.getItem(TMDB_KEY) || ""; } catch (e) {}
    return tmdbKeyOk(k) ? k : "";
  }
  function lookupSources(type) {
    if (type === "book") return ["ol"];
    if (type === "album") return ["mb"];
    if (WD_CLASSES[type]) return tmdbKey() ? ["wd", "tmdb"] : ["wd"];
    return [];
  }
  function srcAgreed(src) {
    if (src === "tmdb") return true;                  // entering the key was the yes
    if (src === "wd") return prefs.lkw === 1;
    return prefs.lk === 1;
  }
  function lookupFlow(draft, pick, want) {
    var srcs = lookupSources(draft.type);
    var src = srcs.indexOf(want) >= 0 ? want : (srcs.indexOf(prefs.lks) >= 0 ? prefs.lks : srcs[0]);
    if (!src) return;
    if (!clipLine(draft.title, TITLE_LEN)) { showToast(t("lk.needTitle")); return; }
    if (srcAgreed(src)) { lookupRun(draft, src, srcs, pick); return; }
    var dlg = makeDialog("sh-lk", "lk-dlg");
    dlg.appendChild(el("div", "dlg-title", t("lk.title")));
    dlg.appendChild(el("p", "csv-p", t("lk.note", { host: SRC_HOST[src] })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("lk.go"), "primary", function () {
      if (src === "wd") prefs.lkw = 1; else prefs.lk = 1;
      savePrefs();
      dlg.close();
      lookupRun(draft, src, srcs, pick);
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function LookupError(code) { this.code = code; }
  function fetchJson(url, headers, signal) {
    if (!url) return Promise.reject(new LookupError("none"));
    var opts = { headers: headers || { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" };
    if (signal) opts.signal = signal;
    return fetch(url, opts).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new LookupError("auth");
      if (!r.ok) throw new LookupError("http");
      return r.json();
    });
  }
  // → Promise of the candidates of one source.
  function searchSrc(src, type, title, by, signal) {
    if (src === "ol" || src === "mb") {
      return fetchJson(lookupUrl(type, title, by), null, signal).then(function (j) { return parseLookup(type, j); });
    }
    if (src === "tmdb") {
      var rq = tmdbSearchReq(type, title, tmdbKey(), LANG);
      if (!rq) return Promise.reject(new LookupError("auth"));
      return fetchJson(rq.url, rq.headers, signal).then(function (j) { return parseTmdbSearch(type, j); });
    }
    return fetchJson(wdSearchUrl(title, LANG), null, signal).then(function (j) {
      var hits = parseWdSearch(j);
      if (!hits.length) return [];
      return fetchJson(wdEntitiesUrl(hits.map(function (h) { return h.id; }), LANG), null, signal).then(function (k) {
        var list = parseWdEntities(type, k, hits, LANG);
        var ids = [];
        list.forEach(function (c) { c.byIds.forEach(function (q) { if (ids.indexOf(q) < 0) ids.push(q); }); });
        if (!ids.length) return list;
        // the director / creator names, in one more call
        return fetchJson(wdEntitiesUrl(ids, LANG, "labels"), null, signal).then(function (l) {
          var names = parseWdLabels(l, LANG);
          list.forEach(function (c) {
            c.by = clipLine(c.byIds.map(function (q) { return names[q] || ""; }).filter(Boolean).join(", "), BY_LEN);
          });
          return list;
        }, function () { return list; });
      });
    });
  }
  // A picked film / series: TMDB's details, or the Commons picture's
  // credit. A failure here keeps what the search gave.
  function detailSrc(src, type, c, signal) {
    if (src === "tmdb") {
      var rq = tmdbDetailsReq(type, c.tmdb, tmdbKey(), LANG);
      if (!rq) return Promise.resolve(c);
      return fetchJson(rq.url, rq.headers, signal).then(function (j) {
        var d = parseTmdbDetails(type, j);
        if (d.by) c.by = d.by;
        if (d.size) c.size = d.size;
        return c;
      }, function () { return c; });
    }
    if (src === "wd" && c.img) {
      return fetchJson(commonsUrl(c.img), null, signal).then(function (j) {
        var cv = parseCommons(j);
        if (cv) Object.keys(cv).forEach(function (k) { c[k] = cv[k]; });
        return c;
      }, function () { return c; });
    }
    return Promise.resolve(c);
  }

  function lookupRun(draft, src, srcs, pick) {
    var type = draft.type, host = SRC_HOST[src];
    var dlg = makeDialog("sh-lk", "lk-dlg");
    dlg.appendChild(el("div", "dlg-title", t("lk.title")));
    if (srcs.length > 1) {
      var sw = el("div", "seg lk-src");
      sw.setAttribute("role", "radiogroup");
      sw.setAttribute("aria-label", t("lk.from"));
      sw.appendChild(el("span", "lk-src-l", t("lk.from")));
      srcs.forEach(function (s) {
        var b = el("button", "chip" + (s === src ? " on" : ""), t("lk." + s));
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", s === src ? "true" : "false");
        b.addEventListener("click", function () {
          if (s === src) return;
          prefs.lks = s;
          savePrefs();
          dlg.close();
          lookupFlow(draft, pick, s);
        });
        sw.appendChild(b);
      });
      dlg.appendChild(sw);
    }
    var body = el("div", "lk-body");
    body.setAttribute("aria-live", "polite");
    body.appendChild(el("p", "hint", t("lk.wait", { host: host })));
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();

    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var closed = false, settled = false;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
    dlg.addEventListener("close", function () { closed = true; clearTimeout(timer); if (ctl) ctl.abort(); });
    function message(msg) {
      body.textContent = "";
      body.appendChild(el("p", "csv-p", msg));
    }
    function choose(c) {
      if (src !== "wd" && src !== "tmdb") { dlg.close(); pick(c); return; }
      body.textContent = "";
      body.appendChild(el("p", "hint", t("lk.more")));
      clearTimeout(timer);
      timer = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
      detailSrc(src, type, c, ctl && ctl.signal).then(function (full) {
        if (closed) return;
        dlg.close();
        pick(full);
      });
    }
    function show(list) {
      body.textContent = "";
      if (!list.length) { message(t("lk.none")); return; }
      var ul = el("ul", "lk-list");
      list.forEach(function (c) {
        var li = el("li");
        var b = el("button", "lk-res" + (c.cov ? " has-img" : ""));
        b.type = "button";
        if (c.cov) {
          var im = el("img", "lk-img");
          im.alt = "";
          im.loading = "lazy";
          im.referrerPolicy = "no-referrer";
          im.addEventListener("error", function () { im.remove(); });
          im.src = c.cov;
          b.appendChild(im);
        }
        var tx = el("span", "lk-tx");
        tx.appendChild(el("span", "lk-t", c.title));
        var meta = [c.by, c.rel ? fmtDate(c.rel) : (c.year ? String(c.year) : ""),
                    c.size ? fmtNum(c.size) + " " + t("size." + type).toLowerCase() : ""].filter(Boolean).join(" · ");
        if (meta) tx.appendChild(el("span", "lk-m", meta));
        if (c.desc && src === "wd") tx.appendChild(el("span", "lk-m", c.desc));
        b.appendChild(tx);
        b.addEventListener("click", function () { choose(c); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      body.appendChild(ul);
      body.appendChild(el("p", "hint", t("lk.src", { host: host })));
      if (src === "wd") body.appendChild(el("p", "hint", t("lk.cc0")));
      if (src === "tmdb") body.appendChild(el("p", "hint", t("tmdb.notice")));
      var first = ul.querySelector("button");
      if (first) first.focus();
    }
    if (navigator.onLine === false) { message(t("lk.offline")); return; }
    searchSrc(src, type, draft.title, draft.by, ctl && ctl.signal).then(function (list) {
      if (closed || settled) return;
      settled = true;
      clearTimeout(timer);
      show(list);
    }, function (e) {
      if (closed || settled) return;
      settled = true;
      clearTimeout(timer);
      message(e && e.code === "auth" && src === "tmdb" ? t("lk.badKey") : t("lk.fail", { host: host }));
    });
  }

  // The user's own TMDB key, on this device only.
  function tmdbDialog() {
    var dlg = makeDialog("sh-tmdb", "lk-dlg");
    dlg.appendChild(el("div", "dlg-title", t("tmdb.title")));
    dlg.appendChild(el("p", "csv-p", t("tmdb.text")));
    var form = el("form");
    form.noValidate = true;
    var w = el("div", "fld");
    var l = el("label", "dlg-lbl", t("tmdb.key"));
    l.setAttribute("for", "sh-tmdb-in");
    var inp = el("input");
    inp.id = "sh-tmdb-in";
    inp.type = "password";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.maxLength = 600;
    inp.value = tmdbKey();
    w.appendChild(l);
    w.appendChild(inp);
    form.appendChild(w);
    var lp = el("p", "hint");
    lp.appendChild(extLink(t("tmdb.get"), "https://www.themoviedb.org/settings/api"));
    form.appendChild(lp);
    form.appendChild(el("p", "hint", t("tmdb.notice")));
    var acts = el("div", "dlg-actions");
    if (tmdbKey()) {
      acts.appendChild(button(t("tmdb.remove"), "danger", function () {
        try { localStorage.removeItem(TMDB_KEY); } catch (e) {}
        if (prefs.lks === "tmdb") { prefs.lks = ""; savePrefs(); }
        dlg.close();
        showToast(t("tmdb.removed"));
      }));
    }
    acts.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    var ok = el("button", "dlg-btn primary", t("f.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var k = inp.value.trim();
      if (!k) {
        try { localStorage.removeItem(TMDB_KEY); } catch (x) {}
        dlg.close();
        showToast(t("tmdb.removed"));
        return;
      }
      if (!tmdbKeyOk(k)) { showToast(t("tmdb.bad")); inp.focus(); return; }
      try { localStorage.setItem(TMDB_KEY, k); } catch (x) {}
      prefs.lks = "tmdb";
      savePrefs();
      dlg.close();
      showToast(t("tmdb.saved"));
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
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
      // What it takes from here (this year and next only).
      if (!st.reached && y >= +td.slice(0, 4)) {
        var pl = goalPlan(g.n, done, y, td, tp === "book" ? avgBookPages(data, y) : 0);
        row.appendChild(el("div", "g-plan", t("plan.left", { n: fmtNum(pl.left), d: fmtNum(pl.daysLeft) })));
        var parts = [t("plan.week", { n: fmtNum(pl.perWeek, pl.perWeek < 10 ? 1 : 0) }),
                     t("plan.month", { n: fmtNum(pl.perMonth, pl.perMonth < 10 ? 1 : 0) })];
        if (pl.pagesPerDay) parts.push(t("plan.pages", { n: fmtNum(pl.pagesPerDay) }));
        row.appendChild(el("div", "g-plan", parts.join(", ")));
        if (y === +td.slice(0, 4) && done) row.appendChild(el("div", "g-plan", t("plan.proj", { n: fmtNum(pl.projected) })));
      }
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
    var R = readingSummary(pagesByDay(data), y, td);
    fact(t("stats.pages"), fmtNum(R.total));
    fact(t("stats.avg"), S.rated ? fmtNum(S.avg, 1) + " ★" : "—");
    fact(t("stats.now"), fmtNum(S.now));
    fact(t("stats.want"), fmtNum(S.want));
    ts.appendChild(facts);
    box.appendChild(ts);
    box.appendChild(readingSection(R, y, td));

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

  // Pages per day (section 4e): the year's figures and, for this year,
  // the streak and a bar for each of the last 30 days.
  function readingSection(R, y, td) {
    var sec = el("section", "st-sec");
    sec.appendChild(el("h3", "", t("rd.title", { y: y })));
    if (!R.total) { sec.appendChild(el("p", "hint", t("rd.none"))); return sec; }
    var facts = el("div", "facts");
    function fact(l, v) {
      var f = el("div", "fact");
      f.appendChild(el("span", "f-v", v));
      f.appendChild(el("span", "f-l", l));
      facts.appendChild(f);
    }
    var cur = y === +td.slice(0, 4);
    fact(t("rd.perDay"), fmtNum(R.perDay, R.perDay < 10 ? 1 : 0));
    fact(t("rd.days"), fmtNum(R.days));
    if (cur) fact(t("rd.streak"), fmtNum(R.streak));
    if (R.best) fact(t("rd.best"), t("rd.bestV", { n: fmtNum(R.best.n), d: fmtDate(R.best.d).slice(0, 5) }));
    sec.appendChild(facts);
    if (cur) {
      sec.appendChild(el("div", "dlg-lbl rd-l", t("rd.last")));
      var chart = el("div", "days30");
      var max = 0;
      R.last.forEach(function (x) { if (x.n > max) max = x.n; });
      R.last.forEach(function (x) {
        var c = el("div", "d30");
        c.title = fmtDate(x.d) + ": " + fmtNum(x.n);
        var f = el("i");
        f.style.height = (max ? Math.max(x.n ? 4 : 0, x.n * 100 / max) : 0) + "%";
        c.appendChild(f);
        chart.appendChild(c);
      });
      chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", t("rd.last") + ": " + fmtNum(R.last.reduce(function (a, x) { return a + x.n; }, 0)) + " " + t("unit.book"));
      sec.appendChild(chart);
    }
    return sec;
  }

  // The year's book goal above the Now list (books or all types).
  function goalStrip() {
    var y = new Date().getFullYear(), g = data.goals[y + "-book"];
    if (prefs.tab !== "now" || (prefs.type !== "all" && prefs.type !== "book") || !g || !g.n) return null;
    var td = today(), done = yearStats(data, y).done.book, st = goalState(g.n, done, y, td);
    var b = el("button", "goal-strip");
    b.type = "button";
    var top = el("div", "goal-top");
    var ic = el("span", "g-ic");
    ic.innerHTML = UI.book;
    top.appendChild(ic);
    top.appendChild(el("span", "g-name", t("goal.strip", { y: y, v: done, n: g.n })));
    b.appendChild(top);
    var bar = el("div", "bar");
    var f = el("i");
    f.style.width = st.pct + "%";
    bar.appendChild(f);
    b.appendChild(bar);
    var msg = st.reached ? t("goal.done") : (st.diff > 0 ? t("goal.ahead", { n: st.diff }) :
      (st.diff < 0 ? t("goal.behind", { n: -st.diff }) : t("goal.on")));
    b.appendChild(el("div", "g-msg" + (st.reached ? " ok" : (st.diff < 0 ? " low" : "")), msg));
    b.addEventListener("click", function () {
      prefs.tab = "stats";
      statsYear = y;
      savePrefs();
      renderAll();
    });
    return b;
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

  // Goodreads / Letterboxd: pick one or more CSV files, preview, confirm.
  function importCsv() {
    var dlg = dialogHost(), accept = ".csv,text/csv";
    var pick = dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(accept) : localPickFiles(accept);
    Promise.resolve(pick).then(function (list) {
      if (!list || !list.length) return;
      list = [].slice.call(list);
      if (list.some(function (f) { return f.size > 8 * 1024 * 1024; })) { showToast(t("toast.big")); return; }
      Promise.all(list.map(function (f) {
        return f.text().then(function (txt) { return { name: f.name || "", text: txt }; });
      })).then(function (files) {
        csvPreview(planImport(files, data, { now: now(), today: today() }));
      });
    });
  }
  function localPickFiles(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var fs = inp.files && inp.files.length ? [].slice.call(inp.files) : null;
        inp.remove();
        resolve(fs);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  function csvPreview(plan) {
    var dlg = makeDialog("sh-csv", "");
    dlg.appendChild(el("div", "dlg-title", t("csv.title")));
    plan.unknown.forEach(function (f) { dlg.appendChild(el("p", "hint warn", t("csv.unknown", { f: f || "?" }))); });
    var room = Math.max(0, MAX_ITEMS - data.items.length);
    var n = Math.min(plan.items.length, room);
    if (plan.found) dlg.appendChild(el("p", "csv-p", t("csv.found", { n: fmtNum(plan.found) })));
    var ul = el("ul", "csv-list");
    TYPES.forEach(function (tp) {
      var c = plan.counts[tp];
      if (!c) return;
      var parts = STATES.filter(function (s) { return c[s]; }).map(function (s) {
        return stLabel({ type: tp }, s) + " " + fmtNum(c[s]);
      }).join(" · ");
      ul.appendChild(el("li", "", t("csv.line", { type: t("types." + tp),
        n: fmtNum(c.want + c.now + c.done + c.drop), parts: parts })));
    });
    if (ul.children.length) dlg.appendChild(ul);
    if (plan.dup) dlg.appendChild(el("p", "hint", t("csv.dup", { n: fmtNum(plan.dup) })));
    if (n < plan.items.length) dlg.appendChild(el("p", "hint warn", t("toast.csvMax", { n: fmtNum(room) })));
    if (!plan.items.length) dlg.appendChild(el("p", "csv-p", t("csv.none")));
    dlg.appendChild(el("p", "hint", t("csv.hint")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    if (n) {
      acts.appendChild(button(t("csv.go", { n: fmtNum(n) }), "primary", function () {
        dlg.close();
        applyPlan(plan, n);
      }));
    }
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function applyPlan(plan, n) {
    var items = plan.items.slice(0, n), keep = {};
    items.forEach(function (it) { keep[it.id] = 1; });
    var sess = plan.sess.filter(function (s) { return keep[s.it]; });
    // Fresh stamps: the plan was made a moment ago (R27, R17).
    var ts = now();
    items.forEach(function (it) { it.m = Math.max(it.m, ts); data.items.push(it); });
    sess.forEach(function (s) { s.m = Math.max(s.m, ts); data.sess.push(s); });
    saveNow();
    prefs.tab = "hist";
    prefs.type = "all";
    savePrefs();
    renderAll();
    undoToast(t("toast.csv", { n: fmtNum(items.length) }), function () {
      tombIds(items.map(function (it) { return it.id; }).concat(sess.map(function (s) { return s.id; })));
      saveNow();
      renderAll();
    });
  }

  function moreMenu() {
    var dlg = makeDialog("sh-more", "menu-dlg");
    dlg.appendChild(el("div", "dlg-title", t("btn.more")));
    var col = el("div", "menu-col");
    col.appendChild(button(t("menu.export"), "", function () { dlg.close(); exportJson(); }));
    col.appendChild(button(t("menu.import"), "", function () { dlg.close(); importJson(); }));
    col.appendChild(button(t("menu.csv"), "", function () { dlg.close(); importCsv(); }));
    col.appendChild(button(t("menu.rem"), "", function () { dlg.close(); remDialog(); }));
    col.appendChild(button(t("menu.tmdb"), "", function () { dlg.close(); tmdbDialog(); }));
    col.appendChild(button(t("f.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(col);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // Reading reminder settings (device-local, never synced). The rule
  // and the key live in feed.js; the shell sends the notification, so
  // it also arrives with the app closed (while orOS is open).
  var REM_KEY = "oros-shelf-rem";
  function readRemPref() {
    var x = null;
    try { x = JSON.parse(localStorage.getItem(REM_KEY) || "null"); } catch (e) {}
    x = x && typeof x === "object" ? x : {};
    return { on: x.on === 1 ? 1 : 0, h: isInt(x.h) && x.h >= 0 && x.h <= 23 ? x.h : 20 };
  }
  function remDialog() {
    var rem = readRemPref();
    var dlg = makeDialog("sh-rem", "");
    dlg.appendChild(el("div", "dlg-title", t("rem.title")));
    var cb = button(t("rem.on"), "toggle rem-tg");
    cb.id = "sh-rem-on";
    cb.setAttribute("role", "switch");
    function paint() {
      cb.classList.toggle("on", !!rem.on);
      cb.setAttribute("aria-checked", rem.on ? "true" : "false");
    }
    paint();
    dlg.appendChild(cb);
    var w = el("div", "fld");
    var l = el("label", "dlg-lbl", t("rem.at"));
    l.setAttribute("for", "sh-rem-h");
    var sel = el("select");
    sel.id = "sh-rem-h";
    for (var h = 0; h < 24; h++) {
      var o = el("option", "", pad2(h) + ":00");
      o.value = String(h);
      sel.appendChild(o);
    }
    sel.value = String(rem.h);
    w.appendChild(l);
    w.appendChild(sel);
    dlg.appendChild(w);
    dlg.appendChild(el("p", "hint", t("rem.hint")));
    function save() {
      rem.h = parseInt(sel.value, 10) || 0;
      try { localStorage.setItem(REM_KEY, JSON.stringify({ on: rem.on, h: rem.h })); } catch (e) { showToast(t("toast.save")); return false; }
      sel.disabled = !rem.on;
      return true;
    }
    cb.addEventListener("click", function () {
      rem.on = rem.on ? 0 : 1;
      if (!save()) { rem.on = rem.on ? 0 : 1; return; }
      paint();
      showToast(t(rem.on ? "rem.toastOn" : "rem.toastOff"));
    });
    sel.addEventListener("change", save);
    sel.disabled = !rem.on;
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("rem.done"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    cb.focus();
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
      else libSync();
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
    libSync();
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
  // Library (BR-LIB-SHELF): target { addBook: { lib, title, by, year, size } }
  // opens the item linked to that book, adding it first if needed.
  // asNew: { kind, title, by, year, status, platform, release, tags, src,
  // from } (the Assistant's entry card) opens the "New title" form
  // prefilled; nothing is saved until Save (BR-W8-6).
  function openSearchTarget(t) {
    if (!t || document.querySelector("dialog[open]")) return;
    if (t.asNew) { var pre = normAsNew(t.asNew); if (pre) editDialog(null, pre); return; }
    if (t.addBook && typeof t.addBook === "object") { libAdd(t.addBook); return; }
    if (typeof t.item !== "string") return;
    if (itemById(t.item)) itemDialog(t.item);
  }
  // Words the Assistant may use for a type or a state → Shelf's own.
  var AS_TYPE = { book: "book", ebook: "book", audiobook: "book", novel: "book",
                  film: "film", movie: "film",
                  series: "series", tv: "series", show: "series", "tv-series": "series", "tv series": "series",
                  album: "album", music: "album", record: "album",
                  podcast: "podcast",
                  game: "game", videogame: "game", "video game": "game" };
  var AS_ST = { want: "want", watchlist: "want", wishlist: "want", "to-read": "want", "to read": "want",
                planned: "want", later: "want",
                now: "now", reading: "now", watching: "now", listening: "now", playing: "now",
                "in-progress": "now", "in progress": "now",
                done: "done", read: "done", watched: "done", listened: "done", played: "done",
                finished: "done", completed: "done",
                drop: "drop", dropped: "drop", abandoned: "drop" };
  // The asNew fields with the form's own limits; null without a title.
  // Unknown fields (and the ones the form has no place for) are ignored.
  function normAsNew(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var title = clipLine(x.title, TITLE_LEN);
    if (!title) return null;
    var word = function (v) { return typeof v === "string" ? v.trim().toLowerCase() : ""; };
    var type = AS_TYPE[word(x.kind)] || "";
    var o = { title: title, type: type, st: AS_ST[word(x.status)] || "",
              by: clipLine(x.by, BY_LEN),
              year: intIn(x.year, 1, 9999, 0),
              plat: type === "game" ? clipLine(x.platform, PLAT_LEN) : "",
              rel: isYmd(x.release) ? x.release : "",
              tags: Array.isArray(x.tags) ? normTags(x.tags) : (typeof x.tags === "string" ? parseTags(x.tags) : []),
              src: clipLine(x.src, SRC_LEN) };
    if (!o.tags.length) delete o.tags;
    return o;
  }
  window.__orosOpenAt = openSearchTarget;

  boot();
})();
