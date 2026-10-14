// ============================================================
// orOS One-Sentence Diary — App logic (v1.0.0)
// One sentence a day, ten seconds. Under the day's line, the same
// date in the years before ("on this day").
//   - Today: the line (up to 280 characters, saved as you type),
//     an optional emoji, on this day, streak; any past day can be
//     written or fixed (arrows, calendar); before 03:00 the line is
//     offered for yesterday
//   - My days: a month calendar with the days written, the month's
//     lines, search in every line
//   - Year: every line of a year on one page, printable
//   - Settings: evening reminder (device-local, off by default; the
//     shell fires it with the app closed), export TXT/CSV/JSON,
//     import (fills empty days only)
// Data:
//   - synced slice "diary" (oros-diary-data): LWW per day +
//     tombstones (R5, R17, R26); clearing a line deletes the day
//   - device-local (R10): oros-diary-prefs (reminder), the open tab
// Deep link: __orosOpenAt("diary", { day: "YYYY-MM-DD" }) opens a day
// (reminder, universal search).
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Writing a day
//   4. On this day, stats, header
//   5. My days: calendar, search
//   6. Year
//   7. Settings: reminder, export, import
//   8. Tabs, toasts
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette + deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.DiaryCore;
  var STORAGE_KEY = "oros-diary-data";
  var PREFS_KEY   = C.PREFS_KEY;
  var SAVE_MS     = 500;
  var VIEWS       = ["today", "days", "year"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "app.name": "One-Sentence Diary",
      "sub.write": "Today's line is waiting", "sub.done": "Today is written",
      "sub.streak": "{n}-day streak",
      "tab.today": "Today", "tab.days": "My days", "tab.year": "Year",
      "btn.rand": "A random memory", "btn.more": "Diary settings", "btn.close": "Close",
      "btn.prev": "Day before", "btn.next": "Day after", "btn.today": "Back to today",
      "btn.mprev": "Month before", "btn.mnext": "Month after",
      "btn.delete": "Delete this day", "btn.print": "Print",
      "btn.txt": "Text", "btn.csv": "CSV", "btn.json": "JSON", "btn.import": "Choose a file",
      "rel.today": "Today", "rel.yesterday": "Yesterday", "rel.ago": "{n} days ago",
      "late.q": "After midnight. This line is for:", "late.yesterday": "Yesterday", "late.today": "Today",
      "f.line": "One sentence about this day", "f.emoji": "Emoji of the day", "f.search": "Search your days",
      "f.year": "Year",
      "ph.today": "One sentence about today…", "ph.day": "One sentence about this day…",
      "ph.search": "Search your days",
      "st.saved": "Saved", "st.saving": "Saving…", "st.empty": "",
      "count.left": "{n} left",
      "emoji.none": "No emoji", "emoji.pick": "Emoji {e}",
      "sec.otd": "On this day",
      "otd.ago1": "A year ago", "otd.agoN": "{n} years ago",
      "otd.empty": "In a year, what you write today will appear here.",
      "otd.emptyDay": "Nothing on this date in the years before.",
      "stats": "Streak {cur} · Longest {long} · {total} days written",
      "stats.none": "Your first line starts the diary.",
      "month.empty": "No lines this month.",
      "res.count": "{n} days found", "res.count1": "1 day found", "res.none": "Nothing found.",
      "year.empty": "No lines in this year yet.", "year.count": "{n} days",
      "more.title": "Diary settings", "sec.rem": "Evening reminder",
      "rem.on": "Remind me when I have not written today", "rem.time": "At",
      "rem.hint": "Reminders appear while orOS is open (also with this app closed). With orOS closed they wait for the next time you open it. This setting stays on this device.",
      "sec.export": "Export", "sec.import": "Import",
      "imp.hint": "A CSV, JSON or text file with a date and a line per day (like the exports). Days that already have a line keep it.",
      "toast.deleted": "Day deleted", "toast.undo": "Undo",
      "toast.saveFail": "Could not save: storage is full", "toast.file": "Saved",
      "toast.imported": "Added {a} days, {k} already had a line", "toast.impNone": "No days found in this file",
      "toast.impFail": "Could not read this file",
      "toast.noRand": "Write a few days first",
      "aria.day": "{date}: {text}", "aria.dayEmpty": "{date}: no line", "aria.today": "today",
      // Wave 30: the long entry
      "aria.long": "with a longer entry",
      "long.open": "✎ Write more about this day", "sec.long": "More about this day",
      "long.write": "Write", "long.preview": "Preview", "f.long": "The longer entry (Markdown)",
      "long.ph": "Anything more about this day: what happened, how it felt…",
      "long.empty": "Nothing written yet.", "long.del": "Clear the longer entry",
      "long.mdhint": "Simple formatting: **bold**, *italic*, # heading, - list, 1. list, > quote, [text](https://…). Nothing else is run or shown as code.",
      "toast.longDel": "Longer entry cleared",
      "pr.lbl": "Question of the day", "pr.use": "Answer it", "pr.next": "Another question",
      "tpl.lbl": "Templates",
      "ph.lbl": "Photos", "ph.open": "Photo {n}", "ph.add": "Add a photo",
      "ph.missing": "Not on this device", "ph.missingLong": "This photo is not on this device. Photos are files in Files › Diary › Photos; Vault Drive can bring them from your other devices.",
      "ph.noDisk": "Photos need the orOS disk (open the diary inside orOS)",
      "ph.bad": "Could not read this image", "ph.max": "Up to four photos a day",
      "ph.remove": "Remove this photo", "toast.phDel": "Photo removed",
      "loc.lbl": "Place and weather", "loc.add": "📍 Add a place", "loc.edit": "Change the place",
      "loc.name": "Place name", "loc.ph": "A place name, e.g. Thessaloniki",
      "loc.geo": "Use my position", "loc.save": "Save place", "loc.cancel": "Cancel", "loc.remove": "Remove place",
      "loc.hint": "Type a name, or use your position once: it is kept rounded to about 1 km.",
      "loc.coords": "Position {c} (rounded to about 1 km). Add a name if you like, then Save.",
      "loc.geoNo": "This browser cannot tell the position", "loc.geoBusy": "Asking for your position…",
      "loc.geoFail": "The position was not given",
      "wx.add": "⛅ Add the day's weather", "wx.again": "Fetch the weather again", "wx.remove": "Remove weather",
      "wx.offline": "The weather needs the internet", "wx.needPlace": "Add a place first, then the weather",
      "wx.busy": "Fetching the weather…", "wx.notFound": "This place was not found", "wx.fail": "Could not fetch the weather",
      "sec.book": "PDF book",
      "book.hint": "One PDF with every day of a year: the date, the line, the longer entry and its photos. Made on this device.",
      "btn.book": "Make the PDF book", "book.all": "All years",
      "book.none": "Nothing written in this year", "book.busy": "Making the PDF book…", "book.fail": "Could not make the PDF book",
      "sec.prompts": "Your questions",
      "prm.hint": "Your own questions join the question of the day (they sync with your days).",
      "prm.new": "A new question", "prm.add": "Add", "prm.del": "Remove",
      "sec.lock": "PIN lock",
      "lock.hint": "A PIN screen when the diary opens, and again after a minute away. It is a privacy screen on this device, not encryption: your days stay readable in this browser's storage and sync to your other devices as usual.",
      "lock.status.on": "The PIN lock is on for this device.", "lock.status.off": "No PIN on this device.",
      "lock.set": "Set a PIN", "lock.lockNow": "Lock now", "lock.change": "Change the PIN", "lock.remove": "Remove the PIN",
      "lock.cur": "Current PIN", "lock.new": "New PIN (4–8 digits)", "lock.again": "The new PIN again", "lock.save": "Save the PIN",
      "lock.bad": "The PIN is 4 to 8 digits", "lock.mismatch": "The two PINs differ",
      "lock.on": "PIN lock on", "lock.off": "PIN lock removed",
      "lock.title": "The diary is locked", "lock.pin": "PIN", "lock.go": "Unlock",
      "lock.wrong": "Wrong PIN", "lock.wait": "Too many tries. Wait {n} s", "lock.unsupported": "This browser cannot check a PIN here",
      "lock.note": "Forgot the PIN? It lives only on this device: clearing orOS's site data removes it (and every other local setting); with sync on, your days come back from the cloud."
    },
    el: {
      "app.name": "Ημερολόγιο μιας πρότασης",
      "sub.write": "Η σημερινή φράση σε περιμένει", "sub.done": "Η σημερινή μέρα γράφτηκε",
      "sub.streak": "Σερί {n} ημερών",
      "tab.today": "Σήμερα", "tab.days": "Οι μέρες μου", "tab.year": "Χρονιά",
      "btn.rand": "Μια τυχαία ανάμνηση", "btn.more": "Ρυθμίσεις ημερολογίου", "btn.close": "Κλείσιμο",
      "btn.prev": "Προηγούμενη μέρα", "btn.next": "Επόμενη μέρα", "btn.today": "Πίσω στο σήμερα",
      "btn.mprev": "Προηγούμενος μήνας", "btn.mnext": "Επόμενος μήνας",
      "btn.delete": "Διαγραφή μέρας", "btn.print": "Εκτύπωση",
      "btn.txt": "Κείμενο", "btn.csv": "CSV", "btn.json": "JSON", "btn.import": "Επιλογή αρχείου",
      "rel.today": "Σήμερα", "rel.yesterday": "Χθες", "rel.ago": "Πριν από {n} μέρες",
      "late.q": "Πέρασαν τα μεσάνυχτα. Η φράση είναι για:", "late.yesterday": "Χθες", "late.today": "Σήμερα",
      "f.line": "Μία φράση για αυτή τη μέρα", "f.emoji": "Emoji της μέρας", "f.search": "Αναζήτηση στις μέρες σου",
      "f.year": "Έτος",
      "ph.today": "Μία φράση για σήμερα…", "ph.day": "Μία φράση για αυτή τη μέρα…",
      "ph.search": "Αναζήτηση στις μέρες σου",
      "st.saved": "Αποθηκεύτηκε", "st.saving": "Αποθήκευση…", "st.empty": "",
      "count.left": "Απομένουν {n}",
      "emoji.none": "Χωρίς emoji", "emoji.pick": "Emoji {e}",
      "sec.otd": "Σαν σήμερα",
      "otd.ago1": "Πριν από ένα χρόνο", "otd.agoN": "Πριν από {n} χρόνια",
      "otd.empty": "Σε έναν χρόνο, ό,τι γράψεις σήμερα θα εμφανιστεί εδώ.",
      "otd.emptyDay": "Τίποτα σε αυτή την ημερομηνία τα προηγούμενα χρόνια.",
      "stats": "Σερί {cur} · Μεγαλύτερο {long} · {total} μέρες γραμμένες",
      "stats.none": "Η πρώτη σου φράση ξεκινά το ημερολόγιο.",
      "month.empty": "Καμία φράση αυτόν τον μήνα.",
      "res.count": "Βρέθηκαν {n} μέρες", "res.count1": "Βρέθηκε 1 μέρα", "res.none": "Δεν βρέθηκε τίποτα.",
      "year.empty": "Καμία φράση σε αυτή τη χρονιά ακόμα.", "year.count": "{n} μέρες",
      "more.title": "Ρυθμίσεις ημερολογίου", "sec.rem": "Βραδινή υπενθύμιση",
      "rem.on": "Υπενθύμισέ μου όταν δεν έχω γράψει σήμερα", "rem.time": "Στις",
      "rem.hint": "Οι υπενθυμίσεις εμφανίζονται όσο το orOS είναι ανοιχτό (και με κλειστή αυτή την εφαρμογή). Με κλειστό το orOS περιμένουν το επόμενο άνοιγμα. Η ρύθμιση μένει σε αυτή τη συσκευή.",
      "sec.export": "Εξαγωγή", "sec.import": "Εισαγωγή",
      "imp.hint": "Αρχείο CSV, JSON ή κειμένου με ημερομηνία και φράση ανά μέρα (όπως οι εξαγωγές). Οι μέρες που έχουν ήδη φράση την κρατούν.",
      "toast.deleted": "Η μέρα διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.file": "Αποθηκεύτηκε",
      "toast.imported": "Προστέθηκαν {a} μέρες, {k} είχαν ήδη φράση", "toast.impNone": "Δεν βρέθηκαν μέρες σε αυτό το αρχείο",
      "toast.impFail": "Δεν διαβάστηκε αυτό το αρχείο",
      "toast.noRand": "Γράψε πρώτα μερικές μέρες",
      "aria.day": "{date}: {text}", "aria.dayEmpty": "{date}: χωρίς φράση", "aria.today": "σήμερα",
      // Wave 30: η μεγάλη καταχώριση
      "aria.long": "με μεγαλύτερο κείμενο",
      "long.open": "✎ Γράψε κι άλλο για αυτή τη μέρα", "sec.long": "Περισσότερα για αυτή τη μέρα",
      "long.write": "Γραφή", "long.preview": "Προεπισκόπηση", "f.long": "Το μεγαλύτερο κείμενο (Markdown)",
      "long.ph": "Ό,τι άλλο για αυτή τη μέρα: τι έγινε, πώς ένιωσες…",
      "long.empty": "Δεν γράφτηκε τίποτα ακόμα.", "long.del": "Καθαρισμός του μεγαλύτερου κειμένου",
      "long.mdhint": "Απλή μορφοποίηση: **έντονα**, *πλάγια*, # τίτλος, - λίστα, 1. λίστα, > παράθεση, [κείμενο](https://…). Τίποτα άλλο δεν εκτελείται ούτε εμφανίζεται ως κώδικας.",
      "toast.longDel": "Το μεγαλύτερο κείμενο καθαρίστηκε",
      "pr.lbl": "Η ερώτηση της μέρας", "pr.use": "Απάντησέ την", "pr.next": "Άλλη ερώτηση",
      "tpl.lbl": "Πρότυπα",
      "ph.lbl": "Φωτογραφίες", "ph.open": "Φωτογραφία {n}", "ph.add": "Προσθήκη φωτογραφίας",
      "ph.missing": "Όχι σε αυτή τη συσκευή", "ph.missingLong": "Αυτή η φωτογραφία δεν είναι σε αυτή τη συσκευή. Οι φωτογραφίες είναι αρχεία στα Αρχεία › Diary › Photos· το Vault Drive μπορεί να τις φέρει από τις άλλες συσκευές σου.",
      "ph.noDisk": "Οι φωτογραφίες θέλουν τον δίσκο του orOS (άνοιξε το ημερολόγιο μέσα στο orOS)",
      "ph.bad": "Δεν διαβάστηκε αυτή η εικόνα", "ph.max": "Έως τέσσερις φωτογραφίες τη μέρα",
      "ph.remove": "Αφαίρεση αυτής της φωτογραφίας", "toast.phDel": "Η φωτογραφία αφαιρέθηκε",
      "loc.lbl": "Τόπος και καιρός", "loc.add": "📍 Προσθήκη τόπου", "loc.edit": "Αλλαγή τόπου",
      "loc.name": "Όνομα τόπου", "loc.ph": "Ένα όνομα τόπου, π.χ. Θεσσαλονίκη",
      "loc.geo": "Η θέση μου", "loc.save": "Αποθήκευση τόπου", "loc.cancel": "Άκυρο", "loc.remove": "Αφαίρεση τόπου",
      "loc.hint": "Γράψε ένα όνομα ή χρησιμοποίησε μία φορά τη θέση σου: κρατιέται στρογγυλεμένη περίπου στο 1 χλμ.",
      "loc.coords": "Θέση {c} (στρογγυλεμένη περίπου στο 1 χλμ.). Πρόσθεσε όνομα αν θέλεις και πάτα Αποθήκευση.",
      "loc.geoNo": "Αυτό το πρόγραμμα περιήγησης δεν δίνει θέση", "loc.geoBusy": "Ζητείται η θέση σου…",
      "loc.geoFail": "Η θέση δεν δόθηκε",
      "wx.add": "⛅ Προσθήκη καιρού της μέρας", "wx.again": "Νέα λήψη του καιρού", "wx.remove": "Αφαίρεση καιρού",
      "wx.offline": "Ο καιρός θέλει σύνδεση στο διαδίκτυο", "wx.needPlace": "Πρόσθεσε πρώτα τόπο, μετά τον καιρό",
      "wx.busy": "Λήψη του καιρού…", "wx.notFound": "Ο τόπος δεν βρέθηκε", "wx.fail": "Δεν ήρθε ο καιρός",
      "sec.book": "Βιβλίο PDF",
      "book.hint": "Ένα PDF με κάθε μέρα μιας χρονιάς: ημερομηνία, φράση, μεγαλύτερο κείμενο και φωτογραφίες. Φτιάχνεται σε αυτή τη συσκευή.",
      "btn.book": "Φτιάξε το βιβλίο PDF", "book.all": "Όλα τα χρόνια",
      "book.none": "Δεν γράφτηκε τίποτα αυτή τη χρονιά", "book.busy": "Φτιάχνεται το βιβλίο PDF…", "book.fail": "Δεν φτιάχτηκε το βιβλίο PDF",
      "sec.prompts": "Οι ερωτήσεις σου",
      "prm.hint": "Οι δικές σου ερωτήσεις μπαίνουν στην ερώτηση της μέρας (συγχρονίζονται μαζί με τις μέρες σου).",
      "prm.new": "Μια νέα ερώτηση", "prm.add": "Προσθήκη", "prm.del": "Αφαίρεση",
      "sec.lock": "Κλείδωμα με PIN",
      "lock.hint": "Μια οθόνη PIN όταν ανοίγει το ημερολόγιο και ξανά μετά από ένα λεπτό μακριά. Είναι οθόνη ιδιωτικότητας σε αυτή τη συσκευή, όχι κρυπτογράφηση: οι μέρες σου μένουν αναγνώσιμες στον χώρο αποθήκευσης του προγράμματος περιήγησης και συγχρονίζονται κανονικά στις άλλες συσκευές σου.",
      "lock.status.on": "Το κλείδωμα PIN είναι ενεργό σε αυτή τη συσκευή.", "lock.status.off": "Δεν υπάρχει PIN σε αυτή τη συσκευή.",
      "lock.set": "Ορισμός PIN", "lock.lockNow": "Κλείδωμα τώρα", "lock.change": "Αλλαγή PIN", "lock.remove": "Αφαίρεση PIN",
      "lock.cur": "Τρέχον PIN", "lock.new": "Νέο PIN (4–8 ψηφία)", "lock.again": "Το νέο PIN ξανά", "lock.save": "Αποθήκευση PIN",
      "lock.bad": "Το PIN έχει 4 έως 8 ψηφία", "lock.mismatch": "Τα δύο PIN διαφέρουν",
      "lock.on": "Το κλείδωμα PIN ενεργοποιήθηκε", "lock.off": "Το PIN αφαιρέθηκε",
      "lock.title": "Το ημερολόγιο είναι κλειδωμένο", "lock.pin": "PIN", "lock.go": "Ξεκλείδωμα",
      "lock.wrong": "Λάθος PIN", "lock.wait": "Πολλές προσπάθειες. Περίμενε {n} δευτ.", "lock.unsupported": "Αυτό το πρόγραμμα περιήγησης δεν μπορεί να ελέγξει PIN εδώ",
      "lock.note": "Ξέχασες το PIN; Υπάρχει μόνο σε αυτή τη συσκευή: η διαγραφή των δεδομένων ιστότοπου του orOS το αφαιρεί (μαζί με κάθε άλλη τοπική ρύθμιση)· με ενεργό συγχρονισμό, οι μέρες σου επιστρέφουν από το cloud."
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
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }
  function num(n) { try { return n.toLocaleString(LOCALE); } catch (e) { return String(n); } }
  function fmt(ymd, opts) {
    var d = C.parseYmd(ymd);
    if (!d) return ymd;
    try { return d.toLocaleDateString(LOCALE, opts); } catch (e) { return ymd; }
  }
  // The month on its own, in the nominative (el: "Οκτώβριος", not
  // the "Οκτωβρίου" of a full date): the month part of "month year".
  function monthName(ymd) {
    var d = C.parseYmd(ymd);
    try {
      var parts = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" }).formatToParts(d);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "month") return parts[i].value;
    } catch (e) {}
    return fmt(ymd, { month: "long" });
  }
  function longDate(ymd) { return fmt(ymd, { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  function shortDate(ymd) { return fmt(ymd, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
  function todayYmd() { return C.ymdOf(new Date()); }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("diary.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, days: {}, tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.days && typeof parsed.days === "object") {
          data = C.mergeDiary(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] diary: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, days: {}, tombs: {} };
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    prefs = C.readPrefs(raw);
    prefs.view = raw && VIEWS.indexOf(raw.view) >= 0 ? raw.view : "today";
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. Writing a day ----------
  var day = null;            // the day being written (ymd)
  var lateChoice = null;     // before 03:00: the day picked for the line
  var pendEmoji = null;      // emoji picked for a day with no line yet
  var editTimer = null;

  function lineOf(ymd) { return data.days[ymd] || null; }

  function commit() {
    clearTimeout(editTimer); editTimer = null;
    var text = C.cleanText($("line").value);
    var cur = lineOf(day);
    var emoji = cur ? cur.e : (pendEmoji || "");
    if (cur && cur.t === text) return;
    if (!cur && !text) return;
    data = C.setDay(data, day, text, emoji, Date.now());
    if (text) pendEmoji = null;
    save();
    $("status").textContent = text ? t("st.saved") : "";
    renderAfterEdit();
  }
  function commitSoon() {
    clearTimeout(editTimer);
    $("status").textContent = t("st.saving");
    editTimer = setTimeout(commit, SAVE_MS);
  }
  function flush() { if (editTimer) commit(); flushLong(); }

  function onLineInput() {
    var ta = $("line"), chars = Array.from(ta.value);
    var clean = ta.value.replace(/[\r\n]+/g, " ");
    if (chars.length > C.MAX_LEN || clean !== ta.value) {
      var pos = ta.selectionStart;
      ta.value = Array.from(clean).slice(0, C.MAX_LEN).join("");
      try { ta.setSelectionRange(pos, pos); } catch (e) {}
    }
    renderCount();
    commitSoon();
  }

  function renderCount() {
    var n = Array.from($("line").value).length, left = C.MAX_LEN - n, c = $("count");
    c.hidden = left > 40;
    c.textContent = t("count.left", { n: left });
    c.classList.toggle("low", left <= 10);
  }

  function setEmoji(e) {
    var cur = lineOf(day);
    var next = (cur ? cur.e : pendEmoji) === e ? "" : e;     // tap again = none
    if (cur) {
      flush();
      cur = lineOf(day);
      if (cur) { data = C.setDay(data, day, cur.t, next, Date.now()); save(); }
    } else pendEmoji = next || null;
    renderEmojis();
    renderAfterEdit();
  }

  function renderEmojis() {
    var host = $("emojis"), cur = lineOf(day), curE = cur ? cur.e : (pendEmoji || "");
    host.innerHTML = "";
    C.EMOJIS.forEach(function (e) {
      var on = e === curE;
      var b = el("button", "emoji" + (on ? " on" : ""), e);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on || (!curE && e === C.EMOJIS[0]) ? 0 : -1;
      setLabel(b, t("emoji.pick", { e: e }));
      b.addEventListener("click", function () { setEmoji(e); });
      host.appendChild(b);
    });
    host.onkeydown = function (ev) {
      var d = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : (ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0);
      if (!d) return;
      ev.preventDefault();
      var btns = host.querySelectorAll("button"), i = [].indexOf.call(btns, document.activeElement);
      var j = (Math.max(0, i) + d + btns.length) % btns.length;
      btns[j].focus();
    };
  }

  function relText(ymd) {
    var today = todayYmd();
    if (ymd === today) return t("rel.today");
    if (ymd === C.addDays(today, -1)) return t("rel.yesterday");
    var a = C.parseYmd(ymd), b = C.parseYmd(today);
    var n = Math.round((b - a) / 86400000);
    return t("rel.ago", { n: num(n) });
  }

  // Opens a day for writing (never a day after today).
  function openDay(ymd, focus) {
    var today = todayYmd();
    if (!C.isYmd(ymd) || ymd > today) ymd = today;
    flush();
    if (ymd !== day) { $("loc-edit").hidden = true; locDraft = null; }
    day = ymd; pendEmoji = null;
    renderDay();
    showView("today");
    if (focus) { var ta = $("line"); ta.focus(); var L = ta.value.length; try { ta.setSelectionRange(L, L); } catch (e) {} }
  }

  function renderLate() {
    var box = $("late"), w = C.writingDay(data, new Date());
    var show = w.late && (day === w.today || day === w.yesterday) && (lateChoice !== null || day === w.day);
    box.hidden = !show;
    if (!show) return;
    var host = $("late-chips");
    host.innerHTML = "";
    [["yesterday", w.yesterday], ["today", w.today]].forEach(function (p) {
      var on = day === p[1];
      var b = el("button", "chip" + (on ? " on" : ""), t("late." + p[0]) + " · " + fmt(p[1], { day: "numeric", month: "short" }));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.addEventListener("click", function () { lateChoice = p[1]; openDay(p[1], true); });
      host.appendChild(b);
    });
  }

  function renderDay() {
    var today = todayYmd(), cur = lineOf(day), ta = $("line");
    $("day-title").textContent = longDate(day);
    $("day-rel").textContent = relText(day);
    $("today-btn").hidden = day === today || (C.writingDay(data, new Date()).late && day === C.addDays(today, -1));
    $("next-btn").disabled = day >= today;
    if (document.activeElement !== ta || !editTimer) ta.value = cur ? cur.t : "";
    ta.placeholder = day === today ? t("ph.today") : t("ph.day");
    $("status").textContent = "";
    $("del-btn").hidden = !cur;
    renderCount();
    renderEmojis();
    renderLate();
    renderLong();
    renderOtd();
    renderStats();
    renderHead();
  }

  function renderAfterEdit() {
    $("del-btn").hidden = !lineOf(day);
    renderStats(); renderHead();
    calDirty = yearDirty = true;
  }

  function deleteDay() {
    var cur = lineOf(day);
    if (!cur) return;
    clearTimeout(editTimer); editTimer = null;
    var snap = { ymd: day, t: cur.t, e: cur.e };
    data = C.setDay(data, day, "", "", Date.now());
    save();
    renderDay();
    calDirty = yearDirty = true;
    undoToast(t("toast.deleted"), function () {
      data = C.setDay(data, snap.ymd, snap.t, snap.e, Date.now());    // R17: newer than the tombstone
      save();
      openDay(snap.ymd);
    });
  }

  // ---------- 4. On this day, stats, header ----------
  function lineItem(ymd, text, emoji, label, onOpen) {
    var li = el("li", "line-item");
    var b = el("button", "line-open");
    b.type = "button";
    var head = el("span", "line-date", label);
    b.appendChild(head);
    var body = el("span", "line-text");
    if (emoji) body.appendChild(el("span", "line-emoji", emoji));
    body.appendChild(document.createTextNode(text));
    if (ymd && C.hasLong(data, ymd)) {
      var mk = el("span", "line-long", "✎");
      mk.title = t("aria.long");
      mk.setAttribute("aria-label", t("aria.long"));
      body.appendChild(mk);
    }
    b.appendChild(body);
    b.addEventListener("click", onOpen || function () { openDay(ymd); });
    li.appendChild(b);
    return li;
  }

  function renderOtd() {
    var list = C.onThisDay(data, day), host = $("otd-list");
    host.innerHTML = "";
    $("otd-title").textContent = day === todayYmd() ? t("sec.otd") : t("sec.otd") + " · " + fmt(day, { day: "numeric", month: "long" });
    list.forEach(function (o) {
      var ago = o.ago === 1 ? t("otd.ago1") : t("otd.agoN", { n: o.ago });
      host.appendChild(lineItem(o.ymd, o.t, o.e, o.year + " · " + ago));
    });
    var empty = $("otd-empty");
    empty.hidden = list.length > 0;
    empty.textContent = Object.keys(data.days).length && day !== todayYmd() ? t("otd.emptyDay") : t("otd.empty");
  }

  function renderStats() {
    var st = C.streak(data, todayYmd());
    $("stats").textContent = st.total ? t("stats", { cur: num(st.current), long: num(st.longest), total: num(st.total) })
                                      : t("stats.none");
  }

  function renderHead() {
    var st = C.streak(data, todayYmd());
    $("title-view").textContent = t("app.name");
    var sub = st.today ? t("sub.done") : t("sub.write");
    if (st.current > 1) sub = t("sub.streak", { n: num(st.current) }) + " · " + sub;
    $("title-sub").textContent = sub;
  }

  // ---------- 5. My days: calendar, search ----------
  var month = null;          // { y, m } shown in the calendar
  var calDirty = true;

  function weekdayNames() {
    var out = [], base = new Date(2024, 0, 1, 12);   // a Monday
    for (var i = 0; i < 7; i++) {
      var d = new Date(base); d.setDate(1 + i);
      try { out.push(d.toLocaleDateString(LOCALE, { weekday: "short" })); } catch (e) { out.push("MTWTFSS".charAt(i)); }
    }
    return out;
  }

  function renderCalendar() {
    calDirty = false;
    var y = month.y, m = month.m, today = todayYmd();
    var first = y + "-" + (m < 10 ? "0" : "") + m + "-01";
    $("month-title").textContent = fmt(first, { month: "long", year: "numeric" });
    var lastMonth = +today.slice(0, 4) * 12 + +today.slice(5, 7);
    $("mnext-btn").disabled = y * 12 + m >= lastMonth;
    var grid = $("grid");
    grid.innerHTML = "";
    var head = el("div", "grid-row grid-head");
    head.setAttribute("role", "row");
    weekdayNames().forEach(function (n) { var c = el("span", "grid-wd", n); c.setAttribute("role", "columnheader"); head.appendChild(c); });
    grid.appendChild(head);
    var pad = C.weekday(first), n = C.daysInMonth(y, m), cells = [];
    for (var i = 0; i < pad; i++) cells.push(null);
    for (var d = 1; d <= n; d++) cells.push(y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d);
    while (cells.length % 7) cells.push(null);
    for (var r = 0; r < cells.length; r += 7) {
      var row = el("div", "grid-row");
      row.setAttribute("role", "row");
      cells.slice(r, r + 7).forEach(function (ymd) {
        if (!ymd) { var e = el("span", "cell blank"); e.setAttribute("role", "gridcell"); row.appendChild(e); return; }
        var ln = lineOf(ymd), future = ymd > today, lg = C.hasLong(data, ymd);
        var b = el("button", "cell" + (ln || lg ? " has" : "") + (ymd === today ? " today" : "") + (ymd === day ? " sel" : ""));
        b.type = "button";
        b.setAttribute("role", "gridcell");
        b.disabled = future;
        b.appendChild(el("span", "cell-n", String(+ymd.slice(8))));
        b.appendChild(el("span", "cell-mark", ln ? (ln.e || "•") : (lg ? "✎" : "")));
        var lbl = ln ? t("aria.day", { date: longDate(ymd), text: ln.t }) : (lg ? longDate(ymd) : t("aria.dayEmpty", { date: longDate(ymd) }));
        if (lg) lbl += " · " + t("aria.long");
        if (ymd === today) lbl += " (" + t("aria.today") + ")";
        b.setAttribute("aria-label", lbl);
        if (ln) b.title = ln.t;
        b.addEventListener("click", function () { openDay(ymd, true); });
        row.appendChild(b);
      });
      grid.appendChild(row);
    }
    var list = $("month-list"), lines = C.monthDays(data, y, m).reverse();
    list.innerHTML = "";
    lines.forEach(function (o) { list.appendChild(lineItem(o.ymd, o.t, o.e, shortDate(o.ymd))); });
    $("month-empty").hidden = lines.length > 0;
  }

  function moveMonth(d) {
    var k = month.y * 12 + (month.m - 1) + d;
    month = { y: Math.floor(k / 12), m: k % 12 + 1 };
    renderCalendar();
  }

  var qTimer = null;
  function renderSearch() {
    var q = $("q").value.trim();
    $("cal-wrap").hidden = !!q;
    $("results-wrap").hidden = !q;
    if (!q) { if (calDirty) renderCalendar(); return; }
    var hits = C.search(data, q), host = $("results");
    host.innerHTML = "";
    hits.slice(0, 300).forEach(function (o) { host.appendChild(lineItem(o.ymd, o.t, o.e, shortDate(o.ymd))); });
    $("results-count").textContent = !hits.length ? t("res.none") : (hits.length === 1 ? t("res.count1") : t("res.count", { n: num(hits.length) }));
  }

  // ---------- 6. Year ----------
  var year = null, yearDirty = true;
  function renderYear() {
    yearDirty = false;
    var ys = C.years(data), cy = +todayYmd().slice(0, 4);
    if (ys.indexOf(cy) < 0) ys.unshift(cy);
    ys.sort(function (a, b) { return b - a; });
    if (year === null || ys.indexOf(year) < 0) year = cy;
    var sel = $("year-sel");
    sel.innerHTML = "";
    ys.forEach(function (y) { var o = el("option", "", String(y)); o.value = String(y); sel.appendChild(o); });
    sel.value = String(year);
    var lines = C.yearDays(data, year), host = $("year-list");
    host.innerHTML = "";
    $("year-count").textContent = lines.length ? t("year.count", { n: num(lines.length) }) : "";
    $("year-empty").hidden = lines.length > 0;
    $("print-btn").disabled = !lines.length;
    $("v-year").setAttribute("data-print-title", t("app.name") + " · " + year);
    var curM = null, ul = null;
    lines.forEach(function (o) {
      var mm = o.ymd.slice(0, 7);
      if (mm !== curM) {
        curM = mm;
        host.appendChild(el("h3", "year-month", monthName(mm + "-01")));
        ul = el("ul", "lines year-lines");
        host.appendChild(ul);
      }
      ul.appendChild(lineItem(o.ymd, o.t, o.e, fmt(o.ymd, { weekday: "short", day: "numeric" })));
    });
  }

  // ---------- 7. Settings: reminder, export, import ----------
  var lastFocus = null;
  function openMore() {
    lastFocus = document.activeElement;
    $("rem-on").checked = prefs.rem.on;
    $("rem-time").value = (prefs.rem.h < 10 ? "0" : "") + prefs.rem.h + ":" + (prefs.rem.mi < 10 ? "0" : "") + prefs.rem.mi;
    $("rem-time").disabled = !prefs.rem.on;
    renderBookYears();
    renderPrompts();
    pinMode = null;
    renderPinArea();
    $("more").hidden = false; $("scrim").hidden = false;
    $("more-close").focus();
  }
  function closeMore(silent) {
    if ($("more").hidden) return;
    $("more").hidden = true;
    if ($("ph-view").hidden) $("scrim").hidden = true;
    pinMode = null;
    if (silent !== true && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onRem() {
    prefs.rem.on = $("rem-on").checked;
    var m = /^(\d{1,2}):(\d{2})/.exec($("rem-time").value || "");
    if (m) { prefs.rem.h = Math.min(23, +m[1]); prefs.rem.mi = Math.min(59, +m[2]); }
    $("rem-time").disabled = !prefs.rem.on;
    savePrefs();
  }

  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = ["." + ext];
      dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: ext.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.file"));
  }
  function exportAs(kind) {
    flush();
    var today = todayYmd();
    if (kind === "txt") saveBlob(new Blob([C.toText(data)], { type: "text/plain" }), C.fileName("txt", today), "text/plain", "txt");
    if (kind === "csv") saveBlob(new Blob(["\ufeff" + C.toCSV(data)], { type: "text/csv" }), C.fileName("csv", today), "text/csv", "csv");
    if (kind === "json") saveBlob(new Blob([C.toJSON(data)], { type: "application/json" }), C.fileName("json", today), "application/json", "json");
  }
  function importFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var rows = C.parseImport(String(rd.result || ""));
      if (!rows.length) { showToast(t("toast.impNone")); return; }
      flush();
      var r = C.importInto(data, rows, Date.now());
      data = r.data;
      save();
      calDirty = yearDirty = true;
      renderDay();
      showToast(t("toast.imported", { a: num(r.added), k: num(r.kept) }));
    };
    rd.onerror = function () { showToast(t("toast.impFail")); };
    rd.readAsText(file);
  }

  function randomMemory() {
    var r = C.randomDay(data, Math.random, todayYmd());
    if (!r) { showToast(t("toast.noRand")); return; }
    openDay(r.ymd);
    live(longDate(r.ymd) + ": " + r.t);
  }

  // ---------- 7b. Wave 30: the long entry ----------
  // Text (Markdown, shown through J.parseMd → DOM, never innerHTML),
  // up to four photos on the orOS disk, a place, the day's weather.
  // Every field syncs on its own (core: LWW per field).
  var J = window.DiaryJournal;
  var LONG_MS = 700;
  var longTimer = null, longDay = null;    // the day the pending text belongs to
  var longShown = {};                      // days opened with "Write more" (this session)
  var longMode = "write";                  // "write" | "preview" (view state)
  var promptSkip = 0, promptDay = null;
  var locDraft = null;                     // { la, lo } from "Use my position", not saved yet

  function longIsOpen() { return !!longShown[day] || C.hasLong(data, day); }

  function renderLong() {
    var open = longIsOpen();
    $("long-open").hidden = open;
    $("long").hidden = !open;
    if (!open) return;
    var L = C.longOf(data, day), ta = $("long-md");
    if (!(document.activeElement === ta && longTimer && longDay === day)) ta.value = L.md;
    ta.placeholder = t("long.ph");
    $("long-del").hidden = !C.hasLong(data, day);
    if (longDay !== day) $("long-status").textContent = "";
    renderMode();
    renderPrompt();
    renderPhotos(L);
    renderMeta(L);
  }

  function renderMode() {
    [["write", "mode-write"], ["preview", "mode-prev"]].forEach(function (p) {
      var on = longMode === p[0], b = $(p[1]);
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    $("long-md").hidden = longMode !== "write";
    $("long-prev").hidden = longMode !== "preview";
    if (longMode === "preview") renderPreview($("long-prev"), $("long-md").value);
  }

  // Markdown blocks → DOM (textContent only; links http/https/mailto).
  function runsInto(host, runs) {
    (runs || []).forEach(function (r) {
      var n;
      if (r.href) {
        n = el("a", "", r.s);
        n.setAttribute("href", r.href);
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer");
      } else if (r.c) n = el("code", "", r.s);
      else n = document.createTextNode(r.s);
      if (r.i) { var em = el("em"); em.appendChild(n); n = em; }
      if (r.b) { var st = el("strong"); st.appendChild(n); n = st; }
      host.appendChild(n);
    });
  }
  function renderPreview(host, md) {
    host.innerHTML = "";
    var blocks = J.parseMd(md), list = null, listOl = false;
    if (!blocks.length) { host.appendChild(el("p", "hint", t("long.empty"))); return; }
    blocks.forEach(function (b) {
      if (b.t !== "li") list = null;
      if (b.t === "h") { var h = el(b.l === 1 ? "h3" : "h4", "md-h md-h" + b.l); runsInto(h, b.runs); host.appendChild(h); }
      else if (b.t === "p") { var p = el("p"); runsInto(p, b.runs); host.appendChild(p); }
      else if (b.t === "q") { var q = el("blockquote"); runsInto(q, b.runs); host.appendChild(q); }
      else if (b.t === "hr") host.appendChild(el("hr"));
      else if (b.t === "li") {
        var isOl = typeof b.n === "number";
        if (!list || listOl !== isOl) {
          list = el(isOl ? "ol" : "ul");
          if (isOl && b.n > 1) list.setAttribute("start", String(b.n));
          listOl = isOl;
          host.appendChild(list);
        }
        var li = el("li"); runsInto(li, b.runs); list.appendChild(li);
      }
    });
  }

  function commitLong() {
    clearTimeout(longTimer); longTimer = null;
    if (!longDay) return;
    var next = C.setLong(data, longDay, "md", $("long-md").value, Date.now());
    if (JSON.stringify(next) !== JSON.stringify(data)) {
      data = next;
      save();
      calDirty = yearDirty = true;
      if (longDay === day) $("long-status").textContent = t("st.saved");
    } else if (longDay === day) $("long-status").textContent = "";
    if (longDay === day) $("long-del").hidden = !C.hasLong(data, day);
    longDay = null;
  }
  function onLongInput() {
    longDay = day;
    clearTimeout(longTimer);
    $("long-status").textContent = t("st.saving");
    longTimer = setTimeout(commitLong, LONG_MS);
  }
  function flushLong() { if (longTimer) commitLong(); }

  function setLongField(field, value) {
    flushLong();
    var next = C.setLong(data, day, field, value, Date.now());
    if (JSON.stringify(next) === JSON.stringify(data)) return false;
    data = next;
    save();
    calDirty = yearDirty = true;
    renderLong();
    return true;
  }

  function clearLong() {
    flushLong();
    var snap = C.longOf(data, day), ymd = day, now = Date.now();
    ["md", "ph", "loc", "wx"].forEach(function (f) {
      data = C.setLong(data, ymd, f, f === "md" ? "" : (f === "ph" ? [] : null), now);
    });
    save();
    calDirty = yearDirty = true;
    longShown[ymd] = true;
    renderLong();
    dropPhotosLater(snap.ph);
    undoToast(t("toast.longDel"), function () {
      var n2 = Date.now();
      data = C.setLong(data, ymd, "md", snap.md, n2);
      data = C.setLong(data, ymd, "ph", snap.ph, n2);
      data = C.setLong(data, ymd, "loc", snap.loc, n2);
      data = C.setLong(data, ymd, "wx", snap.wx, n2);
      save();
      calDirty = yearDirty = true;
      openDay(ymd);
    });
  }

  // ---- prompts and templates ----
  function renderPrompt() {
    if (promptDay !== day) { promptDay = day; promptSkip = 0; }
    var p = J.dailyPrompt(day, LANG, C.livePrompts(data), promptSkip);
    $("prompt-q").textContent = p ? p.t : "";
  }
  function insertIntoLong(block) {
    var ta = $("long-md");
    longMode = "write";
    renderMode();
    ta.value = J.insertBlock(ta.value, block);
    onLongInput();
    ta.focus();
    var L = ta.value.length;
    try { ta.setSelectionRange(L, L); } catch (e) {}
  }
  function renderTemplates() {
    var host = $("tpl-chips");
    host.innerHTML = "";
    J.TEMPLATE_IDS.forEach(function (id) {
      var tp = J.template(id, LANG);
      var b = el("button", "chip", tp.name);
      b.type = "button";
      b.addEventListener("click", function () { insertIntoLong(tp.text); });
      host.appendChild(b);
    });
  }

  // ---- photos (files on the orOS disk) ----
  // The entry keeps names only; each JPEG is a file in Files under
  // Diary/Photos (Vault Drive syncs it when the user runs it). Every
  // photo is re-drawn on a canvas (max 1600 px, JPEG): no EXIF, no
  // location, no foreign bytes are kept.
  var PH_MAX_IN = 40 * 1024 * 1024;
  var phUrls = [];
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function randId() {
    var a = new Uint8Array(8), out = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 8; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) out += (a[j] % 36).toString(36);
    return out;
  }
  function encodePhoto(file) {
    return new Promise(function (resolve) {
      if (!file || file.size > PH_MAX_IN) { resolve(null); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
        var k = Math.min(1, 1600 / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        var g = cv.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b && b.size ? b : null); }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
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
  function rmPhoto(name) {
    var fs = fsApi(), p = C.photoPath(name);
    if (!fs || !p) return Promise.resolve();
    return Promise.resolve(fs.rm(p)).catch(function () {});
  }
  // A photo taken off an entry stays through the Undo window; then a
  // name no entry points at any more leaves the disk.
  function dropPhotosLater(names) {
    if (!names || !names.length || !fsApi()) return;
    var list = names.slice();
    setTimeout(function () {
      var used = C.photosOf(data);
      list.forEach(function (n) { if (used.indexOf(n) < 0) rmPhoto(n); });
    }, 12000);
  }
  function readPhoto(name) {
    var fs = fsApi(), p = C.photoPath(name);
    if (!fs || !p) return Promise.reject(new Error("nodisk"));
    return Promise.resolve(fs.readBlob(p)).then(function (b) { if (!b) throw new Error("ENOENT"); return b; });
  }
  function renderPhotos(L) {
    phUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    phUrls = [];
    var host = $("photos"), fs = fsApi();
    host.innerHTML = "";
    L.ph.forEach(function (name, i) {
      var b = el("button", "ph-th");
      b.type = "button";
      setLabel(b, t("ph.open", { n: i + 1 }));
      b.addEventListener("click", function () { openPhoto(name); });
      host.appendChild(b);
      readPhoto(name).then(function (blob) {
        var u = URL.createObjectURL(blob);
        phUrls.push(u);
        var im = el("img");
        im.alt = "";
        im.src = u;
        b.appendChild(im);
      }).catch(function () { b.appendChild(el("span", "ph-miss", t("ph.missing"))); });
    });
    if (L.ph.length < C.PH_MAX) {
      var add = el("button", "ph-th ph-add", "+");
      add.type = "button";
      add.id = "ph-add";
      setLabel(add, fs ? t("ph.add") : t("ph.noDisk"));
      add.disabled = !fs;
      add.addEventListener("click", pickPhoto);
      host.appendChild(add);
    }
  }
  function pickPhoto() {
    var fs = fsApi();
    if (!fs) { showToast(t("ph.noDisk")); return; }
    var ymd = day, host = dialogHost();
    var p = host && typeof host.openFile === "function" ? host.openFile("image/*") : localPickFile("image/*");
    Promise.resolve(p).then(function (file) {
      if (!file) return;
      return encodePhoto(file).then(function (blob) {
        if (!blob) { showToast(t("ph.bad")); return; }
        var name = C.photoName(ymd, randId());
        if (!name) return;
        return Promise.resolve(fs.writeBlob(C.photoPath(name), blob)).then(function () {
          var cur = C.longOf(data, ymd).ph;
          if (cur.length >= C.PH_MAX) { rmPhoto(name); showToast(t("ph.max")); return; }
          data = C.setLong(data, ymd, "ph", cur.concat([name]), Date.now());
          save();
          calDirty = yearDirty = true;
          if (ymd === day) renderLong();
        });
      });
    }).catch(function () { showToast(t("ph.noDisk")); });
  }
  var phViewName = null, phViewUrl = null, phLastFocus = null;
  function openPhoto(name) {
    phViewName = name;
    phLastFocus = document.activeElement;
    var box = $("ph-img");
    box.innerHTML = "";
    readPhoto(name).then(function (blob) {
      if (phViewUrl) URL.revokeObjectURL(phViewUrl);
      phViewUrl = URL.createObjectURL(blob);
      var im = el("img");
      im.alt = t("ph.lbl");
      im.src = phViewUrl;
      box.appendChild(im);
    }).catch(function () { box.appendChild(el("p", "hint", t("ph.missingLong"))); });
    $("ph-view").hidden = false; $("scrim").hidden = false;
    $("ph-close").focus();
  }
  function closePhoto() {
    if ($("ph-view").hidden) return;
    $("ph-view").hidden = true;
    if ($("more").hidden) $("scrim").hidden = true;
    if (phViewUrl) { URL.revokeObjectURL(phViewUrl); phViewUrl = null; }
    if (phLastFocus && phLastFocus.focus) phLastFocus.focus();
  }
  function removePhoto() {
    var name = phViewName, ymd = day;
    closePhoto();
    if (!name) return;
    var cur = C.longOf(data, ymd).ph;
    data = C.setLong(data, ymd, "ph", cur.filter(function (n) { return n !== name; }), Date.now());
    save();
    calDirty = yearDirty = true;
    renderLong();
    dropPhotosLater([name]);
    undoToast(t("toast.phDel"), function () {
      var now = C.longOf(data, ymd).ph;
      if (now.indexOf(name) >= 0 || now.length >= C.PH_MAX) return;
      data = C.setLong(data, ymd, "ph", now.concat([name]), Date.now());
      save();
      openDay(ymd);
    });
  }

  // ---- place and weather (user-initiated only) ----
  function weatherUnitsImperial() {
    try { var w = JSON.parse(localStorage.getItem("oros-weatherapp-data") || "null"); return !!(w && w.units === "imperial"); }
    catch (e) { return false; }
  }
  // The Weather app's active city: a fallback place for the weather.
  function weatherCity() {
    try {
      var w = JSON.parse(localStorage.getItem("oros-weatherapp-data") || "null");
      if (!w || !Array.isArray(w.cities)) return null;
      var c = null;
      w.cities.forEach(function (x) { if (x && x.id === w.active) c = x; });
      c = c || w.cities[0];
      if (!c || typeof c.lat !== "number" || typeof c.lon !== "number") return null;
      return { n: String(c.label || ""), la: c.lat, lo: c.lon };
    } catch (e) { return null; }
  }
  function renderMeta(L) {
    var lb = $("loc-btn"), wb = $("wx-btn");
    lb.textContent = L.loc ? "📍 " + J.locLine(L.loc) : t("loc.add");
    lb.classList.toggle("on", !!L.loc);
    setLabel(lb, L.loc ? t("loc.edit") : t("loc.add"));
    wb.textContent = L.wx ? J.wxEmoji(L.wx.c) + " " + J.wxLine(L.wx, LANG, weatherUnitsImperial()) : t("wx.add");
    wb.classList.toggle("on", !!L.wx);
    setLabel(wb, L.wx ? t("wx.again") : t("wx.add"));
    var del = $("wx-del");
    if (L.wx && !del) {
      del = el("button", "link-btn danger", t("wx.remove"));
      del.type = "button";
      del.id = "wx-del";
      del.addEventListener("click", function () { setLongField("wx", null); });
      wb.parentNode.appendChild(del);
    } else if (!L.wx && del) del.remove();
  }
  function openLocEdit() {
    var L = C.longOf(data, day);
    locDraft = L.loc && typeof L.loc.la === "number" ? { la: L.loc.la, lo: L.loc.lo } : null;
    $("loc-name").value = L.loc && L.loc.n ? L.loc.n : "";
    $("loc-name").placeholder = t("loc.ph");
    $("loc-remove").hidden = !L.loc;
    renderLocHint();
    $("loc-edit").hidden = false;
    $("loc-name").focus();
  }
  function renderLocHint() {
    $("loc-hint").textContent = locDraft ? t("loc.coords", { c: locDraft.la.toFixed(2) + ", " + locDraft.lo.toFixed(2) }) : t("loc.hint");
  }
  function closeLocEdit() { $("loc-edit").hidden = true; locDraft = null; $("loc-btn").focus(); }
  function useMyPosition() {
    if (!navigator.geolocation) { showToast(t("loc.geoNo")); return; }
    $("loc-hint").textContent = t("loc.geoBusy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      locDraft = { la: C.coarse(pos.coords.latitude), lo: C.coarse(pos.coords.longitude) };
      renderLocHint();
    }, function () {
      renderLocHint();
      showToast(t("loc.geoFail"));
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }
  function saveLoc() {
    var n = $("loc-name").value.trim();
    var v = n || locDraft ? { n: n } : null;
    if (v && locDraft) { v.la = locDraft.la; v.lo = locDraft.lo; }
    $("loc-edit").hidden = true;
    locDraft = null;
    setLongField("loc", v);
    $("loc-btn").focus();
  }
  function removeLoc() { $("loc-edit").hidden = true; locDraft = null; setLongField("loc", null); $("loc-btn").focus(); }

  var wxBusy = false;
  function fetchJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); });
  }
  function fetchWeather() {
    if (wxBusy) return;
    var ymd = day, L = C.longOf(data, ymd), loc = L.loc;
    if (navigator.onLine === false) { showToast(t("wx.offline")); return; }
    var where;
    if (loc && typeof loc.la === "number") where = Promise.resolve(loc);
    else if (loc && loc.n) {
      where = fetchJson(J.geoUrl(loc.n, LANG)).then(function (d) {
        var g = J.parseGeo(d);
        if (!g) throw new Error("notfound");
        // keep the coords with the typed name (rounded to 0.01°)
        data = C.setLong(data, ymd, "loc", { n: loc.n, la: g.la, lo: g.lo }, Date.now());
        save();
        return g;
      });
    } else {
      var wc = weatherCity();
      if (!wc) { showToast(t("wx.needPlace")); openLocEdit(); return; }
      where = Promise.resolve(wc);
    }
    wxBusy = true;
    $("wx-btn").textContent = t("wx.busy");
    where.then(function (g) {
      return fetchJson(J.wxUrl(g.la, g.lo, ymd, todayYmd())).then(function (d) {
        var wx = J.parseWx(d, ymd);
        if (!wx) throw new Error("nodata");
        data = C.setLong(data, ymd, "wx", wx, Date.now());
        save();
        calDirty = yearDirty = true;
      });
    }).catch(function (e) {
      showToast(e && e.message === "notfound" ? t("wx.notFound") : t("wx.fail"));
    }).then(function () {
      wxBusy = false;
      if (ymd === day) renderLong();
    });
  }

  // ---------- 7c. Wave 30: your own questions ----------
  function renderPrompts() {
    var host = $("prm-list");
    host.innerHTML = "";
    C.livePrompts(data).forEach(function (p) {
      var li = el("li", "prm-item");
      li.appendChild(el("span", "prm-t", p.t));
      var b = el("button", "link-btn danger", t("prm.del"));
      b.type = "button";
      setLabel(b, t("prm.del") + ": " + p.t);
      b.addEventListener("click", function () {
        data = C.setPrompt(data, p.id, "", true, Date.now());
        save();
        renderPrompts();
        if (!$("long").hidden) renderPrompt();
      });
      li.appendChild(b);
      host.appendChild(li);
    });
    $("prm-in").placeholder = t("prm.new");
  }
  function addPrompt() {
    var v = $("prm-in").value.trim();
    if (!v) { $("prm-in").focus(); return; }
    data = C.setPrompt(data, "p-" + randId(), v, false, Date.now());
    save();
    $("prm-in").value = "";
    renderPrompts();
    if (!$("long").hidden) renderPrompt();
    $("prm-in").focus();
  }

  // ---------- 7d. Wave 30: PIN lock (device-local privacy screen) ----------
  // Only a salted PBKDF2 hash is kept, in oros-diary-lock on this
  // device. It is a privacy screen, not encryption (see help).
  var LOCK_KEY = J.LOCK_KEY, FAILS_KEY = "oros-diary-lock-fails";
  var RELOCK_MS = 60000;
  var lockRec = null, locked = false, hiddenAt = 0, pinMode = null;
  function cryptoOk() { return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues && window.TextEncoder); }
  function loadLock() {
    try { lockRec = J.readLock(JSON.parse(localStorage.getItem(LOCK_KEY) || "null")); } catch (e) { lockRec = null; }
  }
  function readFails() {
    try { var f = JSON.parse(localStorage.getItem(FAILS_KEY) || "null"); return f && typeof f.n === "number" ? f : { n: 0, at: 0 }; }
    catch (e) { return { n: 0, at: 0 }; }
  }
  function writeFails(f) { try { if (f.n) localStorage.setItem(FAILS_KEY, JSON.stringify(f)); else localStorage.removeItem(FAILS_KEY); } catch (e) {} }
  function setInert(on) {
    ["toolbar", "tabs", "main", "more", "ph-view", "toast"].forEach(function (id) {
      var n = $(id);
      if (!n) return;
      if (on) { n.setAttribute("inert", ""); n.setAttribute("aria-hidden", "true"); }
      else { n.removeAttribute("inert"); n.removeAttribute("aria-hidden"); }
    });
  }
  function showLock() {
    if (!lockRec) return;
    flush();
    locked = true;
    closeMore(true);
    closePhoto();
    $("lock").hidden = false;
    document.body.classList.add("is-locked");
    setInert(true);
    $("lock-pin").value = "";
    $("lock-msg").textContent = "";
    setTimeout(function () { if (locked) $("lock-pin").focus(); }, 30);
  }
  function hideLock() {
    locked = false;
    $("lock").hidden = true;
    document.body.classList.remove("is-locked");
    setInert(false);
    if (view === "today") $("line").focus();
  }
  function tryUnlock(ev) {
    if (ev) ev.preventDefault();
    var f = readFails(), wait = J.lockWait(f.n), left = Math.ceil((f.at + wait * 1000 - Date.now()) / 1000);
    if (wait && left > 0) { $("lock-msg").textContent = t("lock.wait", { n: left }); return; }
    var pin = $("lock-pin").value.trim();
    $("lock-go").disabled = true;
    J.checkPin(window.crypto, lockRec, pin).then(function (ok) {
      $("lock-go").disabled = false;
      if (ok) { writeFails({ n: 0, at: 0 }); hideLock(); return; }
      f.n++; f.at = Date.now(); writeFails(f);
      $("lock-pin").value = "";
      var w2 = J.lockWait(f.n);
      $("lock-msg").textContent = w2 ? t("lock.wait", { n: w2 }) : t("lock.wrong");
      $("lock-pin").focus();
    }, function () { $("lock-go").disabled = false; $("lock-msg").textContent = t("lock.unsupported"); });
  }

  function pinInput(id, label) {
    var inp = el("input", "pin-in");
    inp.type = "password";
    inp.id = id;
    inp.inputMode = "numeric";
    inp.setAttribute("pattern", "[0-9]*");
    inp.maxLength = 8;
    inp.autocomplete = "off";
    inp.placeholder = label;
    inp.setAttribute("aria-label", label);
    return inp;
  }
  function pinBtn(label, cls, fn, id) {
    var b = el("button", cls || "chip", label);
    b.type = "button";
    if (id) b.id = id;
    b.addEventListener("click", fn);
    return b;
  }
  function renderPinArea() {
    var host = $("pin-area");
    host.innerHTML = "";
    if (!cryptoOk()) { host.appendChild(el("p", "hint small", t("lock.unsupported"))); return; }
    host.appendChild(el("p", "hint small pin-status", lockRec ? t("lock.status.on") : t("lock.status.off")));
    var msg = el("p", "hint small pin-msg");
    msg.id = "pin-msg";
    msg.setAttribute("aria-live", "polite");
    if (!pinMode) {
      var acts = el("div", "actions");
      if (!lockRec) acts.appendChild(pinBtn(t("lock.set"), "chip", function () { pinMode = "set"; renderPinArea(); }, "pin-set"));
      else {
        acts.appendChild(pinBtn(t("lock.lockNow"), "chip", function () { showLock(); }, "pin-lock"));
        acts.appendChild(pinBtn(t("lock.change"), "chip", function () { pinMode = "change"; renderPinArea(); }, "pin-change"));
        acts.appendChild(pinBtn(t("lock.remove"), "link-btn danger", function () { pinMode = "remove"; renderPinArea(); }, "pin-remove"));
      }
      host.appendChild(acts);
      return;
    }
    var form = el("div", "pin-form");
    var cur = pinMode !== "set" ? pinInput("pin-cur", t("lock.cur")) : null;
    var n1 = pinMode !== "remove" ? pinInput("pin-new", t("lock.new")) : null;
    var n2 = pinMode !== "remove" ? pinInput("pin-again", t("lock.again")) : null;
    [cur, n1, n2].forEach(function (x) { if (x) form.appendChild(x); });
    var acts2 = el("div", "actions");
    acts2.appendChild(pinBtn(pinMode === "remove" ? t("lock.remove") : t("lock.save"), "chip on", function () {
      var check = cur ? J.checkPin(window.crypto, lockRec, cur.value.trim()) : Promise.resolve(true);
      check.then(function (ok) {
        if (!ok) { msg.textContent = t("lock.wrong"); cur.value = ""; cur.focus(); return; }
        if (pinMode === "remove") {
          try { localStorage.removeItem(LOCK_KEY); } catch (e) {}
          writeFails({ n: 0, at: 0 });
          lockRec = null; pinMode = null;
          renderPinArea();
          showToast(t("lock.off"));
          return;
        }
        var a = n1.value.trim(), b = n2.value.trim();
        if (!J.pinOk(a)) { msg.textContent = t("lock.bad"); n1.focus(); return; }
        if (a !== b) { msg.textContent = t("lock.mismatch"); n2.value = ""; n2.focus(); return; }
        return J.makeLock(window.crypto, a).then(function (rec) {
          try { localStorage.setItem(LOCK_KEY, JSON.stringify(rec)); } catch (e) { msg.textContent = t("toast.saveFail"); return; }
          lockRec = rec; pinMode = null;
          writeFails({ n: 0, at: 0 });
          renderPinArea();
          showToast(t("lock.on"));
        });
      }).catch(function () { msg.textContent = t("lock.unsupported"); });
    }, "pin-ok"));
    acts2.appendChild(pinBtn(t("loc.cancel"), "chip", function () { pinMode = null; renderPinArea(); }, "pin-cancel"));
    form.appendChild(acts2);
    form.appendChild(msg);
    host.appendChild(form);
    (cur || n1).focus();
  }

  // ---------- 7e. Wave 30: the PDF book ----------
  // jsPDF and the Noto Serif faces are vendored (../vendor), loaded on
  // first use, never from a CDN; NFC before drawing (Greek accents).
  var jspdfP = null, fontsP = null;
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfP) return jspdfP;
    jspdfP = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "../vendor/jspdf.umd.min.js";
      s.onload = function () { if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error("jspdf")); };
      s.onerror = function () { jspdfP = null; s.remove(); reject(new Error("jspdf")); };
      document.head.appendChild(s);
    });
    return jspdfP;
  }
  function fontB64(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("font"); return r.arrayBuffer(); }).then(function (buf) {
      var u8 = new Uint8Array(buf), bin = "";
      for (var i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(bin);
    });
  }
  function loadFonts() {
    if (fontsP) return fontsP;
    var names = ["NotoSerif-Regular", "NotoSerif-Bold", "NotoSerif-Italic", "NotoSerif-BoldItalic"];
    fontsP = Promise.all(names.map(function (n) { return fontB64("../vendor/noto/" + n + ".ttf"); }))
      .then(function (list) { var o = {}; names.forEach(function (n, i) { o[n] = list[i]; }); return o; })
      .catch(function (e) { fontsP = null; throw e; });
    return fontsP;
  }
  function photoForPdf(name) {
    return readPhoto(name).then(function (blob) {
      return new Promise(function (resolve) {
        var u = URL.createObjectURL(blob), img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          URL.revokeObjectURL(u);
          blob.arrayBuffer().then(function (ab) { resolve({ data: new Uint8Array(ab), w: w, h: h }); }, function () { resolve(null); });
        };
        img.onerror = function () { URL.revokeObjectURL(u); resolve(null); };
        img.src = u;
      });
    }).catch(function () { return null; });
  }
  var bookBusy = false;
  function makeBook() {
    if (bookBusy) return;
    flush();
    var year = +$("book-year").value || 0;
    var days = J.bookDays(data, C, year);
    if (!days.length) { showToast(t("book.none")); return; }
    bookBusy = true;
    $("book-btn").disabled = true;
    showToast(t("book.busy"));
    var photos = {};
    var chain = Promise.resolve();
    days.forEach(function (d) {
      d.ph.forEach(function (n) {
        chain = chain.then(function () { return photoForPdf(n); }).then(function (p) { if (p) photos[n] = p; });
      });
    });
    Promise.all([loadJsPDF(), loadFonts(), chain]).then(function (r) {
      var pdf = drawBook(r[0], r[1], days, photos, year);
      var stem = "diary-book-" + (year || "all") + ".pdf";
      saveBlob(pdf.output("blob"), stem, "application/pdf", "pdf");
    }).catch(function (e) {
      try { console.error("[orOS diary] book", e); } catch (x) {}
      showToast(t("book.fail"));
    }).then(function () { bookBusy = false; $("book-btn").disabled = false; });
  }
  function drawBook(JsPDF, fonts, days, photos, year) {
    var pdf = new JsPDF({ unit: "pt", format: "a5", compress: true });
    Object.keys(fonts).forEach(function (n) { pdf.addFileToVFS(n + ".ttf", fonts[n]); });
    pdf.addFont("NotoSerif-Regular.ttf", "serif", "normal");
    pdf.addFont("NotoSerif-Bold.ttf", "serif", "bold");
    pdf.addFont("NotoSerif-Italic.ttf", "serif", "italic");
    pdf.addFont("NotoSerif-BoldItalic.ttf", "serif", "bolditalic");
    var W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    var M = 42, BOT = H - 46, y = M, page = 1;
    var nfc = function (s) { s = String(s || ""); try { return s.normalize("NFC"); } catch (e) { return s; } };
    var title = t("app.name");
    try { pdf.setProperties({ title: title + (year ? " · " + year : ""), creator: "orOS One-Sentence Diary" }); } catch (e) {}
    function footer() {
      pdf.setFont("serif", "normal"); pdf.setFontSize(8); pdf.setTextColor(140);
      pdf.text(String(page), W / 2, H - 24, { align: "center" });
    }
    function newPage() { footer(); pdf.addPage(); page++; y = M; }
    function need(h) { if (y + h > BOT) newPage(); }
    function style(r) { return r.b && r.i ? "bolditalic" : r.b ? "bold" : r.i ? "italic" : "normal"; }
    // Word flow over styled runs; returns nothing, moves y.
    function flow(runs, size, x0, lead, color) {
      var maxX = W - M, x = x0, lineH = size * (lead || 1.45);
      need(lineH);
      pdf.setFontSize(size);
      runs.forEach(function (r) {
        var words = nfc(r.s).split(/(\s+)/);
        pdf.setFont("serif", style(r));
        var col = r.href ? [140, 105, 20] : (color || [30, 30, 30]);
        pdf.setTextColor(col[0], col[1], col[2]);
        words.forEach(function (w) {
          if (!w) return;
          var isSp = /^\s+$/.test(w);
          if (isSp) { if (x > x0) x += pdf.getTextWidth(" "); return; }
          var ww = pdf.getTextWidth(w);
          if (x + ww > maxX && x > x0) { y += lineH; need(lineH); x = x0; }
          while (ww > maxX - x0) {                 // one very long word: cut it
            var cut = w.length;
            while (cut > 1 && pdf.getTextWidth(w.slice(0, cut)) > maxX - x0) cut--;
            pdf.text(w.slice(0, cut), x, y + size * 0.8);
            w = w.slice(cut); ww = pdf.getTextWidth(w);
            y += lineH; need(lineH); x = x0;
          }
          pdf.text(w, x, y + size * 0.8);
          if (r.href) { try { pdf.link(x, y, ww, size, { url: r.href }); } catch (e) {} }
          x += ww;
        });
      });
      y += lineH;
    }
    // title page
    pdf.setFont("serif", "bold"); pdf.setFontSize(26); pdf.setTextColor(30);
    var tl = pdf.splitTextToSize(nfc(title), W - 2 * M);
    pdf.text(tl, W / 2, H * 0.36, { align: "center" });
    pdf.setFont("serif", "italic"); pdf.setFontSize(14); pdf.setTextColor(90);
    pdf.text(nfc(year ? String(year) : t("book.all")), W / 2, H * 0.36 + tl.length * 30 + 10, { align: "center" });
    pdf.setFont("serif", "normal"); pdf.setFontSize(10);
    pdf.text(nfc(shortDate(days[0].ymd) + " – " + shortDate(days[days.length - 1].ymd)), W / 2, H * 0.36 + tl.length * 30 + 34, { align: "center" });
    pdf.text(nfc(t("year.count", { n: num(days.length) })), W / 2, H * 0.36 + tl.length * 30 + 50, { align: "center" });
    newPage();
    var lastMonth = null, imperial = weatherUnitsImperial();
    days.forEach(function (d) {
      var mo = d.ymd.slice(0, 7);
      if (mo !== lastMonth) {
        if (lastMonth !== null) y += 10;
        need(60);
        pdf.setFont("serif", "bold"); pdf.setFontSize(15); pdf.setTextColor(140, 105, 20);
        pdf.text(nfc(fmt(mo + "-01", { month: "long", year: "numeric" })), M, y + 14);
        y += 26;
        lastMonth = mo;
      }
      need(48);
      pdf.setDrawColor(210); pdf.setLineWidth(0.5); pdf.line(M, y, W - M, y);
      y += 8;
      pdf.setFont("serif", "bold"); pdf.setFontSize(11); pdf.setTextColor(40);
      pdf.text(nfc(longDate(d.ymd)), M, y + 10);
      y += 18;
      var meta = [J.locLine(d.loc), d.wx ? J.wxLine(d.wx, LANG, imperial) : ""].filter(Boolean).join(" · ");
      if (meta) { flow([{ s: meta }], 8.5, M, 1.3, [120, 120, 120]); y += 2; }
      if (d.t) { flow([{ s: d.t, i: true }], 12.5, M, 1.4, [25, 25, 25]); y += 4; }
      J.parseMd(d.md).forEach(function (b) {
        if (b.t === "h") { y += 4; flow(b.runs.map(function (r) { return Object.assign({}, r, { b: true }); }), b.l === 1 ? 12 : 11, M, 1.35); }
        else if (b.t === "p") { flow(b.runs, 10, M, 1.45); y += 3; }
        else if (b.t === "q") { var y0 = y; flow(b.runs.map(function (r) { return Object.assign({}, r, { i: true }); }), 10, M + 12, 1.45, [90, 90, 90]); pdf.setDrawColor(200); pdf.line(M + 3, y0 + 2, M + 3, y - 4); y += 3; }
        else if (b.t === "li") {
          need(15);
          pdf.setFont("serif", "normal"); pdf.setFontSize(10); pdf.setTextColor(60);
          pdf.text(typeof b.n === "number" ? b.n + "." : "•", M + 4, y + 8);
          flow(b.runs, 10, M + 18, 1.45);
        } else if (b.t === "hr") { need(12); pdf.setDrawColor(200); pdf.line(M + 40, y + 5, W - M - 40, y + 5); y += 12; }
      });
      var pics = d.ph.map(function (n) { return photos[n]; }).filter(Boolean);
      if (pics.length) {
        y += 4;
        var cols = pics.length === 1 ? 1 : 2, gap = 8, cw = (W - 2 * M - gap * (cols - 1)) / cols;
        for (var i = 0; i < pics.length; i += cols) {
          var row = pics.slice(i, i + cols), rh = 0;
          row.forEach(function (p) { rh = Math.max(rh, Math.min(cw * p.h / p.w, cols === 1 ? 260 : 180)); });
          need(rh + 6);
          row.forEach(function (p, j) {
            var h = Math.min(cw * p.h / p.w, rh), w = h * p.w / p.h;
            try { pdf.addImage(p.data, "JPEG", M + j * (cw + gap) + (cw - w) / 2, y, w, h); } catch (e) {}
          });
          y += rh + 6;
        }
      }
      y += 8;
    });
    footer();
    return pdf;
  }
  function renderBookYears() {
    var sel = $("book-year"), ys = {}, keep = sel.value;
    Object.keys(data.days).forEach(function (k) { ys[k.slice(0, 4)] = 1; });
    Object.keys(data.long || {}).forEach(function (k) { if (C.hasLong(data, k)) ys[k.slice(0, 4)] = 1; });
    sel.innerHTML = "";
    var all = el("option", "", t("book.all")); all.value = "0"; sel.appendChild(all);
    Object.keys(ys).sort().reverse().forEach(function (y) { var o = el("option", "", y); o.value = y; sel.appendChild(o); });
    if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
    else if (ys[todayYmd().slice(0, 4)]) sel.value = todayYmd().slice(0, 4);
  }

  // ---------- 8. Tabs, toasts ----------
  var view = "today";
  function showView(v) {
    view = VIEWS.indexOf(v) >= 0 ? v : "today";
    VIEWS.forEach(function (k) {
      var on = k === view, tab = $("tab-" + k);
      $("v-" + k).hidden = !on;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle("on", on);
    });
    if (view === "days") {
      if (!month) month = { y: +day.slice(0, 4), m: +day.slice(5, 7) };
      if ($("q").value.trim()) renderSearch(); else if (calDirty) renderCalendar();
    }
    if (view === "year" && yearDirty) renderYear();
    if (prefs.view !== view) { prefs.view = view; savePrefs(); }
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "diary", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 9. Keyboard ----------
  function typing(e) {
    var tg = e.target, tag = tg && tg.tagName;
    return tag === "INPUT" && tg.type !== "checkbox" || tag === "TEXTAREA" || tag === "SELECT";
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
    document.addEventListener("keydown", function (e) {
      if (locked) return;                      // the lock screen takes no shortcuts
      if (e.key === "Escape" && !$("ph-view").hidden) { e.preventDefault(); closePhoto(); return; }
      if (e.key === "Escape" && !$("loc-edit").hidden && $("loc-edit").contains(e.target)) { e.preventDefault(); closeLocEdit(); return; }
      if (e.key === "Escape" && !$("more").hidden) { e.preventDefault(); closeMore(); return; }
      if (e.target && e.target.closest && e.target.closest("#long")) return;   // the long entry keeps its arrows
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      var inLine = e.target === $("line");
      if (view === "today" && (e.key === "ArrowLeft" || e.key === "ArrowRight") && (e.altKey || (!typing(e) && !inLine))) {
        if (e.target && e.target.closest && e.target.closest('[role="radiogroup"], [role="tablist"]')) return;
        e.preventDefault();
        stepDay(e.key === "ArrowLeft" ? -1 : 1);
      }
    });
    $("line").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      flush();
      if (day < todayYmd() && C.cleanText($("line").value)) stepDay(1, true);   // filling in past days: on to the next
      else $("status").textContent = lineOf(day) ? t("st.saved") : "";
    });
    $("tabs").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var i = (VIEWS.indexOf(view) + d + VIEWS.length) % VIEWS.length;
      showView(VIEWS[i]);
      $("tab-" + VIEWS[i]).focus();
    });
  }
  function stepDay(d, focus) {
    var next = C.addDays(day, d);
    if (!next || next > todayYmd()) return;
    openDay(next, focus);
  }

  // ---------- 10. Sync slice + palette + deep link ----------
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
    api.registerSlice("diary", sliceGet, sliceSet, STORAGE_KEY, C.mergeDiary);
  }

  function sliceGet() { flush(); return C.mergeDiary(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.days || typeof incoming.days !== "object") return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeDiary(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    calDirty = yearDirty = true;
    renderDay();                              // keeps a line being typed (see renderDay)
    if (view === "days") renderSearch();
    if (view === "year") renderYear();
    if (!$("more").hidden) {
      renderBookYears();
      var ae = document.activeElement;
      if (!(ae && ae.id === "prm-in")) renderPrompts();
    }
  }

  // Deep link: { day } opens that day (reminder, universal search).
  function openTarget(target) {
    if (!target || typeof target !== "object") { openDay(todayYmd()); return; }
    openDay(C.isYmd(target.day) ? target.day : C.writingDay(data, new Date()).day, true);
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 11. Wiring & boot ----------
  var ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    rand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("prev-btn").innerHTML = ICON.prev; setLabel($("prev-btn"), t("btn.prev"));
    $("next-btn").innerHTML = ICON.next; setLabel($("next-btn"), t("btn.next"));
    $("mprev-btn").innerHTML = ICON.prev; setLabel($("mprev-btn"), t("btn.mprev"));
    $("mnext-btn").innerHTML = ICON.next; setLabel($("mnext-btn"), t("btn.mnext"));
    $("rand-btn").innerHTML = ICON.rand; setLabel($("rand-btn"), t("btn.rand"));
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    $("more-close").innerHTML = ICON.close; setLabel($("more-close"), t("btn.close"));
    $("q").placeholder = t("ph.search");
    $("ph-close").innerHTML = ICON.close; setLabel($("ph-close"), t("btn.close"));
    $("loc-name").placeholder = t("loc.ph");
    $("lock-pin").placeholder = t("lock.pin");
    $("lock").querySelector(".lock-ic").innerHTML = ICON.lock;
    renderTemplates();
  }

  function wire() {
    $("line").addEventListener("input", onLineInput);
    $("line").addEventListener("blur", flush);
    $("prev-btn").addEventListener("click", function () { stepDay(-1); });
    $("next-btn").addEventListener("click", function () { stepDay(1); });
    $("today-btn").addEventListener("click", function () { lateChoice = null; openDay(C.writingDay(data, new Date()).day, true); });
    $("del-btn").addEventListener("click", deleteDay);
    $("mprev-btn").addEventListener("click", function () { moveMonth(-1); });
    $("mnext-btn").addEventListener("click", function () { moveMonth(1); });
    $("q").addEventListener("input", function () { clearTimeout(qTimer); qTimer = setTimeout(renderSearch, 150); });
    $("year-sel").addEventListener("change", function () { year = +$("year-sel").value; renderYear(); });
    $("print-btn").addEventListener("click", function () { window.print(); });
    $("rand-btn").addEventListener("click", randomMemory);
    $("more-btn").addEventListener("click", openMore);
    $("more-close").addEventListener("click", closeMore);
    $("scrim").addEventListener("click", function () { if (!$("ph-view").hidden) closePhoto(); else closeMore(); });
    // Wave 30: the long entry, photos, place and weather
    $("long-open").addEventListener("click", function () {
      longShown[day] = true;
      longMode = "write";
      renderLong();
      $("long-md").focus();
    });
    $("long-md").addEventListener("input", onLongInput);
    $("long-md").addEventListener("blur", flushLong);
    $("mode-write").addEventListener("click", function () { longMode = "write"; renderMode(); $("long-md").focus(); });
    $("mode-prev").addEventListener("click", function () { flushLong(); longMode = "preview"; renderMode(); });
    $("long-mode").addEventListener("keydown", function (e) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key) < 0) return;
      e.preventDefault();
      longMode = longMode === "write" ? "preview" : "write";
      if (longMode === "preview") flushLong();
      renderMode();
      $(longMode === "write" ? "mode-write" : "mode-prev").focus();
    });
    $("prompt-use").addEventListener("click", function () {
      var q = $("prompt-q").textContent;
      if (q) insertIntoLong(J.questionBlock(q));
    });
    $("prompt-next").addEventListener("click", function () { promptSkip++; renderPrompt(); });
    $("long-del").addEventListener("click", clearLong);
    $("loc-btn").addEventListener("click", function () { if ($("loc-edit").hidden) openLocEdit(); else closeLocEdit(); });
    $("loc-geo").addEventListener("click", useMyPosition);
    $("loc-save").addEventListener("click", saveLoc);
    $("loc-cancel").addEventListener("click", closeLocEdit);
    $("loc-remove").addEventListener("click", removeLoc);
    $("loc-name").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); saveLoc(); } });
    $("wx-btn").addEventListener("click", fetchWeather);
    $("ph-close").addEventListener("click", closePhoto);
    $("ph-remove").addEventListener("click", removePhoto);
    $("book-btn").addEventListener("click", makeBook);
    $("prm-btn").addEventListener("click", addPrompt);
    $("prm-in").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addPrompt(); } });
    $("lock-form").addEventListener("submit", tryUnlock);
    $("rem-on").addEventListener("change", onRem);
    $("rem-time").addEventListener("change", onRem);
    $("exp-txt").addEventListener("click", function () { exportAs("txt"); });
    $("exp-csv").addEventListener("click", function () { exportAs("csv"); });
    $("exp-json").addEventListener("click", function () { exportAs("json"); });
    $("imp-btn").addEventListener("click", function () { $("imp-file").value = ""; $("imp-file").click(); });
    $("imp-file").addEventListener("change", function () { importFile($("imp-file").files[0]); });
    VIEWS.forEach(function (v) { $("tab-" + v).addEventListener("click", function () { showView(v); }); });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { flush(); hiddenAt = Date.now(); return; }
      if (lockRec && !locked && hiddenAt && Date.now() - hiddenAt >= RELOCK_MS) { hiddenAt = 0; showLock(); return; }
      hiddenAt = 0;
      if (day > todayYmd() || (!editTimer && !longTimer && document.activeElement !== $("line") && document.activeElement !== $("long-md"))) renderDay();   // a new day may have started
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    loadLock();
    applyI18n();
    inheritPalette();
    day = C.writingDay(data, new Date()).day;
    wire();
    registerSync();
    watchPalette();
    renderDay();
    showView(prefs.view);
    var opened = false;
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("diary");
        if (pending) { openTarget(pending); opened = true; }
      }
    } catch (e) {}
    if (lockRec) { showLock(); return; }       // device-local privacy screen (7d)
    if (!opened && view === "today" && !lineOf(day)) $("line").focus();
  }

  boot();
})();
