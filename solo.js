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
      name: { en: "orOS Notes", el: "orOS Σημειώσεις" },
      shortcuts: [{ do: "new", name: { en: "New page", el: "Νέα σελίδα" }, target: { newPage: true } }],
      share: "note"
    },
    calendar: {
      name: { en: "orOS Calendar", el: "orOS Ημερολόγιο" },
      shortcuts: [{ do: "new", name: { en: "New event", el: "Νέο συμβάν" }, calNew: true }],
      share: "event"
    },
    bookmarks: {
      name: { en: "orOS Bookmarks", el: "orOS Σελιδοδείκτες" },
      shortcuts: [{ do: "add", name: { en: "Add a bookmark", el: "Νέος σελιδοδείκτης" }, target: { quickAdd: true } }],
      share: "link"
    },
    todo: {
      name: { en: "orOS To-Do", el: "orOS Εργασίες" },
      shortcuts: [{ do: "new", name: { en: "New task", el: "Νέα εργασία" }, target: { quickAdd: true } }],
      share: "task",
      badge: "due"
    },
    // Wave 2: office apps.
    contacts: {
      name: { en: "orOS Contacts", el: "orOS Επαφές" },
      shortcuts: [{ do: "new", name: { en: "New contact", el: "Νέα επαφή" }, target: { newContact: true } }],
      share: "contact"
    },
    writer: {
      name: { en: "orOS Writer", el: "orOS Κειμενογράφος" },
      shortcuts: [{ do: "new", name: { en: "New document", el: "Νέο έγγραφο" }, target: { newBlank: true } }],
      share: "doc"
    },
    spreadsheet: {
      name: { en: "orOS Spreadsheet", el: "orOS Υπολογιστικά φύλλα" },
      shortcuts: [{ do: "new", name: { en: "New sheet", el: "Νέο φύλλο" }, target: { newBlank: true } }],
      share: "sheet"
    },
    kanban: {
      name: { en: "orOS Kanban", el: "orOS Πίνακες Kanban" },
      shortcuts: [{ do: "new", name: { en: "New card", el: "Νέα κάρτα" }, target: { quickAdd: true } }],
      share: "card"
    },
    mindmap: {
      name: { en: "orOS Mind Map", el: "orOS Νοητικός χάρτης" },
      shortcuts: [{ do: "new", name: { en: "New map", el: "Νέος χάρτης" }, target: { newMap: true } }],
      share: "map"
    },
    wiki: {
      name: { en: "orOS Wiki", el: "orOS Wiki" },
      shortcuts: [{ do: "new", name: { en: "New article", el: "Νέο άρθρο" }, target: { newArt: {} } }],
      share: "article"
    },
    slides: {
      name: { en: "orOS Slides", el: "orOS Παρουσιάσεις" },
      shortcuts: [{ do: "new", name: { en: "New presentation", el: "Νέα παρουσίαση" }, target: { newDeck: true } }],
      share: "outline"
    },
    // Wave 3: personal apps. Water, Diary, Mood, Health and Cycle take
    // no shares (nothing a shared text should become there).
    passwords: {
      name: { en: "orOS Passwords", el: "orOS Κωδικοί" },
      shortcuts: [{ do: "gen", name: { en: "Generate a password", el: "Νέος κωδικός" }, target: { gen: true } },
                  { do: "new", name: { en: "New vault entry", el: "Νέα καταχώριση" }, target: { newEntry: {} } }],
      share: "login"
    },
    budget: {
      name: { en: "orOS Budget", el: "orOS Έσοδα & Έξοδα" },
      shortcuts: [{ do: "new", name: { en: "New expense", el: "Νέο έξοδο" }, target: { newTx: {} } }],
      share: "expense"
    },
    habits: {
      name: { en: "orOS Habits", el: "orOS Συνήθειες" },
      shortcuts: [{ do: "new", name: { en: "New habit", el: "Νέα συνήθεια" }, target: { add: true } }],
      share: "habit"
    },
    water: {
      name: { en: "orOS Water", el: "orOS Νερό" },
      shortcuts: [{ do: "glass", name: { en: "Add a glass", el: "Ένα ποτήρι" }, target: { sip: "glass" } }]
    },
    diary: {
      name: { en: "orOS Diary", el: "orOS Ημερολόγιο μιας πρότασης" },
      shortcuts: [{ do: "write", name: { en: "Write today's sentence", el: "Η σημερινή πρόταση" }, target: { write: true } }]
    },
    mood: {
      name: { en: "orOS Mood", el: "orOS Διάθεση" },
      shortcuts: [{ do: "log", name: { en: "Log my mood", el: "Πώς νιώθω" }, target: { checkin: true } }]
    },
    fitness: {
      name: { en: "orOS Workouts", el: "orOS Προπόνηση" },
      shortcuts: [{ do: "log", name: { en: "Log a workout", el: "Νέα προπόνηση" }, target: { logNew: true } }],
      share: "workout"
    },
    health: {
      name: { en: "orOS Health", el: "orOS Υγεία" },
      shortcuts: [{ do: "bp", name: { en: "New blood pressure", el: "Νέα πίεση" }, target: { add: "bp" } },
                  { do: "wt", name: { en: "New weight", el: "Νέο βάρος" }, target: { add: "wt" } }]
    },
    cycle: {
      name: { en: "orOS Cycle", el: "orOS Κύκλος" },
      shortcuts: [{ do: "today", name: { en: "Log today", el: "Καταγραφή σήμερα" }, target: { today: true } }]
    },
    // Wave 4: tools and media.
    calculator: {
      name: { en: "orOS Calculator", el: "orOS Αριθμομηχανή" },
      shortcuts: [{ do: "sci", name: { en: "Scientific", el: "Επιστημονική" }, target: { mode: "sci" } },
                  { do: "graph", name: { en: "Graphs", el: "Γραφήματα" }, target: { mode: "graph" } }]
    },
    time: {
      name: { en: "orOS Time", el: "orOS Ώρα" },
      shortcuts: [{ do: "timer", name: { en: "Timer", el: "Αντίστροφη μέτρηση" }, target: { pane: "timer" } },
                  { do: "stopwatch", name: { en: "Stopwatch", el: "Χρονόμετρο" }, target: { pane: "stopwatch" } },
                  { do: "alarms", name: { en: "Alarms", el: "Ξυπνητήρια" }, target: { pane: "alarms" } }]
    },
    weather: {
      name: { en: "orOS Weather", el: "orOS Καιρός" },
      shortcuts: [{ do: "city", name: { en: "Add a city", el: "Νέα πόλη" }, target: { addCity: true } }]
    },
    maps: {
      name: { en: "orOS Maps", el: "orOS Χάρτες" },
      shortcuts: [{ do: "locate", name: { en: "My location", el: "Η θέση μου" }, target: { locate: true } },
                  { do: "park", name: { en: "Where I parked", el: "Πού πάρκαρα" }, target: { park: true } }],
      share: "place"
    },
    feeds: {
      name: { en: "orOS Reader", el: "orOS Αναγνώστης" },
      shortcuts: [{ do: "add", name: { en: "Add a feed", el: "Νέα ροή" }, target: { addBlank: true } }],
      share: "feed"
    },
    mail: {
      name: { en: "orOS Mail", el: "orOS Αλληλογραφία" },
      shortcuts: [{ do: "new", name: { en: "New mail", el: "Νέο μήνυμα" }, target: { compose: {} } }],
      share: "mail"
    },
    files: {
      name: { en: "orOS Files", el: "orOS Αρχεία" },
      // (no "Add files": a file picker needs a tap inside the page)
      shortcuts: [{ do: "folder", name: { en: "New folder", el: "Νέος φάκελος" }, target: { newFolder: true } }]
    },
    podcasts: {
      name: { en: "orOS Podcasts", el: "orOS Podcasts" },
      shortcuts: [{ do: "find", name: { en: "Find a podcast", el: "Εύρεση podcast" }, target: { find: true } }],
      share: "podcast"
    },
    radio: {
      name: { en: "orOS Radio", el: "orOS Ραδιόφωνο" },
      shortcuts: [{ do: "last", name: { en: "Play the last station", el: "Ο τελευταίος σταθμός" }, target: { play: "last" } }]
    },
    photolab: {
      name: { en: "orOS Photo Lab", el: "orOS Εργαστήριο εικόνας" },
      // (no "Open a picture": a file picker needs a tap inside the page)
      shortcuts: [{ do: "new", name: { en: "New picture", el: "Νέα εικόνα" }, target: { newPic: true } }]
    },
    // Wave 5: business.
    invoices: {
      name: { en: "orOS Invoices", el: "orOS Τιμολόγια" },
      shortcuts: [{ do: "invoice", name: { en: "New invoice", el: "Νέο τιμολόγιο" }, target: { newDoc: "inv" } },
                  { do: "receipt", name: { en: "New receipt", el: "Νέα απόδειξη" }, target: { newDoc: "rcpt" } }],
      share: "invoice"
    },
    crm: {
      name: { en: "orOS CRM", el: "orOS Πελάτες" },
      shortcuts: [{ do: "new", name: { en: "New customer", el: "Νέος πελάτης" }, target: { newCust: true } }],
      share: "customer"
    },
    timesheet: {
      name: { en: "orOS Timesheet", el: "orOS Ώρες εργασίας" },
      shortcuts: [{ do: "timer", name: { en: "Start or stop the timer", el: "Έναρξη ή διακοπή χρονομέτρου" }, target: { toggle: true } },
                  { do: "entry", name: { en: "New time entry", el: "Νέα καταχώριση" }, target: { newEntry: true } }]
    },
    // Wave 6: every game in one app (Game Center is its home; a game
    // opened from it gets Back). files: other apps whose file types
    // this app's icon also opens (fileopen.js still routes them).
    gamecenter: {
      name: { en: "orOS Games", el: "orOS Παιχνίδια" },
      shortcuts: [{ do: "wordle", name: { en: "Today's Wordle", el: "Το σημερινό Wordle" }, target: { play: "wordle", daily: true } },
                  { do: "crossword", name: { en: "Today's crossword", el: "Το σημερινό σταυρόλεξο" }, target: { play: "crossword", daily: true } },
                  { do: "sudoku", name: { en: "Today's Sudoku", el: "Το σημερινό Sudoku" }, target: { play: "sudoku", daily: true } },
                  { do: "chess", name: { en: "Chess", el: "Σκάκι" }, target: { play: "chess" } }],
      files: ["chess"]
    }
  };

  var ID_RE = /^[a-z0-9-]{1,40}$/;
  // Launch parameters the host hands to the shell frame unchanged
  // (each one is checked again where it is used).
  var FORWARD = ["do", "share-url", "share-title", "share-text", "share-files", "file-open"];
  var MAX_PARAM = 4000;

  function has(id) {
    return typeof id === "string" && ID_RE.test(id) && Object.prototype.hasOwnProperty.call(APPS, id);
  }
  function ids() { return Object.keys(APPS); }
  function lang(l) { return l === "el" ? "el" : "en"; }
  function nameOf(id, l) { return has(id) ? APPS[id].name[lang(l)] : ""; }

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
      name: a.name.en,
      short_name: a.name.en.replace(/^orOS /, ""),
      description: a.name.en + ": the orOS app on its own. Works offline, no cookies, no tracking; encrypted sync only if you turn it on.",
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
        return { name: s.name.en, short_name: s.name.en, url: page + "?do=" + s.do,
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
  function installUrl(id, ua, origin, inApp) {
    if (!has(id)) return "";
    if (inApp) return "intent://install/" + id + "#Intent;scheme=oros-permission;package=online.useoros.twa;end";
    var page = "/" + id + "/solo.html?install";
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
  // "browser") and once installed.
  var BAR_TEXT = {
    en: { ask: "Install {n} on this device", btn: "Install", how: "To install {n}: open the browser menu (⋮) and choose Install app or Add to Home screen.", close: "Close" },
    el: { ask: "Εγκατάσταση του {n} σε αυτή τη συσκευή", btn: "Εγκατάσταση", how: "Για να εγκαταστήσεις το {n}: άνοιξε το μενού του browser (⋮) και πάτησε Εγκατάσταση εφαρμογής ή Προσθήκη στην αρχική οθόνη.", close: "Κλείσιμο" }
  };
  function installBar(win, id, asked) {
    var doc = win.document, bar = null, deferred = null, lng = "en";
    try { lng = lang(win.localStorage.getItem("oros-lang")); } catch (e) {}
    try { if (!win.matchMedia("(display-mode: browser)").matches) return; } catch (e) { return; }
    var T = BAR_TEXT[lng], name = nameOf(id, lng);
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
      txt.textContent = (withButton ? T.ask : T.how).replace("{n}", name);
      bar.appendChild(txt);
      if (withButton) {
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
