// ============================================================
// orOS single apps (solo.js)
// ------------------------------------------------------------
// "orOS Notes", "orOS Calendar", ... : one orOS app installed on its
// own (own icon, name and window), offline first, with the same
// encrypted sync as orOS when the person turns it on.
//
// How it is built (Chris 2026-10-14, thread "Companion apps orOS"):
//   /<id>/solo.html   the installed page. Its own manifest
//                     (/<id>/manifest.webmanifest, scope /<id>/) gives
//                     the separate icon, name, shortcuts, file types
//                     and share target. The page holds nothing but a
//                     full-window frame (host(), below).
//   /?solo=<id>       inside that frame: the real orOS shell in solo
//                     mode. Same files, same sync engine, same app
//                     code as orOS: no second copy of any app, of the
//                     encryption or of the merges. The shell shows only
//                     that app (no desktop, menu or Dock); another app
//                     opened from it (Settings, a link) gets a Back.
// Same origin as orOS, so on a device that has both they share the
// data at once; on a device with only the single app the data stays
// local until the person connects the cloud in Settings › Sync.
//
// The window that is NOT the frame (the host) forwards what only a
// top-level page receives: launch parameters (shortcuts, Share, "Open
// with"), launchQueue files and the icon badge.
//
// Shared by the host page, the shell (window.orosSolo) and node tests.
// ============================================================
(function (root) {
  "use strict";

  // The apps that ship as single apps. Each needs /<id>/solo.html,
  // /<id>/manifest.webmanifest and icons/solo/<id>-*.png
  // (tests/solo.test.js keeps them in step with this table).
  //   shortcuts: long-press / right-click menu of the app icon. "do"
  //     is the word in the shortcut URL (/<id>/solo.html?do=<word>);
  //     target goes to the app through __orosOpenAt, calNew opens
  //     Calendar's New event on today.
  //   share: what a shared link or text becomes (shareTarget below).
  //   badge: what the icon badge counts (the shell's solo badge tick).
  var APPS = {
    notes: {
      shortcuts: [{ do: "new", target: { newPage: true } }],
      share: "note"
    },
    calendar: {
      shortcuts: [{ do: "new", calNew: true }],
      share: "event"
    },
    bookmarks: {
      shortcuts: [{ do: "add", target: { quickAdd: true } }],
      share: "link"
    },
    todo: {
      shortcuts: [{ do: "new", target: { quickAdd: true } }],
      share: "task",
      badge: "due"
    },
    // Wave 2: office apps.
    contacts: {
      shortcuts: [{ do: "new", target: { newContact: true } }],
      share: "contact"
    },
    writer: {
      shortcuts: [{ do: "new", target: { newBlank: true } }],
      share: "doc"
    },
    spreadsheet: {
      shortcuts: [{ do: "new", target: { newBlank: true } }],
      share: "sheet"
    },
    kanban: {
      shortcuts: [{ do: "new", target: { quickAdd: true } }],
      share: "card"
    },
    mindmap: {
      shortcuts: [{ do: "new", target: { newMap: true } }],
      share: "map"
    },
    wiki: {
      shortcuts: [{ do: "new", target: { newArt: {} } }],
      share: "article"
    },
    slides: {
      shortcuts: [{ do: "new", target: { newDeck: true } }],
      share: "outline"
    },
    // Wave 3: personal apps. Water, Diary, Mood, Health and Cycle take
    // no shares (nothing a shared text should become there).
    passwords: {
      shortcuts: [{ do: "gen", target: { gen: true } },
                  { do: "new", target: { newEntry: {} } }],
      share: "login"
    },
    budget: {
      shortcuts: [{ do: "new", target: { newTx: {} } }],
      share: "expense"
    },
    habits: {
      shortcuts: [{ do: "new", target: { add: true } }],
      share: "habit"
    },
    water: {
      shortcuts: [{ do: "glass", target: { sip: "glass" } }]
    },
    diary: {
      shortcuts: [{ do: "write", target: { write: true } }]
    },
    mood: {
      shortcuts: [{ do: "log", target: { checkin: true } }]
    },
    fitness: {
      shortcuts: [{ do: "log", target: { logNew: true } }],
      share: "workout"
    },
    health: {
      shortcuts: [{ do: "bp", target: { add: "bp" } },
                  { do: "wt", target: { add: "wt" } }]
    },
    cycle: {
      shortcuts: [{ do: "today", target: { today: true } }]
    },
    // Wave 4: tools and media.
    calculator: {
      shortcuts: [{ do: "sci", target: { mode: "sci" } },
                  { do: "graph", target: { mode: "graph" } }]
    },
    time: {
      shortcuts: [{ do: "timer", target: { pane: "timer" } },
                  { do: "stopwatch", target: { pane: "stopwatch" } },
                  { do: "alarms", target: { pane: "alarms" } }]
    },
    weather: {
      shortcuts: [{ do: "city", target: { addCity: true } }]
    },
    maps: {
      shortcuts: [{ do: "locate", target: { locate: true } },
                  { do: "park", target: { park: true } }],
      share: "place"
    },
    feeds: {
      shortcuts: [{ do: "add", target: { addBlank: true } }],
      share: "feed"
    },
    mail: {
      shortcuts: [{ do: "new", target: { compose: {} } }],
      share: "mail"
    },
    files: {
      // (no "Add files": a file picker needs a tap inside the page)
      shortcuts: [{ do: "folder", target: { newFolder: true } }]
    },
    podcasts: {
      shortcuts: [{ do: "find", target: { find: true } }],
      share: "podcast"
    },
    radio: {
      shortcuts: [{ do: "last", target: { play: "last" } }]
    },
    photolab: {
      // (no "Open a picture": a file picker needs a tap inside the page)
      shortcuts: [{ do: "new", target: { newPic: true } }]
    },
    // Wave 5: business.
    invoices: {
      shortcuts: [{ do: "invoice", target: { newDoc: "inv" } },
                  { do: "receipt", target: { newDoc: "rcpt" } }],
      share: "invoice"
    },
    crm: {
      shortcuts: [{ do: "new", target: { newCust: true } }],
      share: "customer"
    },
    timesheet: {
      shortcuts: [{ do: "timer", target: { toggle: true } },
                  { do: "entry", target: { newEntry: true } }]
    },
    // Wave 6: every game in one app (Game Center is its home; a game
    // opened from it gets Back). files: other apps whose file types
    // this app's icon also opens (fileopen.js still routes them).
    gamecenter: {
      shortcuts: [{ do: "wordle", target: { play: "wordle", daily: true } },
                  { do: "crossword", target: { play: "crossword", daily: true } },
                  { do: "sudoku", target: { play: "sudoku", daily: true } },
                  { do: "chess", target: { play: "chess" } }],
      files: ["chess"]
    }
  };

  // ---------- Words ----------
  // App and shortcut names ("name.<id>", "sc.<id>.<do>") and the bars of
  // the installed page. English and Greek here; any other language from
  // the "solo" pack (i18n/<code>/solo.js) when i18n.js is on the page.
  // The per-app manifests stay English (manifestFor).
  var STR = {
    en: { "name.notes": "orOS Notes",
          "sc.notes.new": "New page",
          "name.calendar": "orOS Calendar",
          "sc.calendar.new": "New event",
          "name.bookmarks": "orOS Bookmarks",
          "sc.bookmarks.add": "Add a bookmark",
          "name.todo": "orOS To-Do",
          "sc.todo.new": "New task",
          "name.contacts": "orOS Contacts",
          "sc.contacts.new": "New contact",
          "name.writer": "orOS Writer",
          "sc.writer.new": "New document",
          "name.spreadsheet": "orOS Spreadsheet",
          "sc.spreadsheet.new": "New sheet",
          "name.kanban": "orOS Kanban",
          "sc.kanban.new": "New card",
          "name.mindmap": "orOS Mind Map",
          "sc.mindmap.new": "New map",
          "name.wiki": "orOS Wiki",
          "sc.wiki.new": "New article",
          "name.slides": "orOS Slides",
          "sc.slides.new": "New presentation",
          "name.passwords": "orOS Passwords",
          "sc.passwords.gen": "Generate a password",
          "sc.passwords.new": "New vault entry",
          "name.budget": "orOS Budget",
          "sc.budget.new": "New expense",
          "name.habits": "orOS Habits",
          "sc.habits.new": "New habit",
          "name.water": "orOS Water",
          "sc.water.glass": "Add a glass",
          "name.diary": "orOS Diary",
          "sc.diary.write": "Write today's sentence",
          "name.mood": "orOS Mood",
          "sc.mood.log": "Log my mood",
          "name.fitness": "orOS Workouts",
          "sc.fitness.log": "Log a workout",
          "name.health": "orOS Health",
          "sc.health.bp": "New blood pressure",
          "sc.health.wt": "New weight",
          "name.cycle": "orOS Cycle",
          "sc.cycle.today": "Log today",
          "name.calculator": "orOS Calculator",
          "sc.calculator.sci": "Scientific",
          "sc.calculator.graph": "Graphs",
          "name.time": "orOS Time",
          "sc.time.timer": "Timer",
          "sc.time.stopwatch": "Stopwatch",
          "sc.time.alarms": "Alarms",
          "name.weather": "orOS Weather",
          "sc.weather.city": "Add a city",
          "name.maps": "orOS Maps",
          "sc.maps.locate": "My location",
          "sc.maps.park": "Where I parked",
          "name.feeds": "orOS Reader",
          "sc.feeds.add": "Add a feed",
          "name.mail": "orOS Mail",
          "sc.mail.new": "New mail",
          "name.files": "orOS Files",
          "sc.files.folder": "New folder",
          "name.podcasts": "orOS Podcasts",
          "sc.podcasts.find": "Find a podcast",
          "name.radio": "orOS Radio",
          "sc.radio.last": "Play the last station",
          "name.photolab": "orOS Photo Lab",
          "sc.photolab.new": "New picture",
          "name.invoices": "orOS Invoices",
          "sc.invoices.invoice": "New invoice",
          "sc.invoices.receipt": "New receipt",
          "name.crm": "orOS CRM",
          "sc.crm.new": "New customer",
          "name.timesheet": "orOS Timesheet",
          "sc.timesheet.timer": "Start or stop the timer",
          "sc.timesheet.entry": "New time entry",
          "name.gamecenter": "orOS Games",
          "sc.gamecenter.wordle": "Today's Wordle",
          "sc.gamecenter.crossword": "Today's crossword",
          "sc.gamecenter.sudoku": "Today's Sudoku",
          "sc.gamecenter.chess": "Chess",
          "apk.note": "A new version of the {n} app is out. Update it where you installed it from (F-Droid, Droid-ify or Obtainium), or download the APK.",
          "apk.get": "Download",
          "apk.close": "Close",
          "bar.ask": "Install {n} on this device",
          "bar.btn": "Install",
          "bar.how": "To install {n}: open the browser menu (⋮) and choose Install app or Add to Home screen.",
          "bar.close": "Close",
          "bar.win": "{n} opened inside an installed app, where it can't be installed. If it isn't installed yet, open this page in Chrome or Edge.",
          "bar.chrome": "Open in Chrome",
          "bar.apk": "Download the app (APK)" },
    el: { "name.notes": "orOS Σημειώσεις",
          "sc.notes.new": "Νέα σελίδα",
          "name.calendar": "orOS Ημερολόγιο",
          "sc.calendar.new": "Νέο συμβάν",
          "name.bookmarks": "orOS Σελιδοδείκτες",
          "sc.bookmarks.add": "Νέος σελιδοδείκτης",
          "name.todo": "orOS Εργασίες",
          "sc.todo.new": "Νέα εργασία",
          "name.contacts": "orOS Επαφές",
          "sc.contacts.new": "Νέα επαφή",
          "name.writer": "orOS Κειμενογράφος",
          "sc.writer.new": "Νέο έγγραφο",
          "name.spreadsheet": "orOS Υπολογιστικά φύλλα",
          "sc.spreadsheet.new": "Νέο φύλλο",
          "name.kanban": "orOS Πίνακες Kanban",
          "sc.kanban.new": "Νέα κάρτα",
          "name.mindmap": "orOS Νοητικός χάρτης",
          "sc.mindmap.new": "Νέος χάρτης",
          "name.wiki": "orOS Wiki",
          "sc.wiki.new": "Νέο άρθρο",
          "name.slides": "orOS Παρουσιάσεις",
          "sc.slides.new": "Νέα παρουσίαση",
          "name.passwords": "orOS Κωδικοί",
          "sc.passwords.gen": "Νέος κωδικός",
          "sc.passwords.new": "Νέα καταχώριση",
          "name.budget": "orOS Έσοδα & Έξοδα",
          "sc.budget.new": "Νέο έξοδο",
          "name.habits": "orOS Συνήθειες",
          "sc.habits.new": "Νέα συνήθεια",
          "name.water": "orOS Νερό",
          "sc.water.glass": "Ένα ποτήρι",
          "name.diary": "orOS Ημερολόγιο μιας πρότασης",
          "sc.diary.write": "Η σημερινή πρόταση",
          "name.mood": "orOS Διάθεση",
          "sc.mood.log": "Πώς νιώθω",
          "name.fitness": "orOS Προπόνηση",
          "sc.fitness.log": "Νέα προπόνηση",
          "name.health": "orOS Υγεία",
          "sc.health.bp": "Νέα πίεση",
          "sc.health.wt": "Νέο βάρος",
          "name.cycle": "orOS Κύκλος",
          "sc.cycle.today": "Καταγραφή σήμερα",
          "name.calculator": "orOS Αριθμομηχανή",
          "sc.calculator.sci": "Επιστημονική",
          "sc.calculator.graph": "Γραφήματα",
          "name.time": "orOS Ώρα",
          "sc.time.timer": "Αντίστροφη μέτρηση",
          "sc.time.stopwatch": "Χρονόμετρο",
          "sc.time.alarms": "Ξυπνητήρια",
          "name.weather": "orOS Καιρός",
          "sc.weather.city": "Νέα πόλη",
          "name.maps": "orOS Χάρτες",
          "sc.maps.locate": "Η θέση μου",
          "sc.maps.park": "Πού πάρκαρα",
          "name.feeds": "orOS Αναγνώστης",
          "sc.feeds.add": "Νέα ροή",
          "name.mail": "orOS Αλληλογραφία",
          "sc.mail.new": "Νέο μήνυμα",
          "name.files": "orOS Αρχεία",
          "sc.files.folder": "Νέος φάκελος",
          "name.podcasts": "orOS Podcasts",
          "sc.podcasts.find": "Εύρεση podcast",
          "name.radio": "orOS Ραδιόφωνο",
          "sc.radio.last": "Ο τελευταίος σταθμός",
          "name.photolab": "orOS Εργαστήριο εικόνας",
          "sc.photolab.new": "Νέα εικόνα",
          "name.invoices": "orOS Τιμολόγια",
          "sc.invoices.invoice": "Νέο τιμολόγιο",
          "sc.invoices.receipt": "Νέα απόδειξη",
          "name.crm": "orOS Πελάτες",
          "sc.crm.new": "Νέος πελάτης",
          "name.timesheet": "orOS Ώρες εργασίας",
          "sc.timesheet.timer": "Έναρξη ή διακοπή χρονομέτρου",
          "sc.timesheet.entry": "Νέα καταχώριση",
          "name.gamecenter": "orOS Παιχνίδια",
          "sc.gamecenter.wordle": "Το σημερινό Wordle",
          "sc.gamecenter.crossword": "Το σημερινό σταυρόλεξο",
          "sc.gamecenter.sudoku": "Το σημερινό Sudoku",
          "sc.gamecenter.chess": "Σκάκι",
          "apk.note": "Βγήκε νέα έκδοση της εφαρμογής {n}. Ενημέρωσέ τη από εκεί που την εγκατέστησες (F-Droid, Droid-ify ή Obtainium) ή κατέβασε το APK.",
          "apk.get": "Λήψη",
          "apk.close": "Κλείσιμο",
          "bar.ask": "Εγκατάσταση του {n} σε αυτή τη συσκευή",
          "bar.btn": "Εγκατάσταση",
          "bar.how": "Για να εγκαταστήσεις το {n}: άνοιξε το μενού του browser (⋮) και πάτησε Εγκατάσταση εφαρμογής ή Προσθήκη στην αρχική οθόνη.",
          "bar.close": "Κλείσιμο",
          "bar.win": "Το {n} άνοιξε μέσα σε εγκατεστημένη εφαρμογή, όπου δεν γίνεται εγκατάσταση. Αν δεν το έχεις ήδη εγκαταστήσει, άνοιξε αυτή τη σελίδα στο Chrome ή στο Edge.",
          "bar.chrome": "Άνοιγμα στο Chrome",
          "bar.apk": "Λήψη της εφαρμογής (APK)" }
  };
  // The { en, el } name pairs on APPS, from the table, for the build
  // tools that read them (android/tools/gen.js: widget labels).
  Object.keys(APPS).forEach(function (id) {
    APPS[id].name = { en: STR.en["name." + id], el: STR.el["name." + id] };
    (APPS[id].shortcuts || []).forEach(function (s) {
      s.name = { en: STR.en["sc." + id + "." + s.do], el: STR.el["sc." + id + "." + s.do] };
    });
  });
  // One string in language l (en, el or a pack language), else English.
  function tt(key, l) {
    var I = root && root.orosI18n, tb = STR.en;
    if (l === "en" || l === "el") tb = STR[l];
    else if (I && I.known(l)) tb = I.table(STR, "solo", l);
    return tb[key] !== undefined ? tb[key] : (STR.en[key] || "");
  }
  // The language the person chose (the shell's, else the stored one).
  function storedLang(win) {
    var I = root && root.orosI18n;
    if (I) return I.lang();
    var l = "en";
    try { l = win.localStorage.getItem("oros-lang") || "en"; } catch (e) {}
    return l;
  }

  var ID_RE = /^[a-z0-9-]{1,40}$/;
  // Launch parameters the host hands to the shell frame unchanged
  // (each one is checked again where it is used).
  var FORWARD = ["do", "share-url", "share-title", "share-text", "share-files", "file-open"];
  var MAX_PARAM = 4000;

  function has(id) {
    return typeof id === "string" && ID_RE.test(id) && Object.prototype.hasOwnProperty.call(APPS, id);
  }
  function ids() { return Object.keys(APPS); }
  function nameOf(id, l) { return has(id) ? tt("name." + id, l) : ""; }

  // The installed page's path: "/notes/solo.html" → "notes".
  function idFromPath(pathname) {
    var m = /^\/([a-z0-9-]+)\/solo\.html$/.exec(String(pathname || ""));
    return m && has(m[1]) ? m[1] : "";
  }
  // The shell frame's address: "?solo=notes" → "notes".
  function idFromSearch(search) {
    var v = "";
    try { v = new URLSearchParams(String(search || "")).get("solo") || ""; } catch (e) { v = ""; }
    return has(v) ? v : "";
  }

  // Host → shell frame address. Only the FORWARD keys travel, each
  // bounded; "solo" itself stays in the frame's address so the update
  // broker's reload comes back in solo mode.
  function frameSrc(id, search) {
    if (!has(id)) return "";
    var q, out = new URLSearchParams();
    try { q = new URLSearchParams(String(search || "")); } catch (e) { q = new URLSearchParams(); }
    out.set("solo", id);
    FORWARD.forEach(function (k) {
      var v = q.get(k);
      if (typeof v === "string" && v) out.set(k === "do" ? "solo-do" : k, v.slice(0, MAX_PARAM));
    });
    return "/?" + out.toString();
  }

  // Shortcut word → what to open. null = just the app.
  function shortcut(id, word) {
    if (!has(id) || typeof word !== "string") return null;
    var list = APPS[id].shortcuts || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].do === word) return list[i];
    }
    return null;
  }

  function ymd(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function clean(v, max) {
    return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
  }
  function httpUrl(v) {
    try {
      var u = new URL(String(v || "").trim());
      return (u.protocol === "http:" || u.protocol === "https:") && u.href.length <= 2048 ? u.href : "";
    } catch (e) { return ""; }
  }

  // Share params (?share-url / share-title / share-text, the shape
  // sw.js and the browser add-on use) → { url, title, text } or null.
  function shareFromSearch(search) {
    var q;
    try { q = new URLSearchParams(String(search || "")); } catch (e) { return null; }
    if (!q.has("share-url") && !q.has("share-title") && !q.has("share-text")) return null;
    var text = clean(q.get("share-text"), 20000);
    var url = httpUrl(q.get("share-url"));
    if (!url) {
      var m = text.match(/https?:\/\/[^\s<>"']+/i);
      if (m) url = httpUrl(m[0]);
    }
    var title = clean(q.get("share-title"), 256);
    if (!title && !url && !text) return null;
    return { url: url, title: title, text: text };
  }

  // A share → where it goes in this single app:
  //   { app, target }        through __orosOpenAt
  //   { calNew: payload }    Calendar's New event dialog
  //   null                   nothing usable (e.g. Bookmarks without a link)
  // Nothing is saved here: every app opens its own dialog or page.
  function shareTarget(id, s, now) {
    if (!has(id) || !s) return null;
    var kind = APPS[id].share;
    var url = s.url || "", title = s.title || "", text = s.text || "";
    var bodyText = text;
    if (url && bodyText.indexOf(url) === -1) bodyText = (bodyText ? bodyText + "\n\n" : "") + url;
    var firstLine = (title || text.replace(url, "").split(/\r?\n/)[0] || url).replace(/\s+/g, " ").trim();
    if (kind === "link") {
      if (!url) return null;
      return { app: id, target: { add: { url: url, title: (title || text.replace(url, "")).replace(/\s+/g, " ").trim().slice(0, 256) } } };
    }
    if (kind === "note") {
      return { app: id, target: { add: { title: firstLine.slice(0, 200), text: bodyText.slice(0, 20000) } } };
    }
    if (kind === "task") {
      if (!firstLine) return null;
      var note = bodyText.replace(firstLine, "").trim();
      return { app: id, target: { addItems: { items: [{ text: firstLine.slice(0, 500), note: note.slice(0, 2000) }] } } };
    }
    if (kind === "event") {
      if (!firstLine) return null;
      var date = ymd(now instanceof Date ? now : new Date());
      return { calNew: { date: date, title: firstLine.slice(0, 80), note: bodyText.replace(firstLine, "").trim().slice(0, 500) } };
    }
    // Wave 2. Each one only opens a form, dialog or new item the
    // person then keeps or drops.
    var rest = bodyText.replace(firstLine, "").trim();
    if (kind === "contact") {
      // Contacts' card reader (cardtext.js) places the lines.
      var card = ((title ? title + "\n" : "") + bodyText).trim();
      return card ? { app: id, target: { cardText: { text: card.slice(0, 4000) } } } : null;
    }
    if (kind === "doc") {
      return bodyText.trim() ? { app: id, target: { newDoc: { title: firstLine.slice(0, 120), text: bodyText } } } : null;
    }
    if (kind === "sheet") {
      // One row per line, cells split on tabs (a copied table) or else
      // on commas.
      var rows = bodyText.split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 1000).map(function (l) {
        return l.split(l.indexOf("\t") !== -1 ? "\t" : ",").slice(0, 100).map(function (c) { return c.trim().slice(0, 500); });
      });
      return rows.length ? { app: id, target: { newSheet: { name: title.slice(0, 31), rows: rows } } } : null;
    }
    if (kind === "card") {
      if (!firstLine) return null;
      return { app: id, target: { asNew: { title: firstLine.slice(0, 500), note: rest.slice(0, 5000) } } };
    }
    if (kind === "map") {
      // Lines become branches (Mind map's paste dialog, filled in).
      var lines = (title && bodyText.indexOf(title) !== 0 ? title + "\n" : "") + bodyText;
      return lines.trim() ? { app: id, target: { pasteText: { text: lines.slice(0, 20000) } } } : null;
    }
    if (kind === "article") {
      if (!firstLine) return null;
      return { app: id, target: { newArt: { title: firstLine.slice(0, 200), text: (title ? bodyText : rest).slice(0, 20000) } } };
    }
    // Wave 3.
    if (kind === "login") {
      return url ? { app: id, target: { newEntry: { title: (title || firstLine.replace(url, "").trim() || url).slice(0, 200), url: url } } } : null;
    }
    if (kind === "expense") {
      return firstLine ? { app: id, target: { newTx: { n: firstLine.slice(0, 140) } } } : null;
    }
    if (kind === "habit") {
      return firstLine ? { app: id, target: { asNew: { name: firstLine.slice(0, 80) } } } : null;
    }
    if (kind === "workout") {
      return bodyText.trim() ? { app: id, target: { asNew: { note: bodyText.slice(0, 2000) } } } : null;
    }
    // Wave 4.
    if (kind === "place") {
      // geo:lat,lon (the Android share of a place) → a pin; otherwise
      // the title or first line is searched (never a bare web address).
      var g = /geo:(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i.exec(text + " " + s.title);
      var q = (title || firstLine).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (g && Math.abs(+g[1]) <= 90 && Math.abs(+g[2]) <= 180) {
        return { app: id, target: { asNew: { name: q || g[1] + ", " + g[2], lat: +g[1], lon: +g[2] } } };
      }
      return q ? { app: id, target: { asNew: { name: q, query: q } } } : null;
    }
    if (kind === "feed" || kind === "podcast") {
      return url ? { app: id, target: { add: { url: url } } } : null;
    }
    if (kind === "mail") {
      return bodyText.trim() || title ? { app: id, target: { compose: { subject: (title || firstLine).slice(0, 300), body: bodyText.slice(0, 20000) } } } : null;
    }
    // Wave 5.
    if (kind === "invoice") {
      // The shared text becomes a new invoice's notes (saved only if
      // the person saves it).
      var notes = ((title && bodyText.indexOf(title) !== 0 ? title + "\n" : "") + bodyText).trim();
      return notes ? { app: id, target: { newDoc: "inv", notes: notes.slice(0, 500) } } : null;
    }
    if (kind === "customer") {
      // First line = the name, an e-mail or phone found in the text
      // fills its field, the rest becomes the note.
      if (!firstLine) return null;
      var em = /[^\s<>()",;:]+@[^\s<>()",;:]+\.[a-z]{2,}/i.exec(text);
      var ph = /\+?\d[\d ().-]{6,}\d/.exec(bodyText);
      var nm = firstLine.replace(em ? em[0] : "\u0000", "").replace(/[<>]/g, "").trim() || (em ? em[0].split("@")[0] : "");
      var c = { name: nm.slice(0, 120), note: rest.slice(0, 2000) };
      if (em) c.email = em[0].slice(0, 120);
      if (ph) c.phone = ph[0].trim().slice(0, 40);
      return c.name ? { app: id, target: { asNew: c } } : null;
    }
    if (kind === "outline") {
      // A titled share starts with its title slide ("# title").
      var outline = (title ? "# " + title + "\n" : "") + bodyText;
      return outline.trim() ? { app: id, target: { outline: outline.slice(0, 20000), title: firstLine.slice(0, 120) } } : null;
    }
    return null;
  }

  // Per-app manifest (what tests/solo.test.js expects each
  // /<id>/manifest.webmanifest to hold). handlers = fileopen.js
  // table(); base = orOS's own manifest, for colours and categories.
  function manifestFor(id, handlers, base) {
    if (!has(id)) return null;
    var a = APPS[id], scope = "/" + id + "/", page = scope + "solo.html";
    var icon = "/icons/solo/" + id;
    var m = {
      name: STR.en["name." + id],
      short_name: STR.en["name." + id].replace(/^orOS /, ""),
      description: STR.en["name." + id] + ": the orOS app on its own. Works offline, no cookies, no tracking; encrypted sync only if you turn it on.",
      id: page,
      start_url: page,
      scope: scope,
      display: "standalone",
      orientation: "any",
      background_color: (base && base.background_color) || "#14120d",
      theme_color: (base && base.theme_color) || "#1b1a18",
      icons: [
        { src: icon + ".svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: icon + "-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: icon + "-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: icon + "-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
      ],
      lang: "en",
      dir: "ltr",
      categories: (base && base.categories) || ["productivity"],
      shortcuts: (a.shortcuts || []).map(function (s) {
        var sn = STR.en["sc." + id + "." + s.do];
        return { name: sn, short_name: sn, url: page + "?do=" + s.do,
                 icons: [{ src: icon + "-192.png", sizes: "192x192", type: "image/png" }] };
      })
    };
    var accept = {}, exts = [];
    (handlers || []).forEach(function (h) {
      if (h.app !== id && (a.files || []).indexOf(h.app) < 0) return;
      Object.keys(h.accept).forEach(function (mime) {
        accept[mime] = h.accept[mime].slice();
        exts = exts.concat(mime, h.accept[mime]);
      });
    });
    if (Object.keys(accept).length) {
      m.file_handlers = [{ action: page + "?file-open=" + id, accept: accept }];
    }
    // An app with nothing a shared text or file could become gets no
    // share target.
    if (!a.share && !exts.length) return m;
    var share = {
      action: page + "?share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" }
    };
    if (exts.length) share.params.files = [{ name: "files", accept: exts }];
    m.share_target = share;
    return m;
  }

  // The installed page, /<id>/solo.html (base = orOS's manifest).
  function pageFor(id, base) {
    if (!has(id)) return "";
    var name = nameOf(id, "en");
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="UTF-8">',
      "  <!-- The installed single app \"" + name + "\" (solo.js): its own manifest,",
      "       icon and window; the page frames the orOS shell in solo mode. -->",
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
      "  <title>" + name + "</title>",
      '  <link rel="manifest" href="manifest.webmanifest">',
      '  <meta name="theme-color" content="' + base.theme_color + '">',
      '  <link rel="icon" href="/icons/solo/' + id + '.svg" type="image/svg+xml">',
      '  <link rel="apple-touch-icon" href="/icons/solo/' + id + '-192.png">',
      '  <meta name="mobile-web-app-capable" content="yes">',
      '  <meta name="apple-mobile-web-app-capable" content="yes">',
      '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '  <meta name="apple-mobile-web-app-title" content="' + name + '">',
      "  <style>html,body{margin:0;height:100%;overflow:hidden;background:" + base.background_color + "}" +
        "#solo-frame{display:block;border:0;width:100%;height:100%}</style>",
      "</head>",
      "<body>",
      '  <script src="/i18n.js" data-app="solo"></script>',   // the install bar in pack languages
      '  <script src="/solo.js"></script>',
      "  <script>window.orosSolo.hostBoot(window);</script>",
      "</body>",
      "</html>",
      ""
    ].join("\n");
  }

  // ---------- Host: the installed page (/<id>/solo.html) ----------
  // Settings › Single apps › Install: the address that opens the
  // single app's page where it can be installed. On Android an https
  // link on this origin is captured by the orOS app (TWA or the
  // installed orOS), which then shows the single app inside orOS with
  // no way to install it; an intent addressed to Chrome opens it in a
  // Chrome tab instead (browser_fallback_url: other browsers).
  // "?install" makes the page offer its Install bar at once.
  // inApp: the page runs in the orOS Android app (its phone bridge is
  // connected). An intent to Chrome from there comes back to the app,
  // so the app's own activity opens the page in Chrome.
  // inTab: the caller runs in a browser tab (display-mode browser). That
  // browser can install the page itself and no app catches the link, so
  // the plain address is used: an intent to Chrome does nothing in a
  // browser that blocks intents (Brave) or on a phone without Chrome.
  // Android package of a single app (android/solo-apps.json builds one per
  // app; CI publishes it as oros-<id>.apk on the "android-apks" release).
  // On Android an installed orOS claims every page of this site, so the
  // browser cannot install a single app next to it: the APK can.
  var APK_BASE = "https://github.com/koulaxizis/oros/releases/download/android-apks/";
  function apkUrl(id) { return has(id) ? APK_BASE + "oros-" + id + ".apk" : ""; }
  // The link an APK button uses. Inside an installed app on Android (the
  // orOS app, a Chrome-installed orOS or single app) a link to GitHub
  // opens in the browser's in-app tab, where an APK download stops at
  // 100% and never finishes (Chris 2026-10-15, Brave; a plain browser
  // tab works in every browser). There the link asks Chrome for a real
  // tab; without Chrome the in-app tab opens as before.
  // apkPkg: the orOS Android package this window runs in (the orOS app or
  // a single app's APK), when known: its BrowserActivity opens the link in
  // the person's default browser, in a normal tab (APKs built before
  // 2.30.01 lack it, and the link then opens as before). Otherwise
  // (Chrome's installed orOS) an intent asks Chrome for a real tab.
  function apkHref(id, ua, inWindow, apkPkg) {
    var u = id === "oros" ? APK_BASE + "oros.apk" : apkUrl(id);
    if (!u || !inWindow || !/Android/i.test(String(ua || ""))) return u;
    if (apkPkg) return browserHref(u, apkPkg);
    return "intent://" + u.replace(/^https:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
      encodeURIComponent(u) + ";end";
  }

  // An orOS link (APK, download page, F-Droid repo) opened through the
  // app's BrowserActivity: the default browser, a normal tab. Fallback:
  // the link itself (an APK without BrowserActivity, or none installed).
  function browserHref(url, pkg) {
    if (!/^online\.useoros\.[a-z]+$/.test(String(pkg || ""))) return url;
    return "intent://open?u=" + encodeURIComponent(url) + "#Intent;scheme=oros-browser;package=" + pkg +
      ";S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
  }
  // The orOS Android package this top window runs in, or "": the start
  // address told it (?apk=, remembered in "oros-apk") or the TWA's
  // referrer says so, and the window is not a browser tab.
  function apkPkgOf(win, id) {
    var pkg = pkgOf(id);
    if (!pkg) return "";
    try { if (win.matchMedia("(display-mode: browser)").matches) return ""; } catch (e) { return ""; }
    try { if (String(win.document.referrer || "").indexOf("android-app://" + pkg) === 0) return pkg; } catch (e) {}
    try {
      var st = JSON.parse(win.localStorage.getItem("oros-apk") || "{}") || {};
      if (st.installed && st.installed[pkg]) return pkg;
    } catch (e) {}
    return "";
  }

  // App updates for the APKs (FDROID-1): CI (.github/workflows/fdroid.yml)
  // publishes them as an F-Droid repository on koulaxizis/oros-fdroid's
  // GitHub Pages whenever the Android shell changes. F-Droid, Droid-ify
  // and Obtainium then update them; versions.json next to it lets the
  // app itself say once that a newer APK is out. The APK's start
  // address carries its versionCode (android/tools/gen.js: ?apk=<code>).
  var REPO_SITE = "https://koulaxizis.github.io/oros-fdroid";
  var REPO = REPO_SITE + "/repo";
  var REPO_FP = "2A066758DF27F6AFDF6D96F72D575E3E04844B9F85A22A54B7F2C03905A11846";
  var MAIN_PKG = "online.useoros.twa";
  // Packages whose last word is not the app id (android/solo-apps.json)
  var PKG_WORD = { feeds: "reader", fitness: "workouts", gamecenter: "games" };
  function pkgOf(id) {
    if (id === "oros") return MAIN_PKG;
    return has(id) ? "online.useoros." + (PKG_WORD[id] || id) : "";
  }
  // Opens F-Droid or Droid-ify with the orOS repository ready to add
  function repoLink() { return "fdroidrepos://" + REPO.replace(/^https:\/\//, "") + "?fingerprint=" + REPO_FP; }
  function obtainiumLink(id) { var p = pkgOf(id); return p ? "obtainium://add/" + REPO + "?appId=" + p : ""; }
  function apkCode(search) {
    var v = "";
    try { v = new URLSearchParams(String(search || "")).get("apk") || ""; } catch (e) { v = ""; }
    return /^\d{1,10}$/.test(v) ? Number(v) : 0;
  }


  var APK_KEY = "oros-apk";           // { installed: {pkg: code}, seen: {pkg: code}, repo: {at, v} }
  var DAY = 864e5;
  // Remembers the installed versionCode (when the launch carried it) and,
  // at most once a day, asks the repo for the published one. A newer one
  // is told once per version, in a bar that closes for good.
  function apkNotice(win, id, code) {
    var pkg = pkgOf(id), st = {}, ls = null;
    if (!pkg) return;
    try { ls = win.localStorage; st = JSON.parse(ls.getItem(APK_KEY) || "{}") || {}; } catch (e) { return; }
    st.installed = st.installed || {};
    st.seen = st.seen || {};
    if (code) st.installed[pkg] = code;
    function save() { try { ls.setItem(APK_KEY, JSON.stringify(st)); } catch (e) {} }
    save();
    var have = st.installed[pkg];
    if (!have) return;              // not the APK (a browser-installed app)
    function check(v) {
      var pub = v && Number(v[pkg]);
      if (!pub || pub <= have || st.seen[pkg] === pub) return;
      st.seen[pkg] = pub;
      save();
      showApkBar(win, id);
    }
    var r = st.repo;
    if (r && r.v && Date.now() - r.at < DAY) { check(r.v); return; }
    if (typeof win.fetch !== "function") return;
    win.fetch(REPO_SITE + "/versions.json", { cache: "no-store" }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (v) {
      if (!v || typeof v !== "object") return;
      st.repo = { at: Date.now(), v: v };
      save();
      check(v);
    }, function () {});
  }
  function showApkBar(win, id) {
    var doc = win.document, lng = storedLang(win);
    function T(k) { return tt("apk." + k, lng); }
    var bar = doc.createElement("div");
    bar.id = "solo-apk";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483000;display:flex;gap:8px;align-items:center;" +
      "padding:10px 12px;border-radius:12px;background:#2a2721;color:#f2ead8;font:14px/1.35 system-ui,sans-serif;" +
      "box-shadow:0 4px 18px rgba(0,0,0,.45)";
    var txt = doc.createElement("span");
    txt.style.flex = "1";
    txt.textContent = T("note").replace("{n}", id === "oros" ? "orOS" : nameOf(id, lng));
    bar.appendChild(txt);
    var a = doc.createElement("a");
    a.href = apkHref(id, win.navigator.userAgent, true, pkgOf(id));
    a.rel = "noopener";
    a.textContent = T("get");
    a.style.cssText = "border-radius:8px;padding:8px 14px;background:#c8a96e;color:#1b1a18;font-weight:600;text-decoration:none;white-space:nowrap";
    bar.appendChild(a);
    var x = doc.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", T("close"));
    x.style.cssText = "border:0;background:none;color:inherit;font-size:22px;line-height:1;padding:2px 6px";
    function close() { bar.remove(); }
    x.addEventListener("click", close);
    a.addEventListener("click", close);
    bar.appendChild(x);
    doc.body.appendChild(bar);
  }

  function installUrl(id, ua, origin, inApp, inTab) {
    if (!has(id)) return "";
    if (inApp) return "intent://install/" + id + "#Intent;scheme=oros-permission;package=online.useoros.twa;end";
    var page = "/" + id + "/solo.html?install";
    if (inTab) return page;
    var m = /^https:\/\/([^\/?#]+)$/.exec(String(origin || ""));
    if (!/Android/i.test(String(ua || "")) || !m) return page;
    return "intent://" + m[1] + page + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
      encodeURIComponent(origin + page) + ";end";
  }

  // The Install bar of the single app's page in a browser tab: Chrome
  // and Edge hand over their install prompt (beforeinstallprompt), the
  // bar's button shows it. Without one (another browser, or not yet
  // offered) a page opened with "?install" says where the browser keeps
  // its Install item. Gone in the installed app (display-mode not
  // "browser") and once installed. A "?install" link that opened in an
  // app window instead (on Android the installed orOS or the orOS app
  // takes every link to this site) says so, with an "Open in Chrome"
  // button on Android.

  function installBar(win, id, asked) {
    var doc = win.document, bar = null, deferred = null, lng = storedLang(win), inWindow = false;
    try { inWindow = !win.matchMedia("(display-mode: browser)").matches; } catch (e) { return; }
    if (inWindow && !asked) return;
    var name = nameOf(id, lng);
    var T = {};
    ["ask", "btn", "how", "close", "win", "chrome", "apk"].forEach(function (k) { T[k] = tt("bar." + k, lng); });
    function close() { if (bar) { bar.remove(); bar = null; } }
    function show(withButton) {
      close();
      bar = doc.createElement("div");
      bar.id = "solo-install";
      bar.setAttribute("role", "status");
      bar.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:10;display:flex;gap:8px;align-items:center;" +
        "padding:10px 12px;border-radius:12px;background:#2a2721;color:#f2ead8;font:14px/1.35 system-ui,sans-serif;" +
        "box-shadow:0 4px 18px rgba(0,0,0,.45)";
      var txt = doc.createElement("span");
      txt.style.flex = "1";
      txt.textContent = (withButton === "win" ? T.win : withButton ? T.ask : T.how).replace("{n}", name);
      bar.appendChild(txt);
      // Only the orOS Android app (TWA) can hand the page to Chrome: in
      // Chrome's own installed orOS an intent to Chrome comes straight
      // back to the same app window, so there the text alone is shown.
      var inApp = false;
      if (withButton === "win" && /Android/i.test(win.navigator.userAgent || "")) {
        try {
          var fw = doc.getElementById("solo-frame").contentWindow;
          inApp = !!(fw.orosPhone && fw.orosPhone.available());
        } catch (e) {}
      }
      if (inApp) {
        var a = doc.createElement("a");
        a.href = installUrl(id, win.navigator.userAgent, win.location.origin, inApp);
        a.textContent = T.chrome;
        a.style.cssText = "border-radius:8px;padding:8px 14px;background:#c8a96e;color:#1b1a18;font-weight:600;text-decoration:none;white-space:nowrap";
        bar.appendChild(a);
      } else if (withButton === "win" && /Android/i.test(win.navigator.userAgent || "")) {
        // Chrome's installed orOS took the link: the APK installs it
        var k = doc.createElement("a");
        k.href = apkHref(id, win.navigator.userAgent, true);
        k.textContent = T.apk;
        k.style.cssText = "border-radius:8px;padding:8px 14px;background:#c8a96e;color:#1b1a18;font-weight:600;text-decoration:none;white-space:nowrap";
        bar.appendChild(k);
      } else if (withButton === true) {
        var b = doc.createElement("button");
        b.type = "button";
        b.textContent = T.btn;
        b.style.cssText = "border:0;border-radius:8px;padding:8px 14px;background:#c8a96e;color:#1b1a18;font:inherit;font-weight:600";
        b.addEventListener("click", function () {
          var d = deferred;
          deferred = null;
          if (!d) { show(false); return; }
          try { d.prompt(); } catch (e) { show(false); return; }
          if (d.userChoice) d.userChoice.then(function (r) { if (r && r.outcome === "accepted") close(); }, function () {});
        });
        bar.appendChild(b);
      }
      var x = doc.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", T.close);
      x.style.cssText = "border:0;background:none;color:inherit;font-size:22px;line-height:1;padding:2px 6px";
      x.addEventListener("click", close);
      bar.appendChild(x);
      doc.body.appendChild(bar);
    }
    if (inWindow) { setTimeout(function () { show("win"); }, 1500); return; }
    win.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      show(true);
    });
    win.addEventListener("appinstalled", close);
    if (asked) setTimeout(function () { if (!deferred && !bar) show(false); }, 4000);
  }

  function host(win) {
    var doc = win.document;
    var id = idFromPath(win.location.pathname);
    if (!id) { win.location.replace("/"); return; }
    var asked = /(^|[?&])install(=|&|$)/.test(win.location.search);
    var code = apkCode(win.location.search);
    var src = frameSrc(id, win.location.search);
    // The launch parameters are one-shots: out of the address bar, so
    // a reload of this window is a plain start.
    try { win.history.replaceState(null, "", win.location.pathname); } catch (e) {}

    var frame = doc.createElement("iframe");
    frame.id = "solo-frame";
    frame.title = nameOf(id, "en");
    frame.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write; geolocation; camera; microphone; screen-wake-lock");
    frame.src = src;
    doc.body.appendChild(frame);
    installBar(win, id, asked);
    setTimeout(function () { apkNotice(win, id, code); }, 3000);
    // Keyboard focus into the app, unless the app already took it
    // (a shortcut that focuses an input): focusing the frame again
    // would blur that input.
    frame.addEventListener("load", function () {
      try { if (doc.activeElement !== frame) frame.focus(); } catch (e) {}
    });

    // "Open with" (file_handlers): the browser hands the files to the
    // TOP page only. They wait until the shell in the frame has its
    // file module (fileopen.js queues them until the app list is in).
    var waiting = [];
    function handOver() {
      var fo = null;
      try { fo = frame.contentWindow && frame.contentWindow.orosFileOpen; } catch (e) { fo = null; }
      if (!fo || typeof fo.open !== "function") return false;
      fo.open(waiting.splice(0));
      return true;
    }
    function deliver(files) {
      waiting = waiting.concat(files);
      var tries = 0;
      (function again() {
        if (handOver() || ++tries > 150) return;   // 30 s, then give up quietly
        setTimeout(again, 200);
      })();
    }
    if (win.launchQueue && typeof win.launchQueue.setConsumer === "function") {
      win.launchQueue.setConsumer(function (params) {
        var hs = params && params.files ? Array.prototype.slice.call(params.files) : [];
        if (!hs.length) return;
        Promise.all(hs.map(function (h) {
          return h && typeof h.getFile === "function" ? h.getFile().then(null, function () { return null; }) : null;
        })).then(function (files) {
          files = files.filter(Boolean);
          if (files.length) deliver(files);
        });
      });
    }

    // What the shell in the frame asks of the top page.
    win.__orosSoloHost = {
      v: 1,
      id: id,
      title: function (t) {
        t = String(t || "").slice(0, 120);
        if (t) doc.title = t;
      },
      badge: function (n) {
        var nav = win.navigator;
        n = Math.max(0, Math.floor(Number(n) || 0));
        try {
          if (n > 0 && typeof nav.setAppBadge === "function") nav.setAppBadge(n).catch(function () {});
          else if (typeof nav.clearAppBadge === "function") nav.clearAppBadge().catch(function () {});
        } catch (e) {}
      }
    };
  }

  // ---------- Shell side ----------
  // window.orosSolo in the shell: set before shell.js / fileopen.js
  // load, so both can ask "which single app am I?" at boot.
  var api = {
    v: 1,
    APPS: APPS,
    FORWARD: FORWARD,
    has: has,
    ids: ids,
    nameOf: nameOf,
    idFromPath: idFromPath,
    idFromSearch: idFromSearch,
    frameSrc: frameSrc,
    shortcut: shortcut,
    shareFromSearch: shareFromSearch,
    shareTarget: shareTarget,
    manifestFor: manifestFor,
    pageFor: pageFor,
    hostBoot: host,
    installUrl: installUrl,
    apkUrl: apkUrl,
    apkHref: apkHref,
    browserHref: browserHref,
    apkPkgOf: apkPkgOf,
    pkgOf: pkgOf,
    repoLink: repoLink,
    repoPage: REPO,
    obtainiumLink: obtainiumLink,
    apkCode: apkCode,
    id: "",
    share: null,
    word: ""
  };

  if (root && root.document && root.location) {
    api.id = idFromSearch(root.location.search);
    if (api.id) {
      // Read before the shell strips its own launch parameters.
      api.share = shareFromSearch(root.location.search);
      try { api.word = new URLSearchParams(root.location.search).get("solo-do") || ""; } catch (e) { api.word = ""; }
      try {
        var u = new URL(root.location.href);
        u.searchParams.delete("solo-do");
        if (api.share) ["share-url", "share-title", "share-text"].forEach(function (k) { u.searchParams.delete(k); });
        root.history.replaceState(root.history.state, "", u.pathname + u.search + u.hash);
      } catch (e) {}
    }
    // The orOS Android app itself (not a single app): its launch
    // address carries ?apk=<versionCode> too.
    else if (root.top === root && root.location.pathname === "/") {
      var mainCode = apkCode(root.location.search);
      if (mainCode) {
        try {
          var mu = new URL(root.location.href);
          mu.searchParams.delete("apk");
          root.history.replaceState(root.history.state, "", mu.pathname + mu.search + mu.hash);
        } catch (e) {}
      }
      var later = function () { setTimeout(function () { apkNotice(root, "oros", mainCode); }, 5000); };
      if (root.document.readyState === "complete") later();
      else root.addEventListener("load", later);
    }
    // The host page that framed us (same origin), if any.
    api.host = function () {
      try {
        var p = root.parent;
        return p && p !== root && p.__orosSoloHost && p.__orosSoloHost.id === api.id ? p.__orosSoloHost : null;
      } catch (e) { return null; }
    };
    root.orosSolo = api;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
